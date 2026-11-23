# Borradores para revisión del responsable: enmienda 1.8.0 del principio III y ADR-036

> **Estado (2026-11-23): versión 2 aprobada por el responsable tal como está, y aplicada en la fase 0 de 010.**
>
> - **(1) Enmienda MINOR 1.8.0:** aplicada en `.specify/memory/constitution.md` (principio III con la quinta
>   excepción, la tabla técnica `account_link_attempt` y su Razón; ajuste del principio VII; Sync Impact Report;
>   versión 1.8.0) y en las puertas III y VII de `.specify/templates/plan-template.md`.
> - **(2) ADR-036:** registrado como Aceptado en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`. El
>   número 036 está libre (ADR-034 y ADR-035 son de 009 y aún no están en ese documento).
> - **(3) Revisión obligatoria de ADR-015:** aprobada y anotada en las consecuencias de ADR-015.
> - **Comprobación previa a la aprobación:** las reglas de dependency-cruiser (PR14) permiten que M05 llame a
>   `CuentasApi` de M01 por su `index.ts` (regla `matriz-m05`; ya lo hace con `BarberiasApi`, `ClientesApi` y
>   `PersonalApi` en `notificaciones/application/enviar-avisos.ts`).
>
> Abajo quedan los textos tal como se aprobaron.
>
> **Cambios respecto a la versión 1** (análisis del 2026-11-23, hallazgos C1 y C2):
>
> - La excepción enumera **exactamente tres operaciones**, con lo que escribe cada una: pedir un enlace de recuperación,
>   verificar el correo y restablecer la contraseña. El `slug` solo elige entre las membresías de esa cuenta.
> - Se aclara la auditoría: se audita en la barbería del enlace solo cuando el enlace pertenece a una cuenta; los enlaces
>   desconocidos o mal formados van solo al contador técnico.
>
> **Por qué hace falta**: las tres operaciones ocurren **sin sesión**. Ninguna de las cuatro excepciones vigentes del
> principio III las cubre: la segunda (selección de membresía por enlace) exige haber comprobado la identidad con la
> contraseña o una sesión, y la cuarta (acciones por enlace) es solo para una cita. Además, restablecer la contraseña de un
> cliente con cuenta en varias barberías obliga a cerrar sus sesiones en todas ellas (research R04 de 010).

## 1. Enmienda MINOR del principio III (propuesta: 1.7.2 → 1.8.0)

**Versionado:** MINOR. Agrega una **quinta excepción acotada** con tres operaciones exactas y una tabla técnica más. No
amplía las excepciones existentes, no crea roles y no cambia ninguna política RLS.

**Texto que se agrega** al principio III, después de la excepción "acciones por enlace de la cita" (antes de la
**Razón**):

> - **Excepción acotada: operaciones de la cuenta por enlace del correo.** Sin sesión, una persona MAY realizar **solo**
>   estas tres operaciones sobre **su propia cuenta**:
>   1. **Pedir un enlace de recuperación de la contraseña**, indicando su correo y, opcionalmente, el enlace público
>      (`slug`) de la barbería desde la que lo pide. El sistema MAY resolver la cuenta por el correo y elegir una
>      barbería **solo entre las membresías de esa misma cuenta**: la del `slug` si la cuenta es miembro de ella; si
>      no, la de su membresía de personal o, en su defecto, la de su membresía de cliente más reciente. El `slug` MUST NOT
>      elegir una barbería donde la cuenta no tenga membresía. Solo MAY escribir, en esa barbería y con RLS, el enlace de
>      la cuenta **sin el token**, su evento de salida y la auditoría de la solicitud. Fuera de toda barbería, solo MAY
>      escribir el contador técnico de intentos.
>   2. **Verificar el correo de su cuenta** con el enlace recibido. Solo MAY escribir la marca de verificación de la
>      cuenta, el uso de ese enlace y la anulación de sus otros enlaces de verificación.
>   3. **Restablecer la contraseña de su cuenta** con el enlace recibido. Solo MAY escribir el resumen de la contraseña
>      nueva, la marca de verificación de la cuenta, el uso de ese enlace, la anulación de sus otros enlaces de
>      recuperación y el cierre de **sus** sesiones en todas sus barberías, más el evento que avisa del cambio.
>
>   Las dos últimas, y la resolución de la cuenta en la primera, MUST hacerse solo con funciones de sistema acotadas del
>   rol de autenticación antes del tenant ya existente (ADR-015), sin crear ni conceder ningún rol nuevo con `BYPASSRLS`.
>   Ninguna de las tres MUST leer ni modificar otros datos de negocio.
>
>   **Reglas de los enlaces.** Cada enlace MUST servir para un solo propósito, una sola cuenta y un solo uso. MUST vencer
>   como máximo a las 24 horas (verificar) o a la hora (restablecer) y MUST anularse al emitirse otro del mismo propósito.
>   MUST guardarse solo de forma que no pueda reconstruirse a partir de lo guardado, y su token MUST NOT guardarse en
>   eventos, avisos ni registros. Antes de validar un enlace, el sistema MUST NOT leer datos de ninguna barbería.
>
>   **Respuestas.** Pedir un enlace y usarlo MUST responder igual exista o no la cuenta, y MUST NOT revelar por qué un
>   enlace no sirve.
>
>   **Auditoría.** Se audita en la barbería del enlace **solo** cuando el enlace pertenece a una cuenta. Un enlace
>   desconocido o mal formado MUST registrarse solo en el contador técnico, nunca en la auditoría.
>
>   **Límites.** Las solicitudes y los usos fallidos MUST limitarse por cuenta y por origen, con su contador en
>   PostgreSQL.
>
>   La decisión se registra en ADR-036.

**Texto que se agrega** en el mismo principio, en "Tablas técnicas de intentos", después de la frase de
`action_link_attempt`:

> `account_link_attempt` (desde 010) MUST guardar el origen solo como hash con sal (`INTENTOS_SAL_IP`), nunca la IP en
> claro, y la cuenta o el correo solo como resumen, nunca en claro, con purga a las 24 h.

**Texto que se agrega** a la **Razón** del principio III, al final:

> La quinta existe porque quien olvidó su contraseña, o quien debe demostrar que su correo es suyo, todavía no tiene una
> sesión; se limita a tres operaciones sobre la propia cuenta, elige la barbería solo entre las membresías de esa cuenta,
> verifica el enlace antes de leer nada y no crea roles nuevos.

**Ajuste mínimo del principio VII** (consecuencia necesaria; no amplía otros contenidos). En la lista de lo que pueden
llevar los mensajes, después de "enlaces de acción":

> y, en los avisos de la propia cuenta (verificación del correo, recuperación de la contraseña y aviso de contraseña
> cambiada), el enlace de la cuenta, su vigencia y la fecha del cambio; nunca la contraseña.

**Sync Impact Report (borrador):**

- _Version change:_ 1.7.2 → 1.8.0 (MINOR: nueva excepción acotada del principio III con tres operaciones y su tabla
  técnica; ajuste mínimo del principio VII).
- _Modified principles:_ III. Aislamiento por barbería (quinta excepción acotada, tabla técnica `account_link_attempt`,
  razón); VII. Notificaciones (contenido de los avisos de la propia cuenta).
- _Templates requiring updates:_ `.specify/templates/plan-template.md`, puerta III ("Only four exceptions" → "Only five
  exceptions", con el resumen en inglés de la quinta) y puerta VII (avisos de la cuenta).
- _Docs:_ `docs/02-arquitectura-software/seguridad-y-privacidad.md` (excepciones y matriz), `multi-tenancy-y-datos.md`
  (casos especiales), `docs/trazabilidad.md`.
- _Follow-up:_ revisión obligatoria de ADR-015 (las funciones nuevas amplían su mecanismo).

**Resumen en inglés para la puerta III del plan-template (propuesta):**

> (5) account operations by email link (amendment 1.8.0, ADR-036): without a session, a person may only (a) request a
> password-reset link for their own account, (b) verify their account's email, or (c) reset their account's password.
> (a) may resolve the account by email and pick a barbershop only among that account's own memberships (the slug's
> barbershop only if the account is a member; else staff, else the most recent client membership), writing only the
> link without its token, its outbox event and the request audit in that barbershop, plus the technical attempt counter;
> (b) and (c) consume a single-purpose, single-account, single-use link (24 h / 1 h), stored only as a non-reversible
> digest, never in events, notices or logs, revoked when a new one is issued, through bounded system functions of the
> existing pre-tenant auth role (ADR-015), no new `BYPASSRLS` role; (b) writes only the verification mark and its links;
> (c) writes only the password digest, the verification mark, its links and closes that account's own sessions in all
> its barbershops. Neutral responses; audit only in the link's barbershop and only for links that belong to an account
> (unknown links go only to the counter); requests and failed uses limited per account and origin with a PostgreSQL
> counter (`account_link_attempt`, salted origin hash, 24 h purge).

### Alternativa descartada

Usar la segunda excepción (selección de membresía por enlace) para la recuperación: no sirve, porque exige comprobar la
identidad con la contraseña o una sesión, que es justo lo que falta. Ampliarla para aceptar "o un enlace del correo"
mezclaría dos mecanismos distintos y ampliaría su alcance a operaciones que no son de membresía.

## 2. ADR-036 (número provisional): enlaces de la cuenta por correo y evento de M01 a M05

> Su número se confirma libre al aplicarlo: ADR-034 y ADR-035 están aprobados en 009 y aún sin aplicar en
> `07-decisiones-arquitectonicas.md`.

- **Estado:** Propuesto (pendiente de revisión del responsable, junto con la enmienda 1.8.0).
- **Contexto:** la auditoría del 2026-11-19 marcó como bloqueantes para clientes reales que el correo del cliente no se
  verifica y que no existe recuperación de contraseña. ADR-015 ya resuelve la autenticación antes del tenant con
  funciones de sistema de un rol `NOLOGIN BYPASSRLS` (`barberias_auth`). ADR-020 da a cada cliente una cuenta única con
  membresía por barbería. ADR-025 y ADR-026 envían los avisos por la salida de eventos y el puerto `NotificationChannel`.
  ADR-032 firma los enlaces del recordatorio al enviar, sin guardarlos.
- **Problema:** ¿cómo enviar y consumir enlaces de un solo uso para verificar el correo y restablecer la contraseña, sin
  guardar el enlace, sin sesión, sin rol nuevo con `BYPASSRLS`, con el correo saliendo solo por M05 y sin revelar si una
  cuenta existe?
- **Alternativas:**
  - (a) Enlaces firmados sin estado (como ADR-032): no permiten un solo uso ni anular el anterior sin una tabla de usos.
  - (b) Poner el token en el evento de la salida: quedaría en claro en `outbox_event` hasta su purga.
  - (c) Cifrar el token en el evento: más piezas (llave, rotación) para un dato que puede generarse al enviar.
  - (d) Que M01 envíe el correo: rompe las reglas `canal-solo-por-puerto` y `m05-sin-llamadas`.
  - (e) **Un enlace de cuenta con estado, cuyo token se genera al enviar, y funciones de sistema de `barberias_auth` para
    resolver la cuenta y consumir el enlace.**
- **Decisión:** opción (e).
  1. **Datos.**
     - `account_link` (por barbería, con RLS): propósito, cuenta, barbería de origen, SHA-256 del token, vencimiento, uso
       y anulación; un solo enlace vigente por cuenta y propósito.
     - `user_account` agrega la marca de verificación: fecha y vía (`ENLACE`, `ACTIVACION` o `MIGRACION`).
     - `account_link_attempt`: contador técnico sin barbería.
     - Detalle en el data-model de 010.
  2. **Las tres operaciones sin sesión** (enmienda 1.8.0):
     - **Pedir la recuperación.** Resuelve la cuenta con `auth_resolver_cuenta` y elige la barbería con
       `auth_barberia_para_enlace`, solo entre las membresías de la cuenta (el `slug` solo cuenta si la cuenta es miembro
       de esa barbería). Crea el enlace sin token, su evento y la auditoría en esa barbería.
     - **Verificar** y **restablecer.** `auth_verificar_correo` y `auth_restablecer_contrasena` validan y consumen el
       enlace en una sola sentencia y escriben solo filas de esa cuenta. Restablecer cierra **todas** sus sesiones en todas
       sus barberías; como el guard comprueba la sesión en cada solicitud, los tokens de acceso dejan de servir al instante.
     - La verificación que nace del registro y el reenvío con sesión ya tienen su barbería (la del registro o la del token)
       y no necesitan la excepción.
  3. **Envío.** M01 publica `EnlaceDeCuentaSolicitado` (solo `enlaceId`, propósito, cuenta y vencimiento) con la barbería
     del enlace. M05 crea el aviso para el destinatario nuevo `CUENTA` y, **al enviar**, pide a M01
     (`CuentasApi.emitirToken`) un token: M01 guarda su hash y lo devuelve en memoria. Cada reintento emite otro. Ningún
     evento, aviso ni registro guarda el token.
  4. **Exigir la verificación.** Un guard del host (`CorreoVerificadoGuard`) actúa en reservar, preguntar al asistente y
     registrar el pago del adelanto, solo para clientes, con 403 `CORREO_NO_VERIFICADO`. Va en el host porque M03 y M04
     no pueden llamar a M01. El `AuthGuard` no cambia.
  5. **Respuestas neutras.**
     - Pedir la recuperación, reenviar y usar un enlace responden igual exista o no la cuenta.
     - Se aplica un tiempo mínimo de respuesta fijado por `CUENTA_RESPUESTA_MINIMA_MS` (400 ms por defecto).
     - Las funciones de consumo devuelven al caso de uso `APLICADO`, `RECHAZADO` (enlace de una cuenta: usado, vencido o
       anulado) o nada (ningún hash coincide). Hacia fuera, los dos últimos son el mismo 410.
  6. **Auditoría.** En la barbería del enlace se auditan la solicitud con cuenta, el uso aceptado y el rechazo de un
     enlace que pertenece a una cuenta. Un enlace desconocido o mal formado no tiene cuenta ni barbería: va solo a
     `account_link_attempt` como `USO_FALLIDO` (el principio III exige la barbería en toda auditoría).
  7. **Cuentas existentes.** Todas quedan verificadas por la migración (vía `MIGRACION`), para no cambiar nada a quien ya
     usa la plataforma. El personal se verifica al activar su cuenta.
- **Riesgos aceptados y decisiones pendientes:**
  - **El registro revela si un correo tiene cuenta** (409 `CORREO_NO_DISPONIBLE`): se mantiene por decisión del
    responsable, mitigado por `REGISTRO_LIMITE_POR_MINUTO`.
  - **El propietario no verifica su correo** en 010 (decisión del 2026-11-23): un propietario con un correo ajeno o mal
    escrito no podrá recuperar su contraseña ni recibir avisos. Mejora futura.
  - **Versiones nuevas de los textos legales**: quien aceptó una anterior no tiene que volver a aceptar (decisión del
    2026-11-23); se decide cuando exista una versión nueva.
  - **Reenvío tras un error del servidor de correo**: si el servidor aceptó el envío pero respondió con error, el
    reintento invalida el primer enlace.
  - **Tiempos en la CI**: la medición de tiempos de las respuestas neutras corre en la CI sin bloquearla, porque en los
    ejecutores compartidos varía por causas ajenas al código; se exige con el umbral estricto en la verificación local.
- **Justificación:** reutiliza los mecanismos probados (tokens opacos y funciones de sistema de ADR-015, salida de
  eventos, puerto de correo, firma al enviar de ADR-032), no crea roles y deja el enlace solo en el correo.
- **Pruebas:**
  - Un solo uso, vencimiento y anulación, por propósito.
  - Respuestas neutras: una prueba funcional bloqueante (el mismo estado y el mismo cuerpo, y el piso respetado) y una
    medición de tiempos no bloqueante en la CI (diferencia de medianas menor de 30 ms y percentil 90 dentro del piso más
    50 ms, con 100 solicitudes por serie).
  - Cierre de sesiones en dos barberías.
  - El guard en las tres rutas (cliente sin verificar → 403; propietario → sin cambio).
  - Permisos exactos de las funciones nuevas en `funciones-definer.spec.ts`.
  - Contador de intentos con el origen solo como hash.
  - Elección de la barbería: un `slug` de una barbería sin membresía no la elige.
  - Ningún token en `outbox_event`, en `notification` ni en los registros (con datos canario).
  - Auditoría solo de enlaces de una cuenta.
  - Aislamiento PR09: un enlace de la barbería A no da acceso a la B.
  - Reglas de dependencias (PR14).
- **Revisión obligatoria:** ADR-015 (sus funciones de sistema se amplían).
- **Drivers:** DA01, DA11.
- **Consecuencias:** se actualizan `seguridad-y-privacidad.md` (excepciones, matriz y cookies), `multi-tenancy-y-datos.md`,
  `api-rest.md`, la trazabilidad, `03-requisitos-funcionales.md` (RF04 y RF05 ampliados, RF nuevos) y la puerta III del
  plan-template.
