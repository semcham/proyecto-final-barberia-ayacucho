# Research: Asistente de IA y reportes (005)

Decisiones de diseño de la fase 0. Cada una con decisión, justificación y alternativas descartadas. Base: la
[especificación](spec.md) con sus aclaraciones del 2026-11-14, la constitución 1.6.0 (principios I, II, III, VI,
VIII y X), ADR-008 (IA desacoplada con herramientas cerradas) y ADR-012 (resiliencia ante servicios externos), y el
código ya construido de M02 y M03.

## R01 · M04 con dos submódulos y lecturas de M02 por una interfaz nueva

- **Decisión:** M04 (`backend/src/modules/asistente-reportes/`) tiene dos submódulos con sus cuatro capas:
  **`reportes`** (US2, sin IA) y **`asistente`** (US1 y US3). M04 usa **solo**:
  - de M02, una interfaz pública nueva, **`CatalogoCitasApi`** (clase abstracta exportada en
    `catalogo-citas/index.ts`, como `AdelantosApi` en M03), **solo de lectura**:
    - `contextoDeLaBarberia()`: zona horaria y si acepta reservas por el enlace (slug);
    - `serviciosActivos()`, con nombre, precio, duración y descripción pública;
    - `barberosQueOfrecen(servicioId)`;
    - `horariosLibres({ servicioId, fecha, barberoId? })`: el mismo cálculo de `ConsultarHorarios.ejecutar` con
      la fuente con sesión;
    - `conteosDeCitas(desde, hasta)`, `serviciosMasSolicitados(desde, hasta, limite)` y
      `actividad(desde, hasta)`: agregados por período, sin datos de clientes;
  - de M03, `SuscripcionesApi.estadoOperativo(tenant)`, que ya existe, para no ofrecer reservar si la barbería
    no acepta reservas (FR-018);
  - de M06, `UnitOfWork`, `TenantContext`, `AuditLog`, `Clock`, `Configuracion`, `Interruptor`, `ZonaHoraria` y
    `FechaLocal`.

  `CatalogoCitasApi` corre en la transacción del llamador (M04 la abre con el tenant del token). Su
  implementación (`CatalogoCitasApiImpl`) reutiliza `CatalogQuery`, `ConsultarHorarios` y una lectura nueva de
  agregados (`ReportesDeCitasQuery`, infraestructura de M02). **No cambia** ningún caso de uso ni ruta existente.
- **Justificación:** la matriz permite M04 → M02, M03 y M06 (estilo §3); los datos de citas son de M02 (principio I:
  nadie lee tablas ajenas). M04 **no depende de M01**: la matriz no lo permite, y la zona horaria y el slug llegan
  por M02, que ya depende de M01.
- **Alternativas descartadas:**
  - Que M04 lea `appointment` directamente: viola el principio I.
  - Que los reportes vivan en M02: RF29 es de M04 según los componentes, y el asistente del propietario
    necesita las mismas cifras.
  - Llamar a los controladores HTTP de M02: no hay transacción ni tenant compartido, y duplica la autorización.

## R02 · Permisos de M04 y del guard

- **Decisión:** una matriz propia, `PermisosAsistenteReportes` (`asistente-reportes/.../domain/permisos.ts`), con
  tres operaciones:
  - `USAR_ASISTENTE_CLIENTE`: CLIENTE;
  - `USAR_ASISTENTE_PROPIETARIO`: PROPIETARIO;
  - `VER_REPORTES`: PROPIETARIO.

  El barbero no tiene ninguna. El `RolesGuard` del host suma esta matriz (como hizo con las de M02 y M03), y cada
  caso de uso la vuelve a exigir.
- **Justificación:** ADR-010 (RBAC en la capa de aplicación) y el patrón de las funcionalidades anteriores.
- **Alternativa descartada:** reutilizar `CONSULTAR_HORARIOS` de M02: mezclaría la cuota y el registro del
  asistente con la ruta de horarios.

## R03 · El modelo solo traduce la pregunta; el backend responde con los datos

- **Decisión:** el proveedor de IA recibe la pregunta y el contexto mínimo, y devuelve **solo una intención
  estructurada** en JSON: `{ "intencion": "...", "argumentos": { ... } }`. El backend:
  1. valida la intención con un esquema cerrado;
  2. comprueba que la intención es una herramienta permitida para el rol;
  3. ejecuta la herramienta con `CatalogoCitasApi` o con los casos de uso de `reportes`;
  4. **compone la respuesta en español con plantillas a partir de los datos de la herramienta**.

  El texto libre del modelo **nunca llega al usuario**. Una sola llamada al proveedor por pregunta.

  Intenciones:
  - del cliente: `servicios`, `barberos`, `horarios_libres`;
  - del propietario: `resumen_citas`, `servicios_mas_pedidos`;
  - comunes: `fuera_de_alcance` y `accion_no_permitida` (reservar, cancelar o cambiar algo).
- **Justificación:**
  - es la "intención estructurada" de ADR-008;
  - FR-001 (ninguna cifra ni horario sin herramienta) se cumple **por construcción**, y la "verificación de la
    respuesta" queda en validar el JSON, no en revisar texto libre;
  - las cifras del propietario son las de los reportes porque salen del mismo caso de uso (FR-027);
  - con una sola llamada, el tiempo límite cabe en los 3 s de SC-003;
  - la inyección no tiene cómo producir datos (R07).
- **Desventaja aceptada:** respuestas menos conversacionales (la "menos magia" de ADR-008).
- **Alternativas descartadas:**
  - **Agente con llamadas a herramientas y respuesta redactada por el modelo**: el modelo puede escribir cifras u
    horarios que no vienen de la herramienta. Habría que verificar el texto número por número (frágil), y son dos
    o más llamadas por pregunta, más de 3 s.
  - **Verificar la respuesta del modelo con expresiones regulares:** falsos positivos y huecos (horas escritas
    "a las cuatro y media").

## R04 · Argumentos resueltos por el backend dentro de la barbería

- **Decisión:**
  - el modelo devuelve los argumentos **como los dijo el usuario**: nombre del servicio, nombre del barbero, y
    fecha o rango en ISO, ya resuelto con la fecha de hoy y la zona horaria que el backend le pasa;
  - el backend los resuelve **contra el catálogo de la barbería del token**: coincidencia sin tildes ni
    mayúsculas, y si es ambigua o no existe, la respuesta lo dice y lista las opciones;
  - el backend valida fechas y rangos: la fecha no puede ser pasada ni pasar del horizonte de reserva (horarios),
    y el rango tiene un tope de 366 días (reportes);
  - la respuesta dice siempre la fecha exacta usada (FR-014);
  - ningún argumento puede ser una barbería, un tenant ni un identificador: el esquema no los admite y se
    descartan.
- **Justificación:**
  - FR-004: la barbería sale solo del token;
  - el catálogo de la barbería no se envía al modelo, así que sus textos no pueden inyectar instrucciones (R07);
  - se envían menos datos al proveedor (FR-011).
- **Alternativa descartada:** enviar al modelo la lista de servicios para que elija el id: abre el canal de
  inyección por textos del catálogo y envía más datos.

## R05 · Puerto `AIProvider`, adaptadores y resiliencia

- **Decisión:**
  - **Puerto** `AIProvider` en `asistente/application/ports/`: `interpretar({ instrucciones, mensajes, esquema })`
    devuelve `{ intencion, argumentos }` o lanza `ProveedorIANoDisponible`.
  - **`ProveedorIAFalso`** (pruebas y CI): determinista, sin red. Interpreta palabras clave y tiene modos
    controlables:
    - `guion`: devuelve un JSON dado, para simular un modelo inyectado o malicioso;
    - `caido`, `lento <ms>` y `error 429/500`;
    - registra las instrucciones y los mensajes que recibió, para las pruebas de privacidad.
  - **`ProveedorIAOpenRouter`** (solo desarrollo): HTTP con `fetch` nativo de Node 22, sin dependencias nuevas, a
    la API de chat compatible de OpenRouter, con salida JSON. Lee la llave de `IA_OPENROUTER_LLAVE`.
  - **`ProveedorIANinguno`**: cuando no hay proveedor configurado; responde siempre "no disponible".
- **Configuración** (servidor, nunca en el repositorio):
  - `IA_PROVEEDOR`: `falso`, `openrouter` o `ninguno`. Por defecto `ninguno`; `falso` en las pruebas.
  - `IA_OPENROUTER_LLAVE` (secreto) e `IA_OPENROUTER_MODELO`.
  - `IA_TIEMPO_LIMITE_MS`: 2 500 por defecto, de 500 a 10 000.
  - Con `IA_PROVEEDOR=openrouter` y `NODE_ENV=production`, el servidor **no arranca**: OpenRouter es solo de
    desarrollo (ADR-027). `.env.example` lleva las variables sin valor.
- **Resiliencia (ADR-012):**
  - tiempo límite por llamada `IA_TIEMPO_LIMITE_MS`, con `AbortSignal.timeout`;
  - **un reintento** solo ante 429 o 5xx inmediatos, y solo si queda tiempo dentro de un presupuesto total de
    3 s (la interpretación no tiene efectos, así que reintentar es seguro);
  - el `Interruptor` de M06 se abre tras 5 fallos en 60 s, con pausa de 30 s;
  - abierto, responde al instante, sin llamar.

  En cualquier falla, la respuesta es 503 `ASISTENTE_NO_DISPONIBLE` con la alternativa manual (enlace a reservar
  o a los reportes), en ≤ 3 s (SC-003).
- **Justificación:** principio VI (`AIProvider`), PR20 (misma suite de contrato para el falso y OpenRouter, que
  se omite sin llave) y PR06 (proveedor caído).
- **Alternativas descartadas:**
  - SDK de OpenAI u otra librería: una dependencia nueva para una sola llamada HTTP.
  - Tiempo límite de 10 s: no cumple SC-003 con el proveedor lento.

## R06 · Instrucciones del sistema y separación de datos

- **Decisión:**
  - **Instrucciones fijas** en el código del submódulo, nunca editables por el usuario ni por la barbería, con:
    - el rol y las intenciones permitidas para ese rol;
    - el esquema JSON de salida;
    - la fecha de hoy y la zona horaria;
    - la regla de que todo lo que llegue del usuario es **dato a clasificar**, no instrucción.
  - **Los mensajes del usuario** van delimitados como contenido del usuario: la pregunta y hasta 6 intervenciones
    previas, en las que las del asistente son solo el resumen de lo que mostró, nunca datos de la barbería.
  - **No se envían:** el catálogo, nombres de clientes, datos de otras barberías, el tenant ni secretos.
- **Justificación:** FR-006 y FR-011; principio de minimización (Ley 29733).
- **Alternativa descartada:** guardar la conversación en el servidor: FR-012 la quiere sin historial.

## R07 · Defensa ante inyección: por diseño y con PR19

- **Decisión:** la defensa no depende de que el modelo "obedezca":
  1. el modelo no tiene acceso a datos ni a herramientas: solo devuelve una intención;
  2. el backend descarta cualquier intención o argumento fuera del esquema y del rol;
  3. la barbería sale del token;
  4. los textos del catálogo no van al modelo;
  5. las herramientas son de solo lectura;
  6. la respuesta se compone con plantillas que escapan los datos.

  **Conjunto adversarial mínimo de PR19 (12 casos)**, en `contracts/asistente.md` §5. Se prueba con el proveedor
  falso en **dos modos**:
  - el modo normal, que demuestra que el mensaje no logra nada;
  - el modo `guion`, que simula un modelo **ya engañado** que devuelve la intención o los argumentos maliciosos, y
    demuestra que el backend los rechaza.

  En los dos casos se comprueba que:
  - no aparecen datos de otra barbería ni de otros clientes;
  - no hay escrituras: las mismas filas antes y después;
  - no hay texto del modelo en la respuesta;
  - el proveedor no recibió el catálogo ni datos de terceros.
- **Justificación:** EQ-19 (0 fugas) y SC-002; probar un modelo real no es determinista, así que la garantía
  tiene que estar en el backend.

## R08 · Cuotas atómicas en PostgreSQL

- **Decisión:**
  - tabla **`assistant_quota`** (`tenant_id`, `scope` USUARIO o BARBERIA, `subject_id` (el usuario, o la
    barbería), `day`, `used`), con RLS y clave primaria `(tenant_id, scope, subject_id, day)`;
  - `day` es la **fecha local de la barbería**, así que la cuota se reinicia a la medianoche de su zona horaria;
  - antes de llamar al proveedor, en **una transacción** con el tenant del token, se suman las dos cuotas con
    `INSERT … ON CONFLICT DO UPDATE SET used = used + 1 WHERE used < :limite RETURNING used`, una por alcance;
  - si alguna no devuelve fila, se **revierte** todo y se responde 429 `CUOTA_ASISTENTE_AGOTADA`, con
    `Retry-After` y `reiniciaEn`;
  - si el proveedor falla (tiempo agotado, error o circuito abierto), se **devuelve** la unidad en otra
    transacción corta (`used = used - 1 WHERE used > 0`);
  - una pregunta vacía o demasiado larga se rechaza antes y no consume (FR-013).

  Límites fijos e iguales para todos los planes: 20 por usuario y 200 por barbería (aclaración del 2026-11-14),
  en `Configuracion` (`IA_CUOTA_USUARIO_DIA`, `IA_CUOTA_BARBERIA_DIA`) para poder bajarlos en la demostración.
- **Justificación:**
  - principio VIII: la cuota de IA en PostgreSQL, compartida entre réplicas;
  - la condición en el UPDATE hace la suma atómica sin pasarse del límite, también con dos réplicas a la vez
    (SC-004);
  - no depende de la sesión (FR-007).
- **Alternativas descartadas:**
  - Redis: el principio VIII lo prohíbe para la cuota de IA.
  - Contar las filas del registro: no es atómico con varias réplicas.

## R09 · Registro de preguntas sin el texto y auditoría

- **Decisión:**
  - tabla **`assistant_question`**, con RLS. Por cada pregunta guarda:
    - quién preguntó (`tenant_id`, `user_id`, `role`), cuándo (`asked_at`) y la intención;
    - la herramienta usada y el resultado: `RESPONDIDA`, `SIN_DATOS`, `FUERA_DE_ALCANCE`, `ACCION_NO_PERMITIDA`,
      `CUOTA_AGOTADA`, `PROVEEDOR_NO_DISPONIBLE` o `INVALIDA`;
    - la duración y los tokens que informa el proveedor;
  - **nunca guarda el texto de la pregunta ni de la respuesta, ni los argumentos** (pueden tener nombres que
    escribió el usuario);
  - además, una fila de `audit_log` por pregunta (`ASISTENTE_CONSULTADO`, recurso `asistente:<rol>;<resultado>`)
    y por consulta de reportes (`REPORTES_CONSULTADOS`, recurso `reportes:<desde>..<hasta>`);
  - los registros de la aplicación solo llevan la intención y el resultado; nunca el contenido ni la llave.
- **Justificación:** FR-010, FR-029, SC-007 y HU23 criterio 3 (cada consulta queda registrada).
- **Retención:** sin purga en esta versión (una fila pequeña por pregunta, con la cuota de 200 al día por
  barbería); la retención queda para 007 (datos personales).
- **Alternativa descartada:** guardar el texto cifrado: es un dato personal más que proteger y no hace falta para
  cumplir la especificación.

## R10 · Reportes por período en la zona horaria de la barbería

- **Decisión:**
  - el período llega como dos fechas locales, `desde` y `hasta`, ambas incluidas, y se valida en el dominio de
    `reportes`: `desde ≤ hasta`, a lo sumo 366 días;
  - se convierte a instantes con `ZonaHoraria` (inicio del día de `desde` y fin del día de `hasta`);
  - las cuentas usan la hora de inicio de la cita: `starts_at >= inicio AND starts_at < fin`.

  Tres agregados en una sola transacción de lectura, en `ReportesDeCitasQuery` de M02:
  - **citas:** conteo por `status`, y de las canceladas, cuántas tienen `late_cancellation`;
  - **servicios más solicitados:** `service_name` de la cita, sin las canceladas, ordenado por número de citas y,
    en un empate, por nombre; los 10 primeros;
  - **actividad:** citas por barbero (nombre visible del catálogo; "Barbero dado de baja" si ya no existe) y por
    día de la semana local (`EXTRACT(ISODOW FROM starts_at AT TIME ZONE zona)`), y los totales de tardías y de no
    asistió.

  Solo conteos, sin montos ni nombres de clientes (FR-024).
- **Índices:** el de 002, `appointment (tenant_id, starts_at)`, ya cubre el rango por barbería; no hace falta uno
  nuevo. SC-005 (≤ 2 s para un mes) se mide en una prueba con citas sembradas, y si no se cumple se agrega
  `(tenant_id, starts_at) INCLUDE (status, service_name, barber_id)`.
- **Justificación:** FR-020 a FR-023; los bordes (las 00:00 de `desde` y las 23:59 de `hasta` en Lima) se prueban
  de forma explícita.

## R11 · Una ruta del asistente para los dos roles

- **Decisión:**
  - `POST /asistente/mensajes`: las herramientas se eligen por el **rol del token**. El cliente usa las de US1 y
    el propietario las de US3; el barbero recibe 403. Si US3 se recorta, el propietario recibe 403 sin cambiar la
    ruta.
  - Reportes: **`GET /reportes?desde=&hasta=`**, que devuelve las tres tablas de una vez (una sola consulta
    auditada). Reemplaza la fila planificada `GET /reportes/citas` de `api-rest.md`.
- **Justificación:** menos superficie; el contexto de la conversación lo manda el navegador (FR-012), así que el
  servidor no guarda estado.
- **Alternativa descartada:** una ruta por herramienta: el modelo dejaría de elegir la intención y el asistente no
  tendría sentido.

## R12 · Interfaz

- **Decisión:**
  - **cliente:** pantalla **`/asistente`** (solo CLIENTE, desde "Mis citas"), con un cuadro de pregunta y las
    respuestas como texto y tablas simples. Para los horarios libres, cada hora es un enlace a
    `/b/{slug}/reservar?servicio=&barbero=&inicio=`: `Reservar.tsx` ya admite esos parámetros, así que no cambia;
  - **propietario:** pantalla **`/app/reportes`** con el selector de período y las tres tablas. Si se hace US3,
    suma una pestaña "Preguntar" con el asistente;
  - estados de carga, vacío, cuota agotada y "no disponible", con la alternativa manual;
  - accesible como el resto (Radix y el sistema de diseño de ADR-016).
- **Justificación:** HU22 (reservar más rápido sin que el asistente reserve) y HU24; sin pantallas fuera de M04.

## R13 · Enmienda de la constitución

- **Decisión:** **no hace falta.**
  - VI (`AIProvider`, herramientas cerradas sobre casos de uso, límites, registro y degradación): se cumple.
  - VIII (la cuota de IA en PostgreSQL): se cumple.
  - III (tenant del token, RLS en las dos tablas nuevas): se cumple.
  - I: M04 → M02, M03 y M06 ya están en la matriz.

  La política de datos hacia el proveedor (solo desarrollo, solo datos de prueba, minimización) se registra en
  ADR-027, no en la constitución. Si el responsable quiere que "el proveedor de IA de producción MUST tener
  aprobada su política de datos" sea un principio, sería una enmienda MINOR a VI: **se propone, no se aplica**.
