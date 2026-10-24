# Estrategia de caché con Redis

Decisión: [ADR-005](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-005-redis-como-caché-selectiva). Táctica T01. Escenarios EQ-01 y EQ-05.

## 1. Principio

Redis es una **caché selectiva**. **Nunca** es la fuente de verdad de reservas, pagos ni suscripciones. PostgreSQL decide la disponibilidad definitiva en el momento de reservar.

Desde la constitución 1.1.0 (principio VIII), Redis también puede guardar **contadores no críticos**: los del límite general de solicitudes, tolerantes a pérdida. Los contadores de seguridad o de costo (intentos de inicio de sesión, cuota de IA) y todo estado de seguridad (sesiones, revocación) se quedan en PostgreSQL. Sin Redis, el límite general se aplica por instancia. Decisión detallada: [ADR-029](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-029-caché-compartida-con-claves-por-barbería-y-límite-general-compartido) (Aceptado el 2026-10-19, funcionalidad 006).

## 2. Qué se cachea y qué no (implementado en la funcionalidad 006)

Contrato completo: [`specs/006-escalado-cache-balanceo/contracts/cache-claves.md`](../../specs/006-escalado-cache-balanceo/contracts/cache-claves.md). Todas las claves las construye una sola fábrica (`ClavesCache` en M06), que exige el `TenantId`: no se puede crear una clave de datos sin tenant ni derivada del `slug`. El prefijo lleva la versión del formato (`v1`): cambiarlo deja inalcanzable lo anterior.

| Dato                                                                | ¿Se cachea?          | Clave                                                 | TTL                              | Invalidación                                                                                                    |
| ------------------------------------------------------------------- | -------------------- | ----------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Catálogo público: horario de atención, servicios y barberos activos | Sí                   | `bp:v1:t:{tenantId}:catalogo-publico`                 | 120 s (configurable de 10 a 300) | Tras confirmar cada cambio de la matriz (abajo); generación en `…:catalogo-publico:gen` (24 h)                  |
| Datos de la barbería y su enlace (`slug`)                           | **No**               | —                                                     | —                                | Se leen en cada solicitud, en una transacción de M01: un enlace cambiado no responde nunca                      |
| Horarios libres calculados (FR-013b)                                | **No** (desactivado) | `bp:v1:t:{tenantId}:horarios:g{gen}:…` si se activara | 30 s                             | No aplicado: la medición de 006 cumplió la meta sin él. Los horarios leen siempre vigentes la ocupación del día |
| Contadores del límite general por IP (no críticos)                  | Sí                   | `rl:v1:{hash}` (la clave del guard, sin tenant)       | La ventana del límite (60 s)     | Expiración; compartidos entre réplicas                                                                          |
| **Disponibilidad definitiva**                                       | **No**               | —                                                     | —                                | Se verifica en PostgreSQL                                                                                       |
| Citas, pagos, suscripciones (estado)                                | **No**               | —                                                     | —                                | PostgreSQL es la fuente                                                                                         |
| Tokens revocados / sesiones cerradas                                | **No**               | —                                                     | —                                | Estado de seguridad: se verifica en PostgreSQL en cada solicitud (funcionalidad 001, R09)                       |
| Intentos de inicio de sesión y cuota de IA                          | **No**               | —                                                     | —                                | Contadores de seguridad y de costo: en PostgreSQL                                                               |
| Plan, configuración y servicios por separado                        | **No** en 006        | —                                                     | —                                | Sin necesidad medida                                                                                            |

La entrada del catálogo tiene una **lista cerrada de campos** (columnas públicas de ADR-021): nunca datos de clientes, contacto o cuenta del personal, motivos de bloqueo, citas ni disponibilidad semanal. Lo comprueba la prueba PR09 de la caché (`aislamiento-cache`).

**Matriz de invalidación del catálogo** (después del COMMIT, con `UnitOfWork.alConfirmar`):

| Invalida el catálogo                                                                                                                    | No lo invalida (el dato no está en la entrada)                                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `CrearServicio`, `ActualizarServicio`, `CrearBarbero`, `ActualizarBarbero` (incluido el usuario vinculado), `ReemplazarHorarioAtencion` | Disponibilidad semanal, bloqueos, citas y sus estados, datos y enlace de la barbería |

Todas las claves de datos de negocio **incluyen el tenant** para evitar mezclas. Los contadores del límite general no son datos de una barbería: son contadores por IP regulados por el principio VIII (interpretación registrada en ADR-029).

## 3. Patrón de lectura y escritura

- **Lectura (cache-aside con generación):** buscar en Redis → si no está, leer la generación → leer de PostgreSQL → guardar **solo si la generación no cambió** (script Lua atómico). Así, si un cambio se confirma entre la lectura y el guardado, la entrada vieja no se guarda (R08 de 006).
- **Escritura:** primero PostgreSQL; **después del COMMIT**, subir la generación y borrar la clave en una sola operación (no se actualiza la caché con el nuevo valor). Si la transacción se revierte, no se invalida nada.
- **Horarios libres:** usan la entrada del catálogo si ya existe (sin llenarla) y leen de PostgreSQL la ocupación del día; sin entrada, lo leen todo en una transacción.
- **Reserva:** nunca se confía en el cálculo en caché; la inserción con la restricción de exclusión es la garantía.

## 4. Comportamiento si Redis cae (EQ-05)

Probado en CI (PR05, `redis-caido`) y con el entorno real (`npm run demo:caida -- --objetivo redis`).

| Función                           | Comportamiento                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lecturas del catálogo y horarios  | Se leen de PostgreSQL, con los mismos datos. Cada operación con Redis tiene un tiempo límite de 100 ms; tras 5 fallos seguidos el interruptor deja de usar Redis durante 10 s |
| Reservas, cancelaciones y estados | Funcionan igual y siguen siendo correctas; la doble reserva sigue rechazada por PostgreSQL                                                                                    |
| Cambios del catálogo              | Se guardan; la invalidación se omite y la entrada vieja que pudiera quedar vence con su TTL (120 s como máximo)                                                               |
| Límite de solicitudes             | Cada instancia lo aplica en memoria **con los mismos valores** (con dos réplicas, una IP puede llegar al doble hasta que Redis vuelve)                                        |
| Alerta                            | Una sola línea `CACHE_NO_DISPONIBLE` por caída y por réplica, y `CACHE_RECUPERADA` al volver; nunca una por solicitud                                                         |
| Recuperación                      | Sin reiniciar: pasada la pausa, una operación de prueba y, si responde, se vuelve a usar Redis                                                                                |
| Arranque sin Redis                | Las réplicas arrancan, quedan listas (`/salud/listo` no mira Redis) y funcionan sin caché                                                                                     |

## 5. Riesgos y mitigaciones

| Riesgo                                                    | Mitigación                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Datos desactualizados                                     | TTL corto; invalidación al escribir; la disponibilidad definitiva no sale de la caché           |
| Mezcla de tenants por clave mal construida                | Constructor único de claves en el adaptador; prueba PR09 incluye caché                          |
| Condición de carrera "lectura → escritura → invalidación" | Invalidar después de confirmar; guardado condicionado por generación; TTL como red de seguridad |
| Fuga de datos personales en Redis                         | No se guardan datos personales de clientes en caché                                             |
| Dependencia excesiva                                      | Si Redis cae, la plataforma sigue funcionando (PR05)                                            |

## 6. Cómo se evitan condiciones de carrera en las reservas

Dos clientes ven el mismo horario libre en pantalla (dato posiblemente de caché) y ambos intentan reservar. Ambas solicitudes llegan al backend, cada una abre una transacción e intenta insertar. La **restricción de exclusión** de PostgreSQL permite una y rechaza la otra. La interfaz recibe "horario no disponible" y refresca. Ni Redis ni la interfaz intervienen en la decisión.
