# Feature Specification: Notificaciones y reprogramación de citas

**Feature Branch**: `004-notificaciones-reprogramacion`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Funcionalidad 004 Notificaciones y reprogramación. Alcance: RF13 reprogramar una cita con las mismas reglas de una reserva nueva (disponibilidad de 002, sin cruces); RF30 correo de confirmación, cancelación y reprogramación de la cita; RF33 y RF34 recordatorio el día de la cita con enlaces de un solo uso para confirmar, reprogramar o cancelar, elección del canal de aviso del cliente y número de WhatsApp como campo del cliente con su consentimiento. Líneas de corte: plantillas de correo en texto simple; reprogramar desde el enlace reutiliza la pantalla de disponibilidad de 002; sin panel de envíos. Restricciones: envíos por el puerto NotificationChannel (correo real con Mailpit en desarrollo; WhatsApp como canal simulado, sin proveedor real, R17); un fallo de envío nunca bloquea la operación de la cita; sin duplicados entre las dos réplicas (tareas programadas con candado ADR-024; eventos con salida transaccional ADR-025); enlaces de un solo uso, que vencen y alcanzan una sola cita, reutilizados o vencidos se rechazan; el tenant sale del token o del dato firmado del enlace, nunca de lo que envíe el cliente; no usar roles que omiten RLS; sin consentimiento no se envía por WhatsApp, el correo es el respaldo. Incluir historias con criterios medibles, casos límite (cita ya cancelada, enlace vencido, enlace reutilizado, cliente sin consentimiento, correo caído) y marcar lo pendiente como pregunta. Solo especificación, sin código ni plan, sin commit."

**Trazabilidad**: HU12, HU25, HU28 (y HU06 criterio 4, HU13 criterio 3) → RF13, RF30, RF33, RF34 → AC03, AC08 / EQ-06, EQ-18 → DA05, DA09, DA11 → ADR-009 (citas sin duplicados), ADR-012 (integraciones con tiempo límite y circuit breaker), ADR-013 (notificaciones multicanal, **Aceptado** con su revisión el 2026-11-04), ADR-024 (tareas programadas sin duplicados, **Aceptado**), ADR-025 (salida transaccional de eventos), ADR-026 (correo y WhatsApp tras `NotificationChannel`) y ADR-032 (acciones por enlace, con la enmienda 1.4.0 de la constitución), **Aceptados** el 2026-11-04 → M02 Catálogo y citas (reprogramación y acciones de la cita), M05 Notificaciones (envío), M01 (canal y consentimiento del cliente), M03 (hechos de la suscripción que originan los avisos al propietario), M06 (eventos y tareas programadas) → PR06, PR09, PR16, PR18. Riesgos: R16 (consentimiento), R17 (condiciones del proveedor de WhatsApp).

**Acuerdos de alcance ya tomados** (backlog §3.1 y §3.2; no se reabren aquí): el **correo es el canal real** (en desarrollo, un buzón de pruebas local, Mailpit); **WhatsApp existe como canal simulado**, que se comporta como un proveedor pero no envía mensajes reales, hasta que se contrate un proveedor (R17, ADR-013). No se elige ni se nombra un proveedor real de WhatsApp. Líneas de corte: plantillas de correo en texto simple; reprogramar desde el enlace reutiliza la pantalla de disponibilidad de 002; sin panel de envíos.

**Reutiliza de las funcionalidades 001, 002, 003 y 006** (no se repite aquí): cuenta de cliente con membresía y perfil por barbería, consentimiento de la política de datos y cliente presencial sin cuenta (002); reglas de la reserva (servicio y barbero activos, disponibilidad, bloqueos, horizonte, hora de la barbería), restricción que impide citas solapadas, estados de la cita, cancelación con marca de tardía y agenda (002); restricciones por estado de la suscripción (003); ejecutor de tareas programadas sin duplicados entre réplicas (003, ADR-024); dos réplicas detrás de un balanceador (006); tenant tomado del token, auditoría y roles (001).

## Clarifications

### Session 2026-11-04

- Q: ¿Entran en 004 los avisos de suscripción al propietario que menciona RF30? → A: Sí, por correo en texto simple y solo al propietario: prueba por terminar, período en gracia, suscripción vencida y pago aprobado o rechazado. Reutilizan el mecanismo de avisos de 004 y los hechos que ya registra 003, sin pantalla ni opciones de configuración. Es el primer bloque que se recorta si el calendario aprieta (US5, FR-036 a FR-040).
- Q: ¿Cuándo se envía el recordatorio? → A: Uno solo, 2 horas antes de la hora de inicio, fijo y no configurable. Una cita reservada con menos de 2 horas de antelación no tiene recordatorio. El recordatorio configurable por barbería y el de 24 horas quedan como evolución futura (FR-022).
- Q: ¿Qué antelación rige la reprogramación del cliente? → A: La misma antelación mínima de cancelación de la barbería. Por debajo de ella, la reprogramación se rechaza con un mensaje claro que ofrece cancelar. El propietario no tiene regla de antelación. No existe una marca de reprogramación tardía (FR-006).
- Q: ¿El número de WhatsApp es propio o el teléfono de contacto? → A: Es un campo propio del cliente en esa barbería; se propone con su teléfono de contacto y se puede cambiar. Cambiar el número exige un consentimiento nuevo (FR-017, FR-018).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - El cliente reprograma su cita sin perderla (Priority: P1)

El cliente con sesión abre una de sus citas activas y la mueve a otra fecha u hora, con el mismo servicio. Ve solo los horarios realmente libres, como al reservar. Si la nueva hora ya no está libre al confirmar, la cita original sigue intacta. El propietario puede reprogramar cualquier cita de su barbería cuando el barbero o la barbería tienen un imprevisto (HU28, criterio 7).

**Why this priority**: es la única historia de 004 que cambia una cita, y las notificaciones y el recordatorio la reutilizan. Sin ella, el cliente con un imprevisto solo puede cancelar y volver a reservar, arriesgándose a perder su turno (RF13, HU12).

**Independent Test**: con dos citas activas del mismo barbero, reprogramar la primera a una hora libre y comprobar que la hora anterior queda libre y la nueva ocupada. Luego intentar reprogramarla a la hora de la segunda cita y comprobar que se rechaza con "horario no disponible" y que la primera conserva su hora. Lanzar 50 reprogramaciones simultáneas de citas distintas hacia la misma hora libre: exactamente una debe quedar en esa hora.

**Acceptance Scenarios**:

1. **Given** un cliente con una cita confirmada futura, **When** elige una hora libre de la pantalla de disponibilidad y confirma la reprogramación, **Then** la cita queda en la nueva hora con el mismo servicio, la hora anterior vuelve a aparecer libre en la consulta siguiente y el cambio queda en el historial de la cita.
2. **Given** una cita y otra cita activa del mismo barbero a las 11:00, **When** el cliente intenta reprogramar la primera a las 11:00, **Then** la reprogramación se rechaza con "horario no disponible" y la primera cita conserva su fecha, hora y estado.
3. **Given** una hora libre por la que compiten varias solicitudes simultáneas (reservas nuevas y reprogramaciones), **When** todas se confirman a la vez, **Then** exactamente una ocupa la hora y las demás reciben "horario no disponible"; ninguna cita reprogramada que pierde pierde también su hora original.
4. **Given** una nueva hora fuera de la disponibilidad del barbero, dentro de un bloqueo, pasada o más allá del horizonte de reserva, **When** el cliente intenta reprogramar, **Then** se rechaza con el mismo motivo que daría una reserva nueva.
5. **Given** una cita a la que le falta menos tiempo para empezar que la antelación mínima de cancelación de la barbería, **When** el cliente intenta reprogramarla (con sesión o por el enlace), **Then** se rechaza con un mensaje claro que dice que ya no se puede reprogramar y ofrece cancelarla; la cita no cambia. Con esa antelación o más, la reprogramación sigue las demás reglas.
6. **Given** el propietario y una cita confirmada de su barbería, **When** la reprograma a una hora libre (del mismo barbero o de otro que ofrezca el servicio), **Then** se aplican las mismas reglas, sin regla de antelación, y el cliente recibe el aviso de reprogramación (US2).
7. **Given** una barbería cuya suscripción no acepta reservas nuevas (003), **When** el cliente o el propietario intentan reprogramar, **Then** se rechaza con el mismo mensaje que una reserva nueva; cancelar sigue permitido.

---

### User Story 2 - El cliente recibe la confirmación, la cancelación y la reprogramación de su cita (Priority: P1)

Cada vez que se crea, se cancela o se reprograma una cita, el cliente recibe un aviso con la barbería, el servicio, el barbero, la fecha y la hora, por el canal que eligió. El envío ocurre después de que la operación quedó guardada y nunca la demora ni la deshace: si el correo está caído, la cita igual se reserva, se cancela o se reprograma.

**Why this priority**: es el corazón de RF30 y el canal por el que llegan los enlaces del recordatorio (US3). Además resuelve un hueco de 002: hoy la confirmación solo se ve en pantalla.

**Independent Test**: reservar, reprogramar y cancelar una cita de un cliente con canal correo; comprobar que en el buzón de pruebas hay exactamente un correo por cada operación, con los datos correctos. Repetir con el servicio de correo detenido: las tres operaciones deben completarse igual, y al reanudarlo los tres correos deben llegar una sola vez.

**Acceptance Scenarios**:

1. **Given** un cliente con canal correo, **When** reserva una cita, **Then** recibe un solo correo de confirmación en texto simple con barbería, servicio, barbero, fecha y hora en la hora de la barbería, sin otros datos personales.
2. **Given** una cita registrada por el propietario para un cliente presencial con correo, **When** se crea, **Then** el cliente recibe la confirmación; si el cliente presencial no tiene correo, no se envía nada y la cita se crea igual.
3. **Given** una cita activa, **When** la cancela el cliente o el propietario, **Then** el cliente recibe el aviso de cancelación por su canal; si canceló el cliente, el propietario y el barbero con usuario vinculado reciben también un aviso por correo (HU13, HU28).
4. **Given** una cita reprogramada, **When** se guarda el cambio, **Then** el cliente recibe un solo aviso con la hora anterior y la nueva; si reprogramó el cliente, el propietario y el barbero con usuario vinculado reciben también un aviso por correo.
5. **Given** el servicio de correo caído, **When** se reserva, se cancela o se reprograma una cita, **Then** la operación responde y se guarda igual que con el correo disponible; los avisos quedan pendientes y se envían cuando el servicio vuelve, cada uno una sola vez.
6. **Given** las dos réplicas del sistema en funcionamiento, **When** se crean 100 citas, **Then** cada cliente recibe exactamente una confirmación por cita: ninguna se pierde y ninguna se repite.
7. **Given** una operación de la cita que falla y no se guarda (por ejemplo, "horario no disponible"), **When** termina, **Then** no se envía ningún aviso.

---

### User Story 3 - El recordatorio del día con enlaces para confirmar, reprogramar o cancelar (Priority: P2)

El mismo día de la cita, el cliente recibe un recordatorio con la barbería, el servicio, el barbero y la hora, y tres enlaces: **confirmo asistencia**, **reprogramar** y **cancelar**. Los enlaces funcionan sin iniciar sesión, sirven para esa sola cita y vencen. Confirmar marca la cita como "confirmada por el cliente" en la agenda. Cancelar libera el horario de inmediato. Reprogramar abre la pantalla de disponibilidad de la barbería para esa cita. Si el cliente no responde, la cita no se cancela: queda "sin confirmar" en la agenda.

**Why this priority**: reduce las inasistencias y libera horarios que de otro modo quedarían perdidos (RF34, HU28). Depende de US1 (reprogramar) y US2 (envío), por eso va después.

**Independent Test**: con una cita para hoy y el momento del recordatorio alcanzado, comprobar que el cliente recibe un solo recordatorio con tres enlaces. Abrir "confirmo asistencia": la agenda muestra la cita confirmada por el cliente. Abrir el mismo enlace otra vez: se rechaza. Con otra cita, abrir "cancelar": la cita queda cancelada y la hora libre. Con una tercera, abrir un enlace después de su vencimiento: se rechaza y la cita no cambia.

**Acceptance Scenarios**:

1. **Given** una cita activa para hoy, **When** faltan 2 horas para su hora de inicio, **Then** el cliente recibe un solo recordatorio por su canal con barbería, servicio, barbero, hora y los tres enlaces. Una cita reservada con menos de 2 horas de antelación no recibe recordatorio.
2. **Given** el recordatorio recibido, **When** el cliente abre "confirmo asistencia" y confirma, **Then** la cita queda marcada como confirmada por el cliente, con fecha y hora, y la agenda del barbero y del propietario lo muestra.
3. **Given** el recordatorio recibido, **When** el cliente abre "cancelar" y confirma, **Then** la cita queda cancelada con las mismas reglas que una cancelación del cliente (incluida la marca de tardía), la hora vuelve a estar libre de inmediato, se avisa al propietario y al barbero (US2) y los otros enlaces de esa cita dejan de servir.
4. **Given** el recordatorio recibido, **When** el cliente abre "reprogramar", **Then** ve la pantalla de disponibilidad de la barbería para el servicio de esa cita y, al elegir una hora libre y confirmar, la cita se reprograma con las reglas de US1; los enlaces anteriores dejan de servir y el cliente recibe el aviso de reprogramación.
5. **Given** un cliente que no responde, **When** llega y pasa la hora de la cita, **Then** la cita no se cancela ni cambia de estado por esa razón: queda "sin confirmar" en la agenda.
6. **Given** las dos réplicas en funcionamiento, **When** llega el momento del recordatorio de 50 citas, **Then** cada cita recibe exactamente un recordatorio.
7. **Given** un enlace ya usado, vencido o de una cita cancelada, reprogramada o ya pasada, **When** alguien lo abre, **Then** se rechaza con un mensaje que no revela datos de la cita ni del cliente y ofrece iniciar sesión para gestionar sus citas; la cita no cambia.
8. **Given** un enlace válido, **When** alguien lo abre y no confirma la acción, **Then** el enlace sigue sirviendo hasta usarse o vencer (abrirlo no lo consume).

---

### User Story 4 - El cliente elige su canal de aviso y da su consentimiento para WhatsApp (Priority: P2)

El cliente con sesión elige cómo quiere recibir los avisos de su barbería: por correo o por WhatsApp. Para WhatsApp indica su número y acepta expresamente recibir mensajes; ese consentimiento queda registrado con fecha, hora y versión del texto. Puede cambiar de canal o retirar el consentimiento cuando quiera, y desde ese momento los avisos vuelven al correo.

**Why this priority**: sin esta historia todos los avisos van por correo, que ya cumple RF30 como respaldo. Es necesaria para RF33 y para demostrar que no se envía nada por WhatsApp sin consentimiento (EQ-18).

**Independent Test**: un cliente elige WhatsApp con su número y acepta; se reserva una cita y la confirmación sale por el canal de WhatsApp simulado. Retira el consentimiento; la siguiente confirmación sale por correo. Un cliente que elige WhatsApp sin aceptar no puede guardar el cambio.

**Acceptance Scenarios**:

1. **Given** un cliente con sesión, **When** elige WhatsApp, **Then** el campo del número de WhatsApp aparece propuesto con su teléfono de contacto y puede cambiarlo; al guardar un número válido y aceptar expresamente recibir mensajes, su canal queda en WhatsApp y el consentimiento se registra con fecha, hora, versión del texto y número. El teléfono de contacto no cambia.
2. **Given** un cliente que elige WhatsApp, **When** intenta guardar sin aceptar recibir mensajes, **Then** el cambio se rechaza y su canal sigue siendo el anterior.
3. **Given** un cliente con canal WhatsApp, **When** retira el consentimiento o vuelve al correo, **Then** el retiro queda registrado con fecha y hora y los avisos siguientes salen por correo.
4. **Given** un cliente con canal WhatsApp, **When** cambia su número, **Then** se le pide aceptar de nuevo; hasta que acepte, los avisos salen por correo.
5. **Given** un cliente con canal WhatsApp, **When** el envío por WhatsApp falla, **Then** el mismo aviso se envía por correo una sola vez.
6. **Given** un cliente con membresía en dos barberías, **When** elige WhatsApp en una, **Then** la otra conserva su propio canal y su propio consentimiento.

---

### User Story 5 - El propietario recibe por correo los avisos de su suscripción (Priority: P3, primer recorte)

El propietario recibe un correo en texto simple cuando su prueba gratuita está por terminar, cuando su período pasa a gracia, cuando su suscripción vence y cuando un pago suyo se aprueba o se rechaza. Así no depende de entrar al panel para enterarse. Los avisos salen de los mismos hechos que 003 ya registra y usan el mismo mecanismo de envío de los avisos de las citas. No hay pantalla ni opciones para configurarlos.

**Why this priority**: completa RF30, que también pide "enviar avisos de suscripción al propietario". Va al final y es **el primer bloque que se recorta** si el calendario aprieta: el panel de 003 ya muestra estos estados, así que el propietario no queda sin información.

**Independent Test**: con una barbería en prueba a la que le quedan 3 días y sin un período siguiente pagado, comprobar que el propietario recibe un solo correo de prueba por terminar. Vencer la prueba con la tarea de 003 y comprobar un solo correo de suscripción vencida. Aprobar un pago y rechazar otro: un correo por cada uno. Repetir con dos réplicas: ningún correo se duplica.

**Acceptance Scenarios**:

1. **Given** una barbería en prueba gratuita, sin un período siguiente pagado, **When** le quedan 3 días o menos de prueba (el mismo criterio con el que el panel de 003 muestra "prueba por terminar"), **Then** el propietario recibe un solo correo que lo avisa y le indica que puede elegir un plan.
2. **Given** una suscripción activa cuyo período termina sin pago, **When** pasa a período de gracia, **Then** el propietario recibe un solo correo con la fecha hasta la que puede pagar sin dejar de recibir reservas.
3. **Given** una suscripción en prueba o en gracia, **When** vence, **Then** el propietario recibe un solo correo que dice que la barbería ya no acepta reservas nuevas y que al pagar vuelve a aceptarlas.
4. **Given** un pago del propietario (en línea o por transferencia), **When** se aprueba, **Then** recibe un solo correo con el plan y el período; **When** se rechaza, **Then** recibe un solo correo con el motivo, si lo hay, y la indicación de que puede intentarlo de nuevo.
5. **Given** el servicio de correo caído, **When** ocurre cualquiera de esos hechos, **Then** la transición de la suscripción o del pago se completa igual; el correo se envía cuando el servicio vuelve, una sola vez.

---

### Edge Cases

- **Cita ya cancelada**: un enlace de una cita cancelada (por el cliente, por el propietario o desde otro enlace) se rechaza; un recordatorio pendiente de una cita que se cancela antes de su envío no se envía.
- **Cita reprogramada antes del recordatorio**: el recordatorio se programa para la nueva hora; el de la hora anterior no se envía. Si se reprograma después de recibir el recordatorio, los enlaces anteriores dejan de servir y la nueva hora tiene su propio recordatorio si aún corresponde.
- **Enlace vencido**: se rechaza aunque no se haya usado; la cita no cambia. Ningún enlace sirve después de la hora de inicio de la cita.
- **Enlace reutilizado**: el segundo uso de un mismo enlace se rechaza, también cuando dos usos llegan a la vez a réplicas distintas: solo uno tiene efecto.
- **Confirmar y después cancelar**: el cliente que confirmó asistencia y luego tiene un imprevisto puede usar el enlace de cancelar mientras siga vigente.
- **Enlace manipulado o de otra barbería**: un enlace alterado, inventado o que apunta a otra cita se rechaza igual que uno vencido, sin indicar si la cita existe. La barbería y la cita salen solo del dato firmado del enlace, nunca de la dirección, del cuerpo ni de los encabezados que envíe el navegador.
- **Cliente sin consentimiento para WhatsApp**: nunca recibe mensajes por WhatsApp, aunque tenga un número guardado; recibe los avisos por correo.
- **Cliente presencial sin correo**: no recibe avisos ni recordatorios; sus citas se gestionan solo en el local y en la agenda. Con correo, recibe los avisos y el recordatorio por correo; no puede elegir WhatsApp porque no tiene sesión para dar el consentimiento.
- **Correo caído**: las operaciones de la cita no se afectan; los avisos se reintentan con espera creciente y el circuito se abre tras fallos repetidos. Un recordatorio que no pudo enviarse antes de la hora de inicio de la cita se descarta, porque ya no sirve.
- **WhatsApp caído y correo caído**: el aviso queda pendiente y se reintenta; si no puede enviarse por ningún canal, queda registrado como fallido, sin afectar la cita.
- **Cita reservada con menos de 2 horas de antelación** (por ejemplo, para dentro de una hora): no recibe recordatorio; la confirmación de la reserva ya trae la fecha y la hora. Lo mismo vale para una cita reprogramada a una hora que empieza en menos de 2 horas.
- **Reprogramar sin la antelación mínima**: el cliente recibe un rechazo que le ofrece cancelar; el propietario sí puede reprogramar la cita.
- **Prueba por terminar con un período siguiente ya pagado**: no se envía el aviso, igual que el panel de 003 no lo muestra.
- **Propietario que paga después de recibir "prueba por terminar"**: no recibe otro aviso de prueba por terminar; recibe el de pago aprobado.
- **Cita que pasa a completada o no asistió**: sus enlaces dejan de servir.
- **Barbería suspendida o cuya suscripción no acepta reservas**: los avisos de las citas existentes se siguen enviando; los enlaces de confirmar y cancelar siguen sirviendo; reprogramar se rechaza (US1, escenario 7).
- **Barbero desactivado o servicio desactivado** después de reservar: los avisos de las citas existentes se siguen enviando; reprogramar exige que el servicio y un barbero que lo ofrezca sigan activos.
- **Dos acciones a la vez sobre la misma cita** (por ejemplo, el cliente cancela por el enlace mientras el propietario la reprograma): solo una tiene efecto y la otra recibe el mensaje de que la cita cambió.

## Requirements _(mandatory)_

### Functional Requirements

**Reprogramación (RF13, HU12)**

- **FR-001**: El sistema MUST permitir al cliente con sesión reprogramar una cita suya pendiente o confirmada, antes de su hora de inicio, eligiendo una nueva fecha y hora para el mismo servicio. El barbero puede ser el mismo u otro que ofrezca ese servicio.
- **FR-002**: El sistema MUST permitir al propietario reprogramar cualquier cita pendiente o confirmada de su barbería, con las mismas reglas y sin regla de antelación.
- **FR-003**: La nueva hora MUST validarse con todas las reglas de una reserva nueva de 002: servicio activo, barbero activo que ofrece el servicio, dentro de su disponibilidad, fuera de bloqueos, en el futuro, dentro del horizonte de reserva, en la hora de la barbería y con una suscripción que acepte reservas.
- **FR-004**: La reprogramación MUST ser atómica: o la cita queda en la nueva hora, o conserva su fecha, hora, barbero y estado. Que la nueva hora no se solape con otra cita activa del mismo barbero MUST garantizarlo el almacenamiento de datos, también con solicitudes simultáneas y varias instancias (constitución, principio IV); el conflicto MUST responderse como "horario no disponible".
- **FR-005**: La cita reprogramada MUST conservar su identidad, el servicio con los datos copiados al reservar (nombre, precio y duración) y su cliente. Su historial MUST registrar la hora anterior, la nueva, quién reprogramó y cuándo.
- **FR-006**: La reprogramación del cliente MUST exigir la misma antelación mínima de cancelación que configuró su barbería (002). Si falta menos tiempo para la hora de inicio, MUST rechazarse con un mensaje claro que ofrece cancelar la cita, sin cambiarla. El propietario MUST NOT tener regla de antelación. No existe una marca de reprogramación tardía.
- **FR-007**: Una cita reprogramada MUST quedar en estado confirmada y sin la marca de asistencia confirmada por el cliente.

**Avisos de la cita (RF30, HU25, HU13)**

- **FR-008**: El sistema MUST avisar al cliente de cada cita creada (reserva del cliente o cita presencial), cancelada (por el cliente o el propietario) y reprogramada, por su canal elegido.
- **FR-009**: Cuando el cliente cancela o reprograma (con sesión o por enlace), el sistema MUST avisar por correo al propietario y, si el barbero tiene usuario vinculado, también al barbero.
- **FR-010**: Los avisos MUST enviarse solo después de que la operación de la cita quedó guardada. Si la operación falla, MUST NOT enviarse aviso.
- **FR-011**: El envío MUST ser asíncrono: MUST NOT demorar la respuesta de la operación de la cita ni deshacerla. Un fallo de envío MUST NOT bloquear, revertir ni cambiar ninguna operación.
- **FR-012**: Ningún aviso que corresponda a una operación guardada MUST perderse, aunque una réplica caiga después de guardar, y ninguno MUST enviarse dos veces, con una o con varias réplicas.
- **FR-013**: Los mensajes MUST contener solo los datos mínimos: barbería, servicio, nombre visible del barbero, fecha y hora en la hora de la barbería y, cuando corresponda, la hora anterior y los enlaces del recordatorio. MUST NOT incluir el teléfono, el correo ni otros datos del cliente, ni datos de otras citas.
- **FR-014**: Los correos MUST ser de texto simple (línea de corte 1).
- **FR-015**: Los avisos de un cliente presencial MUST enviarse solo por correo y solo si tiene uno registrado.

**Canal, consentimiento y respaldo (RF33, HU06, HU25)**

- **FR-016**: El cliente con sesión MUST poder elegir y cambiar su canal de aviso en cada barbería: correo (por defecto) o WhatsApp.
- **FR-017**: Elegir WhatsApp MUST exigir un número válido y la aceptación expresa de recibir mensajes por WhatsApp de esa barbería. El número de WhatsApp MUST ser un campo propio del cliente en esa barbería, propuesto con su teléfono de contacto y modificable sin cambiar ese teléfono. El consentimiento MUST registrarse con persona, barbería, número, versión del texto, fecha y hora, separado del consentimiento de la política de datos de 002.
- **FR-018**: El cliente MUST poder retirar el consentimiento en cualquier momento; el retiro MUST registrarse con fecha y hora, y los avisos siguientes MUST salir por correo. Cambiar el número MUST exigir un consentimiento nuevo.
- **FR-019**: El sistema MUST NOT enviar ningún mensaje por WhatsApp a un cliente sin consentimiento vigente para ese número y esa barbería.
- **FR-020**: Si el envío por WhatsApp falla tras sus reintentos, o el cliente no tiene consentimiento vigente, el aviso MUST enviarse por correo, una sola vez.
- **FR-021**: En esta entrega, WhatsApp MUST funcionar como canal simulado que registra los mensajes y puede simular errores y demoras; MUST NOT enviar mensajes reales ni depender de un proveedor real (R17). Cambiar al proveedor real, cuando se contrate, MUST requerir un adaptador nuevo y configuración, sin cambiar las reglas de los avisos.

**Recordatorio y enlaces (RF34, HU28)**

- **FR-022**: El sistema MUST enviar un solo recordatorio de cada cita pendiente o confirmada 2 horas antes de su hora de inicio (valor fijo, no configurable), por el canal del cliente. Una cita que se reserva, o se reprograma, a menos de 2 horas de su inicio MUST NOT recibir recordatorio. El recordatorio va con barbería, servicio, barbero, hora y tres enlaces: confirmar asistencia, reprogramar y cancelar.
- **FR-023**: Cada cita MUST recibir como máximo un recordatorio por cada hora programada, con una o con varias réplicas. Si la cita se cancela, se reprograma, se completa o se marca como no asistió antes del envío, el recordatorio pendiente MUST NOT enviarse; si se reprograma, MUST programarse el de la nueva hora.
- **FR-024**: Cada enlace MUST: ser imposible de adivinar, servir para una sola cita de una sola barbería y una sola acción, poder usarse una sola vez, vencer como máximo a la hora de inicio de la cita y guardarse en el sistema solo de forma que no pueda reconstruirse a partir de lo guardado.
- **FR-025**: Un enlace usado, vencido, alterado o de una cita cancelada, reprogramada, completada, no asistida o ya iniciada MUST rechazarse con un mensaje genérico que no revele si la cita existe ni datos del cliente, y la cita MUST NOT cambiar. Cancelar o reprogramar la cita MUST invalidar todos sus enlaces vigentes.
- **FR-026**: Abrir un enlace MUST mostrar solo los datos mínimos de la cita y pedir confirmar la acción; MUST NOT consumirlo. El enlace MUST consumirse solo al confirmar la acción y en la misma operación que la aplica: si dos usos llegan a la vez, solo uno MUST tener efecto.
- **FR-027**: La barbería y la cita de una acción por enlace MUST obtenerse solo del dato firmado del enlace, nunca de la dirección, el cuerpo, la consulta ni los encabezados que envíe el navegador. Las operaciones con sesión MUST seguir tomando la barbería solo del token. Ninguna vía de esta funcionalidad MUST usar un acceso a la base que omita las reglas de aislamiento por barbería.
- **FR-028**: Confirmar asistencia MUST marcar la cita como confirmada por el cliente, con fecha y hora, sin cambiar su estado; la agenda del barbero y del propietario MUST mostrar la marca. Una cita sin respuesta MUST mostrarse "sin confirmar" y MUST NOT cancelarse ni cambiar de estado por falta de respuesta.
- **FR-029**: Cancelar por enlace MUST aplicar las mismas reglas que la cancelación del cliente de 002, incluida la marca de cancelación tardía, y liberar la hora de inmediato.
- **FR-030**: Reprogramar por enlace MUST mostrar la pantalla de disponibilidad de 002 para el servicio de esa cita y aplicar las reglas de FR-001 a FR-007 como reprogramación del cliente (línea de corte 2). La acción MUST alcanzar solo esa cita.
- **FR-031**: El sistema MUST limitar los intentos de uso de enlaces por origen para impedir probar enlaces al azar, y registrar los rechazos.

**Fiabilidad, aislamiento y auditoría**

- **FR-032**: Todo envío a un canal externo MUST tener tiempo límite, reintentos con espera creciente y un corte del circuito tras fallos repetidos (EQ-06: 5 fallos en 60 s, propuesta por validar). Con el circuito abierto, los avisos MUST quedar pendientes sin afectar al resto de la plataforma.
- **FR-033**: Un aviso que no pudo enviarse a ningún canal tras sus reintentos MUST quedar registrado como fallido. Un recordatorio que no se envió antes de la hora de inicio de la cita MUST descartarse.
- **FR-034**: Todo aviso, recordatorio, enlace, canal y consentimiento MUST pertenecer a una barbería. Ningún usuario ni enlace MUST poder leer ni afectar datos de otra barbería; ante un recurso de otra barbería, el sistema MUST responder como si no existiera.
- **FR-035**: El sistema MUST registrar en la auditoría, con quién, qué, cuándo y sobre qué barbería: las reprogramaciones, las confirmaciones y cancelaciones por enlace, los cambios de canal, la aceptación y el retiro del consentimiento de WhatsApp y los rechazos de enlaces. De cada aviso MUST quedar constancia de tipo, cita, canal, estado (pendiente, enviado, enviado por respaldo, fallido o descartado) e intentos, sin el texto del mensaje ni datos de contacto en la auditoría. No hay pantalla para consultarlo (línea de corte 3).
**Avisos de suscripción al propietario (RF30; primer bloque que se recorta)**

- **FR-036**: El sistema MUST avisar por correo, en texto simple y solo al propietario de la barbería, de estos cuatro hechos de su suscripción: prueba por terminar, paso a período de gracia, suscripción vencida y pago aprobado o rechazado. MUST NOT avisarse de otros hechos ni a otros usuarios.
- **FR-037**: "Prueba por terminar" MUST usar el mismo criterio con el que el panel de 003 muestra ese aviso: suscripción en prueba, sin un período siguiente pagado y con 3 días o menos de prueba. Se avisa una sola vez por prueba. Los otros tres avisos MUST originarse en las transiciones que 003 ya registra (gracia y vencimiento por la tarea programada; aprobación y rechazo del pago, en línea o por transferencia), sin cambiarlas.
- **FR-038**: Estos avisos MUST usar el mismo mecanismo de envío de los avisos de las citas, con las mismas garantías: asíncronos, sin bloquear ni revertir la transición que los origina (FR-011), sin pérdidas ni duplicados entre réplicas (FR-012), con reintentos y corte del circuito (FR-032) y con su constancia en la auditoría (FR-035).
- **FR-039**: Los mensajes MUST contener solo lo necesario: nombre de la barbería, el hecho, la fecha que corresponde (fin de la prueba, fin de la gracia o período pagado) y, en un rechazo, el motivo. MUST NOT incluir datos de tarjeta, números de cuenta, números de operación completos ni datos del comprobante.
- **FR-040**: Esta funcionalidad MUST NOT agregar pantallas ni opciones de configuración para estos avisos. Sus tareas MUST planificarse como un grupo separado, marcado como el primero que se recorta si el calendario aprieta.

### Key Entities _(include if feature involves data)_

- **Cita** (de 002, ampliada): marca de asistencia confirmada por el cliente (fecha y hora); historial con las reprogramaciones (hora anterior, hora nueva, quién y cuándo).
- **Preferencia de aviso del cliente**: por perfil de cliente en una barbería; canal (correo o WhatsApp) y número de WhatsApp.
- **Consentimiento de WhatsApp**: persona, barbería, número, versión del texto, fecha y hora de aceptación y, si lo hubo, de retiro. Separado del consentimiento de la política de datos.
- **Aviso**: hecho a comunicar de una cita (creada, cancelada, reprogramada o recordatorio) o de la suscripción (prueba por terminar, gracia, vencida, pago aprobado o rechazado), con destinatario, canal previsto, canal usado, estado, intentos y momento previsto. Pertenece a una barbería.
- **Enlace de acción**: una cita, una acción (confirmar, reprogramar o cancelar), vencimiento y momento de uso. Se guarda de forma que el enlace no pueda reconstruirse. Pertenece a una barbería.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: El 100 % de las reprogramaciones que chocan con otra cita activa se rechazan y conservan la cita original; con 50 solicitudes simultáneas hacia la misma hora, exactamente una ocupa la hora.
- **SC-002**: Un cliente reprograma una cita desde su lista de citas, o desde el enlace del recordatorio, en menos de 1 minuto.
- **SC-003**: Con el servicio de correo detenido, el 100 % de las reservas, cancelaciones y reprogramaciones se completan con el mismo resultado que con el correo disponible; ninguna operación tarda más por esa causa.
- **SC-004**: El ≥ 95 % de las citas tiene su confirmación entregada por algún canal en ≤ 5 minutos desde la reserva, con los canales disponibles (EQ-06, propuesta por validar).
- **SC-005**: Con dos réplicas, sobre 100 citas creadas, canceladas o reprogramadas, hay exactamente un aviso por operación: 0 perdidos y 0 duplicados, también si una réplica cae después de guardar una operación.
- **SC-006**: Con dos réplicas y 50 citas con recordatorio, cada cita recibe exactamente 1 recordatorio, entregado en ≤ 10 minutos después de su momento programado.
- **SC-007**: 0 mensajes por WhatsApp a clientes sin consentimiento vigente (EQ-18); el 100 % de los consentimientos y retiros quedan con fecha, hora y versión del texto.
- **SC-008**: El 100 % de los enlaces usados, vencidos, alterados o de citas que ya cambiaron se rechazan sin modificar la cita; con 2 usos simultáneos del mismo enlace, exactamente 1 tiene efecto.
- **SC-009**: El 100 % de los avisos por WhatsApp que fallan llegan por correo una sola vez.
- **SC-010**: 0 citas canceladas o con cambio de estado por no responder al recordatorio.
- **SC-011**: La prueba de aislamiento entre barberías (PR09) cubre avisos, enlaces, canales y consentimientos: un usuario o un enlace de una barbería no lee ni modifica nada de otra.
- **SC-012**: El 100 % de las reprogramaciones de clientes con menos antelación que la mínima de cancelación se rechazan sin cambiar la cita.
- **SC-013**: Con dos réplicas, cada uno de los cuatro hechos de suscripción produce exactamente 1 correo al propietario (0 perdidos y 0 duplicados), y el 100 % de las transiciones de 003 que los originan se completan aunque el correo esté caído.

## Assumptions

- **Canal por defecto**: correo, para todos los clientes con cuenta y para los presenciales con correo. Los clientes ya registrados en 002 quedan con canal correo, sin consentimiento de WhatsApp.
- **Canal por barbería**: el canal y el consentimiento de WhatsApp son por barbería, como la membresía y el consentimiento de datos de 002.
- **Dónde se elige el canal**: en el área del cliente con sesión. El registro de 002 no cambia: el cliente nuevo empieza con correo y elige WhatsApp después.
- **Reprogramar no cambia el servicio**: para cambiar de servicio, el cliente cancela y reserva de nuevo.
- **Sin límite de reprogramaciones** por cita.
- **Vigencia de los enlaces**: los tres enlaces del recordatorio sirven desde su envío hasta la hora de inicio de la cita; confirmar no invalida los enlaces de cancelar ni de reprogramar.
- **Nombre del barbero en los avisos**: es el nombre visible que la barbería publica en su catálogo, que la constitución considera dato público de la barbería; por eso entra en los datos mínimos de los avisos junto con barbería, servicio, fecha y hora (HU25).
- **Avisos al personal**: solo por correo, al propietario y al barbero con usuario vinculado, sin canal elegible.
- **Hora de los avisos**: siempre la de la barbería, con su etiqueta, como en 002.
- **Barbería sin reservas por su suscripción**: los avisos y recordatorios de las citas existentes siguen; reprogramar se rechaza, porque toma una hora nueva igual que una reserva.
- **Dependencias de gobierno (resueltas en el plan y aprobadas el 2026-11-04)**:
  - Actuar sobre una cita con un enlace sin sesión, tomando la barbería del dato firmado del enlace (FR-027), no estaba entre las excepciones del principio III de la 1.3.1. Queda amparado por la **cuarta excepción acotada** de la constitución **1.4.0**, "acciones por enlace de la cita", con **ADR-032**, ambos aprobados y aplicados.
  - **ADR-025** (salida transaccional de eventos) y **ADR-026** (correo y WhatsApp tras `NotificationChannel`) están Aceptados, y **ADR-013** pasó a Aceptado con su revisión, que agrega a la matriz **M05 → M01, de solo lectura**.
- **Correo**: SMTP con la librería `nodemailer`, con versión exacta fija. En desarrollo y en las pruebas, el buzón local (Mailpit). El proveedor de producción queda **por verificar** (ADR-026).
- **Texto del consentimiento de WhatsApp**: texto base en español simple, versión `2026-11` (`specs/004-notificaciones-reprogramacion/contracts/texto-consentimiento-whatsapp.md`), **por validar con asesoría legal**. No se afirma que cumpla la ley.
- **Límite de rechazos de enlaces (FR-031)**: los mismos valores del límite de inicio de sesión (`login_attempt`): bloqueo tras 5 rechazos en 60 s, de 60 s la primera vez, que se duplica en cada racha hasta 15 minutos, por origen.
- **Retención**: los eventos se conservan 30 días y los avisos 90 días; la afinación por tipo queda para la funcionalidad 007.
- **Evolución futura (fuera de 004)**: recordatorio con anticipación configurable por barbería; un segundo recordatorio 24 horas antes; pantalla o panel de envíos; plantillas con formato; conexión a un proveedor real de WhatsApp cuando se contrate (R17); configuración de los avisos de suscripción; retención por tipo de aviso (007).
- **Volumen**: decenas de citas por barbería y por día. Los avisos se despachan al confirmar la operación y, como respaldo, cada 15 segundos, suficiente para la precisión del recordatorio.
