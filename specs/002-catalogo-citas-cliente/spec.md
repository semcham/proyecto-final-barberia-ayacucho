# Feature Specification: Catálogo, citas y cuenta de cliente

**Feature Branch**: `002-catalogo-citas-cliente`

**Created**: 2026-10-16

**Status**: Draft

**Input**: User description: "Funcionalidad 002: Catálogo, citas y cuenta de cliente (módulos M02 y M01). Alcance: RF03, RF05, RF07, RF08, RF09, RF10, RF11, RF12, RF14, RF15, RF16 y RF17. Que el propietario configure servicios, barberos y disponibilidad con bloqueos; que cualquier persona vea el catálogo y los horarios libres de una barbería por su enlace, sin iniciar sesión; que un cliente se registre con consentimiento, reserve, cancele y vea su historial; y que la barbería vea su agenda por barbero y por fecha, con transiciones de estado válidas. Decisiones ya tomadas: cuenta de cliente con una membresía CLIENTE por barbería y credencial por barbería; lecturas públicas por enlace solo de catálogo y horarios libres; nunca dos citas activas del mismo barbero en el mismo horario, con prueba de 200 solicitudes simultáneas; cancelación tardía y estados según RF14 y RF15."

**Trazabilidad**: HU03, HU06–HU11, HU13–HU16 → RF03, RF05, RF07–RF12, RF14–RF17 → EQ-01, EQ-02, EQ-08, EQ-09, EQ-16, EQ-18 → ADR-003, ADR-009, ADR-010; por escribir antes de implementar: ADR-020 (cuenta de cliente con membresía y credencial por barbería) y ADR-021 (lecturas públicas por enlace) → M02 Catálogo y citas; M01 Acceso y barberías (datos de la barbería y cuenta de cliente) → PR08, PR09, PR15, PR16, PR24.

## Clarifications

### Session 2026-10-17

Decisiones provisionales tomadas con la opción recomendada, porque el responsable pidió continuar sin elegir. Pueden revertirse antes de `/speckit-plan`.

- Q: ¿Cómo se identifica al cliente de una cita presencial que llega sin cuenta? → A: El propietario lo registra como cliente presencial de su barbería, con nombre y teléfono (correo opcional) y constancia de su consentimiento verbal; queda sin cuenta ni sesión y no se une automáticamente a una cuenta creada después (FR-035).
- Q: ¿En qué estado nace una reserva? → A: Confirmada directamente; el estado pendiente queda definido, pero ningún flujo de 002 lo usa (FR-035a).

**Reutiliza de la funcionalidad 001** (no se repite aquí): registro de la barbería y prueba gratuita, inicio y cierre de sesión con renovación y período de gracia, límite de intentos, usuarios del personal (propietario y barbero), aislamiento por barbería en varias barreras, auditoría y validación de entradas. Lo que esta funcionalidad agrega a esas piezas se indica en cada requisito.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - El propietario prepara su barbería para recibir reservas (Priority: P1)

El propietario completa los datos comerciales y el horario de atención de su barbería, registra sus servicios con precio y duración, da de alta a los barberos que atienden (él mismo puede ser uno), les asigna servicios y define la disponibilidad semanal de cada uno. Cuando un barbero tiene un descanso o una ausencia, se registra un bloqueo (HU03, HU07, HU08, HU09).

**Why this priority**: Sin servicios, barberos ni disponibilidad no hay nada que mostrar ni reservar. Es la base de las demás historias de esta funcionalidad.

**Independent Test**: Con la sesión del propietario de una barbería recién registrada, configurar datos y horario de atención, dos servicios, dos barberos con servicios asignados, su disponibilidad semanal y un bloqueo; comprobar que todo queda guardado en su barbería y que los datos inválidos se rechazan.

**Acceptance Scenarios**:

1. **Given** un propietario con sesión iniciada, **When** guarda el nombre comercial, la dirección, el teléfono de la barbería y un horario de atención con apertura anterior al cierre para cada día abierto, **Then** los datos quedan guardados y la barbería tiene un enlace público propio.
2. **Given** un horario de atención con cierre anterior o igual a la apertura, o con tramos que se solapan en el mismo día, **When** se intenta guardar, **Then** se rechaza indicando el día y el tramo a corregir.
3. **Given** el propietario, **When** crea un servicio con nombre, precio mayor o igual a 0 y duración mayor que 0, **Then** el servicio queda activo en el catálogo de su barbería; con precio negativo o duración 0 se rechaza.
4. **Given** el propietario, **When** crea un barbero con su nombre visible, le asigna servicios y lo vincula opcionalmente a un usuario de su barbería, **Then** el barbero queda activo y solo ofrece los servicios asignados.
5. **Given** una barbería que alcanzó el límite de barberos activos de su plan o de la prueba gratuita, **When** el propietario intenta crear o reactivar otro barbero, **Then** se rechaza indicando que se alcanzó el límite del plan.
6. **Given** un barbero con usuario vinculado, **When** define su disponibilidad semanal dentro del horario de atención de la barbería, **Then** se guarda; si queda fuera de ese horario o si intenta cambiar la disponibilidad de otro barbero, se rechaza.
7. **Given** un barbero sin citas en una franja, **When** el barbero o el propietario registra un bloqueo en esa franja, **Then** esa franja deja de aparecer como libre de inmediato.
8. **Given** un barbero con citas activas dentro de la franja que se quiere bloquear, **When** se registra el bloqueo, **Then** el sistema advierte el conflicto mostrando las citas afectadas y pide confirmar. Si se confirma, el bloqueo se guarda, las citas **no** se cancelan solas y quedan señaladas "en conflicto" en la agenda para que el propietario decida.

---

### User Story 2 - Cualquier persona ve el catálogo y los horarios libres por el enlace (Priority: P1)

Una persona recibe el enlace de una barbería (por WhatsApp, redes o un cartel) y, sin crear cuenta ni iniciar sesión, ve los servicios con precio y duración, los barberos y los horarios realmente libres para el servicio, el barbero y la fecha que elija (HU10).

**Why this priority**: Es lo que convierte el catálogo en reservas: el cliente decide antes de registrarse. RF10 exige verlo sin autenticación.

**Independent Test**: Con una barbería configurada, abrir su enlace sin sesión, consultar servicios, barberos y horarios libres de una fecha, y verificar que coinciden con disponibilidad, bloqueos y citas existentes, y que la respuesta no contiene ningún dato personal.

**Acceptance Scenarios**:

1. **Given** una barbería activa con servicios y barberos activos, **When** un visitante sin sesión abre su enlace, **Then** ve el nombre comercial, la dirección, el teléfono y el horario de atención de la barbería, los servicios activos con nombre, precio y duración, y los barberos activos con su nombre visible y los servicios que ofrecen.
2. **Given** un servicio, una fecha y opcionalmente un barbero, **When** el visitante consulta los horarios libres, **Then** solo ve horas de inicio en las que el servicio completo cabe dentro de la disponibilidad del barbero, fuera de bloqueos y sin solaparse con citas activas, junto con el momento en que se calcularon.
3. **Given** cualquier consulta por el enlace público, **When** se revisa la respuesta, **Then** no contiene nombres, correos ni teléfonos de clientes, ni correos, teléfonos o identificadores de cuenta del personal, ni motivos de bloqueos, ni qué cliente ocupa una hora.
4. **Given** un servicio o barbero desactivado, **When** se consulta el catálogo público, **Then** no aparece y no se ofrecen horarios para él.
5. **Given** un enlace que no existe o una barbería suspendida por la plataforma, **When** se abre, **Then** se muestra "barbería no disponible", con la misma respuesta en ambos casos.
6. **Given** el enlace público, **When** alguien intenta crear, modificar o borrar cualquier dato por esa vía, **Then** se rechaza: la vía pública es solo de lectura.

---

### User Story 3 - El cliente se registra con consentimiento y reserva sin duplicados (Priority: P1)

Desde el enlace de la barbería, el cliente crea su cuenta con datos mínimos y acepta el tratamiento de sus datos; luego elige servicio, barbero, fecha y hora libre, y obtiene la confirmación de su cita. Si dos personas intentan la misma hora del mismo barbero, solo una la consigue (HU06, HU11).

**Why this priority**: Es el flujo de valor principal del producto, y la garantía de no duplicar citas es un principio no negociable (constitución, principio IV).

**Independent Test**: Registrar un cliente con consentimiento desde el enlace de una barbería, reservar una hora libre, comprobar la confirmación y que esa hora deja de estar libre. Lanzar 200 solicitudes simultáneas de reserva para el mismo barbero y la misma hora, y comprobar que existe exactamente una cita activa.

**Acceptance Scenarios**:

1. **Given** un visitante en el enlace de una barbería, **When** se registra con nombre, correo, teléfono y contraseña y acepta expresamente la política de tratamiento de datos, **Then** se crea su cuenta de cliente con su membresía de cliente en esa barbería, queda registrado su consentimiento con fecha, hora y versión del texto, e inicia sesión en esa barbería.
2. **Given** el formulario de registro, **When** el visitante no acepta la política de datos, **Then** el registro no se completa y no se guarda ningún dato suyo.
3. **Given** una persona que ya tiene cuenta de cliente en la barbería A, **When** entra al enlace de la barbería B, inicia sesión y acepta la política de datos para B, **Then** se crea su membresía de cliente en B sin crear otra cuenta, y su sesión queda en B.
4. **Given** un cliente con sesión en una barbería, **When** reserva un servicio activo con un barbero que lo ofrece en una hora libre, **Then** se crea la cita y ve la confirmación con barbería, servicio, barbero, fecha, hora, precio y estado.
5. **Given** 200 solicitudes de reserva simultáneas del mismo barbero en la misma hora, **When** se procesan, **Then** exactamente una cita queda activa y las otras 199 reciben "horario no disponible", sin errores técnicos.
6. **Given** una hora que estaba libre al consultarla pero fue tomada antes de confirmar, **When** el cliente confirma, **Then** recibe "horario no disponible" y se le invita a elegir otra hora; no se crea ninguna cita.
7. **Given** una solicitud de reserva que el cliente reenvía porque no recibió la respuesta (red lenta o doble toque), **When** llega por segunda vez, **Then** no se crea una segunda cita y el cliente ve la cita ya creada.
8. **Given** una hora pasada, fuera de la disponibilidad del barbero, dentro de un bloqueo, con un servicio inactivo o con un barbero que no ofrece ese servicio, **When** se intenta reservar, **Then** se rechaza con el motivo, sin crear la cita.

---

### User Story 4 - La barbería ve su agenda y lleva el estado de las citas (Priority: P2)

El propietario ve la agenda de toda la barbería por fecha y puede filtrarla por barbero; cada barbero ve solo la suya. Al terminar un servicio, el barbero lo marca como completado, o como "no asistió" si el cliente no llegó. Solo se permiten cambios de estado válidos, y queda registrado quién hizo cada uno (HU14, HU15).

**Why this priority**: Reemplaza el cuaderno o el WhatsApp como agenda. Depende de que existan citas (P1).

**Independent Test**: Con citas de dos barberos, verificar que el propietario ve ambas agendas y el barbero solo la suya; marcar una cita como completada y otra como no asistió, e intentar transiciones inválidas, que deben rechazarse.

**Acceptance Scenarios**:

1. **Given** citas de varios barberos en una fecha, **When** el propietario consulta la agenda de esa fecha, **Then** ve todas las citas de su barbería, ordenadas por hora, con servicio, barbero, cliente, estado y las marcas de cancelación tardía o de conflicto con un bloqueo; puede filtrarlas por barbero.
2. **Given** un barbero con usuario vinculado, **When** consulta su agenda, **Then** ve solo sus citas y ninguna de otro barbero.
3. **Given** una cita confirmada cuya hora de inicio ya llegó, **When** su barbero o el propietario la marca como completada o como no asistió, **Then** el estado cambia y queda registrado quién lo cambió y cuándo.
4. **Given** una cita completada, no asistida o cancelada, **When** alguien intenta cambiar su estado, **Then** se rechaza como transición no válida.
5. **Given** una cita confirmada cuya hora de inicio todavía no llega, **When** se intenta marcarla como completada o como no asistió, **Then** se rechaza.
6. **Given** el propietario, **When** registra una cita presencial para alguien que llegó sin reserva, **Then** se aplican las mismas reglas que a una reserva del cliente, incluida la de no duplicar horarios, y la cita nace confirmada.
7. **Given** una persona sin cuenta que llega a la barbería, **When** el propietario la registra con nombre y teléfono y deja constancia de su consentimiento verbal, **Then** queda como cliente presencial de esa barbería y puede elegirse en la cita; sin la constancia de consentimiento, el registro se rechaza.

---

### User Story 5 - El cliente cancela su cita (Priority: P2)

El cliente que no podrá ir cancela su cita y el horario queda libre de inmediato para otra persona. Cancelar siempre es posible antes de la hora de la cita; si lo hace con menos antelación que la mínima que fijó la barbería, la cita queda marcada como cancelación tardía y el propietario lo ve (HU13).

**Why this priority**: Libera horarios que de otro modo se pierden y da información al propietario sobre clientes que cancelan tarde. Depende de la reserva (P1).

**Independent Test**: Reservar dos citas, cancelar una con antelación suficiente y otra con menos antelación que la mínima; comprobar que ambas horas vuelven a estar libres de inmediato y que solo la segunda queda marcada como tardía.

**Acceptance Scenarios**:

1. **Given** una cita activa del cliente con más antelación que la mínima de la barbería, **When** la cancela, **Then** queda cancelada, sin marca de tardía, y la hora vuelve a aparecer libre de inmediato.
2. **Given** una cita activa del cliente con menos antelación que la mínima, **When** la cancela, **Then** la cancelación se acepta, la cita queda marcada como cancelación tardía y el propietario lo ve en su agenda.
3. **Given** una cita cuya hora de inicio ya pasó, **When** el cliente intenta cancelarla, **Then** se rechaza: su estado lo resuelve la barbería (completada o no asistió).
4. **Given** una cita de otro cliente, **When** un cliente intenta cancelarla, **Then** se rechaza como si la cita no existiera.
5. **Given** el propietario, **When** cancela una cita activa de su barbería, **Then** queda cancelada, se registra quién la canceló y no se marca como tardía para el cliente.

---

### User Story 6 - El cliente consulta su historial (Priority: P3)

El cliente revisa las citas que tuvo y tiene en la barbería en la que está, con el estado final de cada una (HU16).

**Why this priority**: Aporta comodidad y confianza, pero el negocio funciona sin ella. Depende de la reserva (P1).

**Independent Test**: Con un cliente que tiene citas en distintos estados en una barbería, y otro cliente con citas en la misma barbería, verificar que el primero ve solo las suyas, ordenadas por fecha y con su estado.

**Acceptance Scenarios**:

1. **Given** un cliente con citas completadas, canceladas, no asistidas y próximas, **When** consulta su historial, **Then** ve solo sus citas en esa barbería, ordenadas por fecha, con servicio, barbero, fecha, hora y estado final.
2. **Given** un cliente con membresía en dos barberías, **When** consulta su historial con la sesión de la barbería A, **Then** ve solo sus citas de A; para ver las de B debe cambiar a B.

---

### Edge Cases

**Zonas horarias**

- Todas las horas de la barbería (horario de atención, disponibilidad, bloqueos, citas y agenda) se expresan en la hora local de la barbería, y cada fecha se corta a medianoche local. Un cliente cuyo dispositivo está en otra zona horaria ve las horas en la hora de la barbería, indicada como tal, y reserva exactamente la hora que vio.
- Como el horario de atención y la disponibilidad se definen en tramos dentro de un mismo día, ninguna cita puede cruzar la medianoche local. Si en el futuro se admitieran tramos nocturnos, la ocupación ya se calcula por instantes y no por días, así que la regla de no duplicar seguiría valiendo.
- El momento de cálculo de los horarios libres y la regla de antelación de la cancelación se evalúan con la hora actual del servidor, no con el reloj del dispositivo del cliente.

**Bloqueos y cambios de horario que chocan con citas ya reservadas**

- Un bloqueo que se solapa con citas activas no se guarda sin confirmación explícita. Al confirmarlo, las citas siguen activas, se señalan "en conflicto" en la agenda y el propietario decide si las cancela; en esta funcionalidad no se reprograman (la reprogramación es RF13, funcionalidad 004).
- Un barbero que bloquea su propia franja con citas solo puede confirmar el bloqueo, no cancelar las citas; esas citas quedan visibles en conflicto para el propietario.
- Reducir el horario de atención de la barbería o la disponibilidad de un barbero cuando hay citas activas fuera del nuevo horario: el cambio no modifica esas citas; antes de guardar se muestran las citas afectadas, y si se confirma, quedan "en conflicto" igual que con un bloqueo.

**Servicio o barbero desactivado con citas futuras**

- Desactivar un servicio con citas futuras activas: se informa cuántas tiene antes de confirmar. Las citas existentes se mantienen con el nombre, el precio y la duración que tenían al reservar; el servicio deja de aparecer en el catálogo y no acepta reservas nuevas.
- Cambiar el precio o la duración de un servicio no altera las citas ya reservadas.
- Desactivar un barbero con citas futuras activas: igual que con un servicio. El barbero sale del catálogo, conserva su historial y sus citas existentes siguen en la agenda para que el propietario las atienda o cancele.
- Desactivar al usuario vinculado a un barbero (funcionalidad 001) no desactiva al barbero del catálogo; el propietario decide si lo desactiva también.
- Un servicio sin ningún barbero activo que lo ofrezca aparece en el catálogo sin horarios libres.

**Cliente con la misma cuenta en dos barberías**

- La persona tiene una sola cuenta (un correo, una contraseña) y una membresía de cliente en cada barbería donde se unió, con su consentimiento registrado en cada una.
- Su sesión siempre corresponde a una sola barbería. Para operar en otra, el sistema emite una sesión nueva para esa barbería solo después de comprobar que tiene membresía allí; nunca acepta que la barbería venga en la solicitud.
- Cada barbería ve solo el perfil y las citas del cliente en esa barbería; no sabe en qué otras barberías está.
- Si intenta registrarse otra vez con el mismo correo desde el enlace de otra barbería, se le indica que ya tiene cuenta y que inicie sesión para unirse, sin revelar en qué barberías está.
- Si inicia sesión en el enlace de una barbería donde no tiene membresía, se le ofrece unirse aceptando la política de datos de esa barbería; sin aceptarla, no se crea la membresía.

**Otros**

- Dos clientes confirman la última hora libre al mismo tiempo: uno obtiene la cita; el otro recibe "horario no disponible".
- Un mismo cliente intenta dos citas que se solapan en la misma barbería (con barberos distintos): se rechaza la segunda.
- La reserva llega justo cuando el propietario confirma un bloqueo en esa franja: o se crea la cita y el bloqueo se advierte como en conflicto, o se guarda el bloqueo y la reserva se rechaza; nunca ambos sin aviso.
- El correo de un usuario del personal no puede usarse para una cuenta de cliente en esta funcionalidad (ver Supuestos).
- Un cliente presencial que después crea su cuenta en la misma barbería queda como un perfil nuevo; sus citas presenciales anteriores no pasan a su historial en línea (ver Supuestos).
- Un cliente presencial no tiene sesión: no puede cancelar ni ver su historial por la plataforma; sus citas las cancela el propietario.
- El enlace público se cambia: el enlace anterior deja de funcionar y responde "barbería no disponible".
- Las entradas con scripts o longitudes excesivas en nombres, descripciones, motivos de bloqueo o datos del cliente se rechazan con mensaje controlado y no se ejecutan.

## Requirements _(mandatory)_

### Functional Requirements

**Datos y horario de la barbería (RF03)**

- **FR-001**: El sistema MUST permitir al propietario editar los datos comerciales de su barbería: nombre comercial, dirección, teléfono de contacto de la barbería y descripción breve opcional.
- **FR-002**: El sistema MUST permitir al propietario definir el horario de atención semanal, con uno o más tramos por día y días cerrados. Cada tramo MUST tener apertura anterior al cierre y los tramos del mismo día MUST NOT solaparse.
- **FR-003**: Cada barbería MUST tener un enlace público único entre todas las barberías, generado automáticamente a partir de su nombre comercial (también para las ya registradas en la funcionalidad 001). El propietario MUST poder cambiarlo por otro disponible y con formato válido; el anterior deja de funcionar.
- **FR-004**: El sistema MUST permitir al propietario configurar la antelación mínima de cancelación de su barbería (ver FR-038).
- **FR-005**: Un cambio de horario de atención que deja citas activas fuera del nuevo horario MUST NOT modificar esas citas. El sistema MUST mostrar las citas afectadas antes de guardar y, si el propietario confirma, señalarlas "en conflicto" en la agenda.

**Servicios (RF07)**

- **FR-006**: El sistema MUST permitir al propietario crear y editar servicios con nombre (único entre los servicios de su barbería), precio en soles mayor o igual a 0, duración en minutos mayor que 0 y descripción opcional, y activarlos o desactivarlos. Los servicios con citas MUST NOT poder eliminarse; solo desactivarse.
- **FR-007**: Un servicio inactivo MUST NOT aparecer en el catálogo público ni aceptar reservas nuevas. Al desactivar un servicio con citas futuras activas, el sistema MUST informar cuántas tiene, y esas citas MUST mantenerse.
- **FR-008**: Cada cita MUST conservar el nombre, el precio y la duración que tenía el servicio al reservarla; los cambios posteriores del servicio MUST NOT alterarla.

**Barberos (RF08)**

- **FR-009**: El sistema MUST permitir al propietario crear y editar barberos con un nombre visible y, opcionalmente, vincular cada barbero a un usuario de su barbería (con rol barbero o el propio propietario). Un usuario MUST estar vinculado a lo sumo a un barbero.
- **FR-010**: El sistema MUST permitir al propietario asignar y quitar servicios a cada barbero. Un barbero MUST ofrecer solo los servicios que tiene asignados.
- **FR-011**: El sistema MUST permitir desactivar y reactivar barberos. Desactivar MUST conservar su historial, sacarlo del catálogo y de los horarios libres, y mantener sus citas futuras existentes, informando cuántas tiene.
- **FR-012**: El sistema MUST rechazar la creación o reactivación de barberos cuando la barbería alcanzó el límite de barberos activos de su plan o de la prueba gratuita, también ante operaciones simultáneas.

**Disponibilidad y bloqueos (RF09)**

- **FR-013**: El sistema MUST permitir definir la disponibilidad semanal de cada barbero, con uno o más tramos por día, cada uno con inicio anterior al fin, sin solaparse y dentro del horario de atención de la barbería.
- **FR-014**: El barbero con usuario vinculado MUST poder definir solo su propia disponibilidad y sus propios bloqueos; el propietario MUST poder hacerlo para cualquier barbero de su barbería.
- **FR-015**: El sistema MUST permitir registrar bloqueos de un barbero por rango de fecha y hora, con un motivo opcional que solo ve la barbería, y eliminarlos.
- **FR-016**: Un bloqueo que se solapa con citas activas MUST requerir confirmación explícita tras mostrar las citas afectadas. Al confirmarse, las citas MUST seguir activas y quedar señaladas "en conflicto" en la agenda; el sistema MUST NOT cancelarlas automáticamente.
- **FR-017**: Los cambios de disponibilidad y bloqueos MUST reflejarse en los horarios libres desde la consulta siguiente.

**Catálogo público y horarios libres (RF10, RF11)**

- **FR-018**: Cualquier persona sin sesión MUST poder consultar, mediante el enlace público de una barbería activa, el nombre comercial, la dirección, el teléfono y el horario de atención de la barbería, los servicios activos (nombre, precio, duración y descripción) y los barberos activos (nombre visible y servicios que ofrecen).
- **FR-019**: La consulta por enlace público MUST ser de solo lectura y MUST limitarse a los datos de FR-018 y a los horarios libres. MUST NOT devolver datos personales de clientes, correos, teléfonos ni identificadores de cuenta del personal, motivos de bloqueos ni la identidad de quien ocupa una hora. La barbería identificada por el enlace MUST NOT usarse en ninguna operación **de negocio** con sesión; con sesión, el enlace solo se admite para la selección de membresía (FR-025, FR-026) (constitución 1.2.0, principio III; ADR-020, ADR-021).
- **FR-020**: El sistema MUST calcular los horarios libres para un servicio y una fecha, con un barbero concreto o con cualquier barbero que ofrezca el servicio. Una hora de inicio es libre solo si el servicio completo cabe dentro de la disponibilidad del barbero y del horario de atención, no se solapa con bloqueos ni con citas activas, es posterior al momento actual y está dentro del horizonte de reserva.
- **FR-021**: La respuesta de horarios libres MUST indicar el momento en que se calculó y que las horas están en la hora local de la barbería. Mostrar una hora como libre MUST NOT reservarla.
- **FR-022**: Un enlace inexistente, el enlace anterior a un cambio y el de una barbería suspendida por la plataforma MUST recibir la misma respuesta de "barbería no disponible".

**Cuenta de cliente (RF05)**

- **FR-023**: El sistema MUST permitir a un visitante registrarse como cliente desde el enlace de una barbería con nombre, correo, teléfono y contraseña, y con la aceptación expresa de la política de tratamiento de datos. Sin esa aceptación, el registro MUST NOT completarse ni guardar datos.
- **FR-024**: El sistema MUST conservar la evidencia del consentimiento: persona, barbería, versión del texto aceptado, fecha y hora, y cómo se obtuvo (aceptado por el cliente en línea o anotado por el propietario en un registro presencial, con quién lo anotó).
- **FR-025**: Un correo MUST identificar una sola cuenta. Una persona con cuenta de cliente MUST poder unirse a otra barbería iniciando sesión y aceptando la política de datos de esa barbería, lo que crea su membresía de cliente allí sin crear otra cuenta. El registro con un correo ya existente MUST rechazarse invitando a iniciar sesión, sin revelar en qué barberías está.
- **FR-026**: La sesión del cliente MUST corresponder a una sola barbería, la que elige al iniciar sesión desde su enlace. Para operar en otra barbería, el sistema MUST emitir una sesión nueva solo tras comprobar que tiene membresía en ella. En toda operación con sesión, la barbería MUST salir de la credencial firmada (ADR-020).
- **FR-027**: Las reglas de sesión de la funcionalidad 001 (credencial de vida corta, renovación con período de gracia, cierre de sesión, límite de intentos, mensajes genéricos) MUST aplicarse también a los clientes.
- **FR-028**: Cada barbería MUST ver solo el perfil y las citas de sus propios clientes, sin saber de sus membresías en otras barberías.

**Reservas (RF12)**

- **FR-029**: El sistema MUST permitir a un cliente con sesión reservar una cita eligiendo servicio, barbero y hora de inicio; la hora de fin MUST ser la de inicio más la duración del servicio.
- **FR-030**: Antes de crear la cita, el sistema MUST verificar que el servicio y el barbero están activos, que el barbero ofrece ese servicio y que la hora cumple las condiciones de FR-020.
- **FR-031**: El sistema MUST garantizar que nunca existan dos citas activas (pendiente o confirmada) del mismo barbero con horarios que se solapen, incluso con muchas solicitudes simultáneas y con varias instancias del sistema. La garantía MUST imponerla el almacenamiento de datos de forma atómica, no la interfaz ni una comprobación previa (constitución, principio IV). La solicitud que pierde MUST recibir "horario no disponible".
- **FR-032**: Si se repite la misma solicitud de reserva (reintento por red lenta o doble envío), MUST NOT crearse una segunda cita y MUST devolverse la ya creada.
- **FR-033**: Un cliente MUST NOT tener en la misma barbería dos citas activas que se solapen.
- **FR-034**: Tras reservar, el sistema MUST mostrar la confirmación con barbería, servicio, barbero, fecha, hora, precio y estado.
- **FR-035**: El sistema MUST permitir al propietario registrar citas presenciales con las mismas reglas de FR-030 a FR-033, para un cliente de su barbería con cuenta o para un **cliente presencial sin cuenta**. Para el cliente presencial, el propietario MUST registrar nombre y teléfono (correo opcional) y MUST dejar constancia de que la persona aceptó verbalmente el tratamiento de sus datos; sin esa constancia, el cliente presencial MUST NOT registrarse. El cliente presencial queda como perfil de cliente de esa barbería, sin cuenta ni sesión, y el propietario MUST poder elegirlo en reservas presenciales posteriores.
- **FR-035a**: Toda cita nueva (reservada por el cliente o registrada por el propietario) MUST crearse en estado **confirmada**. El estado pendiente y la transición pendiente → confirmada quedan definidos (RF15), pero en esta funcionalidad ningún flujo crea citas pendientes; una opción de "reserva con aprobación" queda como mejora futura.

**Cancelación (RF14)**

- **FR-036**: El sistema MUST permitir al cliente cancelar sus propias citas activas hasta su hora de inicio, y al propietario cancelar cualquier cita activa de su barbería. El barbero MUST NOT cancelar citas.
- **FR-037**: Al cancelar, el horario MUST quedar libre de inmediato.
- **FR-038**: Si el cliente cancela con menos antelación que la mínima configurada por su barbería, la cancelación MUST aceptarse y la cita MUST quedar marcada como cancelación tardía, visible para el propietario. Las cancelaciones hechas por el propietario MUST NOT marcarse como tardías.
- **FR-039**: El sistema MUST registrar quién canceló cada cita, cuándo y, opcionalmente, el motivo.

**Estados de la cita (RF15)**

- **FR-040**: La cita MUST tener uno de estos estados: pendiente, confirmada, completada, no asistió o cancelada. Solo pendiente y confirmada ocupan el horario.
- **FR-041**: El sistema MUST permitir solo estas transiciones: pendiente → confirmada (aprobación del propietario), pendiente → cancelada, confirmada → cancelada, confirmada → completada y confirmada → no asistió. Completada, no asistió y cancelada son estados finales. Cualquier otra transición MUST rechazarse como no válida.
- **FR-042**: Completada y no asistió MUST poder marcarse solo desde la hora de inicio de la cita, por el barbero de la cita (con usuario vinculado) o por el propietario.
- **FR-043**: Cada cambio de estado MUST registrar quién lo hizo, cuándo, el estado anterior y el nuevo.

**Agenda (RF16)**

- **FR-044**: El sistema MUST permitir al propietario consultar la agenda de toda su barbería por fecha y filtrarla por barbero, y al barbero con usuario vinculado consultar solo la suya.
- **FR-045**: Cada cita de la agenda MUST mostrar hora de inicio y fin, servicio, barbero, nombre y teléfono del cliente, estado y, cuando corresponda, las marcas de cancelación tardía y de conflicto con un bloqueo o un cambio de horario.

**Historial del cliente (RF17)**

- **FR-046**: El sistema MUST permitir al cliente consultar sus citas de la barbería de su sesión, ordenadas por fecha, con servicio, barbero, fecha, hora y estado final. MUST NOT mostrar citas de otros clientes ni de otras barberías.

**Hora local, aislamiento, permisos y auditoría**

- **FR-047**: Todas las horas de la barbería MUST registrarse sin ambigüedad y mostrarse en la hora local de la barbería, con los días cortados a medianoche local.
- **FR-048**: Todo dato creado por esta funcionalidad (datos de la barbería, servicios, barberos, disponibilidad, bloqueos, perfiles de cliente, consentimientos, citas y su historial de estados) MUST quedar asociado a su barbería. Ningún usuario MUST poder leer ni modificar datos de otra barbería; ante un recurso de otra barbería, el sistema MUST responder como si no existiera.
- **FR-049**: El sistema MUST aplicar control de acceso por rol en cada operación según la matriz rol × operación del proyecto, ampliada con las operaciones de esta funcionalidad.
- **FR-050**: El sistema MUST registrar en la auditoría, con quién, qué, cuándo, desde dónde y sobre qué barbería: el registro de clientes y su consentimiento, la unión de un cliente a una barbería, los cambios del enlace público, la desactivación de servicios y barberos, los bloqueos confirmados con conflicto, las cancelaciones, los cambios de estado de las citas y los accesos denegados por rol.
- **FR-051**: El sistema MUST validar todas las entradas nuevas (formato, longitud, caracteres, rangos de fechas, horas y montos) y rechazar las inválidas con un mensaje controlado, sin ejecutar su contenido.

### Key Entities _(include if feature involves data)_

- **Barbería** (de 001, ampliada): datos comerciales (dirección, teléfono, descripción), enlace público único, horario de atención semanal, antelación mínima de cancelación.
- **Horario de atención**: tramos de apertura y cierre por día de la semana de la barbería.
- **Servicio**: nombre, precio, duración, descripción, estado (activo o inactivo). Pertenece a una barbería.
- **Barbero**: nombre visible (dato público), estado, vínculo opcional con un usuario de la barbería, servicios asignados. Pertenece a una barbería.
- **Disponibilidad semanal**: tramos por día de la semana de un barbero.
- **Bloqueo**: rango de fecha y hora en que un barbero no atiende, con motivo interno opcional.
- **Cuenta de cliente**: la misma cuenta única por correo de 001, con membresías de cliente en una o más barberías.
- **Perfil de cliente**: datos del cliente en una barbería (nombre, correo, teléfono). Uno por barbería en la que se unió. Puede estar ligado a una cuenta o ser un cliente presencial sin cuenta (registrado por el propietario, con correo opcional).
- **Consentimiento**: evidencia de la aceptación de la política de datos: persona, barbería, versión del texto, fecha y hora, y forma de obtención (en línea o anotado por el propietario, con quién lo anotó).
- **Cita**: barbería, barbero, cliente, servicio con el nombre, precio y duración del momento de la reserva, inicio y fin, estado (nace confirmada), marca de cancelación tardía, marca de conflicto, quién la creó y quién la canceló.
- **Historial de estados de la cita**: cada cambio, con quién, cuándo, estado anterior y nuevo.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: En 200 solicitudes simultáneas de reserva del mismo barbero y la misma hora, con varias instancias del sistema, queda exactamente 1 cita activa y 0 duplicados, y las otras 199 reciben "horario no disponible" (EQ-16).
- **SC-002**: 0 datos de otra barbería visibles o modificables en la suite de pruebas de fuga que recorre todas las operaciones nuevas, incluido un cliente con membresía en dos barberías (EQ-09).
- **SC-003**: 0 datos personales de clientes y 0 datos de contacto o de cuenta del personal en el 100 % de las respuestas de la vía pública por enlace, y el 100 % de los intentos de escritura por esa vía se rechazan.
- **SC-004**: Con 50 personas consultando a la vez los horarios libres de la misma barbería, el 95 % los ve en 800 ms o menos, sin errores del sistema (EQ-01).
- **SC-005**: Con 20 reservas por segundo sobre horas distintas durante 5 minutos, el 95 % se confirma o se rechaza con motivo en menos de 1,5 segundos y menos del 1 % termina en error técnico (EQ-02).
- **SC-006**: El 100 % de los clientes registrados tiene su consentimiento con fecha, hora y versión del texto en cada barbería a la que se unió (EQ-18).
- **SC-007**: El 100 % de las transiciones de estado no válidas se rechazan y el 100 % de los cambios válidos quedan registrados con autor y fecha.
- **SC-008**: El 100 % de las combinaciones rol × operación de esta funcionalidad se permiten o rechazan según la matriz (EQ-08).
- **SC-009**: El 100 % de las cancelaciones de clientes con menos antelación que la mínima quedan marcadas como tardías, y el 100 % de las horas canceladas vuelven a aparecer libres en la consulta siguiente.
- **SC-010**: Un cliente nuevo abre el enlace de una barbería, se registra y reserva desde un celular en menos de 3 minutos.
- **SC-011**: Un propietario configura los datos de su barbería, 3 servicios, 2 barberos y su disponibilidad semanal en menos de 15 minutos.

## Assumptions

- **Zona horaria**: todas las barberías operan, por ahora, en la hora de Perú (UTC−5, sin horario de verano). El diseño registra las horas sin ambigüedad y muestra la hora local de la barbería, de modo que admitir otra zona más adelante no cambie las reglas.
- **Paso de los horarios libres**: las horas de inicio se ofrecen cada 15 minutos; el horizonte de reserva es de 30 días desde hoy. Son propuestas por validar con las barberías.
- **Antelación mínima de cancelación**: 2 horas por defecto, configurable por la barbería entre 0 y 72 horas. Propuesta por validar.
- **Límite de barberos**: lo fija el plan o la prueba gratuita que configura la plataforma, igual que el límite de usuarios de 001; esta funcionalidad solo lo hace cumplir.
- **Barbero y usuario** son cosas distintas: el barbero es quien atiende y aparece en el catálogo; el usuario es quien inicia sesión. Un barbero sin usuario vinculado se agenda igual, pero no puede ver su agenda ni definir su disponibilidad; lo hace el propietario. El propietario puede vincularse a sí mismo como barbero.
- **Datos del cliente**: los mínimos de HU06 (nombre, correo, teléfono). El canal de notificación es el correo por defecto; elegir WhatsApp y su consentimiento expreso (HU06 criterio 4, RF33) corresponden a la funcionalidad 004.
- **Verificación del correo del cliente**: no se exige en esta funcionalidad, porque el envío real de correos llega con la funcionalidad 004. Queda como mejora por evaluar.
- **Personal como cliente**: el correo de un usuario del personal no puede usarse para una cuenta de cliente en esta funcionalidad, igual que 001 no permite el mismo correo en dos barberías como personal. Que una misma cuenta sea personal en una barbería y cliente en otra queda como evolución futura.
- **Consentimiento por barbería**: cada barbería trata los datos de sus clientes, por eso el consentimiento se registra al unirse a cada una.
- **Cliente presencial**: el consentimiento verbal anotado por el propietario se considera suficiente para registrar nombre y teléfono de quien llega sin cuenta. Debe validarse contra la Ley N.° 29733 antes de producción. Unir automáticamente un perfil presencial con una cuenta creada después, por correo o teléfono, queda como mejora futura: hacerlo sin verificar la identidad podría mostrar a alguien citas que no son suyas.
- **Estado inicial confirmado**: el diseño de estados admite reservas con aprobación de la barbería; se deja como mejora futura (una opción por barbería) para no sumar pantallas al plan de 6 días.
- **Cancelación hasta la hora de inicio**: después de esa hora, la cita la resuelve la barbería (completada o no asistió).
- **Fuera del alcance de esta funcionalidad**: reprogramar (RF13) y todas las notificaciones (RF30, RF33, RF34), en la funcionalidad 004, incluido el aviso de cancelación de HU13 (criterio 3); restringir reservas según el estado de la suscripción (RF21, HU11 criterio 4), en la 003; la caché del catálogo y el límite de solicitudes compartido entre instancias, en la 006; el asistente de IA, en la 005; la recuperación de contraseña, como en 001.
- **Abuso de reservas** (un cliente que reserva muchas horas): se limita en esta funcionalidad solo con la regla de no solapar sus propias citas y el límite general de solicitudes; un tope de citas activas por cliente queda como mejora por validar.
- **Líneas de corte** (plan de entrega, sección 3.2): si hay atraso, la agenda se entrega como lista por fecha sin vista de calendario, los bloqueos solo por fecha y hora sin repetición, y el historial sin filtros ni paginación avanzada. Nunca se recortan la garantía de no duplicar citas con su prueba de 200 solicitudes, la vía pública limitada a datos públicos ni la sesión por barbería.
- Las medidas numéricas (tiempos, cargas) provienen de los escenarios EQ del proyecto y son propuestas por validar.
- **SC-004 y SC-005 se miden en la funcionalidad 006** (escalado demostrable), con la prueba de carga de EQ-01 y EQ-02. En 002 solo queda una medición corta como evidencia preliminar: 50 consultas simultáneas de horarios libres contra una instancia. No cuenta como cumplimiento de esos criterios.
- La plataforma es solo web responsive; clientes y barberías la usan desde el navegador del celular o de la computadora.
