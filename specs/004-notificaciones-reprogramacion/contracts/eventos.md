# Eventos de dominio y salida transaccional (M06, ADR-025)

## 1. Interfaz del bus (M06, `shared/eventos/`, sin reglas de negocio)

| Operación                                   | Qué hace                                                                                                      | Dónde se llama                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `publicar(evento, { disponibleDesde? })`    | `INSERT` en `outbox_event` **en la transacción en curso** (falla si no hay una); pide despacho tras el COMMIT | Casos de uso de M02 y M03                    |
| `reemplazar(clave, evento, { disponibleDesde })` | Anula el pendiente con esa clave en el tenant y publica el nuevo, en la misma transacción                 | Reservar y reprogramar (recordatorio)        |
| `anular(clave)`                             | Anula el pendiente con esa clave en el tenant, si existe                                                      | Cancelar, completar y no asistió             |
| `suscribir(tipo, manejador)`                | Registra el manejador de un tipo; solo desde `host/eventos.ts` (raíz de composición)                          | Host, para M05                               |

El tenant del evento es **el de la transacción en curso** (`TenantContext`), nunca un parámetro. Un evento sin tenant no se puede publicar.

## 2. Garantías y semántica

1. **Atomicidad con la operación (FR-010).** El evento se inserta en la misma transacción que el cambio. Si la operación se revierte, el evento no existe.
2. **Al menos una entrega al manejador, sin efectos dobles (FR-012).** El despacho toma el evento con `FOR UPDATE SKIP LOCKED`, ejecuta el manejador y marca `PROCESADO` en **la misma transacción**, con el tenant del evento. Si la réplica cae antes del COMMIT, el evento sigue `PENDIENTE` y otra réplica lo toma. Los manejadores de M05 son idempotentes: el aviso es único por `(evento, destinatario)`.
3. **Orden.** No se garantiza orden global. Dentro de una cita, los avisos se componen con los datos del propio evento (hora anterior y nueva), así que el orden de llegada no cambia el contenido.
4. **Manejador que falla.** El evento sigue `PENDIENTE`, con `attempts + 1` y `next_attempt_at` según la espera creciente. A los 10 intentos queda pendiente y se registra un error para revisar. Nunca se borra un evento sin procesar.
5. **Despacho.** Ocurre (a) tras el COMMIT, en la réplica que publicó, para ese tenant, y (b) en la tarea `despachar-eventos`, cada 15 s, bajo el candado del ejecutor (ADR-024). La tarea lista los pendientes con `barberias_plataforma` (solo `id`, `tenant_id`, `status`, `available_at`, `next_attempt_at`) y procesa cada evento en una transacción con su tenant y `barberias_app`.

## 3. Catálogo de eventos de 004

El `payload` lleva **solo** lo que el mensaje necesita, sin datos de contacto (correo, teléfono o número de WhatsApp). M05 los obtiene de M01 al enviar.

| Tipo                   | Publica | Cuándo                                                                 | `payload`                                                                                                   | Clave de reemplazo                |
| ---------------------- | ------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `CitaCreada`           | M02     | Reserva del cliente o cita presencial                                  | `citaId, version, clienteId, servicio, barbero, barberoUsuarioId?, inicio, fin, zonaHoraria, origen`         | —                                 |
| `CitaCancelada`        | M02     | Cancelación (sesión, propietario o enlace)                             | `citaId, clienteId, servicio, barbero, barberoUsuarioId?, inicio, zonaHoraria, canceladaPor (CLIENTE o PROPIETARIO), tardia` | —                 |
| `CitaReprogramada`     | M02     | Reprogramación con cambio (sesión, propietario o enlace)               | `citaId, version, clienteId, servicio, barbero, barberoUsuarioId?, inicioAnterior, inicio, fin, zonaHoraria, reprogramadaPor` | —                 |
| `RecordatorioDeCita`   | M02     | Programado a `inicio − 2 h` al crear o reprogramar (si faltan ≥ 2 h)   | `citaId, version, clienteId, servicio, barbero, inicio, fin, zonaHoraria`                                   | `recordatorio:<citaId>`           |
| `PruebaPorTerminar`    | M03     | Tarea `avisar-fin-de-prueba` (US5)                                     | `suscripcionId, finPrueba`                                                                                  | `prueba-por-terminar:<id>` (única por prueba) |
| `SuscripcionEnGracia`  | M03     | Transición a `PAST_DUE` en `vencer-suscripciones` (US5)                | `suscripcionId, finGracia`                                                                                  | —                                 |
| `SuscripcionVencida`   | M03     | Transición a `EXPIRED` en `vencer-suscripciones` (US5)                 | `suscripcionId, vencidaEn`                                                                                  | —                                 |
| `PagoAprobado`         | M03     | Aprobación del pago (proveedor o transferencia) (US5)                  | `pagoId, plan, periodoDesde, periodoHasta`                                                                  | —                                 |
| `PagoRechazado`        | M03     | Rechazo del pago (proveedor o comprobante) (US5)                       | `pagoId, plan, motivo?`                                                                                     | —                                 |

`servicio` y `barbero` son el nombre del servicio copiado en la cita y el **nombre visible** del barbero (dato público de la barbería). El nombre de la barbería lo obtiene M05 de M01 al componer el mensaje.

## 4. Destinatarios que crea M05 por evento

| Evento                                     | Cliente (canal elegido) | Propietario (correo) | Barbero con usuario (correo)  |
| ------------------------------------------ | ----------------------- | -------------------- | ----------------------------- |
| `CitaCreada`                               | ✓                       | —                    | —                             |
| `CitaCancelada` por el cliente             | ✓                       | ✓                    | ✓ (si `barberoUsuarioId`)     |
| `CitaCancelada` por el propietario         | ✓                       | —                    | —                             |
| `CitaReprogramada` por el cliente          | ✓                       | ✓                    | ✓ (si `barberoUsuarioId`)     |
| `CitaReprogramada` por el propietario      | ✓                       | —                    | —                             |
| `RecordatorioDeCita`                       | ✓ (con los 3 enlaces)   | —                    | —                             |
| Eventos de suscripción (US5)               | —                       | ✓                    | —                             |

Un cliente presencial sin correo no recibe nada (FR-015); el aviso queda `DESCARTADO` con el motivo `SIN_CANAL`. Al recibir `CitaCancelada` o `CitaReprogramada`, M05 descarta además los avisos `RECORDATORIO` de esa cita que estén `PENDIENTE` (R09).
