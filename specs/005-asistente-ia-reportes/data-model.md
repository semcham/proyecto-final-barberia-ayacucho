# Data Model: Asistente de IA y reportes (005)

Dos tablas nuevas, **de barbería**:
- `tenant_id NOT NULL` y `UNIQUE (tenant_id, id)` cuando tienen `id`;
- claves foráneas compuestas con `tenant_id`;
- `rlsPorTenant()` de `backend/migrations/sql-comun.ts`: RLS habilitada y forzada, política `tenant_isolation`.

Dueño: M04, submódulo `asistente`. El rol `barberias_plataforma` **no** tiene permisos sobre ellas (ninguna
tarea de la plataforma las lee).

Los reportes **no guardan nada**: se calculan al pedirlos, sobre `appointment` de M02, a través de
`CatalogoCitasApi` (research R01 y R10).

## 1. `assistant_quota` (cuotas del asistente)

| Columna      | Tipo          | Reglas                                                                                           |
| ------------ | ------------- | ------------------------------------------------------------------------------------------------ |
| `tenant_id`  | `uuid`        | FK `tenant(id)`; RLS                                                                             |
| `scope`      | `varchar(8)`  | `CHECK (scope IN ('USUARIO','BARBERIA'))`                                                        |
| `subject_id` | `uuid`        | el usuario (`USUARIO`) o la propia barbería (`BARBERIA`, igual a `tenant_id`, por `CHECK`)       |
| `day`        | `date`        | fecha **local** de la barbería en que se contó la pregunta                                       |
| `used`       | `integer`     | `CHECK (used >= 0)`                                                                              |
| `updated_at` | `timestamptz` |                                                                                                  |

- Clave primaria `(tenant_id, scope, subject_id, day)`.
- La suma es atómica: `INSERT … ON CONFLICT (tenant_id, scope, subject_id, day) DO UPDATE SET used =
  assistant_quota.used + 1 WHERE assistant_quota.used < :limite RETURNING used`. Sin fila devuelta, la cuota está
  agotada.
- La devolución por falla del proveedor: `used = used - 1 WHERE used > 0`.
- Los límites (20 por usuario y 200 por barbería al día) **no** se guardan aquí: son de la configuración e iguales
  para todos los planes (aclaración del 2026-11-14).

## 2. `assistant_question` (registro de preguntas, sin texto)

| Columna        | Tipo           | Reglas                                                                                                   |
| -------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `id`           | `uuid` PK      | UUIDv7                                                                                                   |
| `tenant_id`    | `uuid`         | RLS                                                                                                      |
| `user_id`      | `uuid`         | quien preguntó                                                                                           |
| `role`         | `varchar(12)`  | `CHECK (role IN ('CLIENTE','PROPIETARIO'))`                                                              |
| `asked_at`     | `timestamptz`  | `NOT NULL DEFAULT now()`                                                                                 |
| `intent`       | `varchar(32)`  | la intención validada, o nula si no se interpretó (lista cerrada, `CHECK`)                               |
| `result`       | `varchar(24)`  | `RESPONDIDA`, `SIN_DATOS`, `FUERA_DE_ALCANCE`, `ACCION_NO_PERMITIDA`, `CUOTA_AGOTADA`, `PROVEEDOR_NO_DISPONIBLE`, `INVALIDA` (`CHECK`) |
| `duration_ms`  | `integer`      | de la pregunta completa                                                                                   |
| `tokens_in`, `tokens_out` | `integer` | los que informa el proveedor; nulos con el proveedor falso o si falló                           |

- **No hay columnas para el texto** de la pregunta, de la respuesta ni de los argumentos (FR-010, SC-007). Una
  prueba de arquitectura de la migración comprueba la lista exacta de columnas.
- Índice `(tenant_id, asked_at DESC)`.
- Sin purga en esta versión (research R09).

## 3. `audit_log` (sin cambio de esquema)

Acciones nuevas en `AccionAuditada` (M06), sin migración (`action` no tiene `CHECK`):
- `ASISTENTE_CONSULTADO`, con el recurso `asistente:<rol>;<resultado>`;
- `REPORTES_CONSULTADOS`, con el recurso `reportes:<desde>..<hasta>`.

Nunca llevan el texto.

## 4. Lecturas de `appointment` para los reportes (sin cambio de esquema)

`ReportesDeCitasQuery` (infraestructura de M02, en la transacción del llamador, con RLS y filtro por tenant):

| Agregado                  | Filtro                                                         | Agrupa por                                                    |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Conteos de citas          | `starts_at >= :inicio AND starts_at < :fin`                    | `status`; y `count(*) FILTER (WHERE late_cancellation)`       |
| Servicios más solicitados | el mismo, y `status <> 'CANCELADA'`                            | `service_name`, ordenado por conteo descendente y nombre; `LIMIT 10` |
| Actividad por barbero     | el mismo                                                       | `barber_id` (el nombre se resuelve con `CatalogQuery.barbero`) |
| Actividad por día         | el mismo                                                       | `EXTRACT(ISODOW FROM starts_at AT TIME ZONE :zona)`           |

`:inicio` y `:fin` salen de `ZonaHoraria.inicioDelDia(desde)` y del inicio del día siguiente a `hasta`. El índice
`appointment (tenant_id, starts_at)` de 002 cubre el rango.

## 5. Migración

`backend/migrations/0031_asistente.ts`:
- crea `assistant_quota` y `assistant_question` con `rlsPorTenant`;
- da a `barberias_app` `SELECT, INSERT, UPDATE (used, updated_at)` sobre `assistant_quota` y `SELECT, INSERT` sobre
  `assistant_question`, sin `UPDATE` ni `DELETE`;
- no da ningún permiso a `barberias_plataforma` ni a `barberias_publico`.

Se actualiza `backend/src/shared/persistence/db-types.ts`. No cambia ninguna tabla existente.

## 6. Estado de una pregunta (sin persistencia del flujo)

```text
recibida ──(vacía o > 500 caracteres)──────────────────────────▶ INVALIDA (sin cuota)
   │
   ├─(cuota agotada)───────────────────────────────────────────▶ CUOTA_AGOTADA (429)
   │
   └─ cuota sumada ─▶ proveedor ──(falla, tiempo o circuito)──▶ PROVEEDOR_NO_DISPONIBLE (503, cuota devuelta)
                          │
                          └─ intención validada ─▶ herramienta del rol ─▶ RESPONDIDA | SIN_DATOS
                                │
                                ├─(intención de otro rol, fuera del esquema)─▶ FUERA_DE_ALCANCE
                                └─(reservar, cancelar o cambiar)─────────────▶ ACCION_NO_PERMITIDA
```
