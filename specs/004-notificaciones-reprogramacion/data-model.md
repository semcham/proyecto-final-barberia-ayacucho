# Data Model: Notificaciones y reprogramación de citas (004)

Migraciones **previstas** `0021` a `0025`. **No se modifica ninguna migración existente.** Cada tabla de barbería tiene `tenant_id`, `UNIQUE (tenant_id, id)` y la política `tenant_isolation` con `FORCE ROW LEVEL SECURITY` (`rlsPorTenant` de `migrations/sql-comun.ts`). El rol `barberias_app` no tiene `BYPASSRLS` ni permiso de `DELETE` sobre estas tablas, salvo donde se indica (`outbox_event` y `notification`, para la purga de retención con RLS, y `action_link_attempt`). El `DELETE` de `notification` lo agrega la migración `0026_purga_avisos` (fase 3, decisión del responsable del 2026-11-09): `0024` no lo daba.

Convenciones: identificadores `uuid` v7 generados en la aplicación; fechas `timestamptz`; nombres de tablas y columnas en inglés, como en 001 a 003.

## 1. M02 · Citas (migración `0023_citas_reprogramacion`)

### 1.1 `appointment` (de 002, ampliada con `ALTER TABLE`)

| Columna nueva         | Tipo          | Regla                                                                                                      |
| --------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `version`             | `int`         | `NOT NULL DEFAULT 1`, `CHECK (version >= 1)`. Sube en 1 al reprogramar, cancelar, completar o marcar como no asistió. Los enlaces la llevan firmada (R06) |
| `client_confirmed_at` | `timestamptz` | Nula por defecto. Se fija al confirmar la asistencia por enlace (FR-028) y se borra al reprogramar (FR-007) |

**Permisos nuevos de `barberias_app`:** `GRANT UPDATE (barber_id, starts_at, ends_at, version, client_confirmed_at) ON appointment`. Los de `0011` siguen. `period` sigue generada, y las dos restricciones de exclusión de `0011` no cambian (principio IV).

**Reglas de la reprogramación** (sentencia condicional, R01):

```text
UPDATE appointment
   SET barber_id = $nuevo, starts_at = $inicio, ends_at = $inicio + duration_min,
       version = version + 1, client_confirmed_at = NULL, updated_at = now()
 WHERE tenant_id = $tenant AND id = $cita AND version = $esperada
   AND status IN ('PENDIENTE', 'CONFIRMADA') AND starts_at > now()
```

- `23P01` en `appointment_no_overlap_barber` → `HORARIO_NO_DISPONIBLE`; en `appointment_no_overlap_customer` → `CITA_SOLAPADA_DEL_CLIENTE` (409).
- 0 filas → `CITA_CAMBIO` (409).
- La duración es la copiada al reservar (FR-005), no la actual del servicio.

**Cancelar, completar y no asistió** (002) suben también `version`, para invalidar los enlaces (FR-025).

### 1.2 `appointment_reschedule` (nueva)

Historial de reprogramaciones, inmutable para la aplicación (FR-005).

| Columna          | Tipo          | Regla                                                       |
| ---------------- | ------------- | ----------------------------------------------------------- |
| `id`             | `uuid`        | PK                                                          |
| `tenant_id`      | `uuid`        | FK `tenant`                                                 |
| `appointment_id` | `uuid`        | FK `(tenant_id, appointment_id)` → `appointment`            |
| `from_barber_id` | `uuid`        | NOT NULL                                                    |
| `from_starts_at` | `timestamptz` | NOT NULL                                                    |
| `to_barber_id`   | `uuid`        | NOT NULL                                                    |
| `to_starts_at`   | `timestamptz` | NOT NULL, `CHECK (from_starts_at <> to_starts_at OR from_barber_id <> to_barber_id)` |
| `changed_by`     | `uuid`        | Usuario (cliente o propietario); nulo si fue por enlace     |
| `via`            | `varchar(12)` | `CHECK (via IN ('SESION', 'ENLACE'))`                       |
| `changed_at`     | `timestamptz` | `DEFAULT now()`                                             |

Índice `(tenant_id, appointment_id, changed_at)`. **Permisos:** `SELECT, INSERT` para `barberias_app`.

### 1.3 `appointment_link_use` (nueva)

Registro del **uso** de un enlace de acción (R06). No existe ninguna fila al emitir el enlace.

| Columna          | Tipo          | Regla                                                                  |
| ---------------- | ------------- | ---------------------------------------------------------------------- |
| `id`             | `uuid`        | PK                                                                     |
| `tenant_id`      | `uuid`        | FK `tenant`                                                            |
| `appointment_id` | `uuid`        | FK `(tenant_id, appointment_id)` → `appointment`                       |
| `link_hash`      | `char(64)`    | SHA-256 (hexadecimal) del token completo. **`UNIQUE (link_hash)`**: el segundo uso choca (`23505`) → `ENLACE_NO_VALIDO` |
| `action`         | `varchar(12)` | `CHECK (action IN ('CONFIRMAR', 'REPROGRAMAR', 'CANCELAR'))`           |
| `used_at`        | `timestamptz` | `DEFAULT now()`                                                        |

La unicidad es **global** (no por tenant) a propósito: un mismo token nunca vale en dos barberías. El hash no revela el token: le falta la parte aleatoria y la llave. **Permisos:** `SELECT, INSERT` para `barberias_app`.

## 2. M01 · Canal de aviso y consentimiento (migración `0022_canal_y_consentimiento_whatsapp`)

### 2.1 `customer_notification_preference` (nueva)

Una fila por perfil de cliente en una barbería. Sin fila, el canal es correo (supuesto de la especificación).

| Columna           | Tipo          | Regla                                                             |
| ----------------- | ------------- | ----------------------------------------------------------------- |
| `tenant_id`       | `uuid`        | FK `tenant`                                                       |
| `customer_id`     | `uuid`        | FK `(tenant_id, customer_id)` → `customer_profile`; PK `(tenant_id, customer_id)` |
| `channel`         | `varchar(10)` | `CHECK (channel IN ('CORREO', 'WHATSAPP'))`                       |
| `whatsapp_number` | `varchar(20)` | `CHECK (whatsapp_number IS NULL OR whatsapp_number ~ '^\+?[0-9 ]{6,20}$')`; propio del cliente, propuesto con su teléfono (FR-017) |
| `updated_at`      | `timestamptz` | `DEFAULT now()`                                                   |

`CHECK (channel <> 'WHATSAPP' OR whatsapp_number IS NOT NULL)`. **Permisos:** `SELECT, INSERT` y `UPDATE (channel, whatsapp_number, updated_at)` para `barberias_app`.

### 2.2 `whatsapp_consent` (nueva)

Consentimiento expreso para WhatsApp, separado de `consent_record` (FR-017, FR-018).

| Columna         | Tipo          | Regla                                                                |
| --------------- | ------------- | -------------------------------------------------------------------- |
| `id`            | `uuid`        | PK                                                                   |
| `tenant_id`     | `uuid`        | FK `tenant`                                                          |
| `customer_id`   | `uuid`        | FK `(tenant_id, customer_id)` → `customer_profile`                   |
| `number`        | `varchar(20)` | El número aceptado                                                   |
| `text_version`  | `varchar(32)` | Versión del texto aceptado (`2026-11`, [texto base](contracts/texto-consentimiento-whatsapp.md)) |
| `accepted_at`   | `timestamptz` | `DEFAULT now()`                                                      |
| `withdrawn_at`  | `timestamptz` | Nula mientras está vigente; `CHECK (withdrawn_at IS NULL OR withdrawn_at >= accepted_at)` |

Índice único parcial `(tenant_id, customer_id) WHERE withdrawn_at IS NULL`: como máximo un consentimiento vigente por cliente y barbería. **Vigente para un envío** si `withdrawn_at IS NULL` y `number` es igual al `whatsapp_number` actual de la preferencia. Cambiar el número retira el anterior y exige uno nuevo (FR-018). **Permisos:** `SELECT, INSERT` y `UPDATE (withdrawn_at)` para `barberias_app`. No hay `DELETE`: la evidencia se conserva.

## 3. M06 · Salida transaccional de eventos (migración `0021_salida_de_eventos`)

### 3.1 `outbox_event` (nueva)

| Columna            | Tipo           | Regla                                                                                     |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------- |
| `id`               | `uuid`         | PK (v7, ordena por creación)                                                              |
| `tenant_id`        | `uuid`         | FK `tenant` (principio III: todo evento lleva el tenant)                                  |
| `type`             | `varchar(48)`  | Tipo del evento ([contracts/eventos.md](contracts/eventos.md))                            |
| `payload`          | `jsonb`        | Datos mínimos de la cita o de la suscripción; **sin correo, teléfono ni número de WhatsApp** |
| `replace_key`      | `varchar(96)`  | Clave de reemplazo opcional (`recordatorio:<citaId>`, `prueba-por-terminar:<id>`)          |
| `available_at`     | `timestamptz`  | Desde cuándo puede despacharse (`now()` o el momento del recordatorio)                    |
| `status`           | `varchar(14)`  | `CHECK (status IN ('PENDIENTE', 'PROCESADO', 'ANULADO', 'SIN_MANEJADOR'))`                 |
| `attempts`         | `smallint`     | Intentos de despacho fallidos del manejador                                               |
| `next_attempt_at`  | `timestamptz`  | Para reintentar un manejador que falló                                                    |
| `created_at`, `processed_at` | `timestamptz` |                                                                                  |

- Índice parcial `(available_at) WHERE status = 'PENDIENTE'` para el despacho.
- Índice único parcial `(tenant_id, replace_key) WHERE status = 'PENDIENTE' AND replace_key IS NOT NULL`: un solo pendiente por clave.
- Índice único `(tenant_id, replace_key) WHERE replace_key LIKE 'prueba-por-terminar:%'`: una vez por prueba, cualquiera sea el estado (FR-037).

**Permisos:**

- `barberias_app`: `SELECT, INSERT`, `UPDATE (status, attempts, next_attempt_at, processed_at)` y `DELETE`, solo para la purga de retención (decisión del responsable, 2026-11-06): la tarea de despacho borra barbería por barbería, en una transacción con su tenant y RLS, y solo eventos en estado final de más de 30 días.
- `barberias_plataforma`: `SELECT (id, tenant_id, status, available_at, next_attempt_at)` y política `plataforma_lectura FOR SELECT TO barberias_plataforma USING (true)`. Solo esas columnas: ni `type` ni `payload`.

**Estados:** `PENDIENTE → PROCESADO` (el manejador terminó en la misma transacción) · `PENDIENTE → ANULADO` (reemplazado o anulado por su clave) · `PENDIENTE → SIN_MANEJADOR` (su tipo no tiene suscriptor: se escribe una advertencia y no se reintenta; decisión del responsable, 2026-11-04). Los tres son finales.

**Retención:** los eventos procesados, anulados o sin manejador se purgan a los 30 días por la tarea de despacho (decisión del responsable, 2026-11-04; research R17).

## 4. M05 · Avisos (migración `0024_avisos`)

### 4.1 `notification` (nueva)

Un aviso por destinatario de un evento. **No guarda el texto del mensaje ni datos de contacto:** se componen al enviar (R12).

| Columna             | Tipo          | Regla                                                                                         |
| ------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `id`                | `uuid`        | PK; se usa como clave de idempotencia ante el canal (`Message-ID`)                           |
| `tenant_id`         | `uuid`        | FK `tenant`                                                                                   |
| `event_id`          | `uuid`        | Evento de origen                                                                              |
| `kind`              | `varchar(32)` | `CITA_CREADA`, `CITA_CANCELADA`, `CITA_REPROGRAMADA`, `RECORDATORIO`, `PRUEBA_POR_TERMINAR`, `SUSCRIPCION_EN_GRACIA`, `SUSCRIPCION_VENCIDA`, `PAGO_APROBADO`, `PAGO_RECHAZADO` |
| `recipient_kind`    | `varchar(12)` | `CHECK (recipient_kind IN ('CLIENTE', 'PROPIETARIO', 'BARBERO'))`                             |
| `recipient_ref`     | `uuid`        | Perfil de cliente o usuario del personal (sin datos de contacto)                              |
| `appointment_id`    | `uuid`        | Nula para los avisos de suscripción; permite descartar recordatorios de una cita              |
| `channel_planned`   | `varchar(10)` | `CORREO` o `WHATSAPP`, al crear el aviso                                                      |
| `channel_used`      | `varchar(10)` | Canal con el que se envió                                                                     |
| `status`            | `varchar(18)` | Ver estados                                                                                    |
| `attempts`          | `smallint`    | `DEFAULT 0`                                                                                   |
| `next_attempt_at`   | `timestamptz` | Próximo intento                                                                                |
| `claimed_until`     | `timestamptz` | Plazo del reclamo (`ENVIANDO`)                                                                 |
| `discard_after`     | `timestamptz` | Recordatorio: hora de inicio de la cita; otros: creación + 24 h                               |
| `sent_at`           | `timestamptz` |                                                                                               |
| `last_error`        | `varchar(40)` | Solo un código (`TIEMPO_AGOTADO`, `CANAL_NO_DISPONIBLE`, `DESTINATARIO_INVALIDO`), nunca el texto del proveedor |
| `created_at`        | `timestamptz` |                                                                                               |

- **`UNIQUE (tenant_id, event_id, recipient_kind, recipient_ref)`:** el mismo evento nunca crea dos avisos para el mismo destinatario (FR-012).
- Índice parcial `(next_attempt_at) WHERE status IN ('PENDIENTE', 'ENVIANDO')`.

**Estados:**

```text
PENDIENTE ──reclamo──▶ ENVIANDO ──aceptado──▶ ENVIADO
    ▲                     │  ├──aceptado por correo tras fallar WhatsApp──▶ ENVIADO_RESPALDO
    └──error temporal─────┘  ├──sin intentos o error permanente──▶ FALLIDO
                             └──pasó discard_after, cita cambiada o sin canal──▶ DESCARTADO
ENVIANDO con claimed_until vencido ──▶ se vuelve a reclamar (posible duplicado: ADR-025)
```

**Permisos:**

- `barberias_app`: `SELECT, INSERT`, `UPDATE (channel_used, status, attempts, next_attempt_at, claimed_until, sent_at, last_error)` y `DELETE`, solo para la purga de retención (migración `0026_purga_avisos`, decisión del responsable del 2026-11-09): la tarea `enviar-avisos` borra barbería por barbería, en una transacción con su tenant y RLS, y solo avisos en estado final de más de 90 días.
- `barberias_plataforma`: `SELECT (id, tenant_id, status, next_attempt_at, claimed_until)` con política `plataforma_lectura`.

**Retención:** 90 días (decisión del responsable, 2026-11-04; la afinación por tipo, en 007). La purga la hace la tarea `enviar-avisos` de M05; la de `outbox_event`, la tarea `despachar-eventos` de M06.

## 5. Tabla técnica: `action_link_attempt` (migración `0025_intentos_enlaces`, aprobada con la enmienda 1.4.0)

| Columna        | Tipo          | Regla                                                |
| -------------- | ------------- | ---------------------------------------------------- |
| `id`           | `bigserial`   | PK                                                   |
| `ip_hash`      | `char(64)`    | SHA-256 de la IP con una sal de `.env` (no la IP)    |
| `attempted_at` | `timestamptz` | `DEFAULT now()`                                      |

Índice `(ip_hash, attempted_at)`. Sin barbería ni datos de negocio o personales; la constitución 1.4.1 la nombra. A diferencia de `login_attempt` (`0006`), no guarda la IP en claro. Se purga a las 24 h con la tarea programada `purgar-intentos-enlaces`. La regla de bloqueo es la de `login_attempt` (5 rechazos en 60 s; espera de 60 s que se duplica por racha hasta 900 s), con la IP como clave. **Permisos:** `SELECT, INSERT, DELETE` para `barberias_app`.

## 6. Auditoría (`audit_log`, sin cambios de esquema)

Acciones nuevas con su barbería (FR-035):

- `CITA_REPROGRAMADA` (con la vía);
- `ASISTENCIA_CONFIRMADA_ENLACE`;
- `CITA_CANCELADA_ENLACE`;
- `CANAL_AVISO_CAMBIADO`;
- `CONSENTIMIENTO_WHATSAPP_ACEPTADO`;
- `CONSENTIMIENTO_WHATSAPP_RETIRADO`.

Los rechazos de enlaces sin tenant confiable no van a `audit_log` (que exige barbería): quedan en `action_link_attempt` y en el registro de la aplicación, solo con el código del rechazo y sin el token.

## 7. Resumen de roles

| Tabla                              | `barberias_app`                                 | `barberias_plataforma`                         | `barberias_publico` |
| ---------------------------------- | ----------------------------------------------- | ---------------------------------------------- | ------------------- |
| `appointment` (columnas nuevas)    | `UPDATE` por columna                            | —                                              | —                   |
| `appointment_reschedule`           | `SELECT, INSERT`                                | —                                              | —                   |
| `appointment_link_use`             | `SELECT, INSERT`                                | —                                              | —                   |
| `customer_notification_preference` | `SELECT, INSERT, UPDATE` por columna            | —                                              | —                   |
| `whatsapp_consent`                 | `SELECT, INSERT, UPDATE (withdrawn_at)`         | —                                              | —                   |
| `outbox_event`                     | `SELECT, INSERT, UPDATE` por columna, `DELETE` (purga) | `SELECT` de 5 columnas, sin `type` ni `payload` | —                   |
| `notification`                     | `SELECT, INSERT, UPDATE` por columna, `DELETE` (purga, `0026`) | `SELECT` de 5 columnas                          | —                   |
| `action_link_attempt`              | `SELECT, INSERT, DELETE`                        | —                                              | —                   |

`barberias_auth` (con `BYPASSRLS`) **no recibe ningún permiso** sobre estas tablas. La prueba `lectura-plataforma` de PR09 se amplía para comparar los permisos de `barberias_plataforma` con esta lista cerrada.
