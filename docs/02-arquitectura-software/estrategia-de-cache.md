# Estrategia de caché con Redis

Decisión: [ADR-005](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-005-redis-como-caché-selectiva). Táctica T01. Escenarios EQ-01 y EQ-05.

## 1. Principio

Redis es una **caché selectiva**. **Nunca** es la fuente de verdad de reservas, pagos ni suscripciones. PostgreSQL decide la disponibilidad definitiva en el momento de reservar.

Desde la constitución 1.1.0 (principio VIII), Redis también puede guardar **contadores no críticos**: los del límite general de solicitudes, tolerantes a pérdida. Los contadores de seguridad o de costo (intentos de inicio de sesión, cuota de IA) y todo estado de seguridad (sesiones, revocación) se quedan en PostgreSQL. Sin Redis, el límite general se aplica por instancia. Decisión detallada: ADR-029 (por escribir con la funcionalidad 006).

## 2. Qué se cachea y qué no

| Dato                                                   | ¿Se cachea?                          | Clave (con tenant)                      | TTL propuesto       | Invalidación                           |
| ------------------------------------------------------ | ------------------------------------ | --------------------------------------- | ------------------- | -------------------------------------- |
| Catálogo público de la barbería                        | Sí                                   | `t:{tenantId}:catalog`                  | 5 min               | Al crear/editar servicios o barberos   |
| Servicios y precios                                    | Sí                                   | `t:{tenantId}:services`                 | 5 min               | Al modificar servicios                 |
| Configuración y horarios de la barbería                | Sí                                   | `t:{tenantId}:config`                   | 5 min               | Al modificar la configuración          |
| Plan y límites del tenant                              | Sí                                   | `t:{tenantId}:plan`                     | 60 s                | Al cambiar el estado de la suscripción |
| Rango de horarios libres calculado (solo para mostrar) | Opcional                             | `t:{tenantId}:slots:{barberId}:{fecha}` | ≤ 30 s              | Al crear/cancelar/reprogramar cita     |
| **Disponibilidad definitiva**                          | **No**                               | —                                       | —                   | Se verifica en PostgreSQL              |
| Citas, pagos, suscripciones (estado)                   | **No**                               | —                                       | —                   | PostgreSQL es la fuente                |
| Tokens revocados / sesiones cerradas                   | **No**                               | —                                       | —                   | Estado de seguridad: se verifica en PostgreSQL en cada solicitud (funcionalidad 001, R09) |
| Contadores del límite general de solicitudes (no críticos) | Sí                               | `rl:{ip}:{ruta}`; `rl:t:{tenantId}:u:{userId}:{ruta}` si es por usuario | 1 min | Expiración |
| Intentos de inicio de sesión y cuota de IA             | **No**                               | —                                       | —                   | Contadores de seguridad y de costo: en PostgreSQL |

Todas las claves de datos de negocio **incluyen el tenant** para evitar mezclas.

## 3. Patrón de lectura y escritura

- **Lectura (cache-aside):** buscar en Redis → si no está, leer de PostgreSQL → guardar con TTL.
- **Escritura:** primero PostgreSQL; luego **invalidar** la clave (no actualizar la caché con el nuevo valor para evitar condiciones de carrera).
- **Reserva:** nunca se confía en el cálculo en caché; la inserción con la restricción de exclusión es la garantía.

## 4. Comportamiento si Redis cae (EQ-05)

| Función                              | Comportamiento                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| Lecturas de catálogo y configuración | Se leen de PostgreSQL (más lentas)                                           |
| Reservas                             | Funcionan igual y siguen siendo correctas                                    |
| Límite de solicitudes                | Se usa un límite local por instancia con valores más estrictos (degradación) |
| Alerta                               | Se emite una alerta; el adaptador de caché abre su circuit breaker           |

## 5. Riesgos y mitigaciones

| Riesgo                                                    | Mitigación                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Datos desactualizados                                     | TTL corto; invalidación al escribir; la disponibilidad definitiva no sale de la caché |
| Mezcla de tenants por clave mal construida                | Constructor único de claves en el adaptador; prueba PR09 incluye caché                |
| Condición de carrera "lectura → escritura → invalidación" | Invalidar después de confirmar la transacción; TTL como red de seguridad              |
| Fuga de datos personales en Redis                         | No se guardan datos personales de clientes en caché                                   |
| Dependencia excesiva                                      | Si Redis cae, la plataforma sigue funcionando (PR05)                                  |

## 6. Cómo se evitan condiciones de carrera en las reservas

Dos clientes ven el mismo horario libre en pantalla (dato posiblemente de caché) y ambos intentan reservar. Ambas solicitudes llegan al backend, cada una abre una transacción e intenta insertar. La **restricción de exclusión** de PostgreSQL permite una y rechaza la otra. La interfaz recibe "horario no disponible" y refresca. Ni Redis ni la interfaz intervienen en la decisión.
