# Research: Notificaciones y reprogramación de citas (004)

Cada sección resuelve una incógnita del plan con el formato **Decisión / Justificación / Alternativas descartadas**. Las decisiones de arquitectura están **Aceptadas** por el responsable (2026-11-04): constan en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`, con su detalle en [decisiones/](decisiones/); aquí se resume el porqué técnico. Las respuestas del responsable a las preguntas abiertas están en R07 (límite de rechazos), R10 (`nodemailer`), R16 (Docker), R17 (retención) y R18 (texto del consentimiento).

Código revisado para este plan (2026-11-04):

- `backend/src/shared/tareas/ejecutor-tareas.ts` y `shared/persistence/tareas-postgres.ts` (ADR-024);
- `shared/persistence/kysely-unit-of-work.ts` (`alConfirmar`, `ejecutarSinTenant`, `fijarTenant`);
- `migrations/0011_citas.ts` (restricciones de exclusión y permisos de `barberias_app`);
- `modules/catalogo-citas/citas/infrastructure/cita-repository-postgres.ts` (candado por barbero y traducción de `23P01`);
- `migrations/0009_cuenta_cliente.ts` (`customer_profile`, `consent_record`);
- `migrations/0006_intentos_login.ts`, `0016_plataforma.ts`, `0017_tareas.ts`;
- `shared/limites/almacen-limites-compartido.ts` y `host/app.module.ts` (límite general de 006);
- `db/init/01-roles.sql`, `docker-compose.yml` y `backend/simulador-pagos/`.

## R01 · Reprogramar es mover la misma cita, no cancelar y crear otra

- **Decisión:** la reprogramación es un `UPDATE` de `barber_id`, `starts_at` y `ends_at` de la **misma fila** de `appointment`, condicionado a la versión esperada y a un estado activo. Incrementa `version` y borra `client_confirmed_at`. La hora anterior queda en `appointment_reschedule`.
- **Justificación:**
  - FR-005 exige conservar la identidad, el servicio copiado y el cliente.
  - Las restricciones `appointment_no_overlap_barber` y `appointment_no_overlap_customer` de `0011` se evalúan también en un `UPDATE`: la garantía del principio IV no cambia.
  - Una sola sentencia hace atómico el "o se mueve, o no cambia" (FR-004).
  - La condición `version = $esperada` evita que dos acciones simultáneas (por ejemplo, el propietario reprograma mientras el cliente cancela por enlace) tengan efecto las dos.
- **Alternativas descartadas:**
  - **Cancelar y crear una cita nueva en la misma transacción:** cambia la identidad, ensucia el historial con una cancelación que no fue tal y obliga a migrar las referencias (enlaces, avisos).
  - **Columna `rescheduled_from` en una cita nueva:** el mismo problema, con dos filas por cita.

## R02 · Permisos nuevos sobre `appointment`

- **Decisión:** la migración `0023` agrega a `barberias_app`: `UPDATE (barber_id, starts_at, ends_at, version, client_confirmed_at, updated_at)` sobre `appointment`, y las columnas `version int NOT NULL DEFAULT 1` y `client_confirmed_at timestamptz`. `period` sigue siendo una columna generada. No se modifica `0011`.
- **Justificación:** hoy `barberias_app` solo puede cambiar las columnas de estado y cancelación (`0011`, línea 84). Los permisos se amplían columna por columna, sin `DELETE`.
- **Alternativa descartada:** función `SECURITY DEFINER` para reprogramar. Sería otra puerta que omite permisos, sin necesidad.

## R03 · Candados para reprogramar sin bloqueos mutuos

- **Decisión:** antes del `UPDATE`, `pg_advisory_xact_lock(hashtext(tenant), hashtext(barbero))` del **barbero anterior y del nuevo**, en orden de identificador (uno solo si es el mismo barbero). Se reintenta hasta 3 veces ante `40P01`, como en la reserva.
- **Justificación:** el repositorio de 002 toma un candado consultivo por barbero antes de insertar, para que 200 reservas simultáneas no se aborten por bloqueo mutuo (ADR-009, implementación). Una reprogramación que cambia de barbero toca dos barberos; tomar los candados en orden fijo evita el ciclo. **No es la garantía:** la garantía sigue siendo la restricción de exclusión.
- **Alternativa descartada:** sin candado. Con 50 reprogramaciones simultáneas hacia el mismo barbero, PostgreSQL abortaría varias por bloqueo mutuo, de a una por segundo (lo medido en 002, research R06).

## R04 · Salida transaccional de eventos en PostgreSQL (ADR-025)

- **Decisión:** tabla `outbox_event` (M06) con tenant y RLS. El caso de uso publica el evento con un `INSERT` **en su misma transacción**. Un despachador lo entrega al manejador de M05, que crea los avisos por destinatario y marca el evento procesado **en una sola transacción**. Detalle completo, casos de caída y alternativas en [ADR-025](decisiones/ADR-025-salida-transaccional.md) y [contracts/eventos.md](contracts/eventos.md).
- **Justificación:**
  - si la operación se confirma, el evento existe; si se revierte, no existe (FR-010);
  - el despacho es repetible sin efectos dobles: el aviso es único por `(evento, destinatario)` (FR-012);
  - no hace falta infraestructura nueva (principio VIII: Redis no es fuente de verdad).
- **Alternativas descartadas** (detalle en el ADR): enviar después del COMMIT con `alConfirmar` y nada más (se pierde si la réplica cae); colas en Redis o BullMQ (principio VIII); `LISTEN/NOTIFY` solo (no persiste); un intermediario de mensajes (infraestructura nueva).

## R05 · Cuándo se despacha: al confirmar y con una tarea de respaldo cada 15 s

- **Decisión:**
  1. Tras el COMMIT del caso de uso, `uow.alConfirmar` pide al despachador de **esa réplica** procesar ya los eventos de ese tenant (mejor esfuerzo; un fallo solo se registra, como hoy).
  2. Una tarea `despachar-eventos` del ejecutor de M06 recoge lo que quede, cada 15 s (`EVENTOS_INTERVALO_MS`) más el desfase aleatorio del ejecutor.
  3. Una tarea `enviar-avisos` de M05 envía los avisos pendientes y reintenta los que tocan, con el mismo intervalo.
- **Cambio en M06:** el ejecutor de ADR-024 acepta un **intervalo por tarea** (opcional; el resto sigue con `TAREAS_INTERVALO_MS`, 5 min). Es un cambio pequeño en `ejecutor-tareas.ts`, con su prueba unitaria.
- **Justificación:**
  - con solo la tarea de 5 min, SC-004 (≤ 5 min) quedaría al límite y SC-006 (≤ 10 min) dependería del desfase;
  - el despacho inmediato da segundos en el caso normal, y la tarea garantiza que nada queda atrás si la réplica cae justo después del COMMIT.
- **Alternativa descartada:** bajar `TAREAS_INTERVALO_MS` para todas las tareas. Vencer suscripciones o conciliar pagos cada 15 s no aporta nada y multiplica las consultas.

## R06 · Enlaces de acción firmados y sin estado al emitirlos (ADR-032)

- **Decisión:**
  - El enlace contiene, firmados con HMAC-SHA256 y la llave `ENLACES_LLAVE` (32 bytes, solo en `.env`):
    - la versión del formato;
    - el tenant;
    - la cita;
    - la acción (`CONFIRMAR`, `REPROGRAMAR` o `CANCELAR`);
    - la **versión de la cita** al emitirlo;
    - el vencimiento (la hora de inicio de la cita);
    - 16 bytes aleatorios.
  - **No se guarda nada al emitirlo.**
  - Al **usarlo**, en la misma transacción que aplica la acción, se inserta el SHA-256 del enlace en `appointment_link_use` con `UNIQUE (link_hash)`: un segundo uso choca y se rechaza. Si la acción falla (por ejemplo, la hora ya no está libre), la transacción se revierte y el enlace sigue sin usar.
  - Una cita cancelada o reprogramada cambia su `version`: todos sus enlaces anteriores dejan de valer sin tocar ninguna fila.
  - Formato, validación y datos mostrados: [contracts/enlaces-de-accion.md](contracts/enlaces-de-accion.md).
- **Dónde viaja el token:**
  - En el mensaje, la dirección es `https://<frontend>/e#<token>`. El **fragmento** (`#`) no se envía al servidor ni aparece en el encabezado `Referer`.
  - La página lo envía a la API en el encabezado `X-Enlace-Accion`, nunca en la ruta ni en la consulta.
  - Así no queda en los registros de Nginx ni de la aplicación.
- **Quién emite y quién verifica:**
  - M05 emite los enlaces **al enviar el recordatorio**, con `EnlacesFirmados` de M06 y los datos del evento.
  - M02 los verifica y aplica la acción.
  - `EnlacesFirmados` no tiene reglas de negocio: firma, verifica, compara en tiempo constante y vence.
- **Justificación:** cumple FR-024 sin guardar ningún secreto en la base. Lo guardado (hash del enlace usado, versión, cita y tenant) no permite reconstruir ningún enlace, porque falta la parte aleatoria y la llave. Tampoco hace falta leer nada antes de verificar la firma, así que no hay búsqueda entre barberías.
- **Alternativas descartadas:**
  - **Guardar el hash del enlace al emitirlo y buscarlo sin tenant:** necesitaría una lectura entre barberías por un dato que llega del cliente (no está permitido) o una función con `BYPASSRLS`.
  - **JWT con la librería de sesiones:** mezcla dos usos de la misma llave y del mismo verificador.
  - **Que M02 genere los enlaces al publicar el evento:** quedarían completos en `outbox_event`, es decir, guardados.

## R07 · Limitación de intentos sobre los enlaces

- **Decisión:**
  - Las rutas `/enlaces/*` tienen un límite propio con `@Throttle` (30 por minuto por IP, configurable), sobre el límite general compartido de 006. Es un contador no crítico, en Redis, con respaldo por instancia.
  - Además, cada **rechazo** de verificación (firma inválida, vencido, usado o de cita cambiada) se anota en `action_link_attempt` (SHA-256 de la IP con sal, y fecha), en **PostgreSQL**.
  - **Valores (decisión del responsable, 2026-11-04: "los mismos de `login_attempt` si existen").** Existen, en `backend/src/modules/acceso-barberias/identidad/domain/politica-intentos.ts`, y se aplican tal cual, por IP:
    - bloqueo tras **5 rechazos en 60 s**;
    - espera de **60 s** la primera racha, que se **duplica** en cada racha siguiente de 5 (60, 120, 240, 480) hasta **900 s** (15 min);
    - historial de **24 h**.
  - **Una sola regla, sin copias (decisión del responsable, 2026-11-04).** `PoliticaIntentos` sigue en `acceso-barberias/identidad/domain/politica-intentos.ts` y se **expone por la interfaz pública de M01** (`acceso-barberias/index.ts`), que ya reexporta otras piezas de dominio (`Permisos`). Es la opción que el responsable prefería si PR14 lo permitía, y lo permite: la regla `matriz-m02` de `.dependency-cruiser.cjs` deja que M02 importe `acceso-barberias/index.ts`, y M02 → M01 ya figura en la matriz (ADR-020). No hace falta moverla a una pieza compartida.
  - M02 la usa desde su **capa de aplicación**, no desde su dominio: el dominio de un módulo no importa la interfaz de otro, que arrastra el módulo de NestJS. La diferencia con el inicio de sesión es solo la clave (IP sola, porque un enlace rechazado no tiene cuenta).
  - La tabla se purga a las 24 h. A diferencia de `login_attempt`, que solo borra de forma oportunista al registrar un fallo, la purga de `action_link_attempt` también la ejecuta una tarea programada del ejecutor de ADR-024 (`purgar-intentos-enlaces`, cada hora), para que no queden filas viejas si dejan de llegar rechazos.
- **Justificación:** el principio VIII exige que los contadores de seguridad vivan en PostgreSQL. La firma de 256 bits ya hace imposible adivinar un enlace, así que el contador es defensa en profundidad contra el abuso. Sigue el patrón probado de `login_attempt` (`0006`).
- **Aprobado (2026-11-04):** `action_link_attempt` es una tabla técnica sin barbería. La 1.3.1 solo nombraba las tablas de la plataforma; la enmienda 1.4.0, aplicada, la nombra explícitamente y regulariza `login_attempt`, que existe desde 001 y tampoco figuraba en la lista.
- **Alternativas descartadas:**
  - **Solo `@Throttle` en Redis:** el principio VIII lo prohíbe para contadores de seguridad.
  - **Contar por tenant:** con un enlace inválido no hay tenant confiable.

## R08 · Tenant y rol de base de datos en cada vía

| Vía                                  | Cómo se obtiene el tenant                                     | Rol                                            | RLS |
| ------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------- | --- |
| Rutas con sesión (reprogramar, canal) | Del token (principio III)                                    | `barberias_app`                                | Sí  |
| Acción por enlace                    | **Del dato firmado del enlace, tras verificar la firma**      | `barberias_app`                                | Sí  |
| Despacho de eventos y envío de avisos | `barberias_plataforma` lista `(id, tenant_id, estado, disponible)`; cada elemento se procesa con su tenant | `barberias_plataforma` (lectura por columna) y luego `barberias_app` | Sí |
| Avisos de suscripción (US5)          | Desde las transiciones de 003, que ya tienen el tenant        | `barberias_app`                                | Sí  |

- **Ningún paso usa `barberias_auth`** (tiene `BYPASSRLS`, `db/init/01-roles.sql`) ni otro rol que omita RLS.
- La lectura de plataforma se amplía con las columnas mínimas de `outbox_event` y `notification`. No toca `appointment` ni `customer_profile`.
- El uso de la lectura de plataforma por las tareas ya lo permite la tercera excepción ("los trabajos en segundo plano MAY localizar el tenant con esa misma lectura") y lo usa ADR-024. La acción por enlace **no** la usa.

## R09 · Recordatorio programado con clave de reemplazo

- **Decisión:**
  - Al crear o reprogramar una cita, M02 publica en la misma transacción un evento `RecordatorioDeCita` con `disponible_desde = inicio − 2 h` y **clave de reemplazo** `recordatorio:<citaId>`.
  - El bus ofrece `reemplazar(clave, evento)` y `anular(clave)`: si hay un evento pendiente con esa clave en el tenant, se anula o se reemplaza **en la misma transacción**.
  - Cancelar, completar o marcar como no asistió publica `anular`.
  - Una cita creada o reprogramada con menos de 2 h de antelación no publica recordatorio (FR-022).
  - Al enviar, M05 descarta el aviso si ya pasó la hora de inicio (`descartar_despues`, FR-033).
  - Al recibir `CitaCancelada` o `CitaReprogramada`, M05 descarta además los avisos de recordatorio de esa cita que ya estaban creados y no enviados. Así se cierra la ventana entre el procesado del evento y el envío.
- **Justificación:** sin recorrer `appointment` entre barberías: la tarea solo lee `outbox_event` por la lectura de plataforma. El valor de 2 h es fijo (aclaración del 2026-11-04); el recordatorio configurable y el de 24 h quedan como evolución.
- **Alternativa descartada:** una tarea que recorra las citas de hoy de todas las barberías. Necesitaría que `barberias_plataforma` leyera `appointment`, y la tercera excepción se lo prohíbe al administrador ("MUST NOT ver ni modificar citas").

## R10 · Correo: SMTP, Mailpit y la librería

- **Decisión:**
  - **Adaptador de correo por SMTP**, porque Mailpit y casi todos los proveedores lo aceptan.
  - En desarrollo y en las pruebas, contra **Mailpit**: servicio de Compose, imagen pequeña, SMTP en el puerto 1025 y una interfaz y API HTTP en el 8025 para ver y verificar los mensajes.
  - En producción, cualquier proveedor SMTP con TLS y autenticación, **por verificar** (ADR-026).
  - Correo en texto simple (`text/plain; charset=utf-8`), con `Message-ID` derivado del identificador del aviso.
- **Librería: `nodemailer` (decisión del responsable, 2026-11-04).**
  - **Motivo:** SMTP en producción exige STARTTLS o TLS implícito, autenticación, codificación de cabeceras y del cuerpo (tildes y ñ en `utf-8`) y el manejo de las respuestas del servidor. `nodemailer` lo resuelve desde hace años y no arrastra dependencias de terceros. Un cliente propio sobre `node:net` y `node:tls` sería viable para Mailpit, pero tendría que probar desde cero cada uno de esos casos para producción.
  - **Versión exacta fija** en `package.json` (sin `^` ni `~`), como el resto del proyecto (por ejemplo, `@nestjs/core` 11.2.7 y `kysely` 0.28.17). La versión y la licencia se verifican al instalarla, en la fase 1, y quedan anotadas en `tecnologias.md`.
  - **Tipos:** `@types/nodemailer` como devDependency, también con versión exacta fija (aprobado por el responsable el 2026-11-04).
  - **Revisión con el escaneo de dependencias de la CI: hoy ese escaneo no existe.** `.github/workflows/plataforma-barberias.yml` ejecuta `npm ci`, Prettier, lint, build y las pruebas, pero no `npm audit` ni otra herramienta, y no hay Dependabot ni CodeQL. Procedimiento de la **fase 1** (decisión del responsable, 2026-11-04):
    1. **Antes** de tocar la CI, se ejecuta `npm audit --omit=dev` en el backend y el frontend y se decide cada hallazgo de nivel alto o crítico: **con arreglo, se corrige** (versión fija); **sin arreglo, se documenta la excepción con fecha**, paquete, aviso y motivo, en `docs/02-arquitectura-software/tecnologias.md`.
    2. Después se agrega el escaneo a la CI: **audita solo producción y falla desde nivel alto**. `npm audit` no puede ignorar avisos concretos, así que la forma del paso depende del resultado del punto 1 (decisión del responsable, 2026-11-04):
       - **sin ningún hallazgo alto sin arreglo:** el paso es `npm audit --omit=dev --audit-level=high` y **no se agrega nada más**;
       - **con al menos un hallazgo alto sin arreglo:** se aprueba **`audit-ci`** como devDependency, con versión exacta fija, y el paso lo usa con nivel alto, solo producción y una **excepción por aviso, cada una con fecha de vencimiento** (al vencer, el paso vuelve a fallar y obliga a revisarla). Nunca se baja el nivel.
    3. Hasta que ese paso exista y pase, no se afirma que `nodemailer` esté revisado por la CI.
- **Alternativa descartada:** el cliente SMTP mínimo propio, por el motivo de arriba.
- **Alternativa descartada:** la API HTTP de un proveedor concreto. Ataría el adaptador a un proveedor que no está elegido.

## R11 · WhatsApp simulado y suite de contrato del puerto

- **Decisión:**
  - **Simulador en proceso aparte** (`backend/simulador-whatsapp/`, `node:http`, servicio de Compose de 64 MB), como `simulador-pagos`.
  - **Comportamiento:** acepta `POST /mensajes` con autenticación por token, guarda los mensajes en memoria para consultarlos (`GET /mensajes?para=`) y cambia de comportamiento con `POST /control/modo` (token de control). Modos:
    - `normal`, `lento`, `caido`, `colgado`;
    - `rechazar` (número no válido);
    - `limite` (429, demasiados mensajes);
    - `fallar_n` (falla los N primeros envíos).
  - **Suite de contrato** `test/contract/notification-channel.contract.ts`: una sola batería **escrita para correr con cualquier canal** (recibe la fábrica del adaptador y cómo leer lo enviado), que se corre contra cada adaptador:
    - el correo contra Mailpit en Testcontainers, **desde la fase 1**;
    - WhatsApp contra el simulador arrancado en el proceso de prueba, **agregado en la fase 5**, sin cambiar los casos;
    - una variante de proveedor real que se omite sin credenciales, como `gateway-sandbox` en 003.
  - **Cuándo se construye (decisión del responsable, 2026-11-04):** el simulador, su adaptador y su servicio de Compose se hacen en la **fase 5**, donde WhatsApp se usa por primera vez. Las fases 1 a 4 envían solo por correo.
  - Detalle en [contracts/notification-channel.md](contracts/notification-channel.md).
- **Justificación:** el mismo patrón del simulador de pagos (ADR-022), con el que PR06 y PR20 se pudieron medir en 003. Cuando se contrate un proveedor real, su adaptador debe pasar la misma suite.
- **Alternativa descartada:** un doble en memoria dentro del monolito. No prueba el tiempo límite, el circuito ni los errores de red, y PR14 no podría separar el simulador del código de producción.

## R12 · Canal, consentimiento y respaldo: se leen al enviar

- **Decisión:**
  - La preferencia (`customer_notification_preference`) y el consentimiento de WhatsApp (`whatsapp_consent`) viven en **M01** (`clientes`), junto al consentimiento de la política de datos (RF33 está asignado a M01).
  - M05 los consulta **en el momento del envío** con una interfaz pública nueva: `ClientesApi.contactoParaAvisos(clienteId)` devuelve el correo, el canal, el número de WhatsApp y si hay consentimiento vigente para ese número. Del mismo modo, `PersonalApi.correoDe(usuarioId)` y `BarberiasApi.correoDelPropietario()` dan el correo del personal.
  - Eso agrega **M05 → M01** a la matriz (revisión de ADR-013).
  - **Regla de canal (dominio de M05, pura):**
    - WhatsApp solo si el canal es WhatsApp **y** hay consentimiento vigente para el número actual;
    - si no, correo;
    - sin correo (cliente presencial sin correo), el aviso se descarta con motivo.
  - **Respaldo:** si WhatsApp falla 3 veces, o su circuito está abierto, el aviso pasa a correo una sola vez (`ENVIADO_RESPALDO`).
- **Justificación:** FR-019 pide consentimiento **vigente**. Un recordatorio se envía horas después de publicarse, y copiar el consentimiento en el evento no respetaría un retiro intermedio. Además, la salida de eventos no guarda datos de contacto.
- **Alternativas descartadas:** ver Complexity Tracking del plan (copiar en el evento; mover el consentimiento a M05).

## R13 · Reintentos, circuito y descarte (ADR-012)

- **Decisión:**
  - **Tiempo límite** por envío: 5 s para el correo y 3 s para WhatsApp.
  - **Esperas entre intentos:** 30 s, 2 min, 10 min, 30 min y 1 h, con ±20 % de variación.
  - **Intentos:** hasta 6 por aviso de correo, y 3 por WhatsApp antes del respaldo.
  - **Circuito por canal** con el `Interruptor` de M06: se abre con 5 fallos en 60 s (EQ-06) y se prueba de nuevo a los 30 s. Con el circuito de correo abierto, los avisos quedan pendientes sin consumir intentos.
  - Un aviso de cita sin enviar a las 24 h, o un recordatorio sin enviar a la hora de inicio, queda `FALLIDO` o `DESCARTADO` (FR-033).
  - Los errores permanentes (destinatario inválido) no se reintentan.
- **Justificación:** son las medidas de EQ-06 (propuesta por validar) y el patrón de 003 (PR06).
- **Reclamo con plazo:** para enviar, el aviso pasa a `ENVIANDO` con `reclamado_hasta = now() + 2 min` (`FOR UPDATE SKIP LOCKED`). Si la réplica cae antes de anotar el resultado, otra lo retoma al vencer el plazo. Esa es la única vía de un posible duplicado (ADR-025).

## R14 · Avisos de suscripción al propietario (US5, primer recorte)

- **Decisión:**
  - M03 publica eventos **en las transacciones que ya existen**, sin cambiar sus reglas:
    - `SuscripcionEnGracia` y `SuscripcionVencida` en `vencer-suscripciones`;
    - `PagoAprobado` en `aplicar-resultado.ts` y en la aprobación de la transferencia;
    - `PagoRechazado` en el rechazo de la transferencia y en el resultado del proveedor.
  - "Prueba por terminar" no es una transición: lo publica una tarea nueva `avisar-fin-de-prueba` (cada 6 h), con el **mismo criterio del panel** (`consultas.ts`: en prueba, sin período siguiente y con 3 días o menos). Usa una clave única `prueba-por-terminar:<suscripcionId>` para avisar una sola vez por prueba.
  - El destinatario es el correo del propietario (`BarberiasApi.correoDelPropietario()`).
  - Todo queda en un grupo de tareas aparte (fase 6) que se puede omitir completo.
- **Justificación:** reutiliza el mecanismo de 004 sin pantallas ni configuración (aclaración del 2026-11-04).
- **Alternativa descartada:** que la tarea `vencer-suscripciones` también avise del fin de la prueba. Mezclaría el recorte de la fase 6 con una tarea de 003 que no se recorta.

## R15 · Interfaz web

- **Decisión:**
  - **Reprogramar:** en "Mis citas" (cliente) y en la agenda (propietario), un botón abre la misma selección de hora del catálogo de 002 para el servicio de la cita, y confirma con `POST /citas/{id}/reprogramar`.
  - **Página del enlace:** `/e#<token>` es una ruta pública sin sesión.
    1. Pide `GET /enlaces/accion` con el encabezado `X-Enlace-Accion` y muestra los datos mínimos.
    2. Para confirmar o cancelar, pide confirmación y envía `POST`.
    3. Para reprogramar, reutiliza la consulta pública de horarios por enlace (`/publico/{slug}/horarios`) con el slug y el servicio que devuelve la API, y envía `POST /enlaces/accion/reprogramar`.
  - **Canal de aviso (decisión del responsable, 2026-11-04):** pantalla con **ruta propia `/mis-avisos`**, solo para `CLIENTE` y con un enlace desde Mis citas; el número aparece propuesto con su teléfono, junto a la casilla de consentimiento con el texto y su versión.
  - **Agenda:** muestra "confirmada por el cliente" o "sin confirmar".
  - **Accesibilidad (decisión del responsable, 2026-11-04):** cada pantalla nueva se revisa a 360 px y en escritorio, en ambos temas y solo con teclado, y con la **extensión axe DevTools del navegador**, de forma manual y **sin agregar dependencias**. El resultado (fecha, pantalla, tema y hallazgos) se anota en el quickstart.
- **Justificación:** línea de corte 2: se reutiliza la pantalla de disponibilidad de 002. La página del enlace no guarda el token (ni en almacenamiento local ni en el historial: se quita del fragmento al leerlo).

## R16 · Pruebas, dos réplicas y librerías

- **Decisión:**
  - Las pruebas de dos réplicas usan **dos instancias de la aplicación en el mismo proceso** contra un PostgreSQL de Testcontainers, como `vencimiento-dos-replicas` de 003.
  - La caída se simula de dos formas: deteniendo una instancia después del COMMIT y antes del despacho, o después de reclamar un aviso y antes de enviarlo.
  - En Compose, `npm run demo:avisos` reproduce el recorrido con Nginx y las dos réplicas, deteniendo y volviendo a levantar Mailpit.
- **Librerías:** `nodemailer` (dependencia) y `@types/nodemailer` (devDependency), las dos aprobadas con versión exacta fija (R10). Mailpit es una imagen de Docker, no una dependencia del código. Ninguna otra: axe se revisa con la extensión del navegador.
- **Docker (decisión del responsable, 2026-11-04):** en esta fase no se descarga ni se ejecuta nada de Docker. El responsable verifica que Docker guarde las imágenes en D: y descarga la de Mailpit cuando llegue la fase 1. Las pruebas que usan Mailpit en Testcontainers necesitan esa imagen ya descargada.

## R17 · Retención de eventos y avisos

- **Decisión (responsable, 2026-11-04):** los eventos procesados, anulados o sin manejador se purgan a los **30 días**, y los avisos a los **90 días**. La purga de los eventos la hace la tarea de despacho de M06 (`despachar-eventos`), y la de los avisos, la tarea de envío de M05 (`enviar-avisos`), cada una sobre sus propias tablas y en lotes pequeños. La afinación por tipo (por ejemplo, conservar más los avisos de pago) queda para la funcionalidad 007 (RF31, RF32).
- **Justificación:** los eventos procesados no aportan nada después de entregarse; los avisos sirven como constancia de lo enviado ante un reclamo del cliente, sin guardar el texto ni datos de contacto.
- **Alternativa descartada:** conservar todo sin plazo. Contradice la minimización de la Ley N.° 29733 (principio de privacidad de la constitución).

## R18 · Texto del consentimiento de WhatsApp

- **Decisión (responsable, 2026-11-04):** el texto base está en [contracts/texto-consentimiento-whatsapp.md](contracts/texto-consentimiento-whatsapp.md), con documento `WHATSAPP` y versión `2026-11`, en español simple y con el mismo criterio que la política de datos de 002 (versión `2026-10`).
- Va marcado como **"texto base, por validar con asesoría legal"**. No se afirma que cumpla la Ley N.° 29733.
- La versión vigente la entrega la API junto con el texto, y el consentimiento guarda la versión aceptada.
