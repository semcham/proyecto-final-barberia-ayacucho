# Borradores para revisión del responsable: enmienda de la constitución y revisión de ADR-031

> **Estado (2026-11-16): aprobados por el responsable tal como están.**
>
> - **(1) Enmienda 1.7.0:** aplicada en `.specify/memory/constitution.md` y en la puerta III de
>   `.specify/templates/plan-template.md` (fase 2a).
> - **(2) Revisión de ADR-031:** aplicada en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`, con
>   las vistas "por construir en la fase 2c" (fase 2a).
> - **(2b) Nota sobre el registro de indicadores:** aprobada el 2026-11-16 y aplicada en ADR-031 en la fase 2b
>   (T039).
> - **(3) Aclaración PATCH de US3:** aprobada y aplicada el 2026-11-18 como versión **1.7.1**, con las pruebas de US3
>   en verde (T065).
>
> **No hay corte:** las fases 2b, 2c y 3 se construyen. Abajo quedan los textos tal como se aprobaron.

## 1. Enmienda MINOR 1.7.0 del principio III (US2)

**Versionado:** 1.6.0 → **1.7.0** (MINOR: amplía de forma material la guía de la excepción "operaciones de la
plataforma"). No elimina ni redefine nada.

**Texto actual** (principio III, excepción "operaciones de la plataforma", fragmento):

> Sus lecturas entre barberías MUST hacerse con un rol de base de datos sin `BYPASSRLS`, de solo lectura y con
> permisos por columna sobre esas tablas. […] MUST NOT ver ni modificar citas, clientes, catálogo ni usuarios.

**Texto propuesto** (se agrega después de "MUST NOT ver ni modificar citas, clientes, catálogo ni usuarios."):

> **Conteos de uso (RF31).** Para los indicadores agregados de la plataforma, el rol de lectura de la plataforma
> MAY leer **vistas de solo conteo** sobre citas y membresías. Esas vistas MUST entregar solo números agregados
> sin ninguna columna de barbería ni de persona (solo el mes y el estado de la cita, y el tipo de membresía),
> MUST NOT permitir obtener una fila de una cita, de un cliente ni de un usuario, y MUST pertenecer
> a un rol propio sin inicio de sesión y sin `BYPASSRLS`, con `SELECT` solo sobre las columnas que cuentan y una
> política de lectura propia. **Ningún rol con inicio de sesión MUST heredar ese rol** (se concede, si hace
> falta para asignar la propiedad, sin herencia). El rol de lectura de la plataforma MUST NOT recibir permisos
> sobre las tablas de citas, clientes ni usuarios, y los roles de la aplicación y de las lecturas públicas MUST
> NOT leer esas vistas. Una prueba de permisos exactos MUST comprobar todo lo anterior. La decisión se registra
> en ADR-031.

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
>     `membership`, `customer_profile` ni `user_account`. `barberias_app` y `barberias_publico` no leen las vistas.
>   - `barberias_owner` recibe `barberias_conteos` con `WITH INHERIT FALSE, SET TRUE` (PostgreSQL 16): puede
>     asignarle la propiedad de las vistas, pero no hereda sus políticas, así que sigue viendo solo la barbería de
>     su transacción. Ningún rol con inicio de sesión hereda `barberias_conteos`.
>   - **Alternativas descartadas:**
>     - permisos por columna sobre las tablas para `barberias_plataforma`;
>     - una función `SECURITY DEFINER` de `barberias_auth`, que tiene `BYPASSRLS`;
>     - contar barbería por barbería con el rol de la aplicación;
>     - vistas con `tenant_id`, que permitirían filtrar por barbería.
>   - **Pruebas:** `lectura-plataforma` comprueba:
>     - la lista exacta (columnas de tablas más las dos vistas);
>     - que `SELECT id FROM appointment` y `FROM membership` siguen denegados;
>     - que `barberias_conteos` no puede conectarse ni escribir;
>     - que `barberias_app` y `barberias_publico` no leen las vistas;
>     - que `barberias_owner`, con tenant fijado, solo ve su barbería, y que ningún rol con inicio de sesión hereda
>       `barberias_conteos`.
>   - **Consecuencias:**
>     - se crea el rol en `db/init/01-roles.sql`, más su paso manual para bases existentes;
>     - la acción `ADMIN_INDICADORES_CONSULTADOS` en `platform_audit_log`;
>     - la regla `lectura-plataforma-confinada` suma `catalogo-citas/citas/infrastructure/plataforma/`.

## 2b. Nota de ADR-031 sobre el registro de indicadores (US2, fase 2b; no depende de la enmienda)

Se agrega a ADR-031 como **nota propia**, separada de la revisión del punto 2. Se aplica en la fase 2b aunque la
enmienda no se apruebe o la fase 2c se corte (análisis M8):

> - **Nota (funcionalidad 007, 2026-11-xx): registro de indicadores de la plataforma.** Los indicadores agregados
>   de RF31 los junta un registro sin reglas de negocio en M06 (`shared/indicadores/`, `RegistroDeIndicadores`).
>   - Cada módulo aporta una fuente que cuenta **solo sus propios datos**, en su carpeta
>     `infrastructure/plataforma/`, con el nombre `*-indicador.ts`, y con la lectura de la plataforma.
>   - El host (`host/indicadores.ts`) registra las fuentes al arrancar, como `host/tareas.ts` con el
>     `EjecutorTareas`. La ruta `@Plataforma()` y la auditoría del acceso están en M01, dueño de
>     `platform_audit_log`.
>   - **Por qué:** la matriz de dependencias no deja que ningún módulo llame a la vez a M01, M02 y M03, y así no
>     cambia.
>   - **Regla de PR14:** `indicadores-solo-por-registro`: las fuentes solo las importa el host (y el `index.ts`
>     de su módulo), y M06 no importa módulos.
>   - **Sin la enmienda** (corte de la fase 2c), la única fuente es la de las barberías por estado (M03), con las
>     columnas que el rol ya lee.

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
