# Borradores para revisión del responsable: enmienda de la constitución y revisión de ADR-031

> **Estado: BORRADOR, no aplicado.** Nada de esto está en `.specify/memory/constitution.md` ni en
> `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`. Se aplica solo con la aprobación del
> responsable, como primera tarea de la fase de US2 (principio XI y Governance). Si no se aprueba, US2 se
> construye con el **corte**: solo barberías por estado (research R03), y estos textos quedan sin aplicar.

## 1. Enmienda MINOR 1.7.0 del principio III (US2)

**Versionado:** 1.6.0 → **1.7.0** (MINOR: amplía de forma material la guía de la excepción "operaciones de la
plataforma"). No elimina ni redefine nada.

**Texto actual** (principio III, excepción "operaciones de la plataforma", fragmento):

> Sus lecturas entre barberías MUST hacerse con un rol de base de datos sin `BYPASSRLS`, de solo lectura y con
> permisos por columna sobre esas tablas. […] MUST NOT ver ni modificar citas, clientes, catálogo ni usuarios.

**Texto propuesto** (se agrega después de "MUST NOT ver ni modificar citas, clientes, catálogo ni usuarios."):

> **Conteos de uso (RF31).** Para los indicadores agregados de la plataforma, el rol de lectura de la plataforma
> MAY leer **vistas de solo conteo** sobre citas y membresías. Esas vistas MUST entregar solo números agregados
> sin ninguna columna que identifique a una persona (como máximo: barbería, fecha o mes, estado y tipo de
> membresía), MUST NOT permitir obtener una fila de una cita, de un cliente ni de un usuario, y MUST pertenecer
> a un rol propio sin inicio de sesión y sin `BYPASSRLS`, con `SELECT` solo sobre las columnas que cuentan y una
> política de lectura propia. El rol de lectura de la plataforma MUST NOT recibir permisos sobre las tablas de
> citas, clientes ni usuarios. Una prueba de permisos exactos MUST comprobar las dos cosas. La decisión se
> registra en ADR-031.

**Razón que se agrega al final del principio III:**

> La lectura de conteos existe porque RF31 pide indicadores de uso de todas las barberías y el administrador no
> pertenece a ninguna; se limita a números agregados, sin filas ni identificadores de personas, y no da al rol
> de la plataforma ningún permiso sobre las tablas.

**Sync Impact Report (borrador):**

- *Modified principles:* III. Aislamiento por barbería, en la excepción "operaciones de la plataforma"
  (conteos de uso).
- *Templates requiring updates:* `.specify/templates/plan-template.md`, puerta III (agregar "count-only views
  owned by a NOLOGIN NOBYPASSRLS role; the platform role reads only those views").
- *Docs:* `docs/02-arquitectura-software/multi-tenancy-y-datos.md` (roles de base y excepciones) y
  `docs/02-arquitectura-software/seguridad-y-privacidad.md` (matriz y amenazas).
- *Follow-up:* ninguno.

## 2. Revisión de ADR-031 (US2)

Se agrega al final de ADR-031, sin cambiar su decisión original:

> - **Revisión (funcionalidad 007, 2026-11-xx, con la enmienda 1.7.0):** para los indicadores agregados de RF31,
>   dos vistas de solo conteo, `platform_appointment_counts (month, status, appointments)` y
>   `platform_membership_counts (kind, users)`, ya agregadas y sin la barbería, pertenecen al rol nuevo
>   `barberias_conteos` (`NOLOGIN NOBYPASSRLS NOINHERIT`).
>   - Ese rol tiene solo `SELECT (created_at, status)` sobre `appointment` y `SELECT (role_code, status)` sobre
>     `membership`, con una política `FOR SELECT TO barberias_conteos USING (true)` en las dos.
>   - `barberias_plataforma` recibe `SELECT` solo sobre las dos vistas, y ningún permiso sobre `appointment`,
>     `membership`, `customer_profile` ni `user_account`.
>   - **Alternativas descartadas:**
>     - permisos por columna sobre las tablas para `barberias_plataforma`;
>     - una función `SECURITY DEFINER` de `barberias_auth`, que tiene `BYPASSRLS`;
>     - contar barbería por barbería con el rol de la aplicación;
>     - vistas con `tenant_id`, que permitirían filtrar por barbería.
>   - **Pruebas:** `lectura-plataforma` compara la lista exacta (columnas de tablas más las dos vistas) y comprueba
>     que `SELECT id FROM appointment` y `FROM membership` siguen denegados; `barberias_conteos` no puede
>     conectarse ni escribir.
>   - **Consecuencias:**
>     - se crea el rol en `db/init/01-roles.sql`, más su paso manual para bases existentes;
>     - la acción `ADMIN_INDICADORES_CONSULTADOS` en `platform_audit_log`;
>     - la regla `lectura-plataforma-confinada` suma `catalogo-citas/citas/infrastructure/plataforma/`.

## 3. Aclaración PATCH del principio III sobre `login_attempt` (US3)

**Versionado:** **PATCH** (aclaración de un hecho ya previsto en 1.4.1: no cambia ninguna regla). Queda en 1.7.1
si la enmienda de US2 se aplicó antes, o en 1.6.1 si no.

**Texto actual** (principio III, "Tablas técnicas de intentos"):

> `login_attempt` guarda, tal como está hoy, el SHA-256 del correo, la IP **en claro** y la fecha; […] Pasar
> `login_attempt` a un hash de la IP queda como mejora planificada para la funcionalidad 007.

**Texto propuesto:**

> `login_attempt` guarda el SHA-256 del correo, el origen **solo como hash con sal** (`INTENTOS_SAL_IP`, distinta
> de la de los enlaces), nunca la IP en claro, y la fecha; sus filas de más de 24 h se borran de forma oportunista
> al registrar un fallo nuevo, y un ingreso correcto borra los fallos de ese par cuenta y origen (sin una purga
> programada). [Implementado en 007.]

Y se quita de la puerta III de `plan-template.md` la frase "`login_attempt` keeps the IP in clear … (moving it to
an IP hash is planned for 007)", reemplazada por "`login_attempt` stores the origin only as a salted hash".

Se aplica **después** de que US3 esté en verde. Si US3 se recorta, el texto actual sigue siendo cierto y no se
aplica.
