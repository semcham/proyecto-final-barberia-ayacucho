# Tácticas arquitectónicas

Una táctica es una decisión de diseño concreta para lograr un atributo de calidad. Esta tabla conecta atributo/driver → táctica → dónde se aplica → cómo se verifica.

## 1. Catálogo

| ID  | Táctica                                                                                                      | Atributo / driver      | Dónde se aplica                                                         | Estado                                         | Verificación               |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- | -------------------------- |
| T01 | **Caché selectiva (Redis)** con TTL e invalidación; claves con tenant                                        | AC01, DA03             | M06 `shared/cache/` (`CacheCompartida`, `ClavesCache`); catálogo de M02 | Implementado (006)                             | EQ-01 / PR01; EQ-05 / PR05 |
| T02 | **Balanceo de carga** con verificación de salud                                                              | AC02, AC03, DA04, DA05 | Despliegue: Nginx con 2 réplicas en local; ALB en la nube               | Implementado en local (006); nube planificada  | EQ-04 / PR04               |
| T03 | **Reintentos con espera creciente** (solo operaciones idempotentes)                                          | AC03, DA05             | Hoy: Nginx reintenta GET y HEAD en la otra réplica; el proveedor reenvía la notificación y la conciliación consulta los pendientes | Parcial (003, 006)                             | EQ-06 / PR06               |
| T04 | **Interruptor (circuit breaker)** ante servicios externos                                                    | AC03, DA05, DA08       | M06 `shared/resiliencia/interruptor.ts`, usado por el adaptador de pagos y por Redis | Implementado (003, 006); IA planificada        | EQ-06 / PR06; EQ-05 / PR05 |
| T05 | **Limitación de solicitudes** por IP; intentos de inicio de sesión por cuenta e IP                           | AC04, DA09             | Host (`ThrottlerModule`, contadores compartidos en Redis); M01 (`login_attempt`) | Implementado (001, 006); cuota de IA planificada | EQ-12 / PR12               |
| T06 | **Autenticación y autorización** (JWT ES256 corto + RBAC)                                                    | AC04, DA01             | Host (`AuthGuard`, `RolesGuard`); M01 `identidad`                       | Implementado (001, 003)                        | EQ-07, EQ-08 / PR07, PR08  |
| T07 | **Validación de entradas** (formato en Presentación, reglas en Aplicación/Dominio; consultas parametrizadas) | AC04                   | DTO de cada módulo, `host/validacion.ts`, Kysely                        | Implementado                                   | EQ-10 / PR10               |
| T08 | **Idempotencia** (clave de evento u operación)                                                               | AC07, DA07             | M03 (`provider_event.event_id`); M02 (`Idempotency-Key` de la reserva)  | Implementado (002, 003)                        | EQ-17 / PR17; EQ-16 / PR16 |
| T09 | **Restricciones de exclusión y transacciones** en PostgreSQL                                                 | AC07, DA02             | Citas (`appointment_no_overlap_*`) y períodos de suscripción (`EXCLUDE`) | Implementado (002, 003)                        | EQ-16 / PR16               |
| T10 | **Registro y monitoreo**: logs estructurados, identificador de correlación, métricas, alertas                | AC10, DA12             | Host y M06                                                              | Parcial: registros e id de correlación; métricas y alertas planificadas | EQ-21 / PR21               |
| T11 | **Aislamiento de tenant**: tenant del token + transacción con tenant + RLS                                   | AC04, DA01             | Host, M06 (`TenantContext`, `UnitOfWork`), todas las tablas con `tenant_id` | Implementado                                   | EQ-09 / PR09               |
| T12 | **Degradación controlada** (transferencia si la pasarela cae; sin Redis se lee de PostgreSQL)                | AC03, DA05             | M03 `pagos`; M06 caché                                                  | Implementado (003, 006); IA planificada        | EQ-06 / PR06; EQ-05 / PR05 |
| T13 | **Verificación automática de dependencias** entre módulos                                                    | AC05, DA06             | `backend/.dependency-cruiser.cjs` · CI                                  | Implementado                                   | EQ-14 / PR14               |
| T14 | **Gestión de secretos** por variables de entorno o gestor                                                    | AC04                   | `shared/config/configuracion.ts` · `.env` en local                      | Implementado en local; gestor en la nube planificado | EQ-11 / PR11               |
| T15 | **Respaldo y recuperación**                                                                                  | AC03, DA11             | PostgreSQL · Operación                                                  | Planificado                                    | EQ-22 / PR22               |
| T16 | **Puertos y adaptadores**                                                                                    | AC09, AC05, DA07, DA08 | `PaymentGateway`, `AlmacenComprobantes`, repositorios; `AIProvider` y `NotificationChannel` previstos | Implementado (pagos); IA y mensajería planificadas | EQ-20 / PR20               |
| T17 | **Auditoría** de acciones sensibles                                                                          | AC04, DA11             | M06 `shared/audit/` (`audit_log`); `platform_audit_log`                 | Implementado (001–003)                         | EQ-13 / PR13               |
| T18 | **Servicios sin estado (stateless)**                                                                         | AC02, DA04             | Host · todas las réplicas                                               | Implementado (006)                             | EQ-04 / PR04               |

## 2. Cómo se articulan en los flujos críticos

| Flujo                                      | Tácticas combinadas                                           |
| ------------------------------------------ | ------------------------------------------------------------- |
| Reservar cita                              | T06, T11, T07, T01 (lectura), T09 + T08 (escritura), T10, T17 |
| Confirmar un pago                          | T06 (firma de la notificación), T08, T11, T04, T12, T10, T17  |
| Servir el catálogo público                 | T01, T02, T18, T05                                            |
| Consulta al asistente de IA _(planificado)_ | T06, T05, T11, T16, T03, T04, T12, T10                        |

## 3. Parámetros

Los valores de las tácticas implementadas son los del código; los de las planificadas son **propuestas por validar**.

| Táctica | Parámetro                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01     | Catálogo público: TTL 120 s (`CACHE_CATALOGO_TTL_SEGUNDOS`, de 10 a 300); 100 ms de tiempo límite por operación con Redis. Los horarios libres no se guardan en caché          |
| T02     | Nginx: `max_fails=3 fail_timeout=10s`, conexión de 1 s. Propuesta para el ALB: cada 10 s sobre `/api/v1/salud/listo`, 3 fallos para retirar la instancia                        |
| T03     | _(propuesta)_ 3 intentos con espera 200, 400 y 800 ms, solo en operaciones idempotentes                                                                                         |
| T04     | Pagos: abre tras 5 fallos en 60 s durante 30 s; tiempo límite de 2 s (`PAGOS_TIEMPO_LIMITE_MS`). Redis: abre tras 5 fallos seguidos durante 10 s                                 |
| T05     | General: 300 solicitudes por minuto por IP. Inicio de sesión: 5 fallos en 60 s por cuenta e IP bloquean 60 s, con espera que se duplica hasta 900 s. Administrador: 5 fallos en 15 min. Notificaciones del proveedor: 600 por minuto por IP |
| T15     | _(propuesta)_ Respaldo completo diario; prueba de restauración mensual                                                                                                          |

Evidencia: `backend/src/host/app.module.ts` (límite general), `modules/acceso-barberias/identidad/domain/politica-intentos.ts` y `politica-intentos-plataforma.ts`, `shared/resiliencia/interruptor.ts`, `modules/suscripciones-pagos/pagos/infrastructure/pasarela-simulada.adapter.ts`, `shared/config/configuracion.ts`, `nginx/templates/default.conf.template`.