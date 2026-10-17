# Investigación (Fase 0): Catálogo, citas y cuenta de cliente

**Funcionalidad**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Cada decisión indica qué se eligió, por qué y qué se descartó. Las decisiones de arquitectura están
registradas antes de implementar en
[ADR-020](../../docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-020-cuenta-de-cliente-con-membresía-y-sesión-por-barbería)
y
[ADR-021](../../docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-021-lecturas-públicas-por-enlace-slug),
ambos **Aceptados** por el responsable el 2026-10-17. Lo que ya decidió la funcionalidad 001 (R01–R23 de su
[research.md](../001-registro-acceso-barberia/research.md)) no se repite.

## R01. Pila y reutilización (dada)

- **Decisión:** la misma pila de 001: NestJS 11, Kysely + `pg`, PostgreSQL 16 con RLS `FORCE`,
  React 19 + Vite 6, TanStack Query, `react-hook-form` + `zod`, Radix UI y los tokens de ADR-016.
  Se reutilizan sin cambios el `UnitOfWork` con `set_config` por transacción, `TenantContext`,
  `AuditLog`, `Clock`, el formato de errores, `EmitirSesion`, el guard de autenticación y el
  sistema de diseño. **Sin dependencias nuevas** en el backend; en el frontend, ninguna librería
  de calendario (la agenda se entrega como lista por fecha, primera línea de corte).
- **Por qué:** el plan de 6 días no admite incorporar ni evaluar librerías; todo lo que falta se
  resuelve con la plataforma (por ejemplo, la zona horaria con `Intl`, R07).
- **Descartado:** Luxon o `date-fns-tz` (una dependencia más para una zona sin horario de verano);
  una librería de calendario (peso y tiempo).

## R02. Cuenta de cliente con membresía y sesión por barbería (ADR-020)

- **Decisión:** una cuenta por correo; una membresía `CLIENTE` y un `customer_profile` por barbería;
  un token con un solo `tid`. Operaciones:

  | Operación           | Ruta                                                | Identidad comprobada   | Efecto                                                                                                     |
  | ------------------- | --------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
  | Registro de cliente | `POST /clientes/registro` (con `barberia` = `slug`) | Cuenta nueva           | Cuenta, membresía, perfil, consentimiento y sesión en una transacción                                      |
  | Ingreso con enlace  | `POST /auth/login` con `barberia`                   | Contraseña             | Sesión en esa barbería; si no es miembro: `UNIRSE_REQUIERE_CONSENTIMIENTO`, o se une si trae la aceptación |
  | Ingreso sin enlace  | `POST /auth/login` sin `barberia`                   | Contraseña             | Personal: como en 001. Cliente: `INGRESA_DESDE_TU_BARBERIA`                                                |
  | Cambio de barbería  | `POST /auth/barberia`                               | Sesión vigente (`sub`) | Sesión nueva en la barbería destino; cierra la actual y reemplaza `rt`                                     |

- `auth_resolver_cuenta(email)` pasa de `JOIN` a `LEFT JOIN` con la membresía de personal: devuelve
  la cuenta aunque no tenga personal (columnas de membresía nulas). Misma firma, sin tenant, máximo
  una fila. Así la contraseña de cualquier cuenta se verifica por el mismo camino de tiempo constante
  que 001 (con un hash ficticio si la cuenta no existe). Requiere la revisión obligatoria de ADR-015.
- La membresía del destino se busca **con RLS**, en una transacción con el tenant resuelto desde el
  `slug`: no hace falta una función de sistema nueva.
- **Personal y cliente no se mezclan:** si `auth_resolver_cuenta` devuelve membresía de personal, la
  unión como cliente se rechaza con `CUENTA_DE_PERSONAL`. Si el correo ya existe, el registro de
  cliente falla por la unicidad de `user_account` (inserción sin `RETURNING`, como en 001) y responde
  `CORREO_NO_DISPONIBLE`, el mismo código de 001; la interfaz del cliente lo muestra como "ya tienes
  cuenta: inicia sesión para unirte". No revela barberías.
- **Cambios en 001:** `LimiteUsuarios` y `ListarUsuarios` cuentan y listan solo `PROPIETARIO` y
  `BARBERO`; la matriz de `Permisos` agrega `CLIENTE`; `ActualizarUsuario` no opera sobre clientes.
- **Descartado:** ver alternativas (a)–(c) de ADR-020. También se descartó una función de sistema que
  liste las barberías del cliente: sería otra omisión de RLS para una comodidad (línea de corte).

## R03. Lecturas públicas por enlace (ADR-021)

- **Decisión:** rol `barberias_publico` (`LOGIN NOBYPASSRLS`) con `SELECT` solo sobre las columnas
  públicas de la lista cerrada de ADR-021, pool propio (`DATABASE_URL_PUBLICO`), transacción
  `READ ONLY` que fija `app.tenant_id` con el tenant que M01 resolvió desde el `slug`
  (`BarberiasApi.resolverSlugPublico`; M06 no lee tablas de M01, hallazgo C1). RLS filtra las filas
  con las mismas políticas `tenant_isolation`.
- **Rutas:** `GET /publico/{slug}` (barbería, horario de atención, servicios y barberos activos) y
  `GET /publico/{slug}/horarios?servicio=&fecha=&barbero=` (horarios libres). Solo `GET`.
- **Código:** `catalogo-citas/catalogo/infrastructure/publico/` es la única carpeta que importa el
  pool público (regla nueva en PR14). Los controladores públicos están marcados con `@Publica()` y no
  leen el token.
- **Por qué no `SECURITY DEFINER`:** sería un segundo rol `BYPASSRLS` (creación en RDS **por
  validar**) y el tenant se filtraría a mano en cada función. Con permisos por columna, un error de
  código que pida `customer_id` falla en PostgreSQL. Detalle en ADR-021.

## R04. El `slug` como selector previo a la sesión (excepción al principio III)

- **Hallazgo:** el principio III exige que el tenant salga del token y solo admite el `slug` para
  **lecturas** públicas. Pero el registro de cliente, la unión, el ingreso con enlace y el cambio de
  barbería necesitan saber, **antes de que exista la sesión de esa barbería**, en qué barbería crear o
  elegir la membresía. No hay forma de evitarlo: el cliente es quien dice dónde quiere reservar.
- **Decisión:** el `slug` se acepta solo en esas cuatro operaciones, después de comprobar la identidad
  (contraseña o sesión vigente) o al crear la cuenta, y solo para escribir filas de la propia persona
  (cuenta, membresía, perfil, consentimiento, sesión). Ninguna operación autenticada de negocio lo
  acepta. Está justificado en _Complexity Tracking_ del plan y en ADR-020.
- **Resolución (2026-10-17):** el responsable aprobó la enmienda MINOR **1.2.0** de la constitución,
  que añade al principio III esta segunda excepción acotada ("selección de membresía por enlace") con
  las mismas condiciones, y aceptó ADR-020.
- **Descartado:** pedir al cliente que elija la barbería de una lista tras ingresar (sigue siendo una
  elección del cliente y exige listar membresías fuera de RLS); un token con varias barberías (el
  tenant vendría en cada solicitud).

## R05. Dependencia M02 → M01 (ADR-020)

- **Decisión:** la matriz de módulos pasa a permitir M02 → M01 solo por `acceso-barberias/index.ts`:
  - `ClientesApi.perfilDeSesion(userId)`: devuelve el perfil del cliente de la sesión, para reservar y
    para el historial.
  - `ClientesApi.datosDeContacto(ids[])`: devuelve nombre y teléfono para la agenda, en lote.
  - `ClientesApi.perfilDeBarberia(clienteId)`: valida que el cliente de una cita presencial sea de la
    barbería. El alta del cliente presencial la expone M01 en su propio controlador (`POST /clientes`),
    no por `ClientesApi`, porque M02 no la necesita.
  - `PersonalApi.esPersonalActivo(userId)`: para vincular un barbero.
  - `BarberiasApi.configuracionAgenda()`: zona horaria y antelación mínima de cancelación de la
    barbería del contexto. `BarberiasApi.datosPublicos(tenantId)`: nombre, enlace, dirección, teléfono
    y descripción, para el catálogo público. `BarberiasApi.resolverSlugPublico(slug)`: tenant de una
    barbería activa, para la vía pública (ADR-021, decisión 3).

  El horario de atención (`business_hours`) vive en M02 `catalogo`, no en M01. Así se pueden detectar
  las citas en conflicto al reducirlo (FR-005) sin que M01 llame a M02.

  M01 no llama a M02. `appointment.customer_id` tiene clave foránea compuesta a `customer_profile`:
  es una restricción de esquema, no un acceso de código a tablas ajenas.

- **Descartado:** mover `customer_profile` a M02 (el registro de clientes, RF05, es de M01 y M01 no
  puede llamar a M02); copiar nombre y teléfono en la cita (quedan desactualizados y duplican datos
  personales).
- **Permisos de M02:** M02 define su propia matriz de operaciones (`catalogo-citas/*/domain/permisos.ts`)
  sobre el rol del actor que fija el guard. No importa `Permisos` de M01.

## R06. Restricción de exclusión y mapeo de conflictos (principio IV, ADR-009)

- **Decisión:**
  - Extensión `btree_gist` (es una extensión de confianza desde PostgreSQL 13: la crea el dueño de la
    base, `barberias_owner`, sin superusuario; Amazon RDS la admite).
  - En `appointment`, la columna generada `period tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED` y:
    - `appointment_no_overlap_barber EXCLUDE USING gist (tenant_id WITH =, barber_id WITH =, period WITH &&) WHERE (status IN ('PENDIENTE','CONFIRMADA'))`
    - `appointment_no_overlap_customer EXCLUDE USING gist (tenant_id WITH =, customer_id WITH =, period WITH &&) WHERE (status IN ('PENDIENTE','CONFIRMADA'))` (FR-033).
  - El rango semiabierto `[)` permite citas seguidas (10:00–10:30 y 10:30–11:00).
- **Mapeo:** el repositorio traduce el error `23P01` según el nombre de la restricción:
  `appointment_no_overlap_barber` → `HorarioNoDisponible` (409 `HORARIO_NO_DISPONIBLE`);
  `appointment_no_overlap_customer` → 409 `CITA_SOLAPADA_DEL_CLIENTE`. La inserción ocurre en la
  transacción del caso de uso. La verificación previa de reglas (FR-030) **no** sustituye a la
  restricción: solo da mensajes mejores.
- **Descartado:** comprobar en la aplicación y luego insertar; bloqueo con `SELECT … FOR UPDATE` del
  barbero (serializa todas las reservas de un barbero y aun así exige la restricción); bloqueos en
  Redis (principio VIII).

## R07. Hora local (Perú, UTC−5)

- **Decisión:**
  - **Almacenamiento:** todo instante es `timestamptz` (UTC). El horario de atención, la disponibilidad
    semanal y los tramos son `time` local con `weekday` (0 = domingo … 6 = sábado).
  - **Zona:** `tenant.timezone` (`varchar`, por defecto `'America/Lima'`); hoy solo se admite ese
    valor (supuesto de la especificación), pero ninguna regla lo da por fijo.
  - **Conversión:** un servicio `ZonaHoraria` en M06 (`shared/tiempo/`) convierte entre fecha y hora
    local e instante con `Intl.DateTimeFormat` (sin dependencias). El dominio trabaja con
    `FechaLocal` (`YYYY-MM-DD`) y minutos del día, sin conocer zonas.
  - **API:** la fecha de consulta es `YYYY-MM-DD` local; los instantes salen en ISO 8601 con
    desplazamiento (`2026-10-20T10:00:00-05:00`) y cada respuesta incluye `zonaHoraria`. La interfaz
    muestra la hora de la barbería con la etiqueta "hora de la barbería", nunca la del dispositivo.
  - **"Ahora":** sale del `Clock` del servidor (antelación, horas pasadas, momento de cálculo).
- **Por qué:** Perú no tiene horario de verano desde 1994, pero guardar instantes y convertir con la
  base de datos de zonas evita suposiciones si en el futuro hay barberías en otra zona.
- **Medianoche:** los tramos están dentro del día (`start_time < end_time`), así que en la práctica
  ninguna cita cruza la medianoche. El modelo lo admite igual (`tstzrange`), y la ocupación se lee
  por rango de instantes del día local.
- **Descartado:** guardar horas locales sin zona (ambiguo); un desplazamiento fijo `-05:00` en el
  código (frágil); dependencias de fechas (R01).

## R08. Cálculo de horarios libres

- **Decisión:** el caso de uso `ConsultarHorarios`, en el dominio `CalculadoraHorarios` (función
  pura), lo usan las dos vías (pública y autenticada). Para la fecha local `D` y el servicio `s` de
  duración `d`:
  1. **Barberos candidatos:** activos, con `s` asignado (o solo el barbero pedido).
  2. **Ventanas:** se intersecan los tramos de `working_hours` del barbero con los de
     `business_hours` de la barbería para el día de la semana de `D`.
  3. **Ocupación:** se restan los bloqueos (`time_off`) y las citas activas que tocan el día local
     (consulta por rango `[inicio de D, fin de D)` en instantes).
  4. **Candidatas:** horas de inicio en múltiplos de 15 minutos desde la medianoche local, donde
     `[inicio, inicio + d)` cabe entero en una ventana libre, el inicio es posterior a "ahora" y `D`
     está dentro del horizonte de 30 días.
  5. **Resultado:** por hora de inicio, la lista de barberos libres (si se pidió "cualquiera"), el
     instante de cálculo y la zona.
- **Costo:** 3 consultas por solicitud (catálogo del día, ocupación, barbería), acotadas a un día y a
  una barbería; el cálculo en memoria es O(barberos × tramos × 96 pasos). Para EQ-01 (50 consultas
  simultáneas, p95 ≤ 800 ms) la caché del catálogo llega con la funcionalidad 006 (ADR-029); en 002
  basta con índices por `(tenant_id, barber_id, starts_at)`.
- **Parámetros:** `HORARIOS_PASO_MINUTOS` = 15 y `RESERVA_HORIZONTE_DIAS` = 30, en `Configuracion`
  (M06), por validar con las barberías.
- **Reserva con "cualquiera":** la interfaz envía siempre un barbero concreto: el primero libre de la
  lista para esa hora. La reserva lo vuelve a validar (FR-030) y la restricción decide (R06).
- **Descartado:** guardar "turnos" precalculados (se desactualizan con cada bloqueo y no garantizan
  nada); calcular en SQL con `generate_series` (difícil de probar sin base de datos; el dominio debe
  probarse sin infraestructura).

## R09. Idempotencia de la reserva (FR-032)

- **Decisión:** encabezado obligatorio `Idempotency-Key` (UUID v4) en `POST /citas`. La interfaz lo
  genera **al abrir la confirmación** y lo reutiliza en cada reintento de esa misma confirmación.
  - En `appointment` se guardan `idempotency_key uuid` y `request_hash char(64)` (SHA-256 del cuerpo
    normalizado: barbero, servicio, inicio, cliente) con un índice único parcial
    `(tenant_id, created_by, idempotency_key)`.
  - **Flujo:** (1) se busca la clave del mismo autor; si existe y el hash coincide → **200** con la
    cita existente; si el hash difiere → 422 `IDEMPOTENCIA_CONFLICTO`. (2) Si no existe, se inserta.
    (3) Ante una violación de unicidad de la clave (dos reintentos simultáneos), se vuelve a buscar y
    se responde como en (1). (4) Ante `23P01` sin clave existente → 409.
  - La clave vive con la cita (sin purga ni tabla aparte). Una reserva cancelada y repetida con la
    misma clave devuelve la cita cancelada: la interfaz genera una clave nueva por cada intento de
    reservar.
- **Por qué:** la [API REST](../../docs/02-arquitectura-software/api-rest.md) ya define
  `Idempotency-Key` para la creación de citas; con la clave dentro de la misma fila, la idempotencia
  es atómica con la reserva y no necesita otra tabla ni Redis.
- **Descartado:** tabla genérica de claves con respuesta guardada (más código para un solo caso de
  uso); deduplicar por "mismo cliente, barbero e inicio" (no distingue un reintento de una segunda
  reserva legítima tras cancelar).

## R10. Estados, transiciones e historial (RF15)

- **Decisión:** códigos en español, como el resto del esquema de 001: `PENDIENTE`, `CONFIRMADA`,
  `COMPLETADA`, `NO_ASISTIO` y `CANCELADA` (`CHECK`). La entidad `Cita` aplica las transiciones de
  FR-041 y FR-042 y lanza `TransicionInvalida` (422 `TRANSICION_INVALIDA`). Toda cita nueva nace
  `CONFIRMADA` (FR-035a). Cada cambio, incluida la creación, inserta una fila en
  `appointment_status_history` en la misma transacción. Para cambiar el estado se bloquea la fila
  (`FOR UPDATE`): dos cambios simultáneos se atienden uno tras otro.
- **Marca de conflicto (FR-016, FR-005):** **no se guarda**: se calcula al leer la agenda, comparando
  cada cita activa con los bloqueos y con los tramos vigentes del día. Una columna se desactualizaría
  al borrar el bloqueo o al volver a ampliar el horario.
- **Cancelación tardía (FR-038):** `late_cancellation` se fija solo cuando cancela el cliente y
  `starts_at − ahora < antelación mínima`. `tenant.cancel_min_notice_minutes`: 120 por defecto,
  entre 0 y 4320 (72 h).
- **Documentación:** el diagrama de estados de
  [diseño interno](../../docs/03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md) usa
  códigos en inglés; se actualiza en el mismo cambio que el código.

## R11. Cambios que chocan con citas: confirmar en dos pasos (FR-005, FR-007, FR-011, FR-016)

- **Decisión:** las operaciones que pueden dejar citas activas "en conflicto" (crear un bloqueo,
  reducir el horario de atención o la disponibilidad, desactivar un servicio o un barbero) aceptan
  `confirmarConflictos: boolean`. Si es `false` y hay citas afectadas, responden 409
  `CONFLICTO_CON_CITAS` con la lista (id, inicio, barbero, servicio; sin datos del cliente para el
  barbero) y no guardan nada. Con `true`, guardan, registran `BLOQUEO_CON_CONFLICTO` o
  `CAMBIO_CON_CONFLICTO` en la auditoría y no tocan las citas. En la desactivación se informa la
  cantidad de citas.
- **Carrera:** si una reserva entra entre la advertencia y la confirmación, la cita aparece "en
  conflicto" en la agenda (la marca se calcula al leer). Nunca se pierde una cita sin aviso (caso
  límite de la especificación).
- **Descartado:** cancelar automáticamente (contradice HU09 y la especificación); impedir el bloqueo
  hasta mover las citas (el barbero no podría registrar una ausencia urgente).

## R12. Copia del servicio en la cita (FR-008)

- **Decisión:** `appointment` copia `service_name`, `price` y `duration_min` al reservar;
  `ends_at = starts_at + duration_min`. Editar o desactivar el servicio no cambia la cita.
- **Precio:** `numeric(10,2)` en soles, entre 0 y 99 999,99. La duración, en minutos entre 5 y 480,
  múltiplo de 5.

## R13. Límite de barberos del plan (FR-012)

- **Decisión:** M03 expone `obtenerLimiteBarberos(tenantId)` en su `index.ts`, igual que
  `obtenerLimiteUsuarios` en 001; `plan.max_barbers` ya existe (`TRIAL` = 5 en la semilla de la migración `0004`, por validar). Crear y
  reactivar barberos bloquea la fila de `subscription` (`FOR UPDATE`) mediante M03 dentro de la
  transacción, como el límite de usuarios de 001, así que las operaciones simultáneas respetan el
  límite.

## R14. Cliente presencial y consentimiento (FR-035, FR-024)

- **Decisión:** `customer_profile.user_id` admite `NULL` (cliente presencial). El alta exige nombre,
  teléfono y `consentimientoVerbal: true`. Guarda un `consent_record` con `method = 'PRESENCIAL'` y
  `recorded_by` = propietario. El registro en línea guarda `method = 'EN_LINEA'` y la IP. La versión
  del texto se valida en el servidor contra la vigente (`POLITICA_DATOS_VERSION`, como en 001).
- Índice único parcial `(tenant_id, user_id) WHERE user_id IS NOT NULL`: un perfil por cuenta y
  barbería. Los perfiles presenciales no se unen solos a una cuenta creada después (supuesto de la
  especificación).
- El propietario busca clientes de su barbería por nombre o teléfono (`GET /clientes?buscar=`), para
  elegirlos en la cita presencial.

## R15. Datos y enlace de la barbería (RF03)

- **Decisión:** `tenant` gana `address`, `phone`, `description`, `timezone` y
  `cancel_min_notice_minutes`. El horario de atención va en `business_hours` (con tenant y RLS), del
  submódulo `catalogo` de M02 (R05).
- **Protección de `tenant`:** sigue siendo global (la leen la autenticación y la vía pública), pero
  ahora la aplicación puede modificarla. Por eso se activa RLS con `FORCE` y tres políticas:
  - `SELECT USING (true)`.
  - `INSERT WITH CHECK (true)`, para el registro de 001.
  - `UPDATE USING (id = tenant actual) WITH CHECK (id = tenant actual)`.

  Así un error de código no puede modificar otra barbería. `GRANT UPDATE` solo sobre las columnas
  editables.

- **Enlace (`slug`):** se mantiene el que 001 ya genera al registrar (`UNIQUE`). El propietario puede
  cambiarlo: 3–60 caracteres `[a-z0-9-]`, sin guion al inicio ni al final, fuera de una lista de
  palabras reservadas (`api`, `publico`, `admin`, `ingresar`, `registro`…). El anterior deja de
  funcionar (sin historial ni redirección) y se audita `ENLACE_CAMBIADO`.
- **Horario de atención:** se reemplaza la semana completa (`PUT`) en una transacción. El dominio
  valida `inicio < fin` y que no haya solapes por día.

## R16. Agenda e historial (RF16, RF17)

- **Decisión:**
  - **Agenda:** `GET /agenda?fecha=YYYY-MM-DD&barbero=`. El propietario ve toda la barbería; el
    barbero, solo el barbero vinculado a su usuario (si pasa otro `barbero` → 403). Devuelve las citas
    del día local ordenadas por inicio, con las marcas calculadas (R10) y nombre y teléfono del cliente
    vía `ClientesApi` en lote (sin N+1).
  - **Historial:** `GET /clientes/yo/citas?pagina=&tamano=`, ordenado por inicio descendente,
    paginación simple (línea de corte: sin filtros).
- **Línea de corte:** lista por fecha, sin vista de calendario.

## R17. Frontend

- **Rutas públicas:**
  - `/b/:slug` (catálogo y horarios).
  - `/b/:slug/registro`.
  - `/b/:slug/ingresar` (también para unirse).
  - `/b/:slug/reservar`, que exige sesión de cliente en esa barbería: si la sesión es de otra, llama
    a `POST /auth/barberia`.
- **Panel del personal:** `Barbería` (datos, enlace, horario, antelación), `Servicios`, `Barberos`
  (con servicios y vínculo), `Disponibilidad` (semana y bloqueos), `Agenda`, `Clientes` (búsqueda y
  alta presencial).
- **Cliente:** `Mis citas` (historial y cancelar).
- Todas las pantallas nuevas se cargan con `React.lazy` (ADR-018). El catálogo público debe ser
  liviano: una sola solicitud para el catálogo y otra por fecha consultada.
- **Estado:** la confirmación de reserva conserva la `Idempotency-Key` mientras el usuario no cambie
  la selección (R09). Si la respuesta es `HORARIO_NO_DISPONIBLE`, se vuelven a pedir los horarios
  del día.

## R18. Pruebas

- **PR16 (obligatoria, EQ-16):** prueba de integración con Testcontainers.
  - Levanta **dos instancias** de la aplicación Nest en el mismo proceso, cada una con su propio
    pool, sobre la misma base (simula dos réplicas).
  - Siembra un barbero y una hora libre, y crea 200 sesiones de cliente distintas.
  - Lanza 200 `POST /citas` simultáneos (`Promise.all`), repartidos entre las dos instancias, sobre
    el mismo barbero e inicio.
  - **Verifica:** exactamente 1 respuesta 201, 199 respuestas 409 `HORARIO_NO_DISPONIBLE`, 0
    respuestas 5xx, y en la base exactamente 1 cita activa para ese barbero y rango.
  - **Variantes:** rangos que se solapan parcialmente (10:00 con 30 min y 10:15 con 30 min); el
    mismo cliente con dos barberos (restricción del cliente); 50 reintentos simultáneos con la misma
    `Idempotency-Key` → 1 cita, todas las respuestas con la misma cita.
- **PR09 (aislamiento):**
  - Se amplía `endpoints-protegidos.ts` con cada operación nueva (identificadores de B con el token
    de A → 404).
  - **Cliente con membresía en A y B:** con el token de A no ve citas, perfil ni historial de B.
  - **Selector:** un `slug` de B en una operación autenticada con el token de A no cambia la barbería.
  - **Cambio de barbería:** sin membresía ni aceptación, no emite sesión.
  - **RLS** en las tablas nuevas; RLS de `UPDATE` en `tenant`.
  - **Vía pública:** las 6 pruebas de ADR-021 (permisos exactos del rol, columnas privadas que fallan,
    filas de otro tenant, escritura imposible, datos canario en HTTP, `slug` inexistente o suspendido
    con la misma respuesta).
  - **Funciones de ADR-015:** `auth_resolver_cuenta` sigue devolviendo como máximo una fila con
    cuentas de cliente de varias barberías.
- **PR14 (arquitectura):** reglas nuevas en `.dependency-cruiser.cjs`:
  - `matriz-m01`: M01 no importa M02.
  - `matriz-m02`: M02 solo puede importar M01, M03 y M06, por su `index`.
  - `pool-publico-solo-en-catalogo`: solo `catalogo-citas/catalogo/infrastructure/publico/` importa
    el pool público.
  - El dominio de M02 sigue sin frameworks.
  - El fixture de pruebas de arquitectura gana casos que deben fallar.
- **PR08:** la matriz de [contracts/rbac.md](contracts/rbac.md) se convierte en casos parametrizados.
  `Permisos` de M02 y los `@Roles` de las rutas deben coincidir con ella.
- **Dominio sin infraestructura:** `CalculadoraHorarios` (ventanas, bloqueos, citas, paso, "ahora",
  horizonte), `Cita` (transiciones, tiempos, cancelación tardía), `RangoHorario`, `HorarioSemanal`
  (solapes), `Servicio`, `Slug`, `ZonaHoraria` (conversiones de Lima, fin de mes y de año).
- **Contrato:** HTTP contra [contracts/openapi.yaml](contracts/openapi.yaml).
- **Rendimiento:** SC-004 y SC-005 (EQ-01 y EQ-02) se miden con la prueba de carga de la
  funcionalidad 006. En 002 solo hay una prueba de humo que comprueba que los horarios libres de un
  día con 5 barberos y 60 citas se calculan en menos de 200 ms en la integración.
- **Frontend:** Vitest + MSW (catálogo público, registro con consentimiento, reserva con 409 y
  reintento idempotente, agenda, cancelación tardía); axe-core en las pantallas nuevas.

## R19. Auditoría (FR-050)

- **Decisión:** acciones nuevas en `audit_log`:
  - Clientes: `CLIENTE_REGISTRADO`, `CLIENTE_UNIDO`, `CLIENTE_PRESENCIAL_REGISTRADO`.
  - Sesión: `BARBERIA_CAMBIADA`.
  - Barbería y catálogo: `ENLACE_CAMBIADO`, `SERVICIO_DESACTIVADO`, `BARBERO_DESACTIVADO`.
  - Conflictos: `BLOQUEO_CON_CONFLICTO`, `CAMBIO_CON_CONFLICTO`.
  - Citas: `CITA_CANCELADA`, `CITA_ESTADO_CAMBIADO`.
  - Seguridad: `ACCESO_DENEGADO_ROL` (ya existe).

  `resource` lleva solo identificadores (`cita:<id>`), sin datos personales. La lectura pública no se
  audita (sin datos personales; el límite de solicitudes cubre el abuso).

## R20. Líneas de corte (backlog §3.2) aplicadas al diseño

| Orden | Recorte si hay atraso                          | Qué queda listo igual                                                                                                         |
| ----- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1     | Agenda como lista por fecha, sin calendario    | Diseño ya planteado como lista (R16)                                                                                          |
| 2     | Bloqueos solo por fecha y hora, sin repetición | `time_off` solo guarda rangos sueltos; no hay bloqueos recurrentes en el modelo                                               |
| 3     | Historial sin filtros ni paginación avanzada   | Paginación simple (R16)                                                                                                       |
| 4     | Acabado visual de las pantallas nuevas         | Componentes de ADR-016 sin piezas nuevas                                                                                      |
| Nunca | —                                              | `EXCLUDE` + PR16; vía pública con `barberias_publico` y sus pruebas; token por barbería; PR09; PR14; ADR antes de implementar |

Orden de trabajo para proteger lo que nunca se recorta:

1. Migraciones de citas con `EXCLUDE` y PR16 (día 1).
2. Vía pública y sus pruebas (día 2).
3. Cuenta de cliente (día 3).
4. Reserva, cancelación y estados (día 4).
5. Agenda, historial y pantallas (días 5 y 6).
