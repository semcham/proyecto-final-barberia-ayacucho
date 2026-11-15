# Data Model: Indicadores y datos personales (007)

Una migración por fase, para que cada una se construya y se cierre sola. **Sin números fijos:** cada migración
toma el **número siguiente libre al implementarla**, porque el migrador (`backend/src/shared/persistence/migrate.ts`)
no admite migraciones fuera de orden y las fases 2c y 3 pueden hacerse en cualquier orden o recortarse (análisis
H2). La última aplicada antes de 007 es `0031_asistente`.

| Historia | Migración (nombre; el número se fija al implementar) | Objetos |
|---|---|---|
| US1 | `NNNN_solicitudes_datos` | `data_subject_request` con RLS |
| US2 (2b, barberías por estado) | `NNNN_auditoria_indicadores` | acción `ADMIN_INDICADORES_CONSULTADOS` en `platform_audit_log`; nada más (usa columnas que el rol de la plataforma ya lee) |
| US2 (2c, se recorta con el corte) | `NNNN_vistas_de_conteo` | vistas `platform_appointment_counts` y `platform_membership_counts`, su propiedad y sus permisos (el rol `barberias_conteos` va en `db/init`) |
| US3 | `NNNN_intentos_con_hash` | `login_attempt.ip` → `login_attempt.ip_hash` |

## 1. `data_subject_request` (US1, M01 `solicitudes-datos`)

Una solicitud de un titular (cliente o barbero) sobre sus datos en **una** barbería. Es un dato de la barbería:
lleva `tenant_id` y `rlsPorTenant()`.

| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid PK | uuidv7 |
| `tenant_id` | uuid NOT NULL | FK `tenant`; RLS |
| `kind` | varchar(16) NOT NULL | `ACCESO`, `RECTIFICACION` o `ELIMINACION` |
| `subject_kind` | varchar(8) NOT NULL | `CLIENTE` o `BARBERO` |
| `customer_id` | uuid | FK `(tenant_id, customer_id)` → `customer_profile`. Obligatorio si y solo si `subject_kind = CLIENTE` |
| `staff_membership_id` | uuid | FK `(tenant_id, staff_membership_id)` → `membership`. Obligatorio si y solo si `subject_kind = BARBERO` |
| `status` | varchar(12) NOT NULL | `RECIBIDA`, `EN_ATENCION`, `ATENDIDA` o `RECHAZADA` |
| `detail` | varchar(500) | Lo que pide el titular. Obligatorio en `RECTIFICACION` (`CHECK`) |
| `response` | varchar(1000) | Obligatoria en `ATENDIDA` (`CHECK`) |
| `rejection_reason` | varchar(300) | De 5 a 300 caracteres; obligatorio si y solo si `RECHAZADA` (`CHECK`) |
| `registered_by` | uuid NOT NULL | La cuenta que la registró: el titular o el propietario "en nombre de" |
| `on_behalf` | boolean NOT NULL | `true` si la registró el propietario por el titular |
| `received_at` | timestamptz NOT NULL | Fecha de registro |
| `due_on` | date NOT NULL | Plazo interno: 10 días hábiles (lunes a viernes) desde la fecha local de registro |
| `started_at` | timestamptz | Al pasar a `EN_ATENCION` |
| `closed_at` | timestamptz | Al pasar a `ATENDIDA` o `RECHAZADA` (`CHECK`: solo en esos estados) |
| `closed_by` | uuid | El propietario que la cerró |

**Restricciones e índices:**

- `UNIQUE (tenant_id, id)`.
- **Una abierta por titular y tipo:** índice único parcial sobre
  `(tenant_id, kind, coalesce(customer_id, staff_membership_id))` `WHERE status IN ('RECIBIDA', 'EN_ATENCION')`.
- `(tenant_id, status, due_on)`, para la bandeja.

**Permisos:**

- `barberias_app`: `SELECT`, `INSERT` y `UPDATE (status, response, rejection_reason, started_at, closed_at,
  closed_by)`. Sin `DELETE`.
- Ningún permiso para `barberias_auth`, `barberias_publico`, `barberias_plataforma` ni `barberias_conteos`.

**Transiciones** (dominio, `solicitud-datos.ts`):

```text
RECIBIDA ──iniciar──▶ EN_ATENCION ──atender(respuesta)──▶ ATENDIDA
   │                      └──────rechazar(motivo)───────▶ RECHAZADA
   ├──atender(respuesta)──────────────────────────────▶ ATENDIDA
   └──rechazar(motivo)────────────────────────────────▶ RECHAZADA
```

- Las transiciones desde un estado final responden 409 `SOLICITUD_CERRADA`.
- Cada transición se hace con la fila bloqueada (`FOR UPDATE`), en la transacción con el tenant del token.
- **Vencida** se calcula al leer: estado abierto y `due_on` anterior a hoy en la zona de la barbería. No se
  guarda.

**Auditoría** (`audit_log` de la barbería, sin ningún texto):

| Acción | Cuándo | `resource` |
|---|---|---|
| `SOLICITUD_DATOS_REGISTRADA` | al crearla (también "en nombre de") | `solicitud_datos:<id>;<kind>` |
| `SOLICITUD_DATOS_EN_ATENCION` | al iniciarla | igual |
| `SOLICITUD_DATOS_ATENDIDA` | al atenderla | igual |
| `SOLICITUD_DATOS_RECHAZADA` | al rechazarla (sin el motivo) | igual |

## 2. Vistas de solo conteo (US2, sin el corte)

Su **dueño** es `barberias_conteos`: `NOLOGIN NOBYPASSRLS NOINHERIT`, creado en `db/init/01-roles.sql`, con
`GRANT barberias_conteos TO barberias_owner` para asignar la propiedad. Ver research R02.

| Vista | Columnas | Definición |
|---|---|---|
| `platform_appointment_counts` | `month date`, `status varchar`, `appointments integer` | `appointment` agrupado por `date_trunc('month', created_at AT TIME ZONE 'America/Lima')` y `status`, solo los últimos 12 meses |
| `platform_membership_counts` | `kind varchar`, `users integer` | `membership` con `status = 'ACTIVA'`, agrupado en `PERSONAL` (`PROPIETARIO` o `BARBERO`) o `CLIENTE` |

**Concesión a `barberias_owner`:** `GRANT barberias_conteos TO barberias_owner WITH INHERIT FALSE, SET TRUE`
(PostgreSQL 16), en `db/init/01-roles.sql` y en el paso manual de un volumen existente. `SET TRUE` permite asignar
la propiedad de las vistas; `INHERIT FALSE` impide que el dueño de las tablas, que inicia sesión, herede las
políticas del rol (research R02). **Ningún rol con inicio de sesión hereda `barberias_conteos`.**

**Permisos:**

- `barberias_conteos`:
  - `SELECT (created_at, status)` sobre `appointment`;
  - `SELECT (role_code, status)` sobre `membership`;
  - política `plataforma_conteo ON appointment` y `ON membership`, `FOR SELECT TO barberias_conteos USING (true)`.
  - Nada más: ninguna otra tabla ni columna, y ningún `INSERT`, `UPDATE` ni `DELETE`.
- `barberias_plataforma`: `SELECT` sobre las **dos vistas**, y ningún permiso nuevo sobre ninguna tabla.

**Auditoría del acceso** (2b, también con el corte): la migración `auditoria_indicadores` amplía el `CHECK` de
`platform_audit_log.action` con `ADMIN_INDICADORES_CONSULTADOS`. No es un permiso.

**Con el corte** (solo barberías por estado): no hay rol, vistas ni cambio de permisos; la migración
`vistas_de_conteo` no existe.

## 3. Lecturas de los indicadores (US2)

| Indicador | Módulo y archivo | Lectura | Rol |
|---|---|---|---|
| Barberías por estado y activas | M03 `suscripciones/infrastructure/plataforma/barberias-por-estado-indicador.ts` | `tenant.status` × `subscription.status`, columnas ya concedidas (0016) | `barberias_plataforma` |
| Citas por mes y estado | M02 `citas/infrastructure/plataforma/citas-por-mes-indicador.ts` | `platform_appointment_counts` | `barberias_plataforma` |
| Usuarios por tipo | M01 `identidad/infrastructure/plataforma/usuarios-por-tipo-indicador.ts` | `platform_membership_counts` | `barberias_plataforma` |

Cada fuente implementa `FuenteDeIndicador` de M06 y la registra el host. **Convención:** toda fuente se llama
`*-indicador.ts` y vive en `infrastructure/plataforma/` de su módulo; la regla `indicadores-solo-por-registro`
de PR14 usa ese patrón. El resultado es solo de números
(sin ids ni nombres), con `calculadoEn`.

## 4. `login_attempt` (US3, M01 `identidad`)

| Columna | Antes | Después |
|---|---|---|
| `email_hash` | char(64) | igual |
| `ip` | inet NOT NULL | **se elimina** |
| `ip_hash` | — | **char(64) NOT NULL**: `SHA-256(INTENTOS_SAL_IP ‖ ip)` en la aplicación |
| `attempted_at` | timestamptz | igual |

- Índice `login_attempt_cuenta_ip (email_hash, ip, attempted_at)` → `login_attempt_cuenta_origen (email_hash,
  ip_hash, attempted_at)`.
- La migración **borra** las filas existentes (valen 24 h, y la sal no está en la base).
- Los permisos (`SELECT`, `INSERT` y `DELETE` para `barberias_app`) no cambian.
- El administrador sigue usando la misma tabla con su clave `plataforma:<correo>`, y su IP desconocida
  (`0.0.0.0`) también se deriva.
- Configuración nueva: `INTENTOS_SAL_IP`, secreto obligatorio de al menos 16 caracteres, distinto de
  `ENLACES_SAL_IP`. Lleva un valor **solo de desarrollo** en `.env.example` y en `docker-compose.yml` (como
  `ENLACES_SAL_IP`) y otro en las pruebas (`test/helpers/entorno.ts`). El valor de cualquier otro entorno va fuera
  del repositorio (FR-020). El `.env` local del responsable no se toca: la añade él a mano.
