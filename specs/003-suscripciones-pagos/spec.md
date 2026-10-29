# Feature Specification: Suscripciones y pagos de las barberías

**Feature Branch**: `003-suscripciones-pagos`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "Crea la feature 003 en el directorio specs/003-suscripciones-pagos. Es el módulo M03 Suscripciones y pagos de la plataforma multi-barbería. Debe cubrir: 1) pago de la suscripción con Yape mediante una pasarela en sandbox o simulada, detrás del puerto PaymentGateway, que pase a producción solo cambiando la configuración; 2) pago por transferencia bancaria con comprobante subido por el dueño y aprobado o rechazado por el administrador de la plataforma; 3) webhook firmado e idempotente, historial de pagos y conciliación; 4) vencimiento automático de la prueba gratuita y de las suscripciones, sin duplicar el trabajo entre las dos réplicas; 5) aislamiento entre barberías y seguridad de los comprobantes. En la especificación describe el qué y el porqué, no la tecnología: las decisiones técnicas van como ADR en /speckit-plan. Incluye casos límite (pago duplicado, webhook repetido, webhook con firma inválida, comprobante rechazado, pasarela caída)."

**Trazabilidad**: HU01 (mínimo), HU17, HU18, HU19, HU20, HU21 → RF02 (mínimo), RF19, RF20, RF21, RF22, RF23, RF24, RF25, RF26 → AC03, AC04, AC05, AC07 / EQ-06, EQ-08, EQ-09, EQ-11, EQ-13, EQ-17 → DA01, DA05, DA07, DA11, DA12 → ADR-003, ADR-007, ADR-010, ADR-012; ADR-022 (pasarela en sandbox o simulada, cambiable por configuración, y transferencia con comprobante), ADR-023 (almacenamiento de los comprobantes), ADR-024 (tareas programadas sin duplicados entre instancias) y ADR-031 (operaciones del administrador de la plataforma, con la enmienda 1.3.0 de la constitución), **Aceptados** (2026-10-24) → M03 Suscripciones y pagos, M01 (administrador de la plataforma, estado de la barbería) → PR06, PR08, PR09, PR13, PR17, PR20, PR25. Riesgos: R07 (pagos duplicados), R08 (proveedor no disponible), R15 (el proveedor no confirma Yape ni entrega credenciales de prueba).

**Acuerdos de alcance ya tomados** (backlog §3.1; no se reabren aquí): Yape se cobra mediante una pasarela peruana en su ambiente de pruebas o, si no está disponible, con un simulador que se comporta igual; pasar a credenciales reales debe requerir solo configuración. La compatibilidad real con Yape sigue **por verificar** con el proveedor (R15). No se hace ningún cobro real en esta entrega.

**Reutiliza de las funcionalidades 001, 002 y 006** (no se repite aquí): la suscripción nace en prueba gratuita al registrar la barbería, y los límites de usuarios y barberos del plan ya se aplican (001 y 002); sesiones, roles y tenant tomado del token; auditoría; dos réplicas detrás de un balanceador y la caché compartida (006).

## Clarifications

### Session 2026-10-24

- Q: ¿Cuándo se aplica un cambio de plan pagado? → A: Al empezar el período pagado, es decir, al terminar el vigente o, si ya venció, al confirmarse el pago. Sin prorrateo (FR-005).
- Q: Si el propietario paga durante los 7 días de gracia, ¿cuándo empieza el período nuevo? → A: Al terminar el período vencido: los días de gracia cuentan dentro del período pagado. Solo una suscripción ya vencida empieza su período al confirmarse el pago (FR-004).
- Q: ¿Qué pasa si el plan que empieza tiene límites menores que lo que la barbería usa? → A: Nada se desactiva solo. La barbería no puede crear ni reactivar usuarios o barberos hasta quedar por debajo del límite, el panel lo avisa, y antes de pagar se muestra lo que excede (FR-005a).
- Q: En una barbería vencida, ¿qué se permite además de ver y pagar? → A: Gestionar las citas existentes (cancelar, confirmar, marcar atendida o no asistió). El catálogo, los horarios, la disponibilidad, los bloqueos y los usuarios quedan de solo lectura (FR-006).

### Session 2026-10-24 (análisis de consistencia)

- Correcciones aprobadas por el responsable tras `/speckit-analyze`: cada pago guarda la cobertura que existía al iniciarlo, y al aprobarse es duplicado si ese período ya está tomado (FR-004, FR-012a); el pago en línea se reutiliza solo con su sesión vigente (FR-012); con un comprobante en revisión no se anula nada (FR-012, FR-021); límite de notificaciones de 600 por minuto, configurable (FR-013a); meta de respuesta al proveedor (FR-018); la activación manual registra el precio del plan (FR-036); clientes y barberos solo ven si la barbería acepta reservas (FR-039).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - El propietario ve su suscripción y la paga con Yape (Priority: P1)

El propietario de una barbería ve en su panel el estado de la suscripción, el plan, las fechas y los días que le quedan de prueba o de período pagado, junto con lo que incluye su plan. Elige un plan y lo paga con Yape: la plataforma lo lleva al flujo de pago del proveedor, que es quien pide y valida los datos de Yape. La suscripción pasa a activa **solo** cuando el proveedor confirma oficialmente el pago, aunque el propietario cierre el navegador antes de volver.

**Why this priority**: es la razón de ser del módulo. Sin cobro, la plataforma no tiene modelo comercial (RF20, RF23, RF24), y el propietario necesita saber cuándo vence para decidir cuándo pagar (RF19).

**Independent Test**: con una barbería en prueba gratuita y la pasarela en modo de pruebas (o el simulador), el propietario inicia un pago con Yape. El proveedor notifica el pago aprobado y la suscripción queda activa con su nuevo período, sin que el propietario vuelva a la plataforma.

**Acceptance Scenarios**:

1. **Given** una barbería en prueba gratuita con 9 días restantes, **When** el propietario abre la pantalla de suscripción, **Then** ve el estado "En prueba", el plan, la fecha de vencimiento, los 9 días restantes y los límites de su plan (usuarios y barberos).
2. **Given** el mismo propietario, **When** elige un plan y paga con Yape, **Then** la plataforma registra un pago "pendiente de confirmación" y lo dirige al flujo del proveedor, sin pedir ni guardar los datos de pago.
3. **Given** un pago pendiente, **When** el proveedor envía la confirmación de pago aprobado con una firma válida, **Then** la suscripción pasa a activa con el plan elegido y un período nuevo, y el pago queda "aprobado". Ambas cosas ocurren juntas o no ocurre ninguna.
4. **Given** un pago pendiente, **When** el proveedor notifica que el pago fue rechazado o que sigue pendiente, **Then** la suscripción no cambia y el propietario ve el pago como rechazado o pendiente.
5. **Given** un pago aprobado, **When** el propietario vuelve del flujo del proveedor (o cierra el navegador sin volver), **Then** el resultado que ve es el que confirmó el proveedor, no lo que dijo el navegador.
6. **Given** una barbería en prueba gratuita a la que le quedan 5 días, **When** paga un plan, **Then** el período pagado empieza al terminar la prueba: no pierde los días que le quedaban.

---

### User Story 2 - La prueba y las suscripciones impagas vencen solas y restringen la barbería (Priority: P1)

Sin que nadie intervenga, la plataforma vence las pruebas gratuitas que terminaron y las suscripciones cuyo período pagado acabó. Una suscripción impaga pasa primero a un período de gracia con aviso y, si sigue sin pagarse, vence. En cada estado la barbería solo puede usar lo que ese estado permite: en una suscripción vencida o suspendida no se aceptan reservas nuevas, pero se conserva toda la información y el propietario puede pagar para recuperar el acceso. Aunque la plataforma corra en dos réplicas, cada vencimiento se aplica una sola vez.

**Why this priority**: RF22 exige el vencimiento automático y RF21 las restricciones. Sin esto, la prueba gratuita nunca termina y nadie tiene razón para pagar (HU19).

**Independent Test**: con dos réplicas en marcha, una barbería con la prueba vencida hace una hora y otra con el período pagado vencido pasan a su nuevo estado una sola vez, con un solo registro de auditoría cada una. La vencida no acepta reservas nuevas, y al pagar vuelve a aceptarlas.

**Acceptance Scenarios**:

1. **Given** una prueba gratuita cuya fecha de fin ya pasó, **When** corre el proceso de vencimiento, **Then** la suscripción queda "vencida", se audita la transición y la barbería deja de aceptar reservas nuevas.
2. **Given** una suscripción activa cuyo período pagado terminó sin un pago nuevo, **When** corre el proceso de vencimiento, **Then** pasa a "en período de gracia" con aviso visible en el panel del propietario, y la barbería sigue operando con normalidad.
3. **Given** una suscripción en período de gracia que terminó sin pago, **When** corre el proceso de vencimiento, **Then** queda "vencida".
4. **Given** dos réplicas que ejecutan el proceso de vencimiento al mismo tiempo, **When** hay 50 suscripciones por vencer, **Then** cada una cambia de estado exactamente una vez y queda un solo registro de auditoría por transición.
5. **Given** una barbería vencida, **When** un cliente intenta reservar (por el enlace público o con su sesión) o el personal intenta crear una cita, **Then** se rechaza con un mensaje claro de que la barbería no acepta reservas por ahora; las citas ya existentes, el catálogo, la agenda y el historial se siguen viendo.
6. **Given** una barbería vencida, **When** el propietario inicia sesión, **Then** puede ver su suscripción, pagar y consultar su historial de pagos.
7. **Given** una barbería vencida, **When** su pago se confirma, **Then** la suscripción queda activa con un período que empieza en ese momento y la barbería vuelve a aceptar reservas.
8. **Given** una suscripción cuyo período terminó el 10 y que está en su cuarto día de gracia, **When** su pago se confirma el 14, **Then** el período nuevo va del 10 al 10 del mes siguiente: los días de gracia cuentan dentro del período pagado.
9. **Given** una barbería vencida con citas futuras, **When** el personal cancela una cita, la confirma o la marca atendida, **Then** se permite; **When** intenta crear un servicio, cambiar el horario, crear un bloqueo o dar de alta un usuario, **Then** se rechaza con un mensaje que indica que la suscripción está vencida.

---

### User Story 3 - El propietario paga por transferencia y el administrador revisa el comprobante (Priority: P2)

Como alternativa a Yape, el propietario transfiere el importe a la cuenta bancaria de la plataforma y sube el comprobante (una imagen o un PDF) desde su panel. El administrador de la plataforma ve la lista de comprobantes por revisar, con la barbería, el plan y el importe esperado, y los aprueba o los rechaza indicando el motivo. Al aprobarlo, la suscripción se activa igual que con un pago en línea; al rechazarlo, el propietario ve el motivo y puede subir otro.

**Why this priority**: es el camino de respaldo si la pasarela no está disponible o si Yape no se confirma con el proveedor (R08, R15), y muchas barberías pequeñas pagan por transferencia. Depende de US1 para el modelo de períodos.

**Independent Test**: el propietario sube un comprobante y el administrador lo aprueba: la suscripción queda activa y el pago, en el historial como "transferencia aprobada". Con otro comprobante rechazado, la suscripción no cambia y el propietario ve el motivo.

**Acceptance Scenarios**:

1. **Given** una barbería en prueba, **When** el propietario elige "transferencia bancaria", **Then** ve los datos de la cuenta de la plataforma, el importe exacto del plan y la referencia que debe indicar.
2. **Given** el propietario con una transferencia hecha, **When** sube un comprobante válido (imagen o PDF dentro del tamaño permitido), **Then** queda un pago "comprobante en revisión" y no puede subir otro para el mismo período mientras ese esté en revisión.
3. **Given** un comprobante en revisión, **When** el administrador lo aprueba, **Then** la suscripción se activa con el plan y el período correspondientes, el pago pasa a "aprobado" y la aprobación queda en auditoría con quién y cuándo.
4. **Given** un comprobante en revisión, **When** el administrador lo rechaza con un motivo, **Then** la suscripción no cambia, el pago pasa a "rechazado" con su motivo y el propietario puede subir un comprobante nuevo.
5. **Given** un archivo que no es una imagen ni un PDF, que supera el tamaño permitido o que dice ser un tipo y es otro, **When** el propietario lo sube, **Then** se rechaza sin guardarlo, con un mensaje que indica qué se acepta.
6. **Given** el comprobante de la barbería A, **When** el propietario o el personal de la barbería B intentan verlo o descargarlo de cualquier forma, **Then** no lo obtienen y no se revela que existe.

---

### User Story 4 - Historial de pagos y conciliación de los pagos que quedaron a medias (Priority: P2)

El propietario ve el historial de los pagos de su barbería: fecha, plan, importe, medio (Yape o transferencia) y estado, sin ningún dato de pago sensible. La plataforma revisa periódicamente con el proveedor los pagos que quedaron pendientes, por ejemplo porque la confirmación nunca llegó, y los cierra con el resultado real.

**Why this priority**: RF25 y RF26. El historial da confianza y control de gastos (HU20). La conciliación evita que un pago aprobado se pierda porque su notificación no llegó, o que un pago quede pendiente para siempre. **Entrega:** la conciliación (FR-026 a FR-028) se entrega junto con US1, porque el cobro con Yape no puede funcionar sin ella; con P2 llegan el historial y la revisión de los pagos marcados.

**Independent Test**: un pago aprobado en el proveedor cuya notificación nunca llegó queda aprobado tras la conciliación y activa la suscripción. El historial muestra todos los pagos de la barbería y ninguno de otra.

**Acceptance Scenarios**:

1. **Given** una barbería con tres pagos (uno aprobado, uno rechazado y un comprobante en revisión), **When** el propietario abre el historial, **Then** ve los tres con fecha, plan, importe, medio y estado, del más reciente al más antiguo, sin datos de tarjeta, números de cuenta completos ni datos del comprobante más allá de su estado.
2. **Given** un pago pendiente cuyo pago el proveedor ya aprobó pero cuya notificación nunca llegó, **When** corre la conciliación, **Then** el pago queda aprobado y la suscripción se activa una sola vez, igual que si hubiera llegado la notificación.
3. **Given** un pago pendiente que el proveedor informa como rechazado o expirado, **When** corre la conciliación, **Then** el pago queda con ese estado y la suscripción no cambia.
4. **Given** un pago pendiente durante más del tiempo máximo de espera sin respuesta del proveedor, **When** corre la conciliación, **Then** el pago queda "expirado" y el propietario puede iniciar uno nuevo.
5. **Given** la conciliación y la notificación del mismo pago llegan casi a la vez, **When** ambas se procesan, **Then** el pago se aprueba una sola vez y la suscripción se extiende un solo período.

---

### User Story 5 - El administrador de la plataforma gestiona barberías y suscripciones (Priority: P3)

El administrador de la plataforma puede suspender y reactivar una barbería (RF02, mínimo), suspender y reactivar su suscripción, y activar un plan a mano con un motivo cuando un pago no pudo procesarse por la plataforma (la contingencia de R08 y R15). Ve el estado de suscripción de cada barbería, pero no sus citas, clientes ni datos de negocio.

**Why this priority**: completa RF22 (suspender y reactivar) y el mínimo de RF02, y da una salida operativa si la pasarela falla. El flujo normal (US1 a US4) funciona sin esto.

**Independent Test**: el administrador suspende una barbería y sus usuarios ya no pueden iniciar sesión; la reactiva y vuelven a poder. Activa a mano el plan de otra con un motivo, y queda en auditoría.

**Acceptance Scenarios**:

1. **Given** una barbería activa, **When** el administrador la suspende, **Then** sus usuarios no pueden iniciar sesión, su enlace público responde "barbería no disponible", sus datos no se borran y la acción queda en auditoría.
2. **Given** una barbería suspendida, **When** el administrador la reactiva, **Then** sus usuarios vuelven a iniciar sesión y su enlace vuelve a funcionar. La suscripción siguió su curso durante la suspensión: si su período venció mientras tanto, queda en el estado que le corresponde por sus fechas.
3. **Given** una suscripción activa, **When** el administrador la suspende con un motivo, **Then** la barbería deja de aceptar reservas nuevas como si estuviera vencida, el propietario ve el motivo y la acción queda en auditoría. Al reactivarla, la suscripción queda en el estado que le corresponde por sus fechas (FR-035); los días suspendidos no se devuelven.
4. **Given** una barbería cuyo pago no pudo procesarse por la plataforma, **When** el administrador activa un plan a mano indicando el motivo y la referencia del pago externo, **Then** la suscripción queda activa con el período correspondiente y el historial muestra un pago "activación manual" con el motivo.
5. **Given** el administrador de la plataforma, **When** intenta ver la agenda, los clientes o el catálogo privado de una barbería, **Then** no puede: sus operaciones se limitan a las de la plataforma.
6. **Given** un propietario, un barbero o un cliente, **When** intentan cualquier operación del administrador de la plataforma, **Then** se rechaza.

### Edge Cases

- **Pago duplicado (R07):** el propietario pulsa "pagar" dos veces o abre dos pestañas a la vez. Solo existe un pago abierto: se le muestra el que ya existe (FR-012). Si de todas formas el proveedor aprueba dos pagos para el mismo período (por ejemplo, uno anulado que el propietario terminó de pagar en su aplicación de Yape), la suscripción se extiende una sola vez y el segundo queda "pago duplicado" para que el administrador lo revise y lo devuelva fuera de la plataforma (FR-012a).
- **Pago aprobado después de que la plataforma lo anuló o lo dio por expirado:** se registra como aprobado; si su período sigue sin pagar, se aplica, y si no, queda como duplicado (FR-012a). El dinero recibido nunca desaparece del historial.
- **Precio del plan cambiado mientras hay un pago en curso:** el pago conserva el importe con el que se inició (FR-005b), y la notificación se compara con ese importe.
- **Pagar más de un período por adelantado:** se rechaza al iniciarlo con un mensaje claro (FR-004).
- **Importe fuera del rango que el proveedor admite para Yape** (por debajo del mínimo o por encima del máximo): ese medio no se ofrece para ese plan y queda la transferencia.
- **Notificación repetida (EQ-17):** el proveedor envía la misma notificación 10 veces o la reenvía días después. Solo la primera tiene efecto: una transición de estado y un registro de pago; las demás se reconocen como ya procesadas y se responden como recibidas, para que el proveedor deje de reenviarlas.
- **Notificación con firma inválida o sin firma:** se rechaza sin ningún efecto y queda registrada como intento sospechoso, sin guardar su contenido como verdadero. Lo mismo si la firma es válida pero el evento es de otra cuenta del proveedor.
- **Notificación de un pago desconocido, o con un importe o una moneda que no coinciden:** no activa nada; queda registrada para revisión del administrador.
- **Notificaciones fuera de orden:** un "pendiente" que llega después de un "aprobado" no deshace la aprobación. Un "aprobado" que llega después de un "rechazado" no se aplica solo: queda para revisión del administrador (FR-017).
- **Devolución o contracargo de un pago aprobado:** se registra y queda para revisión del administrador; la suscripción no cambia sola (FR-017a).
- **Comprobante rechazado:** la suscripción no cambia. Si la prueba o el período vencen mientras tanto, el vencimiento sigue su curso. El propietario puede subir un comprobante nuevo, que vuelve a la cola de revisión.
- **Comprobante en revisión al vencer el período:** la barbería entra en período de gracia como cualquier impaga. Si el administrador aprueba después, el período empieza según FR-004 (durante la gracia, según la regla de pago en período de gracia; ya vencida, desde la aprobación); no se cobra por el tiempo vencido.
- **Comprobante de un período ya pagado:** el administrador lo rechaza como duplicado; nunca extiende dos veces el mismo período.
- **Comprobante reutilizado:** el mismo número de operación bancaria presentado por otra barbería, o dos veces por la misma, no se aprueba dos veces; el administrador ve que ya figura en otro pago (FR-022b).
- **Transferencia por un importe distinto al del plan:** se rechaza con el motivo; la diferencia se devuelve o se completa fuera de la plataforma (FR-022a).
- **Dos administradores revisan el mismo comprobante a la vez:** se aplica la primera revisión y la otra recibe "ya fue revisado" (FR-022c).
- **Avalancha de comprobantes o de notificaciones falsas:** se limitan por día y por origen (FR-020a, FR-013a), sin afectar a las demás barberías.
- **Pasarela caída o lenta (EQ-06, R08):** si el proveedor no responde al iniciar el pago, el propietario ve en 3 segundos o menos el mensaje "el pago en línea no está disponible ahora; inténtalo más tarde o paga por transferencia", y no queda ningún cobro a medias. Tras fallos repetidos, la plataforma deja de intentar durante un rato y muestra el mensaje al instante. El resto de la plataforma sigue funcionando.
- **Pago aprobado por el proveedor mientras corre el vencimiento:** si el pago confirmado cubre el período, el estado final es "activa", nunca "vencida", sea cual sea el orden en que se procesen.
- **Importe del plan por encima del máximo de Yape:** si el importe supera el límite que el proveedor admite para Yape, ese medio no se ofrece para ese plan y queda la transferencia.
- **Proceso de vencimiento interrumpido** (una réplica se cae a mitad): lo que quedó sin procesar se procesa en la siguiente ejecución, y nada se procesa dos veces.
- **Las dos réplicas caídas cuando una suscripción debía vencer:** vence en la primera ejecución tras volver, con la fecha de vencimiento real en la auditoría.
- **Comprobante con datos personales** (nombres, parte del número de cuenta): se trata como dato personal; solo lo ven el propietario de esa barbería y el administrador de la plataforma, y nunca aparece en registros, mensajes de error ni enlaces públicos.
- **Enlace de descarga de un comprobante copiado y reenviado:** deja de funcionar a los pocos minutos y nunca sirve sin una sesión con permiso para verlo.
- **Barbería o suscripción suspendida con un pago aprobado por el proveedor:** el pago se registra y el período se extiende, pero la barbería o la suscripción siguen suspendidas hasta que el administrador las reactive (FR-035).
- **Cambio a un plan con límites menores que lo que la barbería usa:** el propietario ve antes de pagar qué excede, y al empezar el período se aplica la regla de FR-005a.

## Requirements _(mandatory)_

### Functional Requirements

#### Estado, planes y restricciones

- **FR-001**: El propietario MUST poder consultar el estado de su suscripción (en prueba `TRIAL`, activa `ACTIVE`, en período de gracia `PAST_DUE`, vencida `EXPIRED`, cancelada `CANCELLED`, suspendida `SUSPENDED`; los nombres de HU17), el plan, las fechas de inicio y de fin del período o de la prueba, los días restantes y los límites y funciones de su plan (RF19, HU17).
- **FR-002**: Los planes MUST ser datos de la plataforma (nombre, precio mensual en soles, límites de usuarios y barberos y funciones incluidas) editables sin cambiar el código; los precios son referenciales (HU18).
- **FR-003**: La suscripción MUST cobrarse por períodos mensuales pagados por adelantado, sin cobro automático: el propietario paga cada período.
- **FR-004**: Un período pagado MUST empezar al terminar la prueba o el período vigente si todavía no venció, o al confirmarse el pago si ya venció. Ningún pago extiende dos veces el mismo período.
  - **Duración:** un período dura un mes calendario desde su inicio; si ese día no existe en el mes siguiente, termina el último día de ese mes (un período que empieza el 31 de enero termina el 28 o 29 de febrero).
  - **Pago en período de gracia:** si el propietario paga durante los 7 días de gracia, el período nuevo empieza al terminar el período vencido: los días de gracia cuentan dentro del período pagado. Solo una suscripción ya vencida empieza su período al confirmarse el pago.
  - **Pago por adelantado:** se puede pagar el período siguiente en cualquier momento del vigente o de la prueba, pero como máximo **un** período por adelantado. Un pago cuando ya está pagado el período siguiente se rechaza al iniciarlo **y también al aprobarse** (en ese caso queda como "pago duplicado", FR-012a).
  - **Fechas del período:** se fijan al aprobarse el pago, no al iniciarlo. Si el período vigente venció entre el inicio y la confirmación, el período nuevo empieza al confirmarse.
  - **Período objetivo:** al iniciarse, cada pago registra la cobertura vigente en ese momento (hasta qué fecha estaba cubierta la suscripción). Al aprobarse, si ya existe un período que empieza en esa fecha o después, el período objetivo ya está tomado y el pago es un duplicado: nunca crea un período más.
- **FR-005**: Un cambio de plan MUST pagarse como un período nuevo del plan elegido y regir desde que ese período empieza (FR-004): al terminar el vigente o, si ya venció, al confirmarse el pago. Hasta entonces sigue el plan vigente con sus límites. No hay prorrateo (línea de corte de 003).
- **FR-005a**: Si el plan que empieza tiene límites de usuarios o barberos menores que los que la barbería usa, nada MUST desactivarse solo: la barbería MUST NOT poder crear ni reactivar usuarios o barberos hasta quedar por debajo del límite, y el panel MUST avisarlo con lo que excede. Además, antes de pagar un plan cuyos límites son menores que lo que la barbería usa hoy, el propietario MUST ver un aviso con lo que excede.
- **FR-005b**: El importe de un pago MUST fijarse con el precio del plan al iniciarlo. Un cambio posterior del precio no afecta a los pagos ya iniciados ni a los períodos ya pagados.
- **FR-006**: Cada estado MUST permitir solo lo que le corresponde (RF21, HU19):
  - en prueba, activa y en período de gracia: operación normal con los límites del plan;
  - vencida, cancelada y suspendida: no se aceptan reservas nuevas, por ninguna vía (enlace público, cliente con sesión ni cita presencial del personal). Se conservan y se siguen viendo el catálogo, la agenda, las citas existentes y el historial, y el propietario puede iniciar sesión, ver su suscripción y pagar. Además, se pueden gestionar las citas existentes (cancelar, confirmar, marcar atendida o no asistió). El catálogo, los horarios de atención, la disponibilidad, los bloqueos y los usuarios quedan de solo lectura.
  - Ninguna restricción borra datos ni cancela citas ya reservadas; los clientes con citas futuras conservan su cita.
- **FR-007**: Las restricciones de FR-006 MUST aplicarse en el servidor en cada operación afectada, nunca solo en la interfaz. Una reserva rechazada por el estado de la suscripción MUST recibir un mensaje claro y distinto de "horario no disponible".

#### Pago en línea con Yape (pasarela)

- **FR-008**: El propietario MUST poder pagar un plan con Yape mediante el flujo alojado del proveedor de pagos. La plataforma MUST NOT pedir, recibir, guardar, registrar ni transportar datos de tarjeta ni credenciales de Yape (RF23, principio V).
- **FR-009**: Al iniciar un pago, la plataforma MUST registrar un pago "pendiente de confirmación" con el plan, el importe, la moneda y qué período cubre (el siguiente sin pagar; sus fechas se fijan al aprobarse, FR-004), antes de dirigir al propietario al proveedor.
- **FR-010**: La suscripción MUST activarse o extenderse **solo** con la confirmación oficial del proveedor (su notificación o la conciliación), nunca por lo que informe el navegador (principio V).
- **FR-011**: La plataforma MUST funcionar contra el ambiente de pruebas del proveedor o contra un simulador con el mismo comportamiento, incluidas las notificaciones firmadas y los rechazos. Pasar a credenciales reales MUST requerir solo configuración, sin cambiar el código (acuerdo de alcance; R15).
- **FR-012**: Una suscripción MUST tener a lo sumo **un pago abierto** a la vez (pendiente de confirmación o comprobante en revisión), también cuando dos intentos llegan al mismo tiempo, por ejemplo desde dos pestañas. Repetir el mismo intento (mismo plan y medio) MUST reutilizar el pago abierto **solo si su sesión de pago sigue vigente**; si venció, MUST anularlo (cancelándolo en el proveedor cuando este lo permita) y crear uno nuevo. Elegir otro plan u otro medio MUST anular antes el pago abierto, salvo que tenga un **comprobante en revisión**: entonces MUST rechazarse el intento nuevo y no anularse nada, porque el dinero pudo haberse transferido ya (FR-021).
- **FR-012a**: **El dinero recibido nunca se ignora.** Un pago que el proveedor aprueba MUST registrarse siempre como aprobado, aunque la plataforma lo hubiera anulado o expirado (FR-012, FR-027). Si su período objetivo (FR-004) sigue sin pagar, MUST aplicarse; si ya estaba tomado, MUST quedar "pago duplicado" para revisión del administrador y devolución fuera de la plataforma (R07).

#### Notificaciones del proveedor

- **FR-013**: La plataforma MUST aceptar una notificación del proveedor solo si su firma es válida y corresponde a la cuenta configurada. Lo no firmado o mal firmado MUST rechazarse sin ningún efecto y registrarse como intento sospechoso (RF24, EQ-17).
- **FR-013a**: El punto de recepción de notificaciones MUST tener un límite de solicitudes por origen (600 por minuto por defecto, configurable), y los intentos sospechosos MUST registrarse de forma resumida (sin guardar el cuerpo completo), para que una avalancha de notificaciones falsas no degrade la plataforma ni llene el almacenamiento.
- **FR-013b**: De cada notificación válida MUST guardarse solo lo necesario para la idempotencia y la conciliación (identificador de evento, pago, estado, importe y moneda), sin datos personales del pagador (por ejemplo, su número de teléfono de Yape).
- **FR-014**: Cada notificación MUST procesarse una sola vez por su identificador de evento: repetirla MUST NOT producir una segunda transición, un segundo registro de pago ni un segundo período (RF24, EQ-17).
- **FR-015**: La actualización del pago y de la suscripción MUST ser atómica: o se aplican ambas, o ninguna (RF24).
- **FR-016**: Una notificación que no corresponde a un pago registrado, o cuyo importe o moneda no coinciden, MUST NOT activar nada y MUST quedar para revisión del administrador.
- **FR-017**: Un pago aprobado MUST NOT volver a pendiente ni pasar a rechazado por notificaciones posteriores: un evento atrasado se registra sin efecto. Una aprobación posterior a un rechazo no se aplica sola: MUST quedar para revisión del administrador. Los estados "anulado" y "expirado" los decide la plataforma, no el proveedor, y por eso sí ceden ante una aprobación (FR-012a).
- **FR-017a**: Si el proveedor informa una devolución o un contracargo de un pago aprobado, la plataforma MUST registrarlo y dejarlo para revisión del administrador, sin cambiar la suscripción automáticamente. El administrador decide si suspende la suscripción (FR-035).
- **FR-018**: La respuesta al proveedor MUST indicar recibido cuando la notificación ya fue procesada o es válida, para que no la siga reenviando, y MUST darse sin depender de tareas lentas: en 1 segundo o menos para el 95 % de las notificaciones.

#### Transferencia bancaria con comprobante

- **FR-019**: El propietario MUST poder elegir la transferencia bancaria y ver los datos de la cuenta de la plataforma, el importe exacto y una referencia de pago propia de su barbería y período.
- **FR-020**: El propietario MUST poder subir un comprobante por pago, en imagen (JPG o PNG) o PDF, de hasta 5 MB. El tipo real del archivo MUST verificarse por su contenido, no por su nombre, y lo que no cumpla MUST rechazarse sin guardarse. El propietario MUST indicar además el número de operación bancaria y la fecha de la transferencia.
- **FR-020b**: La fecha de la transferencia MUST ser un día de calendario de la barbería (hora de Lima) que no sea posterior a hoy ni tenga más de 30 días; si no, el comprobante MUST rechazarse sin guardarse. Si la fecha es anterior al día en que se inició el pago, con un día de tolerancia por la hora de Lima (el mismo día y el día anterior no cuentan), el comprobante MUST aceptarse igual y el pago MUST quedar marcado "fecha anterior al pago", visible para el administrador en la lista de comprobantes por revisar. La marca es informativa: MUST NOT impedir la aprobación ni el rechazo, y queda resuelta al revisar el comprobante.
- **FR-020a**: Una barbería MUST poder subir como máximo 5 comprobantes por día. Al verlo o descargarlo, el comprobante MUST entregarse con su tipo verificado y como archivo, sin que la plataforma lo interprete ni lo muestre como página.
- **FR-021**: Un pago con comprobante MUST quedar "comprobante en revisión". Mientras esté en revisión, MUST NOT aceptarse otro comprobante ni otro pago para la misma suscripción (FR-012).
- **FR-022**: El administrador de la plataforma MUST ver la lista de comprobantes por revisar (barbería, plan, importe esperado, referencia, número de operación, fecha de la transferencia, fecha de envío y si la fecha es anterior al pago, FR-020b), ver cada comprobante y aprobarlo o rechazarlo. El rechazo MUST incluir un motivo.
- **FR-022a**: Un comprobante MUST aprobarse solo si el importe transferido es exactamente el esperado. Los pagos parciales o de más se rechazan con su motivo, y la diferencia se resuelve fuera de la plataforma.
- **FR-022b**: Un mismo número de operación bancaria MUST NOT aprobarse dos veces, ni en la misma barbería ni en otra. Al revisar, el administrador MUST ver si ese número ya figura en otro pago, para detectar un comprobante reutilizado.
- **FR-022c**: Cada comprobante MUST revisarse una sola vez. Si dos revisiones llegan a la vez (dos pestañas o dos administradores), MUST aplicarse solo la primera, y la segunda MUST recibir "ya fue revisado".
- **FR-023**: Aprobar un comprobante MUST activar o extender la suscripción como un pago confirmado (FR-004, FR-015). Rechazarlo MUST dejar la suscripción sin cambios y permitir un comprobante nuevo.
- **FR-024**: Cada aprobación y cada rechazo MUST quedar en auditoría con el administrador, la fecha y el resultado, sin copiar el contenido del comprobante (RF25, EQ-13).

#### Historial y conciliación

- **FR-025**: El propietario MUST poder consultar el historial de pagos de su barbería (fecha, plan, importe, medio y estado, con el motivo si fue rechazado), del más reciente al más antiguo. El historial MUST NOT mostrar datos de tarjeta ni números de cuenta completos (RF25, HU20).
- **FR-025a**: El administrador de la plataforma MUST ver una lista de pagos por revisar: pagos duplicados, notificaciones de pagos desconocidos o con importe distinto, aprobaciones posteriores a un rechazo, y devoluciones o contracargos. Cada caso MUST poder marcarse como resuelto, con una nota, y la acción queda en auditoría.
- **FR-026**: La plataforma MUST conciliar con el proveedor, al menos cada 15 minutos, los pagos en línea pendientes desde hace más de 10 minutos, y cerrarlos con el estado real: aprobado (con el mismo efecto que la notificación), rechazado o expirado (RF26).
- **FR-027**: Un pago en línea pendiente durante 24 horas sin una respuesta final del proveedor MUST quedar expirado, y el propietario MUST poder iniciar uno nuevo. Si después el proveedor lo aprueba, se aplica FR-012a.
- **FR-028**: La conciliación y la notificación del mismo pago MUST producir un solo efecto, en cualquier orden.

#### Vencimiento automático y tareas programadas

- **FR-029**: La plataforma MUST vencer automáticamente, sin intervención: la prueba gratuita al llegar su fecha de fin (pasa a vencida), y el período pagado al terminar sin pago nuevo (pasa a período de gracia y, al terminar la gracia, a vencida) (RF22).
- **FR-030**: El período de gracia MUST durar 7 días, durante los cuales el panel del propietario MUST mostrar un aviso con la fecha en que vencerá.
- **FR-031**: Cada transición automática MUST aplicarse a lo sumo una hora después de su fecha, y MUST quedar en auditoría con la fecha que le correspondía.
- **FR-032**: Con varias réplicas en marcha, cada transición automática y cada conciliación de un pago MUST ejecutarse exactamente una vez. Una ejecución interrumpida MUST retomarse en la siguiente sin repetir lo ya hecho.
- **FR-033**: Si un pago confirmado cubre el período, el resultado final MUST ser "activa" aunque el vencimiento se procese al mismo tiempo.

#### Administración de la plataforma (RF02 mínimo, RF22)

- **FR-034**: El administrador de la plataforma MUST poder suspender y reactivar una barbería (RF02). Una barbería suspendida no permite iniciar sesión a sus usuarios, su enlace público responde "barbería no disponible" y sus datos no se borran (HU01).
- **FR-035**: El administrador MUST poder suspender y reactivar la suscripción de una barbería con un motivo. Mientras está suspendida, sus fechas siguen corriendo y los pagos que se aprueben se registran y extienden el período, pero la suscripción sigue suspendida. Al reactivarla, queda en el estado que le corresponde por sus fechas (en prueba, activa, en gracia o vencida); los días suspendidos no se devuelven (RF22).
- **FR-036**: El administrador MUST poder activar un plan a mano con un motivo y la referencia de un pago hecho fuera de la plataforma (contingencia de R08 y R15). Queda en el historial como "activación manual", con el **precio del plan** como importe. Sigue las mismas reglas que un pago: un período a la vez, sin extender dos veces el mismo período, y anula el pago abierto si lo hay (FR-004, FR-012).
- **FR-037**: Toda acción del administrador de la plataforma MUST quedar en auditoría (quién, qué barbería, qué acción, cuándo y el motivo) (EQ-13).
- **FR-038**: El administrador de la plataforma MUST actuar solo mediante las operaciones de la plataforma de esta funcionalidad (barberías, suscripciones, pagos y comprobantes). MUST NOT poder ver ni cambiar citas, clientes, catálogo ni usuarios de una barbería.
- **FR-039**: Las operaciones del administrador MUST estar disponibles solo para ese rol, y las del propietario sobre su suscripción, solo para el propietario de esa barbería (barberos y clientes no ven ni pagan la suscripción: solo pueden saber si la barbería acepta reservas, con su mensaje, sin el estado de la suscripción) (EQ-08). La matriz de permisos MUST probarse celda por celda (PR08).

#### Aislamiento y seguridad de los comprobantes

- **FR-040**: Los pagos, las suscripciones, las notificaciones registradas y los comprobantes de una barbería MUST ser invisibles para cualquier otra barbería, por cualquier vía. MUST existir pruebas de aislamiento que lo demuestren, incluidos los comprobantes (PR09, principio III).
- **FR-041**: Los comprobantes MUST guardarse fuera de cualquier ubicación pública, MUST verse o descargarse solo con una sesión del propietario de esa barbería o del administrador de la plataforma, y MUST entregarse mediante un acceso de corta duración (minutos), nunca con un enlace permanente.
- **FR-042**: El contenido y el nombre original de un comprobante MUST NOT aparecer en registros, mensajes de error, auditoría ni respuestas de otras operaciones.
- **FR-043**: Las credenciales del proveedor y el secreto de verificación de firmas MUST estar solo en la configuración del servidor, nunca en el código, en el repositorio ni en los registros (EQ-11).

#### Resiliencia y pruebas

- **FR-044**: Si el proveedor no responde a tiempo al iniciar un pago, el propietario MUST recibir en 3 segundos o menos un mensaje con la alternativa (reintentar más tarde o pagar por transferencia), y el pago MUST quedar anulado, sin cobro a medias. Tras 5 fallos en 60 segundos la plataforma MUST dejar de llamar al proveedor durante un intervalo y responder el mensaje al instante (EQ-06). El resto de la plataforma MUST seguir operando (EQ-06, ADR-012).
- **FR-045**: MUST existir pruebas automáticas, con el simulador del proveedor, de: notificación válida, repetida (10 veces) y con firma inválida (PR17); fallos y lentitud del proveedor (PR06); el mismo comportamiento con el simulador y con el ambiente de pruebas del proveedor (PR20); las transiciones de estado de la suscripción (PR25); el vencimiento con dos réplicas sin duplicados; y la conciliación.

### Key Entities

- **Plan**: oferta comercial de la plataforma. Nombre, precio mensual en soles (referencial), límites de usuarios y barberos, funciones incluidas e indicador de si ofrece prueba gratuita. Es global, no de una barbería.
- **Suscripción**: la relación de una barbería con un plan. Estado, plan vigente, fin de la prueba, inicio y fin del período pagado, fin del período de gracia y motivo de suspensión si la hay. Una por barbería.
- **Pago**: cada intento de pagar un período. Barbería, plan, importe y moneda fijados al iniciarlo, medio (Yape por la pasarela, transferencia o activación manual), cobertura vigente al iniciarlo (período objetivo, FR-004) y período que cubre (fechas fijadas al aprobarse), estado (pendiente de confirmación, esperando comprobante, comprobante en revisión, aprobado, rechazado, anulado, expirado; "pago duplicado" es un pago aprobado con la marca de duplicado), referencia del proveedor o de la transferencia (con el número de operación bancaria), motivo de rechazo, marca "por revisar" con su resolución, y fechas. Nunca datos de tarjeta.
- **Notificación del proveedor**: cada evento recibido; es una tabla de la plataforma, sin datos de negocio (constitución 1.3.1). Identificador de evento (único), pago al que se refiere, resultado de la verificación de la firma, estado informado y si tuvo efecto. Sirve para la idempotencia y para investigar intentos sospechosos.
- **Comprobante**: el archivo que respalda una transferencia. Barbería, pago, tipo y tamaño verificados, quién lo subió y cuándo, y la revisión (administrador, resultado, motivo, fecha). El contenido se guarda aparte, con acceso restringido.
- **Ejecución de tarea programada**: registro de cada corrida del vencimiento y de la conciliación (cuándo, qué réplica, qué procesó), para garantizar que cada trabajo se hace una sola vez y poder auditarlo.
- **Administrador de la plataforma**: cuenta de la plataforma que no pertenece a ninguna barbería y opera solo sobre barberías, suscripciones, pagos y comprobantes.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Un propietario completa el pago de un plan con Yape, desde su panel hasta ver la suscripción activa, en 3 minutos o menos en el ambiente de pruebas, sin ayuda.
- **SC-002**: La misma notificación enviada 10 veces produce exactamente 1 transición de estado y 1 registro de pago aprobado; el 100 % de las notificaciones con firma inválida o sin firma se rechazan sin efecto (EQ-17).
- **SC-003**: Con dos réplicas ejecutando el vencimiento a la vez sobre 50 suscripciones por vencer, cada una cambia de estado exactamente una vez, a lo sumo una hora después de su fecha, con una sola entrada de auditoría.
- **SC-004**: El 100 % de los pagos pendientes que el proveedor ya resolvió quedan cerrados con su estado real en la siguiente conciliación, sin intervención manual, y ninguno extiende la suscripción dos veces.
- **SC-005**: Con la pasarela caída o lenta, el propietario recibe el mensaje con la alternativa en 3 segundos o menos, y las reservas, la agenda y el catálogo de todas las barberías siguen funcionando (EQ-06).
- **SC-006**: Cero accesos de una barbería a pagos, suscripciones o comprobantes de otra en la suite de aislamiento, incluidos los intentos con identificadores ajenos; el 100 % de los comprobantes son inaccesibles sin una sesión con permiso (EQ-09).
- **SC-007**: El administrador revisa un comprobante (verlo y aprobarlo o rechazarlo con motivo) en 2 minutos o menos.
- **SC-008**: Una barbería vencida rechaza el 100 % de las reservas nuevas por todas las vías y conserva el 100 % de sus datos; al confirmarse su pago vuelve a aceptar reservas de inmediato.
- **SC-009**: Pasar del simulador al ambiente de pruebas del proveedor, o a credenciales reales, no cambia ninguna línea de código: solo la configuración, y la misma suite de pruebas pasa con ambos (PR20).
- **SC-010**: Ningún dato de tarjeta, credencial de Yape, secreto del proveedor ni contenido de comprobante aparece en los registros, la auditoría ni las respuestas de error (comprobado con datos canario).
- **SC-011**: El 100 % de los pagos que el proveedor aprueba aparecen como aprobados en el historial, incluidos los que la plataforma había anulado o dado por expirados; ninguno extiende dos veces el mismo período, y ningún número de operación bancaria se aprueba dos veces.

## Assumptions

- **Proveedor y Yape (R15):** el proveedor concreto, su ambiente de pruebas y si admite Yape se deciden y documentan en ADR-022. Si el ambiente de pruebas no está disponible al día 11 del plan, se usa el simulador (línea de corte de 003). No se hacen cobros reales. **Por verificar con el proveedor:** que sus reenvíos de notificaciones lleguen firmados de nuevo, con una marca de tiempo nueva (supuesto del diseño).
- **Renovación manual:** como Yape y la transferencia no permiten cobros automáticos recurrentes, cada período se paga explícitamente. Los avisos por correo antes del vencimiento llegan con la funcionalidad 004; en 003 el aviso se ve en el panel.
- **Moneda y período:** soles y períodos mensuales. Los planes anuales y la facturación electrónica (boleta o factura) quedan fuera de esta funcionalidad.
- **Precios:** los valores de los planes son datos de prueba referenciales (HU18), editables sin cambiar el código. Su edición desde una pantalla del administrador queda fuera: se cargan como datos de la plataforma.
- **Límite de Yape:** el proveedor candidato admite Yape hasta un monto máximo por pago (ADR-007); los planes de prueba quedan por debajo de ese máximo.
- **Cancelación por el propietario:** no hay una acción de "cancelar suscripción". El propietario simplemente no paga y la suscripción vence. El estado "cancelada" queda reservado y se trata como vencida en las restricciones.
- **Reembolsos:** los pagos duplicados o erróneos se devuelven fuera de la plataforma; aquí solo se marcan y se ven en el historial.
- **Administrador de la plataforma:** la primera cuenta se crea con un paso operativo documentado (no hay registro público para ese rol). Su acceso es distinto del de las barberías, y cómo se compatibiliza con el principio III (tenant tomado del token) se resuelve en `/speckit-plan`, con revisión de la constitución. Como esa cuenta puede activar planes sin cobro, su autenticación y sus sesiones MUST ser al menos tan estrictas como las del propietario, y el plan evalúa exigir un segundo factor.
- **Precios con impuestos:** los precios referenciales de los planes incluyen impuestos; no se emite comprobante tributario.
- **Retención de barberías vencidas:** una barbería vencida conserva sus datos sin plazo; su eliminación, si la pide, sigue las reglas de la funcionalidad 007.
- **Datos de la cuenta bancaria de la plataforma:** son configuración. Las transferencias se revisan a mano; no hay conexión con el banco.
- **Retención de comprobantes:** se conservan mientras exista el pago, como respaldo del cobro. Su eliminación junto con la barbería sigue las reglas de la funcionalidad 007.
- **Zona horaria:** las fechas de vencimiento se calculan como instantes; el panel las muestra en la zona horaria de la barbería.
- **Dependencias:** reutiliza la suscripción en prueba gratuita creada al registrar la barbería (001) y los límites del plan ya aplicados (001 y 002); el aviso de "no acepta reservas" se integra en la reserva de 002; las dos réplicas y el balanceador de 006 se usan para probar que las tareas no se duplican.
- **Fuera de alcance:** pago de citas por clientes (principio V), tarjetas como medio de pago en esta entrega, cobro automático recurrente, prorrateo, facturación electrónica y notificaciones por correo o WhatsApp (004). **Trabajo futuro:** la rotación de la llave que cifra los secretos del segundo factor del administrador.
