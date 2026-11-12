# Feature Specification: Adelanto de reserva con QR de la barbería

**Feature Branch**: `008-adelanto-reserva-qr`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Funcionalidad 008 "Adelanto de reserva con QR": implementa RF35 y HU29 tal como quedaron en docs/01-analisis-de-sistema y ADR-033 (aceptado, constitución 1.5.0). Versión mínima funcional: configuración del adelanto por barbería (monto fijo en soles o porcentaje del servicio, tiempo para pagar, QR de Yape o Plin); reserva en PENDIENTE con el horario retenido; el cliente ve el QR, el monto y el código de su reserva y registra el número de operación (captura opcional y privada); el propietario recibe un aviso, comprueba el pago en su propia app y confirma (Cita.aprobar()); vencimiento automático con liberación del horario y aviso a los dos; descuento del adelanto el día de la cita; devolución si el cliente cancela con tiempo y retención si cancela tarde o no asiste. Si el cliente ya registró el pago y el propietario no confirma antes del vencimiento, la cita NO se cancela sola: el horario sigue retenido hasta que el propietario decida, con un límite máximo adicional. Los avisos (instrucciones de pago, comprobante por revisar, adelanto confirmado, adelanto vencido) usan el outbox y NotificationChannel de 004; no dupliques esa infraestructura. Respeta la constitución 1.5.0, multi-tenancy con RLS y el puerto PaymentGateway sin cambiarlo. Sin pasarela real."

**Trazabilidad**: HU29 → RF35 (y RF14, RF15, RF30, que reutiliza) → AC01, AC02 / EQ-23, EQ-24 → DA02, DA07, DA11 → ADR-033 (adelanto por QR de la barbería con verificación manual, **Aceptado** el 2026-11-12, con la enmienda 1.5.0 del principio V), ADR-009 (citas sin duplicados), ADR-023 (comprobantes privados), ADR-024 (tareas programadas sin duplicados), ADR-025 y ADR-026 (avisos de 004) → M02 Catálogo y citas (cita pendiente, confirmación y vencimiento), M03 Suscripciones y pagos (registro del comprobante del adelanto, sin cobrarlo), M05 Notificaciones (avisos), M06 (tareas y eventos) → PR31, PR32, PR09, PR16.

**Acuerdos de alcance ya tomados** (ADR-033 y constitución 1.5.0, principio V; no se reabren aquí): el cliente paga el adelanto **directamente a la barbería** con el QR de Yape o Plin de la barbería. La plataforma **no recibe, no retiene ni transfiere** ese dinero, **no cobra comisión** y **no maneja datos de tarjeta**; solo registra lo que declara el cliente y la decisión del propietario. **La verificación es manual**: la hace el propietario en su propia aplicación de pagos (limitación declarada). No hay pasarela real, y el cobro de la suscripción (003) no cambia.

**Reutiliza de las funcionalidades 001 a 004 y 006** (no se repite aquí): reglas de la reserva y restricción que impide citas solapadas, estados de la cita (entre ellos **pendiente** y la transición "aprobar"), cancelación con marca de tardía según la antelación mínima de la barbería, agenda e historial (002); comprobantes privados con detección de número de operación repetido y límites de archivo (003); restricciones por estado de la suscripción (003); tareas programadas sin duplicados entre réplicas (003); avisos asíncronos por el canal elegido del cliente y por correo al propietario, sin pérdidas ni duplicados y sin bloquear la operación (004); reprogramación y recordatorio (004); dos réplicas detrás de un balanceador (006); tenant tomado del token, aislamiento entre barberías, auditoría y roles (001).

## Clarifications

### Session 2026-11-12

- Q: Si el cliente registró su pago y el propietario no lo revisa, ¿cuánto dura el límite máximo adicional y qué pasa al alcanzarlo? → A: El límite es el momento más temprano entre **2 horas antes del inicio de la cita** y **24 horas después de la hora límite de pago**. Al alcanzarlo sin decisión del propietario, la cita se cancela sola (sin marca de tardía), se libera el horario, el adelanto queda **por devolver** y se avisa al cliente y al propietario.
- Q: ¿Se registra que la barbería ya devolvió un adelanto "por devolver"? → A: Sí. El propietario marca el adelanto como **devuelto**, con su fecha y sin datos del pago; el cliente ve ese estado y la marca queda en la auditoría de la barbería.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - El propietario activa el adelanto de su barbería (Priority: P1)

El propietario decide que las reservas de su barbería exijan un adelanto. Elige si es un **monto fijo en soles** o un **porcentaje del precio del servicio**, cuánto tiempo tiene el cliente para pagar y sube la imagen del **QR de Yape o Plin** de la barbería. Puede cambiar estos datos o desactivar el adelanto cuando quiera; los cambios valen para las reservas nuevas.

**Why this priority**: sin esta configuración no hay adelanto que pedir. Es la base de todas las demás historias y la decisión de negocio del propietario.

**Independent Test**: con una barbería sin adelanto, el propietario lo activa con un porcentaje del 20 %, un plazo de 30 minutos y su QR; una reserva nueva de un servicio de S/ 40 pide S/ 8. Al desactivarlo, la reserva siguiente se confirma directamente, como en 002.

**Acceptance Scenarios**:

1. **Given** una barbería sin adelanto, **When** el propietario lo activa con un monto fijo de S/ 10, un plazo de 30 minutos y una imagen de QR válida, **Then** la configuración queda guardada y las reservas nuevas piden S/ 10.
2. **Given** el formulario de activación, **When** el propietario intenta guardarlo sin QR, con un monto o porcentaje fuera de rango o con un plazo fuera de rango, **Then** no se guarda y ve qué dato corregir.
3. **Given** un adelanto activo, **When** el propietario cambia el porcentaje o el plazo, **Then** las reservas ya hechas conservan el monto y el plazo con los que se reservaron, y las nuevas usan los valores nuevos.
4. **Given** un adelanto activo con citas pendientes, **When** el propietario lo desactiva, **Then** las reservas nuevas se confirman al instante y las pendientes siguen su curso hasta confirmarse, rechazarse o vencer.
5. **Given** un barbero o un cliente, **When** intenta ver o cambiar la configuración del adelanto, **Then** se le niega.

---

### User Story 2 - El cliente reserva, ve cómo pagar y registra su pago (Priority: P1)

Con el adelanto activo, el cliente reserva como siempre. La cita queda **pendiente** y el horario queda retenido para él. En la confirmación ve el **QR de la barbería**, el **monto del adelanto**, el **código de su reserva** (para escribirlo en el mensaje del pago) y **hasta cuándo** puede pagar. Paga desde su aplicación y registra en la plataforma el **número de operación** y, si quiere, una **captura** del pago. También recibe un aviso con estas instrucciones.

**Why this priority**: es el corazón de RF35: que nadie reserve "por jugar" sin perder el horario. Sin el registro del pago, el propietario no tiene qué comprobar.

**Independent Test**: con el adelanto activo, el cliente reserva; la cita aparece pendiente en su lista y en la agenda, y ese horario ya no aparece libre para otro cliente. El cliente registra un número de operación y el propietario lo ve en la cita como "pago por revisar".

**Acceptance Scenarios**:

1. **Given** una barbería con adelanto activo, **When** el cliente reserva un horario libre, **Then** la cita queda pendiente, el horario deja de aparecer libre para otros y el cliente ve el QR, el monto, el código de la reserva y la hora límite para pagar.
2. **Given** una reserva pendiente, **When** el cliente reserva, **Then** recibe un aviso con las instrucciones de pago (monto, código, hora límite y el enlace a su cita), por su canal elegido.
3. **Given** una cita pendiente dentro del plazo, **When** el cliente registra un número de operación válido, con o sin captura, **Then** queda registrado como "pago por revisar" y el propietario recibe un aviso de comprobante por revisar.
4. **Given** un número de operación ya registrado en otra cita de la misma barbería, **When** el cliente lo registra, **Then** se rechaza sin cambiar nada y se le explica que ese número ya se usó.
5. **Given** una cita pendiente con el pago ya registrado, **When** el cliente intenta registrar otro número, **Then** se rechaza: solo hay un registro de pago por cita mientras el propietario no lo rechace.
6. **Given** otro cliente o un usuario de otra barbería, **When** intenta ver el número de operación o la captura de esa cita, **Then** no puede verlos.

---

### User Story 3 - El propietario comprueba el pago y confirma o rechaza (Priority: P1)

El propietario recibe un aviso cuando un cliente registra su pago. En la agenda o en la lista de pagos por revisar ve el monto esperado, el código de la reserva, el número de operación y la captura si la hay. Comprueba el pago en su propia aplicación de Yape o Plin y **confirma**: la cita pasa a **confirmada** y el cliente recibe un aviso. Si el pago no aparece o no coincide, **rechaza** con un motivo: el cliente recibe un aviso y puede registrar otro número mientras su plazo siga vigente.

**Why this priority**: sin la confirmación del propietario la cita nunca se confirma. Es la verificación manual que exige ADR-033.

**Independent Test**: con una cita pendiente y su pago registrado, el propietario confirma; la cita aparece confirmada en la agenda y en la lista del cliente, y el cliente recibe un aviso. En otra cita, el propietario rechaza con un motivo; el cliente recibe el aviso con el motivo y puede volver a registrar.

**Acceptance Scenarios**:

1. **Given** una cita pendiente con el pago registrado, **When** el propietario confirma, **Then** la cita pasa a confirmada, el adelanto queda como "confirmado" y el cliente recibe un aviso de adelanto confirmado.
2. **Given** una cita pendiente con el pago registrado, **When** el propietario rechaza con un motivo, **Then** la cita sigue pendiente con su horario retenido, el registro rechazado se conserva con su motivo, y el cliente recibe un aviso con el motivo y puede registrar otro número dentro del plazo.
3. **Given** una cita pendiente **sin** pago registrado, **When** el propietario decide no esperar, **Then** puede cancelarla, como cualquier cita, y el horario queda libre.
4. **Given** una cita ya confirmada, **When** el propietario o un segundo intento la confirman otra vez, **Then** no cambia nada y no se envía otro aviso.
5. **Given** el propietario confirma una cita en el mismo momento en que vence su plazo, **When** ambos ocurren a la vez, **Then** solo uno tiene efecto: la cita queda confirmada o cancelada, nunca las dos, y sale un solo aviso.
6. **Given** un barbero, **When** intenta confirmar o rechazar un adelanto, **Then** se le niega.

---

### User Story 4 - El adelanto vence solo (Priority: P2)

Si el cliente no registra su pago antes de la hora límite, la cita **se cancela sola**, el horario queda libre y se avisa al cliente y al propietario. Si el cliente **sí registró** el pago pero el propietario todavía no lo revisó, la cita **no se cancela**: el horario sigue retenido hasta que el propietario confirme o rechace, con un **límite máximo adicional**.

**Why this priority**: evita que un horario quede bloqueado por una reserva que nadie va a pagar. Depende de US2 y US3.

**Independent Test**: con un plazo de pago corto, reservar sin registrar el pago y dejar pasar la hora límite: la cita aparece cancelada, el horario vuelve a estar libre y ambos reciben un aviso. En otra cita, registrar el pago antes de la hora límite y dejarla pasar: la cita sigue pendiente y el horario sigue retenido.

**Acceptance Scenarios**:

1. **Given** una cita pendiente sin pago registrado, **When** pasa su hora límite, **Then** la cita se cancela sola (sin marca de cancelación tardía), el horario queda libre y el cliente y el propietario reciben un aviso de adelanto vencido.
2. **Given** una cita pendiente con el pago registrado y sin revisar, **When** pasa su hora límite, **Then** la cita **no** se cancela y el horario sigue retenido; el propietario ve que el pago está por revisar con el plazo vencido.
3. **Given** una cita pendiente con el pago registrado y sin revisar, **When** se alcanza el límite máximo adicional sin decisión del propietario, **Then** la cita se cancela sola (sin marca de tardía), el horario queda libre, el adelanto queda **por devolver** y el cliente y el propietario reciben un aviso. El límite es el momento más temprano entre 2 horas antes del inicio de la cita y 24 horas después de la hora límite de pago.
4. **Given** un pago rechazado por el propietario, **When** pasa la hora límite sin un registro nuevo, **Then** la cita se cancela sola como en el escenario 1.
5. **Given** dos réplicas en marcha, **When** vence el plazo de 50 citas a la vez, **Then** cada cita se cancela una sola vez y sale un solo aviso por destinatario.

---

### User Story 5 - El adelanto el día de la cita y al cancelar (Priority: P2)

El día de la cita el propietario y el cliente ven el **saldo a pagar** (precio del servicio menos el adelanto confirmado). Si el cliente cancela **con tiempo** (antes de la antelación mínima de la barbería), la plataforma indica que la barbería **debe devolver** el adelanto; si cancela **tarde** o **no asiste**, indica que la barbería **lo retiene**. La devolución la hace la barbería por su cuenta, fuera de la plataforma.

**Why this priority**: completa las reglas de HU29 sobre qué pasa con el dinero, sin que la plataforma lo toque. Puede entregarse después de US1 a US4 sin afectarlas.

**Independent Test**: con una cita confirmada con adelanto de S/ 10 y un servicio de S/ 40, la agenda muestra "saldo S/ 30". Cancelar una cita con tiempo muestra "adelanto por devolver"; cancelar otra tarde muestra "adelanto retenido"; marcar otra como "no asistió" muestra "adelanto retenido".

**Acceptance Scenarios**:

1. **Given** una cita confirmada con adelanto, **When** el propietario o el cliente la ven, **Then** ven el adelanto confirmado y el saldo a pagar.
2. **Given** una cita confirmada con adelanto, **When** el cliente la cancela con tiempo, **Then** la cita queda cancelada y el adelanto queda como "por devolver", y el aviso de cancelación al cliente y al propietario lo indica.
3. **Given** una cita confirmada con adelanto, **When** el cliente la cancela tarde, **Then** queda como cancelación tardía y el adelanto como "retenido".
4. **Given** una cita confirmada con adelanto, **When** se marca como "no asistió", **Then** el adelanto queda como "retenido".
5. **Given** una cita confirmada con adelanto, **When** la cancela el **propietario**, **Then** el adelanto queda como "por devolver" (la cancelación del propietario nunca es tardía para el cliente).
6. **Given** un adelanto "por devolver", **When** la barbería ya lo devolvió, **Then** el propietario lo marca como **devuelto**; queda con la fecha de la marca, el cliente ve el estado "devuelto" en su cita y la marca queda en la auditoría. Un adelanto "retenido" no se puede marcar como devuelto.

---

### Edge Cases

- **Reserva muy cercana a la hora de inicio:** si el plazo para pagar terminaría después del inicio de la cita, la hora límite es el inicio de la cita menos un margen; si no queda margen, la reserva se rechaza con un mensaje que lo explica.
- **Cita registrada por el propietario** (presencial o por teléfono): no exige adelanto; nace confirmada, como en 002.
- **Límite máximo adicional en una reserva cercana al inicio:** si 2 horas antes del inicio ya es más temprano que la hora límite de pago, la cita con el pago registrado sigue retenida hasta su hora de inicio, y el propietario decide hasta entonces (FR-018).
- **Marcar como devuelto** un adelanto que no está "por devolver" (pendiente, confirmado o retenido): se rechaza sin cambios.
- **Cambio o desactivación del adelanto** con citas pendientes: cada cita conserva el monto, el plazo y el QR con los que se reservó; desactivarlo no confirma ni cancela las pendientes.
- **Porcentaje con decimales:** el monto se redondea al céntimo; si el resultado supera el precio del servicio, el adelanto es el precio completo.
- **Servicio gratuito o con precio menor que el monto fijo:** el adelanto nunca supera el precio del servicio; con precio cero no se pide adelanto.
- **Número de operación repetido** en la misma barbería (también en una cita ya cancelada o confirmada): se rechaza. El mismo número en otra barbería no se compara ni se revela (aislamiento entre barberías).
- **Dos registros de pago a la vez** para la misma cita: solo uno queda registrado.
- **Captura de pago** con un tipo de archivo no permitido o demasiado grande: se rechaza sin perder el número de operación escrito.
- **Reprogramar una cita pendiente:** el cliente no puede reprogramarla hasta que esté confirmada (puede cancelarla); el propietario sí puede, y la cita conserva su adelanto y su hora límite.
- **Recordatorio del día (004):** solo se envía a citas confirmadas; una cita pendiente no recibe recordatorio con enlaces.
- **Cancelación de una cita pendiente** por el cliente: se permite; si había un pago registrado sin revisar, el propietario ve el aviso de cancelación con el pago registrado para devolverlo si lo recibió.
- **Suscripción de la barbería vencida o suspendida** (003): no se aceptan reservas nuevas; el propietario puede seguir confirmando, rechazando o cancelando las pendientes que ya existían.
- **Aviso que no sale** (correo caído o WhatsApp sin consentimiento): la operación de la cita se completa igual; el aviso se reintenta o sale por correo, como en 004.
- **El cliente sin correo ni canal** (cliente con cuenta siempre tiene correo): no aplica, porque solo los clientes con cuenta reservan con adelanto.

## Requirements _(mandatory)_

### Functional Requirements

**Configuración (RF35, HU29 criterio 1)**

- **FR-001**: El sistema MUST permitir al propietario activar, cambiar y desactivar el adelanto de su barbería, con: tipo (monto fijo en soles o porcentaje del precio del servicio), valor, plazo para pagar y la imagen del QR de Yape o Plin de la barbería.
- **FR-002**: El sistema MUST validar la configuración: monto fijo entre S/ 1 y S/ 500; porcentaje entre 1 % y 100 %; plazo para pagar entre 10 minutos y 24 horas; imagen del QR en formato de imagen permitido y de tamaño acotado. Una configuración inválida MUST NOT guardarse.
- **FR-003**: Solo el propietario MUST poder ver y cambiar la configuración del adelanto de su barbería.
- **FR-004**: Cada cita MUST conservar el monto, la hora límite y el QR con los que se reservó, aunque la configuración cambie o se desactive después.

**Reserva pendiente y registro del pago (RF35, HU29 criterios 2 y 3)**

- **FR-005**: Con el adelanto activo, una reserva hecha por el cliente MUST quedar **pendiente** con el horario retenido, con las mismas reglas de disponibilidad y sin solapamientos que una reserva de 002. Una reserva registrada por el propietario MUST NOT exigir adelanto.
- **FR-006**: El sistema MUST calcular el monto del adelanto (fijo, o porcentaje del precio redondeado al céntimo), sin superar el precio del servicio; con precio cero no se pide adelanto.
- **FR-007**: El sistema MUST calcular la hora límite como la hora de la reserva más el plazo configurado, sin pasar del inicio de la cita menos un margen; si no queda tiempo para pagar, la reserva MUST rechazarse con un mensaje claro.
- **FR-008**: El cliente MUST ver, en la confirmación de su reserva y en su lista de citas, el QR de la barbería, el monto, el código de la reserva y la hora límite (en hora de la barbería).
- **FR-009**: El cliente MUST poder registrar, dentro del plazo, un número de operación y, opcionalmente, una captura del pago. Solo puede haber un registro de pago vigente por cita.
- **FR-010**: Un número de operación ya registrado en cualquier cita de la misma barbería MUST rechazarse sin efectos.
- **FR-011**: El número de operación y la captura MUST ser privados: solo los ven el cliente de la cita y el propietario de su barbería. La captura MUST validarse por su contenido (tipo y tamaño), como los comprobantes de 003.

**Confirmación y rechazo (RF35, HU29 criterio 4; Cita.aprobar())**

- **FR-012**: Solo el propietario MUST poder confirmar o rechazar el adelanto de una cita de su barbería.
- **FR-013**: Confirmar MUST pasar la cita de pendiente a confirmada (la transición "aprobar" de 002) y dejar el adelanto como confirmado, en una sola operación; una confirmación repetida MUST NOT tener efecto ni enviar otro aviso.
- **FR-014**: Rechazar MUST exigir un motivo (de 5 a 300 caracteres), conservar el registro rechazado con su motivo y dejar la cita pendiente para que el cliente registre otro número dentro de su plazo.
- **FR-015**: La confirmación y el vencimiento de la misma cita MUST excluirse: con operaciones simultáneas, exactamente una tiene efecto y sale un solo aviso.

**Vencimiento (RF35, HU29 criterio 5)**

- **FR-016**: Una cita pendiente **sin** un registro de pago vigente MUST cancelarse sola al pasar su hora límite, sin marca de cancelación tardía, liberando el horario.
- **FR-017**: Una cita pendiente **con** un registro de pago sin revisar MUST NOT cancelarse al pasar su hora límite: el horario sigue retenido hasta que el propietario confirme o rechace, o hasta el límite máximo adicional de FR-018.
- **FR-018**: El límite máximo adicional MUST ser el momento más temprano entre 2 horas antes del inicio de la cita y 24 horas después de la hora límite de pago; si ese momento ya pasó cuando vence la hora límite, el límite es el inicio de la cita. Al alcanzarlo sin decisión del propietario, la cita MUST cancelarse sola (sin marca de tardía), liberar el horario y dejar el adelanto **por devolver**, con aviso al cliente y al propietario.
- **FR-019**: El vencimiento MUST procesarse una sola vez por cita aunque haya varias réplicas, y retomarse sin repetir efectos si se interrumpe.

**Día de la cita y cancelación (RF35, HU29 criterio 6)**

- **FR-020**: Para una cita con adelanto confirmado, el sistema MUST mostrar al propietario y al cliente el adelanto y el saldo a pagar (precio menos adelanto).
- **FR-021**: Al cancelarse una cita con adelanto confirmado, el adelanto MUST quedar "por devolver" si la cancela el cliente con tiempo o el propietario, y "retenido" si el cliente cancela tarde; al marcarse "no asistió", MUST quedar "retenido".
- **FR-022**: El propietario MUST poder marcar un adelanto "por devolver" como **devuelto**, con su fecha y sin datos del pago; el cliente MUST ver ese estado en su cita y la marca MUST quedar en la auditoría. Un adelanto "retenido" MUST NOT marcarse como devuelto.

**Avisos (reutiliza 004)**

- **FR-023**: El sistema MUST avisar, con el mecanismo de avisos de 004 (asíncrono, sin pérdidas ni duplicados entre réplicas, sin bloquear la operación, por el canal elegido del cliente y por correo al propietario): al cliente, las instrucciones de pago al reservar, el adelanto confirmado, el pago rechazado (con el motivo), el adelanto vencido y la cancelación por el límite máximo adicional (con el adelanto por devolver); al propietario, el comprobante por revisar, el adelanto vencido y la cancelación por el límite máximo adicional.
- **FR-024**: Los avisos MUST contener solo lo necesario: barbería, servicio, fecha y hora, monto, código de la reserva, hora límite y, en un rechazo, el motivo. MUST NOT incluir el número de operación completo, la captura ni datos de tarjeta.
- **FR-025**: Una cita pendiente MUST NOT recibir el recordatorio del día de 004; lo recibe solo si está confirmada en el momento del envío.

**Dinero, aislamiento y auditoría (constitución 1.5.0, principio V)**

- **FR-026**: La plataforma MUST NOT recibir, retener ni transferir el dinero del adelanto, MUST NOT cobrar comisión y MUST NOT pedir, guardar ni mostrar datos de tarjeta. Solo registra lo que declara el cliente y la decisión del propietario.
- **FR-027**: El adelanto MUST NOT procesarse por el mecanismo de cobro de la suscripción ni cambiarlo: el cobro de la suscripción de 003 sigue igual.
- **FR-028**: Todo dato del adelanto (configuración, registros de pago, capturas y estados) MUST pertenecer a una sola barbería: un usuario de una barbería nunca ve ni cambia datos de otra.
- **FR-029**: La activación y los cambios de la configuración, el registro del pago, la confirmación, el rechazo, el vencimiento, la cancelación por el límite máximo adicional, la marca de devuelto y el estado final del adelanto MUST quedar en la auditoría de la barbería, sin el número de operación completo ni la captura.
- **FR-030**: Las acciones del cliente y del propietario sobre el adelanto MUST respetar las restricciones por estado de la suscripción de 003, igual que las demás operaciones de la cita.

### Key Entities _(include if feature involves data)_

- **Configuración del adelanto** (una por barbería): si está activo, tipo (monto fijo o porcentaje), valor, plazo para pagar, imagen del QR de la barbería y fecha del último cambio.
- **Adelanto de la cita** (uno por cita pendiente o confirmada con adelanto): monto, código de la reserva, hora límite, QR usado, estado (por pagar, pago por revisar, confirmado, vencido, por devolver, devuelto, retenido) y fechas de cada cambio.
- **Registro de pago del adelanto**: número de operación (único dentro de la barbería), captura opcional y privada, fecha del registro, resultado de la revisión (pendiente, confirmado o rechazado) y motivo del rechazo.
- **Cita** (de 002): suma la relación con su adelanto; usa sus estados existentes, pendiente y confirmada.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: El propietario activa el adelanto de su barbería (tipo, valor, plazo y QR) en menos de 3 minutos.
- **SC-002**: Un cliente registra su pago (número de operación) en menos de 1 minuto desde que ve las instrucciones de pago.
- **SC-003**: El 100 % de las citas pendientes sin pago registrado se cancelan y liberan su horario en 5 minutos o menos después de su hora límite.
- **SC-004**: 0 citas con un pago registrado y sin revisar se cancelan solas antes del límite máximo adicional.
- **SC-005**: El 100 % de los números de operación repetidos en una misma barbería se rechazan, y 0 números de operación o capturas de una cita son visibles para otro cliente o para otra barbería (EQ-23, PR31).
- **SC-006**: Con dos réplicas y confirmaciones simultáneas o una confirmación a la vez que el vencimiento, cada cita tiene exactamente 1 transición y 1 aviso por destinatario; 0 citas quedan confirmadas y canceladas a la vez (EQ-24, PR32).
- **SC-007**: Con 50 reservas simultáneas del mismo horario con adelanto activo, exactamente una queda pendiente y las demás se rechazan por horario no disponible.
- **SC-008**: El 100 % de las operaciones del adelanto se completan aunque el servicio de avisos esté caído; cada aviso llega una sola vez cuando vuelve.
- **SC-009**: En la plataforma no existe ningún campo, registro ni mensaje con datos de tarjeta ni con movimientos de dinero del adelanto (revisión del modelo de datos y de los mensajes).

## Assumptions

- Solo los **clientes con cuenta** reservan con adelanto por el enlace de la barbería; las citas que registra el propietario (presenciales o por teléfono) no lo exigen.
- El **margen** entre la hora límite de pago y el inicio de la cita es de 30 minutos; si la reserva deja menos tiempo para pagar, se rechaza.
- Los **rangos** de configuración (S/ 1 a S/ 500, 1 % a 100 %, 10 minutos a 24 horas) son una propuesta razonable que se ajusta en la planificación si hace falta.
- El **código de la reserva** es corto, legible y único dentro de la barbería; el cliente lo escribe en el mensaje de su pago para que el propietario lo reconozca.
- El número de operación se compara **dentro de la barbería**: cada barbería tiene su propio QR, y comparar entre barberías revelaría información de otra.
- La **captura** del pago sigue las reglas de los comprobantes de 003 (tipos de imagen o PDF y tamaño máximo), y la **imagen del QR** solo admite imágenes.
- La **cancelación con tiempo** usa la antelación mínima de cancelación que ya configura la barbería (002); no se crea una regla nueva.
- El cliente **no puede reprogramar** una cita pendiente (sí cancelarla); el propietario sí puede, y la cita conserva su adelanto.
- Los avisos usan las plantillas en texto simple y el mecanismo de 004; no hay panel de envíos ni configuración de avisos.
- La verificación del pago es **manual**: la plataforma no consulta Yape, Plin ni ningún proveedor. Cobrar el adelanto con una pasarela queda como evolución (ADR-033).
- **Dependencias:** funcionalidades 002 (citas y estados), 003 (comprobantes, restricciones por estado y tareas programadas) y 004 (avisos, reprogramación y recordatorio), todas implementadas.
