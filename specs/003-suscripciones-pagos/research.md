# Research: Suscripciones y pagos de las barberías (003)

**Fecha**: 2026-10-24 · **Especificación**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Cada decisión indica qué se eligió, por qué y qué se descartó. Las de arquitectura se registran como
ADR en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`, en estado **Aceptado** (decisión del responsable, 2026-10-24):

- ADR-022: pasarela y transferencia;
- ADR-023: comprobantes;
- ADR-024: tareas programadas;
- ADR-031: operaciones de la plataforma, con la enmienda 1.3.0 de la constitución (aplicada el
  2026-10-24).

No hay `NEEDS CLARIFICATION` abiertas. **No se agrega ninguna librería** (ver R16).

---

## R01 · Proveedor de pagos y adaptadores detrás de `PaymentGateway` (ADR-022)

**Decisión:**

- M03 define el puerto `PaymentGateway` en `pagos/application/ports/`. Hay dos adaptadores en
  `pagos/infrastructure/` y se elige con `PAGOS_PROVEEDOR`:
  1. **`simulado` (por defecto en desarrollo, pruebas y CI):** `PasarelaSimuladaAdapter` habla por HTTP
     con el **simulador de pasarela** (R02), un proceso aparte con el mismo protocolo que una pasarela
     real: sesión de pago alojada, notificaciones firmadas, consulta de estado y cancelación.
  2. **`culqi` (ambiente de pruebas y producción):** `PasarelaCulqiAdapter`, escrito contra la API
     pública de Culqi (candidato de ADR-007) con `fetch` de Node, sin SDK. **Se construye solo si al
     día 11 del plan hay credenciales de prueba y Culqi confirma Yape (R15).** Si no, la línea de corte
     de 003 deja el simulador como única pasarela de la entrega, y el adaptador real queda descrito en
     ADR-022 como trabajo pendiente.
- **Configuración** (`.env`, nunca en el código):
  - `PAGOS_PROVEEDOR`;
  - `PAGOS_URL_BASE`;
  - `PAGOS_LLAVE_PUBLICA`;
  - `PAGOS_LLAVE_SECRETA`;
  - `PAGOS_SECRETO_FIRMA`;
  - `PAGOS_URL_RETORNO`;
  - `PAGOS_TIEMPO_LIMITE_MS` (2000).

  Pasar del simulador al ambiente de pruebas, o a producción, cambia solo estas variables (FR-011,
  SC-009).

- **El puerto** (sin tipos del proveedor):
  - `crearSesionDePago({ pagoId, importeCentimos, moneda, descripcion, metodo: 'YAPE', urlRetorno })`
    devuelve `{ referenciaProveedor, urlPago, expiraEn }`;
  - `consultarPago(referenciaProveedor)` devuelve `{ estado, importeCentimos, moneda, eventoId? }`,
    con `estado` igual a `APROBADO`, `RECHAZADO`, `PENDIENTE` o `EXPIRADO`;
  - `cancelarSesion(referenciaProveedor)` devuelve `true` o `false`, según si el proveedor lo permite;
  - `verificarNotificacion(cuerpoCrudo, encabezados)` devuelve una `NotificacionVerificada` o lanza
    `FirmaInvalida`;
  - `limitesYape()` devuelve el mínimo y el máximo en céntimos.
- Toda llamada al proveedor tiene un tiempo límite (2 s) y pasa por el interruptor de circuito de M06
  (R13). Los reintentos solo se hacen en `consultarPago` y `cancelarSesion`, que son idempotentes.

**Justificación:** el principio V exige el puerto y prohíbe datos de tarjeta. El acuerdo de alcance
pide pasar a producción solo con configuración. Con un simulador **por HTTP**, la caída y la lentitud
son reales (red, tiempo límite, interruptor) y no un `throw` de prueba. La misma suite de contrato
del puerto corre contra cualquier adaptador (PR20, R14).

**Alternativas descartadas:**

- Un simulador dentro del proceso (una clase que responde en memoria): no ejercita la red, el tiempo
  límite ni la firma sobre bytes reales, y con dos réplicas su estado no se comparte.
- El SDK oficial del proveedor: es una dependencia nueva sin necesidad, porque la API es REST y `fetch`
  basta.
- Integrar directamente en el caso de uso: lo prohíbe el principio V.

**Por verificar (R15):** que Culqi admita Yape en su ambiente de pruebas, sus montos mínimo y máximo
(ADR-007 cita de S/ 6 a S/ 500 para billeteras QR) y el formato exacto de su firma. Mientras tanto, el
simulador usa el formato de R03.

## R02 · Simulador de la pasarela (adaptador completo)

**Decisión:** el simulador vive en `tecnologia/plataforma-barberias/backend/simulador-pagos/`. Es un
servidor con `node:http` y `node:crypto`, sin dependencias. **No es parte del monolito** (no está en
`src/`, ningún módulo lo importa) y **nunca se despliega en producción**.

- **En Docker Compose:** servicio `pasarela-simulada`, 64 MB, puerto 3100, que corre con el `tsx` ya
  instalado.
- **En las pruebas:** se arranca en el mismo proceso con `iniciarSimulador({ puerto: 0, ... })`.

Protocolo (detalle en [contracts/pasarela-simulada.md](contracts/pasarela-simulada.md)):

| Capacidad               | Cómo                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesión de pago alojada  | `POST /v1/sesiones` crea la sesión. `GET /checkout/{id}` muestra una página mínima con "Aprobar", "Rechazar" y "Dejar pendiente". El propietario nunca escribe datos de Yape en la plataforma |
| Notificaciones firmadas | Al decidir, envía `POST {PAGOS_URL_NOTIFICACIONES}` con el cuerpo JSON y el encabezado `X-Firma: t={unix},v1={hex}` = HMAC-SHA256(`{t}.{cuerpo}`, secreto)                                    |
| Consulta y cancelación  | `GET /v1/sesiones/{ref}` devuelve el estado y el importe. `POST /v1/sesiones/{ref}/cancelar` cancela si está pendiente                                                                        |
| Rechazo                 | El botón "Rechazar" o el modo `rechazar`                                                                                                                                                      |
| Lentitud                | Modo `lento` con `retardoMs` (respuestas y notificaciones demoradas)                                                                                                                          |
| Caída                   | Modo `caido`: deja de aceptar conexiones (cierra el puerto); se reabre con `normal`. En Compose también sirve `docker compose stop pasarela-simulada`                                         |
| Notificación repetida   | Modo `duplicar` con `veces` (la misma notificación N veces, con el mismo `evento_id`)                                                                                                         |
| Firma inválida          | Modo `firma_invalida` (firma con otro secreto) y `sin_firma`                                                                                                                                  |
| Fuera de orden          | Modo `fuera_de_orden`: primero `APROBADO` y luego un `PENDIENTE` atrasado                                                                                                                     |
| Aprobación tardía       | Modo `aprobar_despues` con `retardoMs`: aprueba una sesión ya expirada o anulada en la plataforma (FR-012a)                                                                                   |
| Devolución              | `POST /control/sesiones/{ref}/devolver`: notifica `DEVUELTO` (FR-017a)                                                                                                                        |
| Control                 | `POST /control/modo` y `POST /control/reiniciar`, solo con `SIMULADOR_TOKEN_CONTROL`. Las pruebas los usan; en Compose, `npm run simulador:modo -- lento 2500`                                |

El estado del simulador vive en su memoria, porque es un único proceso. Al reiniciarlo, las sesiones
se pierden, igual que cuando un proveedor real "olvida" una sesión vencida.

**Alternativas descartadas:**

- MSW o nock: interceptan en el proceso, sin red real, y no funcionan con dos réplicas en Compose.
- WireMock: imagen Java de más de 200 MB, mucha memoria para un equipo de 8 GB.
- El ambiente de pruebas real como única opción: depende de R15 y de la red externa en CI.

## R03 · Notificaciones: firma, idempotencia y atomicidad (FR-013 a FR-018)

**Decisión:**

1. **Ruta:** `POST /api/v1/pagos/notificaciones`. Es pública (no lleva token de usuario), con límite
   propio de 60 por minuto por IP (FR-013a). El cuerpo crudo se conserva para verificar la firma: un
   `verify` del parser JSON, solo en esta ruta, con un máximo de 16 KB.
2. **Firma:** la verifica el adaptador. Para eso:
   - el HMAC-SHA256 se compara en tiempo constante (`timingSafeEqual`);
   - se rechaza un `t` con más de 5 minutos de diferencia respecto del reloj (protección contra
     reenvíos maliciosos);
   - el `evento_id` debe ser único.

   Lo inválido responde **401** sin ningún efecto, y solo se registra una línea resumida
   `PAGO_NOTIFICACION_RECHAZADA`, con el motivo y la IP, sin el cuerpo.

3. **Reenvíos legítimos del proveedor días después:** el proveedor vuelve a firmar con un `t` nuevo.
   El mismo `evento_id` se reconoce como ya procesado y responde **200** sin efecto. Esto es
   compatible con el borde "lo reenvía días después" de la especificación.
4. **Tenant:** con el `referencia_proveedor` verificado, una lectura exacta por la vía de la plataforma
   (R06) devuelve `(tenant_id, pago_id)`. Si no hay pago, el evento queda como `SIN_PAGO` para revisión
   del administrador (FR-016). Con el tenant obtenido, todo lo demás corre en **una transacción con
   ese tenant fijado y RLS**:
   - `INSERT` del evento con `ON CONFLICT (evento_id) DO NOTHING`; si no inserta, es un repetido y
     responde 200;
   - bloqueo de la fila del pago (`FOR UPDATE`);
   - transición del pago según la máquina de [data-model.md](data-model.md) §3;
   - si se aprueba, inserción del período y actualización de la suscripción.

   O se aplica todo, o nada (FR-015).

5. **Comparación de importe y moneda:** contra lo fijado al iniciar el pago (FR-005b). Si no coinciden,
   el pago no se aplica y queda `revision = IMPORTE_DISTINTO`.
6. **Respuesta rápida (FR-018):** la transacción es corta (un puñado de filas) y no llama al proveedor.
   La verificación extra con `consultarPago` la hace la conciliación, no la notificación.

**Alternativas descartadas:**

- Aceptar sin firma y luego consultar al proveedor: deja abierta una vía de denegación de servicio y
  contradice el principio V.
- Encolar la notificación y procesarla después: necesita una cola (y Redis no puede ser fuente de
  verdad); la transacción directa es suficiente para el volumen esperado.
- Deduplicar en memoria: no sirve con dos réplicas.

## R04 · Períodos, pago abierto único y "el dinero recibido nunca se ignora" (FR-004, FR-012)

**Decisión:**

- **Tabla `subscription_period`** (ver [data-model.md](data-model.md)): una fila por período pagado,
  con `UNIQUE (payment_id)` y la restricción de exclusión
  `EXCLUDE USING gist (subscription_id WITH =, tstzrange(starts_at, ends_at) WITH &&)`.
  **Ningún pago puede extender dos veces ni crear períodos solapados**, garantizado en PostgreSQL,
  como las citas (principio IV aplicado a dinero).
- **Inicio del período**, que se calcula al aprobar, con la suscripción bloqueada:
  - prueba vigente o período vigente: al terminar la cobertura actual;
  - período de gracia: al terminar el período vencido (P2: A);
  - vencida o cancelada: al aprobarse.

  La duración es un mes calendario, ajustado al último día del mes (FR-004).

- **Pago por adelantado:** como máximo un período. Al iniciar un pago se rechaza con
  `PAGO_ADELANTADO_NO_PERMITIDO` si ya existe un período que empieza después del actual.
- **Un pago abierto por suscripción:** índice único parcial
  `UNIQUE (subscription_id) WHERE status IN ('PENDIENTE', 'ESPERANDO_COMPROBANTE', 'EN_REVISION')`. Un
  pago de transferencia sin comprobante a los 7 días pasa a `EXPIRADO` (tarea de R08). Con dos intentos simultáneos
  hay **una sola fila**: el segundo choca con el índice y recibe la existente si es el mismo plan y el
  mismo medio, o anula la anterior y reintenta si es otro (FR-012).
- **Aprobación tardía (FR-012a):**
  - `ANULADO` y `EXPIRADO` pasan a `APROBADO` si llega la aprobación del proveedor;
  - si ya hay un período que cubre ese tramo, el pago se aprueba sin período nuevo y queda con
    `revision = DUPLICADO`;
  - el historial siempre lo muestra.

  Un `APROBADO` después de un `RECHAZADO` se registra con `revision = APROBADO_TRAS_RECHAZO` y no
  aplica período (FR-017).

- **Plan vigente:** es el del período que cubre el instante actual, o el de prueba. `subscription.plan_id`
  se actualiza en la misma transición de estado que la tarea programada aplica al empezar un período
  (R08). Las lecturas de límites usan siempre el período vigente (FR-005).

**Alternativas descartadas:**

- Guardar solo `current_period_end` en la suscripción y sumar un mes en cada pago: no impide la doble
  extensión si dos aprobaciones llegan juntas, y no conserva qué pago cubrió qué tramo.
- Bloqueos en la aplicación: la constitución exige que las garantías críticas estén en la base.

## R05 · Transferencia con comprobante (FR-019 a FR-024)

**Decisión:**

- **Iniciar la transferencia:** `POST /suscripcion/pagos` con `medio: TRANSFERENCIA` crea el pago
  `ESPERANDO_COMPROBANTE` (que también cuenta como abierto) y devuelve:
  - los datos bancarios de la plataforma (variables `PAGOS_CUENTA_*`);
  - el importe exacto;
  - la referencia `SUS-{6 caracteres del tenant}-{AAAAMM}-{4 aleatorios}`.
- **Subir el comprobante:** `multipart/form-data` en `POST /suscripcion/pagos/{id}/comprobante`, con
  `archivo`, `numeroOperacion` y `fechaTransferencia`. Se procesa con `FileInterceptor` de
  `@nestjs/platform-express` (que trae `multer` 2.4.0, MIT, **ya instalado**): memoria, un archivo,
  5 MB.
  - El tipo se verifica por los **bytes iniciales**: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A` y
    PDF `%PDF-`. No se usan el nombre ni el `Content-Type`.
  - Lo que no coincide se descarta antes de guardar (FR-020).
  - El nombre original no se guarda.
- **Límite de comprobantes:** 5 por barbería y por día (FR-020a), contados en PostgreSQL. Es un
  contador de abuso con efecto sobre el almacenamiento, así que no va en Redis.
- **Número de operación (FR-022b):** se normaliza (solo dígitos y letras, en mayúsculas) y tiene un
  **índice único global** `UNIQUE (bank_operation_number) WHERE status = 'APROBADO'`. La unicidad la
  garantiza PostgreSQL aunque la fila esté protegida por RLS. Al revisar, el administrador ve si el
  número aparece en otro pago, de cualquier barbería, por la vía de la plataforma (R06).
- **Revisión:** solo una vez (FR-022c), con `UPDATE ... WHERE status = 'EN_REVISION'` y la fila
  bloqueada. La segunda revisión recibe `PAGO_YA_REVISADO` (409). Aprobar aplica R04 en la misma
  transacción. Rechazar exige un motivo de 5 a 300 caracteres.
- **Importe exacto (FR-022a):** el administrador confirma el importe transferido, y se rechaza si no
  es igual.

**Alternativas descartadas:**

- Subir el archivo en base64 dentro de JSON: obliga a subir el límite del cuerpo JSON y gasta un 33 %
  más.
- `file-type` (detección por contenido): una dependencia nueva para tres firmas de bytes.
- Leer el comprobante automáticamente (OCR): fuera de alcance; la revisión es manual.

## R06 · Administrador de la plataforma y principio III (ADR-031, enmienda 1.3.0)

**Problema:** el administrador no pertenece a ninguna barbería. Revisa comprobantes y pagos **de
todas**, y suspende barberías y suscripciones. El principio III dice que el tenant sale **solo** del
token, que toda tabla de negocio tiene RLS y que el rol de la aplicación no puede omitirla. Las dos
excepciones vigentes (ADR-021 y ADR-020) no cubren este caso.

**Decisión (aceptada el 2026-10-24 con ADR-031 y la enmienda 1.3.0 de la constitución):**

1. **Identidad separada.** La tabla global `platform_admin` (correo, hash Argon2id de la contraseña,
   secreto TOTP cifrado, códigos de recuperación con hash, estado) y la tabla `platform_session`.
   - No usa `user_account` ni `membership`: un correo de barbería no puede ser administrador, y su
     identidad no se mezcla con la RLS de `user_account` (ADR-015).
   - La cuenta se crea **solo** por línea de comandos (`npm run plataforma:crear-admin`), nunca por
     la API.
2. **Token de plataforma.** JWT ES256 con la misma llave, `aud: "plataforma"`, `rol: ADMIN_PLATAFORMA`,
   `sub`, `sid` y **sin `tid`**.
   - `AuthGuard` acepta un token sin `tid` **solo** en rutas marcadas `@Plataforma()`, y las rutas de
     barbería rechazan los tokens de plataforma.
   - Así el administrador **no puede** llamar a ninguna operación de citas, clientes, catálogo ni
     usuarios (FR-038). PR08 lo prueba celda por celda.
3. **Lecturas entre barberías.** Rol de base de datos `barberias_plataforma` (`LOGIN NOBYPASSRLS
NOINHERIT`):
   - `SELECT` **solo por columna** sobre `tenant(id, name, slug, status)`, `subscription`, `plan`,
     `subscription_period`, `payment` (sin el archivo del comprobante) y `provider_event`;
   - políticas RLS `FOR SELECT TO barberias_plataforma USING (true)` en esas tablas, sin escritura;
   - transacciones `READ ONLY`.

   Su única escritura es en las tablas de identidad del propio administrador (`platform_admin`,
   `platform_session`, `platform_challenge`), que no contienen datos de barberías; así, el rol de la
   aplicación nunca lee hashes ni secretos de los administradores.

   Es el mismo patrón probado de ADR-021, pero entre barberías y solo para metadatos de pago. Lo usan
   **únicamente** `suscripciones-pagos/*/infrastructure/plataforma/`,
   `acceso-barberias/barberias/infrastructure/plataforma/` (listado y suspensión) y
   `acceso-barberias/identidad/infrastructure/plataforma/` (ingreso del administrador), con la regla
   de PR14 `lectura-plataforma-confinada`.

4. **Escrituras sobre una barbería.** El administrador elige la barbería en la ruta
   (`/plataforma/barberias/{id}/…`). El caso de uso abre una transacción normal del rol de la
   aplicación con **ese** tenant fijado (`uow.ejecutar(TenantId.de(id))`), así que RLS limita la
   escritura a esa barbería, y audita en el tenant de la barbería con el administrador como actor
   (FR-037). Esta es la parte que contradice "nunca de la ruta" y por eso necesita la excepción.
5. **Sin tenant del cliente en lo demás.** La notificación del proveedor y las tareas programadas
   obtienen el tenant de la fila que buscan (R03 y R08), con la misma vía de lectura, nunca de datos
   del cliente.
6. **Auditoría del acceso.** La tabla global `platform_audit_log` registra los inicios de sesión,
   segundos factores y cierres del administrador, que no tienen barbería. Lo hecho sobre una barbería
   va al `audit_log` de esa barbería.

**Texto de la enmienda** (aprobado y aplicado el 2026-10-24 en la constitución 1.3.0). Agrega al
principio III:

> - **Excepción acotada: operaciones de la plataforma.** El administrador de la plataforma, que no
>   pertenece a ninguna barbería, MAY operar sobre barberías, suscripciones, pagos y comprobantes de
>   cualquier barbería. Su cuenta y su sesión MUST ser propias de la plataforma, con segundo factor
>   obligatorio, y su token MUST NOT llevar tenant ni servir en operaciones de una barbería. Sus
>   lecturas entre barberías MUST hacerse con un rol de base de datos sin `BYPASSRLS`, de solo
>   lectura y con permisos por columna sobre esas tablas. Cada escritura MUST afectar a una sola
>   barbería, identificada por el administrador en la ruta, en una transacción con ese tenant fijado
>   y con RLS, y MUST auditarse en esa barbería. MUST NOT ver ni modificar citas, clientes, catálogo
>   ni usuarios. Las notificaciones del proveedor de pagos y los trabajos en segundo plano MAY
>   localizar el tenant con esa misma lectura, por una clave exacta, nunca con datos del cliente. La
>   decisión se registra en ADR-031.

Versión 1.3.0 (MINOR: amplía la guía de un principio sin redefinirlo). También se actualizarían la
puerta III de `.specify/templates/plan-template.md`, la de
`docs/02-arquitectura-software/multi-tenancy-y-datos.md` y el Sync Impact Report.

**Alternativas descartadas:**

- (a) Administrador con una membresía en cada barbería: multiplica cuentas y sesiones, mezcla al
  administrador con el personal y sigue sin dar una vista entre barberías.
- (b) El administrador "entra" a una barbería emitiendo un token con su `tid` por cada revisión: no
  permite la cola de comprobantes de todas las barberías y obliga a muchos cambios de sesión.
- (c) Rol `BYPASSRLS` con conexión propia: omite RLS en **todo**, incluidas citas y clientes, y su
  creación en RDS está por validar (ADR-015).
- (d) Funciones `SECURITY DEFINER` para cada listado (patrón ADR-015): sirven para búsquedas por clave
  exacta, pero no para listados filtrados y paginados; serían decenas de funciones con `BYPASSRLS`.
- (e) Copiar los pagos a una tabla global sin RLS: duplica datos de dinero y los saca de la
  protección de RLS.

## R07 · Segundo factor del administrador (evaluación pedida)

**Decisión: segundo factor obligatorio con TOTP (RFC 6238)** para toda cuenta de administrador.

- **Motivo:** esta cuenta puede aprobar comprobantes y activar planes sin cobro (FR-036). Robarle la
  contraseña equivale a dar servicio gratis a cualquier barbería.
- **Implementación con `node:crypto`**, sin librería:
  - HMAC-SHA1, 6 dígitos y paso de 30 s, con tolerancia de ±1 paso;
  - se rechaza un código ya usado (se guarda el último paso aceptado);
  - el secreto de 20 bytes se cifra en reposo con AES-256-GCM y la llave `PLATAFORMA_LLAVE_TOTP` del
    entorno;
  - las pruebas usan los vectores del RFC 6238.
- **Alta:** la orden `plataforma:crear-admin` imprime **una sola vez**:
  - la URI `otpauth://totp/...` para escribirla o pegarla en una aplicación de autenticación;
  - 10 códigos de recuperación de un solo uso, guardados con hash Argon2id.

  No se genera código QR, para no sumar una librería; si se quiere, `qrcode` (MIT) es una opción
  futura.

- **Flujo:**
  1. `POST /plataforma/auth/ingresar` con correo y contraseña devuelve un `desafio` de 5 minutos;
  2. `POST /plataforma/auth/segundo-factor` con el desafío y el código, o con un código de
     recuperación, entrega la sesión.

  Los intentos fallidos de ambos pasos cuentan en `login_attempt` (PostgreSQL, principio VIII): 5 en
  15 minutos bloquean ese correo desde esa IP.

- **Sesión del administrador:**
  - token de acceso de 10 minutos;
  - renovación con cookie `HttpOnly`, `SameSite=Strict` y ruta `/api/v1/plataforma/auth`;
  - vida máxima de 8 horas;
  - sin el indicador `hay_sesion` (no hace falta).

**Alternativas descartadas:**

- Sin segundo factor: el riesgo descrito es inaceptable con dinero de por medio.
- Código por correo: depende de M05 (funcionalidad 004) y del correo, que es más débil.
- WebAuthn o llaves físicas: más seguro, pero exige una librería de verificación
  (`@simplewebauthn/server`, MIT) y hardware. Queda como evolución.
- `otplib` (MIT): innecesario para unas 40 líneas con vectores de prueba oficiales.

## R08 · Tareas programadas sin duplicados entre réplicas (ADR-024)

**Decisión:** un **ejecutor de tareas en cada réplica** (M06, `shared/tareas/`):

- corre cada `TAREAS_INTERVALO_MS` (5 min, con un desfase aleatorio de hasta 30 s);
- usa un **candado de PostgreSQL** por tarea (`pg_try_advisory_lock` en una conexión propia y corta),
  así que solo una réplica la ejecuta a la vez;
- además, **cada cambio es condicional e idempotente**, de modo que, aunque dos réplicas coincidieran,
  ningún efecto se aplica dos veces.

Tareas de 003 (en M03, registradas en el ejecutor por el host):

1. **`vencer-suscripciones`:**
   - lee por la vía de la plataforma (R06) los `(tenant_id, subscription_id)` cuya fecha ya pasó
     (prueba, período o gracia), en lotes de 100;
   - por cada uno abre una transacción **con ese tenant** y RLS;
   - hace `SELECT ... FOR UPDATE SKIP LOCKED` y la transición condicional
     (`WHERE status = $esperado AND fecha <= now()`);
   - audita con la fecha que correspondía (FR-031);
   - aplica también el plan del período que empieza (R04).
2. **`conciliar-pagos`:**
   - toma los pagos en línea `PENDIENTE` con más de 10 minutos;
   - consulta el proveedor y aplica el resultado con la **misma** función que la notificación (FR-028);
   - expira a las 24 horas (FR-027).

**Registro:** cada corrida se anota en `scheduled_job_run` (tarea, réplica, inicio, fin, procesados y
errores). Es una tabla global con conteos, sin datos de barberías. Si una réplica se cae a mitad, el
candado se libera al cerrarse su conexión, y la siguiente corrida retoma lo pendiente (FR-032).

**Alternativas descartadas:**

- `@nestjs/schedule` (MIT): librería nueva que no resuelve los duplicados; igual haría falta el candado.
- Una réplica "programadora" elegida por configuración: si esa réplica cae, nadie vence nada.
- Cron externo (contenedor o EventBridge) que llama a un endpoint: agrega otra pieza y un endpoint
  interno que proteger. Es la equivalencia en la nube documentada en ADR-024.
- `pg_cron`: lógica de negocio en SQL y una extensión más.
- Colas con Redis (BullMQ): harían a Redis fuente de verdad de trabajos con dinero, prohibido por el
  principio VIII.

## R09 · Comprobantes: almacenamiento privado y acceso de corta duración (ADR-023)

**Decisión:**

- **Contenido:** en la tabla `payment_receipt_file`, `bytea` con RLS, detrás del puerto
  `AlmacenComprobantes` (M03), con el adaptador `AlmacenComprobantesPostgres`. Los metadatos van en
  `payment_receipt`. El contenido nunca se incluye en listados ni en la vía de la plataforma (el rol
  `barberias_plataforma` no tiene `SELECT` sobre esa tabla).
- **Acceso:** solo por la API, con una sesión con permiso: el propietario de esa barbería, o el
  administrador con la barbería fijada en la ruta. La respuesta lleva:
  - `Content-Type` verificado;
  - `Content-Disposition: attachment`;
  - `X-Content-Type-Options: nosniff`;
  - `Cache-Control: no-store`.

  La interfaz lo convierte en una URL local del navegador (`blob:`) que se revoca a los 60 s. **No
  existe ninguna URL del servidor que sirva el archivo sin sesión**, así que un enlace copiado no
  funciona nunca (FR-041). Es más estricto que un enlace firmado de 5 minutos.

- **Integridad:** se guarda el SHA-256 del contenido. Un mismo archivo subido por dos barberías se
  detecta (con el mismo índice que el número de operación) como señal de comprobante reutilizado.
- **Retención:** los comprobantes se conservan mientras exista el pago.
- **En la nube:** el adaptador equivalente es S3 con cifrado del lado del servidor y acceso solo desde
  el backend, que sigue transmitiendo el archivo. Se cambia sin tocar el caso de uso.

**Alternativas descartadas:**

- Carpeta del servidor o volumen: con dos réplicas no se comparte, no tiene RLS ni entra en el
  respaldo de la base.
- MinIO o S3 en local: un servicio más (unos 150 MB) para un volumen de pocos megabytes.
- Enlace firmado de corta duración servido sin sesión: un enlace reenviado funciona durante su vida,
  y FR-041 pide que nunca sirva sin sesión.

**Volumen esperado:** 5 MB × 5 por día y barbería, como máximo. En la práctica, uno o dos al mes, de
menos de 1 MB.

## R10 · Restricciones por estado en las operaciones de 002 (FR-006, FR-007)

**Decisión:**

- **La regla vive en el dominio de M03:** `PoliticaDeOperacion.permite(estado, accion)`, una función
  pura con la tabla de [contracts/restricciones-estado.md](contracts/restricciones-estado.md). Sus
  acciones:
  - `RESERVAR`;
  - `GESTIONAR_CITAS`;
  - `CONFIGURAR_CATALOGO`, que cubre servicios, barberos, horario de atención, disponibilidad y
    bloqueos;
  - `GESTIONAR_USUARIOS`.
- **M03 la expone en su interfaz pública:** `SuscripcionesApi.exigirOperacion(tenantId, accion)`. Lanza
  `SuscripcionNoPermite` (`SUSCRIPCION_NO_PERMITE`, 403, con el detalle `{ estado, accion }`). Lee la
  suscripción en la transacción del llamador, con su tenant y RLS.
- **M02 y M01 la llaman** al empezar cada caso de uso de escritura, dentro de su transacción. Es
  exactamente lo que la matriz de PR14 ya permite: M02 → M03 y M01 → M03 por `index.ts`, como hoy
  `obtenerLimiteBarberos`.
  - **M02:** `ReservarCita`, que cubre las tres vías (cliente, presencial y la del enlace después del
    inicio de sesión); `CrearServicio`, `ActualizarServicio`, `CrearBarbero`, `ActualizarBarbero`,
    `ReemplazarHorarioAtencion`, `ReemplazarDisponibilidad`, `CrearBloqueo` y `EliminarBloqueo`.
  - **M01:** `CrearUsuario`, `ActualizarUsuario` y `RegenerarActivacion`.
  - **Se dejan permitidas** `CancelarCita` y `CambiarEstadoCita` (`GESTIONAR_CITAS`, P4: A), y
    ninguna lectura cambia.
- **Mensaje:** M02 traduce el error a "Esta barbería no acepta reservas por ahora" y M01 a "Tu
  suscripción no permite este cambio". Nunca a "horario no disponible" (FR-007).
- **Aviso previo en la interfaz:** `GET /suscripcion/estado-operativo`, para PROPIETARIO, BARBERO y
  CLIENTE con su sesión, devuelve `{ estado, aceptaReservas, configuracionEditable, mensaje }`. El
  cliente lo ve **antes** de elegir un horario, en la pantalla de reservar (que ya exige sesión).
- **Catálogo público:** sigue igual. Mostrar "no acepta reservas" en la vía pública exigiría que la vía
  pública de M02 leyera una tabla de M03 (prohibido por el principio I) o ampliar la excepción de
  ADR-021. Se descarta: la reserva se rechaza en el servidor, y el aviso aparece al entrar a reservar.
- **Pruebas:**
  - una prueba de integración `restricciones-estado` recorre la tabla del contrato, fila por fila y
    estado por estado, contra la API real;
  - una prueba de arquitectura comprueba que cada caso de uso de escritura de la lista llama a
    `exigirOperacion`. Se hace con un análisis estático simple sobre los archivos (busca la llamada en
    las clases listadas), para que una operación nueva sin la llamada haga fallar la prueba.

**Alternativas descartadas:**

- Un guard HTTP que mire el estado: no protege los casos de uso llamados por otras vías (M04 en 005,
  tareas), y la constitución pone la autorización en la aplicación.
- Que M02 lea `subscription` directamente: lo prohíbe el principio I.
- Eventos de "suscripción vencida" que desactiven cosas en M02: los efectos asíncronos dejarían
  ventanas de inconsistencia, y no hace falta mover nada.

## R11 · Planes, precios e importes

**Decisión:**

- **Planes:** se agregan a `plan` las columnas `name`, `price_cents`, `currency` (`PEN`), `active` y
  `public`. La migración siembra **BÁSICO** (S/ 49,00 al mes; 3 usuarios y 3 barberos) y **PRO**
  (S/ 89,00; 8 usuarios y 8 barberos), con precios **referenciales** (HU18). `TRIAL` se mantiene como
  el plan de la prueba, sin precio y no contratable.
- **Importes:** en **céntimos enteros** (sin decimales flotantes) y fijados en el pago al iniciarlo
  (FR-005b). Yape se ofrece solo si el importe está dentro de `limitesYape()`.

**Alternativa descartada:** `numeric` con decimales en el dominio. Con céntimos enteros, la aritmética
y la comparación del webhook son exactas.

## R12 · Estados de la suscripción y transiciones (PR25)

**Decisión:** máquina de estados pura en el dominio de M03, en [data-model.md](data-model.md) §2. Las
transiciones automáticas las ejecuta la tarea (R08), y las manuales (suspender, reactivar, activación
manual), los casos de uso del administrador. Al reactivar se **recalcula por las fechas** (FR-035).
`CANCELLED` existe pero ningún flujo de 003 llega a él (supuesto de la especificación).

## R13 · Resiliencia ante el proveedor (FR-044, EQ-06, PR06)

**Decisión:**

- **Interruptor:** se reutiliza el `Interruptor` de M06 (creado en 006 para Redis), que se mueve de
  `shared/cache/` a `shared/resiliencia/` y se exporta por `shared/index.ts`. La caché lo sigue usando
  igual.
- **Con el proveedor:** 5 fallos en 60 s abren el circuito por 30 s. Las llamadas tienen un tiempo
  límite de 2 s.
- **Mensaje:** `PAGO_EN_LINEA_NO_DISPONIBLE` (503), con la alternativa de transferencia, en 3 s o menos
  (SC-005). El pago que se intentaba crear queda `ANULADO`.
- **Resto de la plataforma:** las reservas, la agenda y el catálogo no llaman al proveedor, así que no
  se afectan.

## R14 · Pruebas obligatorias y cómo se ejecutan

| Prueba                       | Qué demuestra                                                                                                                                                                                                                                              | Dónde                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| PR06                         | Pasarela caída y lenta: mensaje en 3 s o menos, el circuito se abre tras 5 fallos y el resto sigue                                                                                                                                                         | `test/integration/pagos/proveedor-caido.spec.ts` (simulador en modos `caido` y `lento`)  |
| PR08                         | Matriz de permisos de 003, celda por celda (propietario, barbero, cliente, administrador y anónimo), leída de [contracts/rbac.md](contracts/rbac.md); el token de plataforma no sirve en rutas de barbería ni el de barbería en rutas de plataforma        | `test/contract/rbac-003.spec.ts`                                                         |
| PR09                         | Pagos, suscripciones, eventos y comprobantes invisibles entre barberías, por la API y por SQL directo con el rol de la aplicación; `barberias_plataforma` sin escritura, sin `BYPASSRLS`, sin acceso a citas, clientes ni al contenido de los comprobantes | `test/integration/aislamiento/aislamiento-pagos.spec.ts`, `lectura-plataforma.spec.ts`   |
| PR17                         | Notificación válida, repetida 10 veces (1 transición y 1 período), firma inválida, sin firma, reenvío vencido, fuera de orden, importe distinto, pago desconocido; y concurrencia entre la notificación y la conciliación                                  | `test/integration/pagos/notificaciones.spec.ts`                                          |
| PR20                         | La **misma** suite de contrato del puerto `PaymentGateway` contra el simulador (siempre) y contra el ambiente de pruebas del proveedor (solo con `PAGOS_SANDBOX_*` definidas; si no, se salta con aviso)                                                   | `test/contract/payment-gateway.contract.ts` y `test/integration/pagos/gateway-*.spec.ts` |
| PR25                         | Máquina de estados de la suscripción, cálculo de períodos (fin de mes, gracia y adelantado) y `PoliticaDeOperacion`                                                                                                                                        | `test/unit/suscripciones/*.spec.ts`                                                      |
| Vencimiento con dos réplicas | Dos instancias en proceso ejecutan `vencer-suscripciones` a la vez sobre 50 suscripciones: cada una cambia una sola vez, con 1 auditoría; una caída a mitad se retoma                                                                                      | `test/integration/tareas/vencimiento-dos-replicas.spec.ts`                               |
| PR13                         | Auditoría de las acciones del administrador y de las transiciones automáticas                                                                                                                                                                              | `test/integration/auditoria.spec.ts` (ampliado)                                          |
| PR14                         | Reglas nuevas: `lectura-plataforma-confinada`, `pasarela-solo-por-puerto`, `simulador-fuera-del-monolito`, y la llamada a `exigirOperacion` en los casos de uso de escritura                                                                               | `test/architecture/`                                                                     |
| Datos canario (SC-010)       | Ningún secreto, teléfono de pagador ni contenido de comprobante en los registros ni en los errores                                                                                                                                                         | `test/integration/pagos/canarios.spec.ts`                                                |

El simulador se arranca dentro del proceso de Jest. Las pruebas con dos instancias reutilizan los
ayudantes de 006 (`crearApp({ escuchar: true })`).

## R15 · Interfaz web

**Decisión:** se agregan pantallas con el sistema de diseño de 001 (ADR-016) y carga diferida
(ADR-018):

- **Propietario, `/app/suscripcion`:** estado, días, plan, límites y avisos; elegir el plan; pagar con
  Yape, que lleva a la URL del proveedor o del simulador; transferencia, con los datos, la subida del
  comprobante y su estado; historial. Al volver del proveedor, la pantalla consulta el pago hasta 60 s
  y muestra lo que confirmó el servidor.
- **Cliente:** aviso en la pantalla de reservar si `aceptaReservas` es falso.
- **Administrador, en `/plataforma/…`:** ingreso con segundo factor; barberías (estado y
  suspender/reactivar); comprobantes por revisar; pagos por revisar; activación manual.

  Con la línea de corte 2, el panel del administrador queda en listas con acciones.

Las pruebas se escriben con Vitest y MSW, como en 001 y 002.

## R16 · Librerías

**No se agrega ninguna dependencia.**

| Necesidad                     | Cómo se cubre                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Firma HMAC y TOTP             | `node:crypto`                                                                                                                           |
| HTTP al proveedor             | `fetch` de Node 22                                                                                                                      |
| Subida de archivos            | `multer` 2.4.0 (MIT), que ya viene con `@nestjs/platform-express`; se declara un tipo mínimo propio en lugar de agregar `@types/multer` |
| Detección del tipo de archivo | 3 firmas de bytes propias                                                                                                               |
| Simulador                     | `node:http`                                                                                                                             |

**Opcionales**, que no se instalan sin tu aprobación:

- `qrcode` (MIT), para mostrar el QR del TOTP;
- `@simplewebauthn/server` (MIT), si algún día se quieren llaves físicas.
