# Data Model: Adelanto de reserva con QR (008)

Todas las tablas nuevas son **de barbería**: `tenant_id NOT NULL`, `UNIQUE (tenant_id, id)`, claves foráneas
compuestas con `tenant_id` (no se puede apuntar a filas de otra barbería) y `rlsPorTenant()` de
`backend/migrations/sql-comun.ts` (RLS habilitada y forzada, política `tenant_isolation` con el tenant de la
transacción). Importes en **céntimos enteros**. Dueño: M03, submódulo `adelantos` (research R01). Ninguna tabla
guarda datos de tarjeta, cuentas bancarias ni movimientos de dinero (FR-026, SC-009).

## 1. `booking_deposit_settings` (configuración, una por barbería)

| Columna                  | Tipo           | Reglas                                                                 |
| ------------------------ | -------------- | ---------------------------------------------------------------------- |
| `tenant_id`              | `uuid` PK      | FK `tenant(id)`                                                        |
| `enabled`                | `boolean`      | `NOT NULL`                                                             |
| `kind`                   | `varchar(10)`  | `CHECK (kind IN ('FIJO','PORCENTAJE'))`                                |
| `amount_cents`           | `integer`      | `CHECK (amount_cents BETWEEN 100 AND 50000)` si `kind = 'FIJO'`; nulo si no |
| `percent`                | `smallint`     | `CHECK (percent BETWEEN 1 AND 100)` si `kind = 'PORCENTAJE'`; nulo si no |
| `payment_window_minutes` | `smallint`     | `CHECK (payment_window_minutes BETWEEN 10 AND 1440)`                   |
| `qr_file_id`             | `uuid`         | FK compuesta a `booking_deposit_file` (tipo `QR`); `NOT NULL` si `enabled` |
| `updated_at`, `updated_by` | `timestamptz`, `uuid` | último cambio                                                  |

Un `CHECK` exige que, con `enabled = true`, estén el tipo, su valor, el plazo y el QR (FR-002).

## 2. `booking_deposit_file` (QR y capturas, privados)

| Columna        | Tipo          | Reglas                                                                  |
| -------------- | ------------- | ----------------------------------------------------------------------- |
| `id`           | `uuid` PK     |                                                                         |
| `tenant_id`    | `uuid`        | RLS                                                                     |
| `kind`         | `varchar(8)`  | `CHECK (kind IN ('QR','CAPTURA'))`                                      |
| `content_type` | `varchar(20)` | QR: `image/jpeg` o `image/png`; captura: además `application/pdf`        |
| `size_bytes`   | `integer`     | QR ≤ 1 MB; captura ≤ 5 MB (`CHECK`)                                     |
| `sha256`       | `char(64)`    | del contenido                                                           |
| `content`      | `bytea`       | nunca en listados, registros ni en la vía de la plataforma              |
| `created_at`, `created_by` | `timestamptz`, `uuid` |                                                        |

Como `payment_receipt_file` de 003 (ADR-023): sin URL pública, sin el nombre original del archivo. El tipo se
detecta por los bytes (`detectarTipoComprobante`).

## 3. `booking_deposit` (el adelanto de una cita)

| Columna               | Tipo            | Reglas                                                                         |
| --------------------- | --------------- | ------------------------------------------------------------------------------ |
| `id`                  | `uuid` PK       |                                                                                |
| `tenant_id`           | `uuid`          | RLS                                                                            |
| `appointment_id`      | `uuid`          | `UNIQUE (tenant_id, appointment_id)`; FK compuesta a `appointment`             |
| `customer_id`         | `uuid`          | perfil del cliente (copia, R02)                                                |
| `customer_user_id`    | `uuid`          | cuenta del cliente que reservó (copia, R02): autoriza el registro del pago     |
| `code`                | `char(6)`       | `UNIQUE (tenant_id, code)`; alfabeto sin ambigüedades (R07)                    |
| `amount_cents`        | `integer`       | `CHECK (amount_cents > 0)`                                                     |
| `service_price_cents` | `integer`       | precio del servicio al reservar (para el saldo)                                |
| `service_name`, `starts_at`, `time_zone` | copia | datos del aviso (Complexity Tracking del plan); se actualizan al reprogramar |
| `qr_file_id`          | `uuid`          | QR vigente al reservar (FR-004)                                                |
| `due_at`              | `timestamptz`   | hora límite de pago (R04)                                                      |
| `review_limit_at`     | `timestamptz`   | límite máximo adicional (R04, FR-018); `CHECK (review_limit_at >= due_at)`     |
| `status`              | `varchar(12)`   | ver §5                                                                         |
| `resolved_at`         | `timestamptz`   | cuando deja de estar POR_PAGAR o POR_REVISAR                                   |
| `refunded_at`, `refunded_by` | `timestamptz`, `uuid` | marca de devuelto (Q2); solo con `status = 'DEVUELTO'`             |
| `created_at`          | `timestamptz`   |                                                                                |

Índice parcial para la tarea: `(due_at) WHERE status = 'POR_PAGAR'` y `(review_limit_at) WHERE status =
'POR_REVISAR'`.

## 4. `booking_deposit_payment` (registros de pago del cliente)

| Columna            | Tipo           | Reglas                                                                          |
| ------------------ | -------------- | ------------------------------------------------------------------------------- |
| `id`               | `uuid` PK      |                                                                                 |
| `tenant_id`        | `uuid`         | RLS                                                                             |
| `deposit_id`       | `uuid`         | FK compuesta a `booking_deposit`                                                |
| `operation_number` | `varchar(20)`  | normalizado (R07); `UNIQUE (tenant_id, operation_number)`                       |
| `file_id`          | `uuid`         | captura opcional (`booking_deposit_file`, tipo `CAPTURA`)                       |
| `registered_at`, `registered_by` | `timestamptz`, `uuid` |                                                          |
| `review_result`    | `varchar(10)`  | nulo, `CONFIRMADO` o `RECHAZADO`                                                |
| `reviewed_at`, `reviewed_by` | `timestamptz`, `uuid` |                                                              |
| `rejection_reason` | `varchar(300)` | `CHECK` de 5 a 300 caracteres, obligatorio si y solo si `RECHAZADO`             |

Índice único parcial `(tenant_id, deposit_id) WHERE review_result IS DISTINCT FROM 'RECHAZADO'`: un solo
registro vigente por adelanto (US2-5), también con dos registros simultáneos.

## 5. Estados del adelanto

```text
                  registrar pago                    confirmar
   POR_PAGAR ─────────────────────▶ POR_REVISAR ─────────────────▶ CONFIRMADO
     │  ▲                              │   │                          │
     │  └──────── rechazar ────────────┘   │ límite máximo            ├─ cancela el cliente con tiempo
     │                                     │ adicional                │  o el propietario ──▶ POR_DEVOLVER ──▶ DEVUELTO
     │ hora límite                         ▼                          │                         (marca)
     ├──────────────────▶ VENCIDO     POR_DEVOLVER                    └─ cancela tarde o no asistió ──▶ RETENIDO
     │                                     ▲
     └─ cancela la cita ──▶ ANULADO        └─ cancela la cita con el pago por revisar
```

| Desde        | Hacia        | Disparo (módulo)                                        | Cita                    |
| ------------ | ------------ | ------------------------------------------------------- | ----------------------- |
| —            | POR_PAGAR    | reservar con adelanto (M02 → `AdelantosApi.crear`)     | nace PENDIENTE          |
| POR_PAGAR    | POR_REVISAR  | el cliente registra el pago (M03)                       | sigue PENDIENTE         |
| POR_REVISAR  | POR_PAGAR    | el propietario rechaza (M03)                            | sigue PENDIENTE         |
| POR_REVISAR  | CONFIRMADO   | el propietario confirma (M02 → `AdelantosApi.confirmar`)| PENDIENTE → CONFIRMADA  |
| POR_PAGAR    | VENCIDO      | tarea, al pasar `due_at` (M02)                          | → CANCELADA, no tardía  |
| POR_REVISAR  | POR_DEVOLVER | tarea, al pasar `review_limit_at` (M02)                 | → CANCELADA, no tardía  |
| POR_PAGAR    | ANULADO      | se cancela la cita (M02)                                | → CANCELADA             |
| POR_REVISAR  | POR_DEVOLVER | se cancela la cita (M02)                                | → CANCELADA             |
| CONFIRMADO   | POR_DEVOLVER | cancela el cliente con tiempo o el propietario (M02)    | → CANCELADA             |
| CONFIRMADO   | RETENIDO     | cancela tarde el cliente, o no asistió (M02)            | → CANCELADA o NO_ASISTIO |
| POR_DEVOLVER | DEVUELTO     | el propietario lo marca (M03)                           | sin cambio              |

Cada transición es condicional (`WHERE status = $desde`) y corre en la transacción de la operación, con la cita
bloqueada primero (research R06). Finales: CONFIRMADO (hasta que la cita termine), VENCIDO, ANULADO, DEVUELTO y
RETENIDO. Una cita `COMPLETADA` deja el adelanto CONFIRMADO, descontado del precio (saldo = precio − adelanto).

## 6. Cambios en tablas existentes

- **`appointment`** (002): sin cambios de esquema; con adelanto nace `PENDIENTE` (la restricción de exclusión ya
  la cubre).
- **`notification.kind`** (004, migración 0024): el `CHECK` suma `ADELANTO_SOLICITADO`, `PAGO_ADELANTO_REGISTRADO`,
  `ADELANTO_CONFIRMADO`, `PAGO_ADELANTO_RECHAZADO` y `ADELANTO_VENCIDO`.
- **`audit_log`**: acciones nuevas (research R13); la columna no tiene `CHECK`.

## 7. Permisos de los roles de base

- `barberias_app`: `SELECT, INSERT` en las cuatro tablas; `UPDATE` solo de las columnas que cambian
  (`booking_deposit_settings` completa; en `booking_deposit`: `status`, `resolved_at`, `refunded_at`,
  `refunded_by`, `service_name`, `starts_at`, `time_zone`; en `booking_deposit_payment`: las de revisión). Sin
  `DELETE` (evidencia), salvo el reemplazo del QR anterior, que se conserva mientras una cita lo use.
- `barberias_plataforma`: `SELECT (id, tenant_id, status, due_at, review_limit_at)` sobre `booking_deposit`, con
  política `FOR SELECT ... USING (true)` (lista cerrada ampliada; PR09 `lectura-plataforma` la verifica). Nada
  sobre las otras tres tablas.
- `barberias_publico` y `barberias_auth`: nada.

## 8. Migraciones previstas

| Migración                       | Contenido                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `0028_adelanto_configuracion`   | `booking_deposit_file` y `booking_deposit_settings`, con RLS y permisos                    |
| `0029_adelantos`                | `booking_deposit` y `booking_deposit_payment`, índices, RLS, permisos y columnas de plataforma |
| `0030_avisos_adelanto`          | `CHECK` de `notification.kind` con los cinco tipos nuevos                                  |

Cada tabla nueva tiene su prueba de aislamiento (`aislamiento-008.spec.ts`, mismo patrón que `aislamiento-004`):
con el tenant de A no se lee, no se modifica y no se inserta una fila de B (`WITH CHECK`), y aparece en
`rls.spec.ts` ("toda tabla con `tenant_id` tiene RLS activada y forzada").
