# Research: Acceso verificado (010)

Decisiones técnicas del plan. Cada una: **Decisión**, **Razón** y **Alternativas descartadas**. Los hechos del código se
comprobaron el 2026-11-23 en la rama `main` (rutas relativas a `tecnologia/plataforma-barberias/`).

## R01. Un solo mecanismo de "enlace de cuenta" para verificar y recuperar

- **Decisión**: una tabla nueva `account_link` (M01, por barbería) con `purpose` = `VERIFICAR_CORREO` | `RECUPERAR_CONTRASENA`,
  la cuenta, la barbería de origen, el SHA-256 del token, `expires_at`, `used_at` y `revoked_at`. Mismas reglas que la
  activación del personal (`account_activation`, ADR-015, `backend/src/modules/acceso-barberias/identidad/domain/activacion.ts`):
  un solo uso, el mismo error para usado, vencido o anulado, y anulación del anterior al emitir uno nuevo del mismo
  propósito. Se reutilizan `generarTokenOpaco` y `hashDeToken` (`identidad/application/tokens-opacos.ts`).
- **Razón**: el proyecto ya tiene un patrón probado de token opaco de un solo uso con solo el hash guardado; las dos
  piezas comparten el 90 % de las reglas (FR-002 a FR-007).
- **Alternativas**: (a) reutilizar `account_activation` con un tipo nuevo: mezcla el flujo del personal (72 h, entregado
  por el propietario) con el del correo, y su clave foránea a la membresía no sirve igual para la recuperación; (b)
  enlaces firmados sin estado (HMAC, como ADR-032): no permiten "un solo uso" ni anular el anterior sin una tabla de
  usos, que es lo mismo que R01 pero más complejo.

## R02. El enlace completo nunca se guarda: se genera al enviar el correo

- **Decisión**: M01 crea la fila de `account_link` **sin token** (estado "por enviar") y publica el evento
  `EnlaceDeCuentaSolicitado` por la salida de eventos (ADR-025) con solo el `enlaceId`, el propósito y la cuenta. M05
  crea el aviso y, **en el momento de enviarlo**, pide a M01 por su interfaz pública (`CuentasApi.emitirToken(enlaceId)`)
  un token nuevo: M01 lo genera, guarda su hash y lo devuelve en memoria; M05 arma la dirección y envía. Si el envío se
  reintenta, se emite otro token y el hash anterior se reemplaza.
- **Razón**: es el mismo criterio que los enlaces del recordatorio de 004, que "se firman al enviar y no se guardan"
  (`notificaciones/application/manejador-recordatorio.ts:8-12`). Así ni `outbox_event.payload` ni la tabla de avisos
  contienen el token (FR-003), y la matriz de dependencias ya permite que M05 llame a M01 por su `index.ts`
  (regla `matriz-m05` de `.dependency-cruiser.cjs`).
- **Alternativas**: (a) poner el token en el evento: quedaría en claro en `outbox_event` (jsonb) hasta su purga; (b)
  cifrarlo en el evento: más piezas (llave, rotación) para un dato que puede generarse al enviar; (c) que M01 envíe el
  correo: rompe `canal-solo-por-puerto` y `m05-sin-llamadas` (ADR-026, ADR-025).
- **Consecuencia aceptada**: si el servidor de correo aceptó un envío y respondió con error, el reintento manda un
  enlace nuevo y el primero deja de servir. El cliente usa el último correo o pide otro.

## R03. Barbería (tenant) de cada enlace y de su evento

- **Decisión**: todo evento y todo aviso llevan una barbería (principio III; `outbox_event.tenant_id` es `NOT NULL`,
  migración 0021). **Verificación**: la barbería donde el cliente se registró (o desde la que pide el reenvío, con su
  sesión). **Recuperación**: si se pide desde el enlace de una barbería (`/b/<slug>/ingresar`), esa barbería, solo si la
  cuenta tiene membresía allí; si se pide desde el ingreso general (`/ingresar`), la barbería del personal, o si la
  cuenta es solo de cliente, la de su membresía de cliente más reciente. La elige una función de sistema nueva
  (`auth_barberia_para_enlace`), con el mismo patrón que `auth_resolver_cuenta`.
- **Razón**: cumple "todo evento incluye el tenant" sin aceptar el tenant del cliente para nada que no sea elegir dónde
  se envía el aviso de su propia cuenta; con esa barbería, `user_account` es visible por RLS para leer el correo del
  destinatario (ADR-015).
- **Alternativas**: un evento sin tenant (rompe el principio III y la tabla); un aviso por cada barbería del cliente
  (varios correos iguales).

## R04. Consumir un enlace sin sesión: funciones de sistema del rol existente `barberias_auth`

- **Decisión**: cuatro funciones `SECURITY DEFINER` cuyo dueño es `barberias_auth` (el rol `NOLOGIN BYPASSRLS` que ya existe
  por ADR-015; **no se crea ningún rol nuevo**): **dos de consumo**, `auth_verificar_correo(p_token_hash)` y
  `auth_restablecer_contrasena(p_token_hash, p_hash_nuevo)`; **una de elección de barbería** para el aviso,
  `auth_barberia_para_enlace` (R03); y **una de activación**, `auth_marcar_verificada_por_activacion` (R12). Las dos de
  consumo se describen aquí; el detalle de las cuatro está en data-model §4. Cada una, en una sola sentencia atómica: valida el enlace
  (propósito, no usado, no anulado, no vencido), lo marca usado y aplica su efecto **solo sobre filas de esa cuenta**:
  la fecha de verificación, o la contraseña, la anulación de sus otros enlaces de recuperación y el cierre de **todas**
  sus sesiones (`auth_session.status` → `REVOCADA`, en todas sus barberías). Devuelven solo lo necesario (la barbería de
  origen para redirigir, o nada) y el mismo resultado vacío para cualquier enlace no válido.
- **Razón**: antes de abrir el enlace no hay sesión ni tenant, y la recuperación debe cerrar sesiones de varias
  barberías; con RLS por barbería, el rol de la aplicación no puede hacerlo en una transacción. Es el mismo mecanismo
  acotado que ya usan el ingreso (`auth_resolver_cuenta`) y la activación (`auth_buscar_activacion`). El cierre de
  sesiones corta también los tokens de acceso al instante, porque el guard comprueba la sesión en cada solicitud
  (`identidad/application/validar-solicitud.ts:25-31`).
- **Alternativas**: (a) un rol nuevo con `BYPASSRLS`: lo prohíbe la constitución; (b) recorrer las barberías de la cuenta
  una por una con el rol de la aplicación: necesita listar sus membresías sin tenant (otra función de sistema) y no es
  atómico.
- **Gobernanza**: estas funciones son operaciones sobre la cuenta sin sesión que no caben en las cuatro excepciones del
  principio III. Requieren la **enmienda MINOR 1.8.0** (borrador en `borradores/enmienda-iii-1.8.0-y-adr-036.md`) y la
  **revisión obligatoria de ADR-015**.

## R05. Dónde se exige el correo verificado: un guard nuevo del host

- **Decisión**: un guard `CorreoVerificadoGuard` en `backend/src/host/`, con el decorador `@RequiereCorreoVerificado()`,
  en tres rutas: `POST /citas` (reservar), `POST /asistente/mensajes` y `POST /citas/{id}/adelanto/pago`. Solo actúa si
  el actor es `CLIENTE` (el propietario que registra una cita presencial o usa el asistente no se ve afectado); consulta
  `CuentasApi.correoVerificado(usuarioId)` de M01 dentro del tenant del token y responde **403 `CORREO_NO_VERIFICADO`**.
  El `AuthGuard` no cambia.
- **Razón**: la matriz de dependencias **prohíbe** que M03 (adelanto) y M04 (asistente) llamen a M01 (reglas `matriz-m03`
  y `matriz-m04`); el host sí puede, porque es la raíz de composición. Un solo punto, probado por ruta, evita repetir la
  regla en tres módulos.
- **Alternativas**: (a) un dato `cv` en el token: no cambia hasta renovar la sesión (hasta 15 min sin poder reservar
  tras verificar) y obliga a tocar la emisión de sesión; (b) comprobar en cada caso de uso: rompe la matriz en M03 y M04.

## R06. La interfaz sabe si la cuenta está verificada

- **Decisión**: `SesionResponse.usuario` agrega `correoVerificado: boolean` (en `/auth/login`, `/auth/refresh`,
  `/auth/barberia`, `/clientes/registro` y `/auth/yo`). La interfaz muestra el aviso **antes** de intentar la acción, y
  además trata el 403 `CORREO_NO_VERIFICADO` igual (por si la verificación ocurrió en otro dispositivo o la sesión es
  antigua).
- **Razón**: FR-011 pide un aviso claro; mostrarlo antes evita que el cliente llene la reserva para nada. El servidor
  sigue siendo quien decide (FR-010).
- **Alternativa**: solo reaccionar al 403 (peor experiencia en el celular).

## R07. Respuestas neutras y de tiempo constante

- **Decisión**: `POST /cuenta/recuperacion`, `POST /cuenta/verificacion/reenvio` y `POST /cuenta/verificacion` responden
  siempre lo mismo (202 sin cuerpo útil, o el mismo 410 `ENLACE_NO_VALIDO` para cualquier enlace no válido). Las dos
  solicitudes hacen el mismo trabajo exista o no la cuenta (resolver la cuenta con la función de sistema y verificar
  límites) y aplican un **tiempo mínimo de respuesta** fijo para que la escritura extra cuando la cuenta existe no se
  note. Ese piso lo fija la variable de entorno **`CUENTA_RESPUESTA_MINIMA_MS`** (entero, por defecto **400**, validada en
  `backend/src/shared/config/configuracion.ts` con un rango de 100 a 2000), documentada en `.env.example` y fijada en las
  pruebas por `backend/test/helpers/entorno.ts`.
- **Cómo se prueba (SC-005)**: en dos partes.
  - **Prueba funcional, bloqueante en la CI**, dentro de `npm run test:int`: el mismo estado y el mismo cuerpo con y sin
    cuenta, y ninguna respuesta por debajo del piso. Es determinista y no depende de la máquina.
  - **Medición de tiempos, no bloqueante en la CI**: 100 solicitudes por serie; la diferencia de medianas debe ser
    menor de 30 ms y el percentil 90 de ambas series debe quedar dentro del piso más 50 ms. Va en un archivo aparte que
    `test:int` no recoge por defecto (sufijo `.medicion.spec.ts`, ejecutado con `npm run test:medicion`).
    - En la **verificación local** (quickstart) se exige con ese umbral estricto.
    - En la **CI** corre en un paso propio con el **mismo umbral** pero **no bloqueante** (`continue-on-error: true`): sus
      resultados quedan en el registro de la corrida.
  - **Por qué no bloqueante y no con tolerancia ampliada:** en los ejecutores compartidos de la CI los tiempos varían por
    causas ajenas al código. Ampliar la tolerancia la volvería poco útil, y dejarla bloqueante crearía fallos
    intermitentes, justo lo que 009 intenta reducir.
- **Razón**: FR-005, FR-013, FR-019, SC-005. El ingreso ya usa la verificación ficticia de contraseña para igualar
  tiempos (`iniciar-sesion.ts:81-84`).
- **Alternativa**: procesar en segundo plano sin escribir en la solicitud: necesitaría un evento sin tenant (R03).

## R08. Límites de solicitudes e intentos: contador en PostgreSQL

- **Decisión**: una tabla técnica nueva `account_link_attempt` sin `tenant_id` (como `login_attempt` y
  `action_link_attempt`): tipo (`REENVIO`, `RECUPERACION`, `USO_FALLIDO`), SHA-256 de la cuenta o del correo (nunca el
  correo en claro), origen **solo como hash con sal** (se reutiliza `INTENTOS_SAL_IP`, la de los intentos de ingreso de
  M01) y la fecha; purga oportunista de lo que tenga más de 24 h. Límites por defecto: reenvío 3/h por cuenta y 20/h por
  origen; recuperación 3/h por cuenta y 10/h por origen; usos fallidos 20/h por origen. Por encima: 429
  `DEMASIADOS_INTENTOS` con `reintentarEnSegundos` (mismo formato que el ingreso).
- **Razón**: el principio VIII exige que los contadores de seguridad vivan en PostgreSQL, no en Redis.
- **Alternativa**: el limitador general compartido en Redis (`AlmacenLimitesCompartido`): es para el límite general,
  tolerante a pérdidas; no sirve para seguridad.

## R09. Los enlaces van en el fragmento de la dirección

- **Decisión**: `/verificar#<token>` y `/restablecer#<token>`, como `/e#<token>` de ADR-032. La página lee el fragmento,
  lo borra de la barra de direcciones y lo envía en el cuerpo de un `POST` solo cuando la persona pulsa el botón
  (FR-004).
- **Razón**: el fragmento no viaja al servidor ni queda en los registros de Nginx ni en el `Referer`; la acción explícita
  evita que un revisor automático de correo gaste el enlace.

## R10. Textos legales: páginas estáticas versionadas en la interfaz

- **Decisión**: dos páginas públicas `/terminos` y `/privacidad` con el texto en archivos versionados del frontend
  (`frontend/src/legal/`), cada uno con su versión, su fecha de vigencia y la marca de borrador. Las versiones vigentes
  siguen saliendo de `TERMS_VERSION` y `PRIVACY_POLICY_VERSION` (backend) y de `VITE_TERMS_VERSION` y
  `VITE_PRIVACY_POLICY_VERSION` (interfaz), que ya existen (`frontend/src/legal.ts`). El registro ya rechaza una versión
  distinta de la vigente (FR-026 está construido); solo se agrega una prueba.
- **Versión nueva**: los textos se publican como una **versión nueva** (provisionalmente `2026-12`), no como `2026-10`,
  porque nadie pudo leer el texto de la `2026-10`. Las aceptaciones guardadas con `2026-10` no cambian (Q1: C).
  **Paso del responsable**: cambiar `TERMS_VERSION` y `PRIVACY_POLICY_VERSION` en su `.env` local (el agente no lo lee ni
  lo cambia), además de `.env.example`, `backend/test/helpers/entorno.ts`, el valor por defecto de `legal.ts` y el de la
  semilla en `docker-compose.yml`.
- **Razón**: el texto cambia poco y debe revisarlo una persona; un sistema de gestión de documentos no se justifica.
- **Alternativa**: guardar los textos en la base de datos con una pantalla de edición (fuera de alcance; sin ella la
  tabla no aporta nada).

## R11. Pantallas del cliente sin sesión

- **Decisión**: extender a `/asistente`, `/mis-avisos`, `/mis-datos` y `/mis-citas/:citaId/adelanto` la opción
  `sinSesion` de `RutaProtegida` y la pantalla `ClienteSinSesion` ya construidas para `/mis-citas`, con el título de cada
  una y la dirección a la que volver (`desde`). El aviso `ADELANTO_SOLICITADO` **ya** incluye
  `URL_PUBLICA/mis-citas/<id>/adelanto` (`notificaciones/application/enviar-avisos.ts:252-257`); solo falta que la
  interfaz lo atienda sin sesión, y una prueba de contrato del aviso.
- **Razón**: FR-028 a FR-031 con lo que ya existe y está probado.

## R12. Cuentas existentes y personal

- **Decisión**: la migración agrega `user_account.email_verified_at` y `email_verified_via` (`ENLACE` | `ACTIVACION` |
  `MIGRACION`) y marca como verificadas, con `MIGRACION`, todas las cuentas existentes. La activación del personal
  (`auth/activar`) marca `ACTIVACION`. Una recuperación de contraseña completada **también** marca la cuenta como
  verificada (`ENLACE`), porque demuestra la posesión del correo (supuesto de la spec).
- **Razón**: FR-016, FR-017 y SC-002 sin romper a nadie. Las pruebas que crean cuentas directamente con SQL deben marcar
  la verificación en sus ayudantes (ver R13).

## R13. Semilla y pruebas que registran y reservan enseguida

- **Decisión**: la semilla verifica a sus clientes por el buzón; las pruebas del backend que reservan usan cuentas creadas
  por SQL, que deben nacer verificadas; y las pruebas del frontend simulan sesiones verificadas.
- **Los 13 archivos que llaman a `POST /clientes/registro`** (búsqueda del 2026-11-23), y cuáles reservan después con el
  cliente recién registrado:

  | Archivo (relativo a `tecnologia/plataforma-barberias/`) | Tipo | ¿Reserva el cliente recién registrado? | Qué cambia |
  | --- | --- | --- | --- |
  | `semilla/cargar-semilla.mjs` | Semilla | **Sí** (registra y luego reserva por la API) | Verificar cada cliente con el enlace de Mailpit (`semilla/lib/buzon.mjs`) y `POST /cuenta/verificacion` antes de reservar |
  | `semilla/test/semilla.test.mjs` | Prueba de la semilla (API falsa) | **Sí** | La API falsa simula el correo y la verificación; prueba que la semilla verifica antes de reservar y que la segunda carga no duplica |
  | `frontend/test/pages/cliente-reserva.spec.tsx` | Prueba del frontend (MSW) | **Sí** (registro → confirmación de la reserva) | La sesión simulada tras el registro trae `correoVerificado: true`; un caso nuevo con `false` muestra el aviso (T055) |
  | `backend/test/contract/clientes.contract.spec.ts` | Contrato | No | Nada (agregar `correoVerificado` en la forma de la respuesta) |
  | `backend/test/contract/rbac-002.spec.ts` | Contrato RBAC | No (la fila `POST /citas` usa `sesionCliente`, creado por SQL) | Nada por el registro; cubierto por la corrección de `fixtures.ts` |
  | `backend/test/integration/clientes/cuenta-cliente.spec.ts` | Integración | No | Comprobar que la cuenta nueva nace sin verificar |
  | `backend/test/integration/auditoria.spec.ts` | Integración | No (reserva con `sesionCliente`, por SQL) | Nada por el registro |
  | `backend/test/integration/host/entradas.spec.ts` | Integración | No (las filas de `/citas` usan `sesionCliente`) | Nada por el registro |
  | `backend/test/integration/escalado/limite-compartido.spec.ts` | Integración | No | Nada |
  | `backend/src/modules/acceso-barberias/clientes/presentation/clientes.controller.ts` | Código | — | Fase 4 (T057) |
  | `backend/src/modules/acceso-barberias/clientes/presentation/clientes.dto.ts` | Código | — | Sin cambios |
  | `frontend/src/pages/publico/RegistroCliente.tsx` | Código | — | Sin cambios (la sesión trae `correoVerificado`) |
  | `frontend/src/api/schema-002.d.ts` | Tipos generados | — | Sin cambios |

- **El punto que más pruebas toca son los ayudantes que crean cuentas por SQL**: `backend/test/helpers/fixtures.ts`
  (líneas 86 y 373, `INSERT INTO user_account`). Usan `sesionCliente` y `sembrarCliente` en las pruebas que reservan,
  preguntan al asistente o pagan el adelanto. Deben crear las cuentas **verificadas** (`email_verified_via = 'MIGRACION'`),
  salvo que la prueba pida una sin verificar. Para eso se agrega una opción a esos ayudantes.
- Las pruebas del frontend que arman sesiones de cliente usan `correoVerificado: true`, salvo las que prueban el aviso.
- **Razón**: FR-034; la semilla verificada con Docker real (T025 de 009) debe seguir pasando.

## R14. El 409 `CORREO_NO_DISPONIBLE` del registro se mantiene

- **Decisión**: no se cambia (fuera de alcance por decisión del responsable). Se documenta en el ADR nuevo como riesgo
  aceptado: el registro revela si un correo tiene cuenta, mitigado por `REGISTRO_LIMITE_POR_MINUTO`. La recuperación y la
  verificación sí son neutras.

## R15. Qué se audita de los enlaces

- **Decisión**: se auditan, en la barbería del enlace, la solicitud con una cuenta existente, el uso aceptado y el
  **rechazo de un enlace que pertenece a una cuenta** (usado, vencido o anulado: la fila existe, así que se conocen la
  cuenta y la barbería). Un enlace **desconocido o mal formado** (ningún hash coincide) **no se audita**: se registra solo
  en `account_link_attempt` como `USO_FALLIDO` por origen, que además alimenta el límite de R08. Una solicitud con un
  correo sin cuenta tampoco se audita.
- **Razón**: el principio III exige la barbería en todo registro de auditoría, y `audit_log.tenant_id` es obligatorio. La
  única auditoría sin barbería que se admite es la del acceso del administrador de la plataforma.
- **Cómo se distinguen los dos casos sin revelar nada**: las dos funciones de consumo devuelven **al caso de uso** un
  resultado interno: `APLICADO` (con la barbería y la cuenta), `RECHAZADO` (con la barbería y la cuenta: usado, vencido o
  anulado) o nada (ningún hash coincide). El caso de uso audita los dos primeros en esa barbería y registra el tercero
  como `USO_FALLIDO`. **Hacia fuera**, `RECHAZADO` y "nada" dan el mismo 410 `ENLACE_NO_VALIDO`, con el mismo cuerpo.
- **Alternativa**: auditar todos los rechazos en `platform_audit_log`: esa tabla es solo para el acceso del administrador.
