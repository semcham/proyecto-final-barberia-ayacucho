# Data Model: Acceso verificado (010)

Todo en una migración nueva (`backend/migrations/0036_acceso_verificado.ts`). No cambia ninguna política RLS existente
(FR-033): solo se agregan columnas, tablas, políticas propias de las tablas nuevas y funciones de sistema.

## 1. `user_account` (existente, ADR-015): estado de verificación

| Columna nueva | Tipo | Regla |
| --- | --- | --- |
| `email_verified_at` | timestamptz, nulo | Fecha de la verificación; nulo = sin verificar |
| `email_verified_via` | varchar(10), nulo | `ENLACE`, `ACTIVACION` o `MIGRACION`; `CHECK ((email_verified_at IS NULL) = (email_verified_via IS NULL))` |

- **Migración inicial**: toda fila existente queda con `email_verified_at = now()` y `email_verified_via = 'MIGRACION'`
  (FR-016). Las cuentas nuevas nacen sin verificar.
- **Permisos**: `barberias_app` recibe `SELECT` de las dos columnas (para leer el estado con RLS, ADR-015) y **ningún**
  `UPDATE` sobre ellas: solo las cambian la activación del personal (dentro de su transacción con tenant, mediante una
  función de sistema) y `auth_verificar_correo` / `auth_restablecer_contrasena` (sección 4).
  - *Precisión de la implementación (fase 3)*: `barberias_app` tenía `INSERT` de tabla completa sobre `user_account`
    (0001), que se habría extendido a las columnas nuevas. La migración lo cambia a `INSERT` por columna sobre las seis de
    antes, sin las de verificación: la aplicación no puede crear una cuenta ya verificada. Nada de lo existente cambia.
- **Reglas de estado** (una sola dirección):

```text
sin verificar ──(enlace de verificación usado)──────▶ verificada (ENLACE)
sin verificar ──(recuperación de contraseña usada)──▶ verificada (ENLACE)
personal ───────(activación de la cuenta)───────────▶ verificada (ACTIVACION)
existente ──────(migración 0036)────────────────────▶ verificada (MIGRACION)
```

No hay transición de vuelta a "sin verificar" (cambiar el correo de una cuenta está fuera de alcance).

## 2. `account_link` (nueva, M01, por barbería)

Enlace de cuenta por correo, de un solo uso (R01).

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | uuid | PK (con `UNIQUE (tenant_id, id)`) |
| `tenant_id` | uuid | NOT NULL; barbería de origen (R03); FK a `tenant` |
| `user_id` | uuid | NOT NULL; FK a `membership (tenant_id, user_id)`: la cuenta debe ser miembro de esa barbería |
| `purpose` | varchar(20) | `VERIFICAR_CORREO` o `RECUPERAR_CONTRASENA` |
| `token_hash` | char(64), nulo | SHA-256 del token; nulo mientras no se envió (R02); único cuando no es nulo |
| `requested_at` | timestamptz | NOT NULL |
| `expires_at` | timestamptz | NOT NULL; `requested_at + 24 h` (verificar) o `+ 1 h` (recuperar) |
| `used_at` | timestamptz, nulo | |
| `revoked_at` | timestamptz, nulo | Al emitir otro del mismo propósito, al cambiar la contraseña o al verificar |

- **Restricciones**: `CHECK (expires_at > requested_at)`; `CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL))`;
  índice único parcial: **un solo enlace vigente** por (`tenant_id`, `user_id`, `purpose`) donde
  `used_at IS NULL AND revoked_at IS NULL`.
  - *Precisión de la implementación (fase 3)*: el índice incluye `tenant_id`. Con RLS, la aplicación solo ve y anula los
    enlaces de su barbería; con un índice por (`user_id`, `purpose`), un cliente que se registró en A y pide el reenvío
    desde B chocaría con el enlace de A, que B no puede anular. Al **usar** un enlace, las funciones de sistema anulan
    los demás del mismo propósito en **todas** las barberías (sección 4), así que nunca sirven dos después de un uso.
- **RLS**: `ENABLE` + `FORCE`, política `tenant_isolation` como las demás tablas de negocio (`rlsPorTenant`). `barberias_app`:
  `SELECT`, `DELETE` (retención de 30 días, con RLS), `INSERT` solo de (`id`, `tenant_id`, `user_id`, `purpose`,
  `requested_at`, `expires_at`) —el enlace nace sin token, sin uso y sin anular— y `UPDATE (token_hash, revoked_at)`;
  nunca `used_at` (solo las funciones de sistema lo marcan). `barberias_publico` y `barberias_plataforma`: ningún permiso.
  - *Precisión de la implementación (fase 3)*: el `DELETE` no estaba en la lista original; lo necesita la retención, que
    borra barbería por barbería con el rol de la aplicación (como la purga de `notification`, migración 0026).
- **Vigencia del token**: el token se puede emitir (o reemitir en un reintento) solo mientras el enlace esté vigente;
  `expires_at` no se mueve al reemitir.
- **Retención**: las filas usadas, anuladas o vencidas hace más de 30 días se borran con una tarea programada (ADR-024).

### Ciclo de vida

```text
solicitado (sin token) ──emitir al enviar──▶ vigente (con hash) ──usar──▶ usado
        │                                     │  ▲                       
        │                                     │  └─ reemitir (reintento): hash nuevo, mismo vencimiento
        ├──── nueva solicitud del mismo propósito, verificar o cambiar contraseña ───▶ anulado
        └──── llega expires_at ───▶ vencido (no se marca: se calcula al leer)
```

## 3. `account_link_attempt` (nueva, técnica, sin barbería)

Contador de solicitudes y usos fallidos (R08), como `login_attempt` y `action_link_attempt`. Requiere nombrarla en el
principio III (enmienda 1.8.0).

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | bigint identity | PK |
| `kind` | varchar(12) | `REENVIO`, `RECUPERACION` o `USO_FALLIDO` |
| `subject_hash` | char(64), nulo | SHA-256 del correo normalizado o del id de la cuenta; nulo en `USO_FALLIDO` |
| `origin_hash` | char(64) | HMAC con `INTENTOS_SAL_IP` del origen; **nunca la IP en claro** |
| `at` | timestamptz | NOT NULL |

- **Sin `tenant_id` ni datos de negocio ni correos en claro.** Índices por (`kind`, `subject_hash`, `at`) y (`kind`,
  `origin_hash`, `at`). Purga oportunista de lo que tenga más de 24 h al registrar un intento nuevo.
- **Permisos**: `barberias_app`: `SELECT`, `INSERT`, `DELETE`; nadie más.

## 4. Funciones de sistema (dueño `barberias_auth`, ADR-015; ningún rol nuevo)

| Función | Qué hace | Devuelve |
| --- | --- | --- |
| `auth_barberia_para_enlace(p_user_id, p_tenant_preferido)` | Elige la barbería del aviso de una cuenta (R03): la preferida si la cuenta tiene membresía allí; si no, la del personal; si no, la membresía de cliente más reciente | `tenant_id` o nada |
| `auth_verificar_correo(p_token_hash)` | Si hay un enlace `VERIFICAR_CORREO` vigente con ese hash: lo marca usado, marca la cuenta verificada (`ENLACE`) si no lo estaba y anula sus otros enlaces de verificación | `resultado` (`APLICADO` o `RECHAZADO`), `tenant_id` y `user_id`; ninguna fila si ningún hash coincide (research R15) |
| `auth_restablecer_contrasena(p_token_hash, p_hash_nuevo)` | Si hay un enlace `RECUPERAR_CONTRASENA` vigente: lo marca usado, cambia `password_hash`, marca la cuenta verificada (`ENLACE`) si no lo estaba, anula sus otros enlaces de recuperación y pasa a `REVOCADA` todas sus sesiones `ACTIVA` en todas las barberías | Igual que la anterior: `APLICADO` o `RECHAZADO` con `tenant_id` y `user_id`, o ninguna fila |
| `auth_marcar_verificada_por_activacion(p_user_id)` | La usa la activación del personal dentro de su transacción | nada |

- *Precisiones de la implementación (fase 3)*: `auth_barberia_para_enlace` solo considera membresías `ACTIVA` (un usuario
  del personal pendiente o desactivado no recibe enlaces); `auth_marcar_verificada_por_activacion` solo marca la cuenta si
  tiene una activación **ya usada**, para que la aplicación no pueda verificar otras cuentas con ella; y
  `auth_restablecer_contrasena` rechaza un hash nuevo que no sea argon2id.
- `REVOKE ALL ... FROM PUBLIC`; `GRANT EXECUTE` solo a `barberias_app`. `barberias_publico` y `barberias_plataforma` no
  pueden ejecutarlas (lo comprueba la prueba de funciones de sistema existente, `aislamiento/funciones-definer.spec.ts`).
- `barberias_auth` recibe solo los permisos por columna que estas funciones necesitan: `UPDATE (password_hash,
  email_verified_at, email_verified_via)` de `user_account`, `UPDATE (used_at, revoked_at)` de `account_link`,
  `UPDATE (status, ended_at)` de `auth_session`, y `SELECT` de las columnas que leen.
- **Revisión obligatoria de ADR-015**: estas funciones amplían el mecanismo de autenticación antes del tenant.

## 5. `notification` (existente, M05): tipos y destinatario nuevos

- **Tipos de aviso nuevos** (`kind`): `VERIFICAR_CORREO`, `RECUPERAR_CONTRASENA`, `CONTRASENA_CAMBIADA`.
- **Destinatario nuevo** (`recipient_kind`): `CUENTA`, con `recipient_ref` = `user_id`. El correo se lee al enviar, por
  `CuentasApi.correoDeCuenta(usuarioId)` en el tenant del aviso (RLS por membresía, ADR-015). Se agregan los dos valores a
  los `CHECK` (como hizo la migración 0030).
- **Siempre por correo**: estos tres tipos ignoran el canal elegido del cliente (WhatsApp no aplica).
- **Descarte**: un aviso `VERIFICAR_CORREO` o `RECUPERAR_CONTRASENA` que no salió antes del vencimiento de su enlace se
  descarta (`discard_after = expires_at`).

## 6. Eventos nuevos (M01 → M05, por la salida de eventos de ADR-025)

| Evento | Publica | Payload (sin secretos) | Aviso |
| --- | --- | --- | --- |
| `EnlaceDeCuentaSolicitado` | M01 al registrar un cliente, al reenviar y al pedir recuperación | `enlaceId`, `proposito`, `usuarioId`, `venceEn` | `VERIFICAR_CORREO` o `RECUPERAR_CONTRASENA` a `CUENTA` |
| `ContrasenaCambiada` | M01 al restablecer la contraseña | `usuarioId`, `cambiadaEn` | `CONTRASENA_CAMBIADA` a `CUENTA` |

El tenant de cada evento es el del enlace (R03). `replace_key` = `enlace:<usuarioId>:<proposito>` para que un reenvío
reemplace el aviso pendiente anterior en lugar de sumar otro.

## 7. Auditoría (existente)

Acciones nuevas en `AccionAuditada`: `CORREO_VERIFICACION_SOLICITADA`, `CORREO_VERIFICADO`, `RECUPERACION_SOLICITADA`,
`CONTRASENA_RESTABLECIDA` y `ENLACE_DE_CUENTA_RECHAZADO`. Nunca el token, el enlace ni la contraseña. Todas llevan la
barbería del enlace (principio III).

- `ENLACE_DE_CUENTA_RECHAZADO` se registra **solo** cuando el enlace pertenece a una cuenta (resultado `RECHAZADO` de la
  función de consumo: usado, vencido o anulado).
- Un enlace **desconocido o mal formado** no tiene cuenta ni barbería: **no se audita**, solo se registra en
  `account_link_attempt` como `USO_FALLIDO` (§3, research R15).
- Una solicitud con un correo sin cuenta tampoco se audita: no hay cuenta ni barbería.

## 8. Documentos legales (sin tabla)

Archivos versionados en `frontend/src/legal/` (R10): `terminos.ts` y `privacidad.ts`, cada uno con `version`,
`vigenteDesde`, `borrador: boolean` y las secciones del texto. La versión vigente la fijan las variables de entorno que ya
existen. El consentimiento (`consent_record`, existente) ya guarda la versión aceptada.
