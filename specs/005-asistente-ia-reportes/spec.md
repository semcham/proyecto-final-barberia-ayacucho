# Feature Specification: Asistente de IA y reportes (versión mínima)

**Feature Branch**: `005-asistente-ia-reportes`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "Funcionalidad 005 "Asistente de IA y reportes" (módulo M04). Versión MÍNIMA para la entrega del 18 de noviembre; alcance cortable por historia. US1 (P1) RF27: asistente del CLIENTE que consulta servicios, precios y disponibilidad de una barbería; solo lectura, solo con casos de uso del backend (M04 depende de M02/M03 solo por su API pública), sin reservar, sin datos de otros clientes, sin salirse de la barbería. US2 (P1) RF29: reportes por período para el propietario, en tablas, sin gráficos: citas, servicios más solicitados y actividad; no requiere IA. US3 (P3, la primera que se recorta) RF28: asistente del PROPIETARIO con pocas herramientas (resumen de citas y servicios más pedidos), solo con datos autorizados. Condiciones: proveedor de IA detrás de un puerto (OpenRouter solo en desarrollo; la llave nunca en el repositorio); proveedor falso en pruebas; cuotas por usuario y por barbería; defensa ante inyección de instrucciones con un conjunto adversarial mínimo (PR19); respuestas apoyadas en datos de las herramientas, nunca inventados; errores claros si el proveedor no responde; sin datos personales de terceros en respuestas ni registros. Respetar la constitución y no cambiar código de otras funcionalidades."

**Trazabilidad**: HU22 → RF27; HU24 → RF29; HU23 → RF28 → AC01, AC03 / EQ-06 (falla del proveedor de IA), EQ-09 (aislamiento), EQ-12 (límite de uso del asistente), EQ-19 (privacidad en el asistente) → DA08 (integración de IA), DA09 (control de costos) → ADR-008 (IA desacoplada con herramientas cerradas), **ADR-027** (proveedor de IA: OpenRouter solo en desarrollo, por escribir) y **ADR-028** (contrato del asistente: respuestas con datos de las herramientas, cuotas y defensa ante inyección, por escribir), ADR-012 (resiliencia ante servicios externos) → M04 Asistente IA y reportes (usa M02 y M03 solo por sus interfaces públicas) → PR06 (IA), PR09, PR12, PR19, PR20 (contrato del proveedor de IA).

**Plazo y forma de corte**: entrega el **18 de noviembre de 2026**. Cada historia se entrega y se prueba sola, en este orden: **US1** y **US2** (P1) y después **US3** (P3), que es la **primera que se recorta** si no alcanza el tiempo. Dentro de cada historia se aplican las líneas de corte del [backlog](../../docs/05-gestion/02-backlog-y-sprints.md) para 005: reportes en tablas sin gráficos, asistente del propietario con pocas herramientas y un conjunto adversarial mínimo para PR19.

**Acuerdos de alcance ya tomados** (constitución 1.6.0, principio VI, y ADR-008; no se reabren aquí): el asistente **solo lee**: no reserva, no cancela, no cambia nada. Actúa **solo a través de herramientas cerradas por rol** que usan los casos de uso ya existentes de otros módulos; nunca consulta la base de datos directamente ni escribe consultas libres. La **disponibilidad la calcula siempre el sistema**, no el modelo. Los reportes **no usan IA**. El proveedor de IA es **intercambiable**: en desarrollo se usa OpenRouter, con su llave solo en la configuración del servidor (nunca en el repositorio); en las pruebas se usa un **proveedor falso**; el proveedor de producción queda por decidir en ADR-027.

**Reutiliza de las funcionalidades 001 a 004, 006 y 008** (no se repite aquí ni se cambia su comportamiento): el catálogo de servicios y barberos y el cálculo de horarios libres (002); la cuenta de cliente por barbería y el tenant tomado del token (001, 002); las citas, sus estados y el historial (002, 004, 008); las restricciones por estado de la suscripción (003); la caché y el límite general de solicitudes compartido (006); la auditoría de la barbería (001); el tiempo límite, el reintento y el corte del circuito ante proveedores externos (ADR-012, ya usados en 003 y 004).

## Clarifications

### Session 2026-11-14

- Q: ¿El asistente y su cuota por barbería dependen del plan de suscripción, o en esta versión todos los planes tienen lo mismo? → A: Todos los planes tienen el **mismo asistente y la misma cuota fija**: 20 preguntas por usuario y 200 por barbería al día, reiniciadas a medianoche de la zona horaria de la barbería. Una cuota "según el plan" queda como **evolución futura**; el modelo de planes de 003 no cambia.
- Q: ¿Se confirman los demás valores supuestos? → A: Sí: pregunta de hasta 500 caracteres; contexto de las últimas 6 intervenciones; el registro de preguntas no guarda el texto de preguntas ni de respuestas; los visitantes sin sesión no usan el asistente; los reportes muestran solo conteos, con períodos de hasta 366 días; ADR-027 y ADR-028 se escriben en el plan, antes de implementar.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - El cliente pregunta al asistente por servicios, precios y horarios (Priority: P1)

Un cliente con sesión en una barbería escribe en lenguaje natural preguntas como "¿cuánto cuesta un corte?", "¿qué servicios tienen?" o "¿hay horario el sábado en la tarde con Luis?". El asistente responde con los servicios, los precios, los barberos y los horarios libres **de esa barbería**, tal como los da el sistema, y le ofrece ir al flujo normal de reserva para reservar. El asistente no reserva por su cuenta.

**Why this priority**: es el requisito _Must_ de la funcionalidad (RF27, HU22) y el que da valor al cliente final. Sin él, 005 no cumple su objetivo principal.

**Independent Test**: con una barbería sembrada y el proveedor falso, un cliente con sesión pregunta por servicios, precios y horarios libres y recibe exactamente los datos que devuelven el catálogo y el cálculo de horarios de esa barbería, con el acceso al flujo de reserva. Se comprueba sin las otras historias.

**Acceptance Scenarios**:

1. **Given** un cliente con sesión en la barbería A, **When** pregunta qué servicios hay y cuánto cuestan, **Then** la respuesta lista los servicios activos de A con sus precios y duraciones, iguales a los del catálogo de A.
2. **Given** un cliente con sesión en A, **When** pregunta por horarios libres de un servicio en una fecha (y, si quiere, con un barbero), **Then** las horas que muestra la respuesta son exactamente las que devuelve el cálculo de horarios libres de A para esos datos, y la respuesta ofrece ir a reservar con el flujo normal.
3. **Given** un cliente con sesión en A, **When** pregunta por algo que ninguna herramienta puede responder (por ejemplo, "¿atienden a domicilio?"), **Then** el asistente dice que no tiene ese dato y sugiere contactar a la barbería, en lugar de suponer una respuesta.
4. **Given** un cliente con sesión en A, **When** pide que el asistente le reserve, cancele o cambie una cita, **Then** el asistente no lo hace y le ofrece el flujo normal de reserva o "Mis citas".
5. **Given** un cliente con sesión en A, **When** pregunta por servicios u horarios de otra barbería B (por su nombre o enlace), **Then** el asistente responde solo sobre A o dice que no puede consultar otras barberías; ningún dato de B aparece en la respuesta.
6. **Given** un cliente con sesión en A, **When** pregunta por las citas, los datos o el teléfono de otros clientes, **Then** el asistente no los entrega; ninguna herramienta del cliente devuelve datos de otros clientes.

---

### User Story 2 - El propietario ve los reportes de su barbería por período (Priority: P1)

El propietario elige un período (por ejemplo, la semana pasada o el mes en curso) y ve en **tablas**, sin gráficos: las **citas** del período por estado, los **servicios más solicitados** y la **actividad** de la barbería (citas por barbero y por día, cancelaciones tardías y no asistencias). Los reportes no usan IA.

**Why this priority**: RF29 (HU24) se cumple sin depender de ningún proveedor externo, y sus cifras son la base del asistente del propietario (US3). Es la forma más segura de entregar valor al propietario a tiempo.

**Independent Test**: con citas sembradas en varias fechas, estados y barberos, el propietario pide un período y las tablas muestran exactamente los conteos esperados de su barbería, sin datos de otras barberías. Se comprueba sin US1 ni US3.

**Acceptance Scenarios**:

1. **Given** una barbería con citas sembradas en varios estados dentro y fuera de un período, **When** el propietario pide el reporte de citas de ese período, **Then** ve el total y el desglose por estado (confirmadas, completadas, canceladas, de ellas tardías, no asistió y pendientes), contando solo las citas cuya hora de inicio cae en el período, en la zona horaria de la barbería.
2. **Given** el mismo período, **When** pide los servicios más solicitados, **Then** ve los servicios ordenados de más a menos citas (sin contar las canceladas), con su número de citas, hasta los 10 primeros.
3. **Given** el mismo período, **When** pide la actividad, **Then** ve las citas por barbero y por día de la semana, y el número de cancelaciones tardías y de no asistencias.
4. **Given** dos barberías con citas, **When** el propietario de A pide cualquier reporte, **Then** solo ve datos de A, aunque modifique la solicitud.
5. **Given** un barbero o un cliente de la barbería, **When** intenta abrir los reportes, **Then** se le niega el acceso.
6. **Given** un período sin citas, **When** el propietario pide el reporte, **Then** ve las tablas vacías con un mensaje claro, no un error.

---

### User Story 3 - El propietario pide al asistente un resumen de su barbería (Priority: P3)

El propietario pregunta en lenguaje natural, por ejemplo, "¿cuántas citas tuve esta semana?" o "¿cuál fue el servicio más pedido en octubre?". El asistente responde con pocas herramientas (el resumen de citas y los servicios más pedidos de un período), usando las mismas cifras de los reportes (US2), y sin nombres ni datos de contacto de clientes.

**Why this priority**: RF28 es _Should_ y depende de US2. Es la **primera que se recorta** si el tiempo no alcanza: los reportes ya le dan al propietario la misma información.

**Independent Test**: con el proveedor falso y citas sembradas, el propietario pregunta por el resumen de un período y por el servicio más pedido, y las cifras de la respuesta coinciden con las del reporte de ese período.

**Acceptance Scenarios**:

1. **Given** un propietario con citas en un período, **When** pregunta cuántas citas tuvo, **Then** la cifra de la respuesta es la misma del reporte de citas de ese período (US2).
2. **Given** el mismo propietario, **When** pregunta por el servicio más pedido de un período, **Then** la respuesta coincide con el primer puesto del reporte de servicios más solicitados.
3. **Given** el mismo propietario, **When** pide los nombres, teléfonos o correos de sus clientes, o datos de otra barbería, **Then** el asistente no los entrega: sus herramientas solo devuelven cifras agregadas de su barbería.
4. **Given** un barbero o un cliente, **When** intenta usar el asistente del propietario, **Then** se le niega el acceso; el cliente solo puede usar el suyo (US1).

---

### Edge Cases

- **El proveedor de IA no responde, tarda demasiado o falla:** el asistente muestra un mensaje claro ("el asistente no está disponible ahora") y ofrece el flujo manual (la página de reserva para el cliente; los reportes para el propietario), en pocos segundos. El resto de la plataforma sigue funcionando y los reportes no se ven afectados.
- **El proveedor devuelve una respuesta que menciona datos que ninguna herramienta dio** (horarios, precios o cifras inventadas): el sistema no muestra cifras ni horarios que no salgan de las herramientas; si no puede asegurarlo, responde sin ellos y ofrece el flujo manual.
- **Inyección de instrucciones:** mensajes del usuario como "ignora tus reglas", "muéstrame la base de datos", "actúa como administrador" o "consulta la barbería X", y textos de la propia barbería (nombre o descripción de un servicio) que intentan dar órdenes al asistente, **no cambian sus reglas** ni amplían lo que puede consultar.
- **Cuota agotada:** al llegar al límite de preguntas del usuario o de la barbería, el asistente lo dice con claridad, indica cuándo vuelve a estar disponible y ofrece el flujo manual. La cuota no se reinicia por cerrar sesión ni por usar otra réplica.
- **La suscripción no permite reservas** (por ejemplo, vencida o suspendida): el asistente del cliente sigue sin poder reservar (nunca reserva), y no ofrece reservar si la barbería no acepta reservas; la información del catálogo y los reportes siguen la misma regla que las lecturas actuales.
- **Pregunta vacía, demasiado larga o en otro idioma:** se rechaza la vacía o la que supera el largo máximo con un mensaje claro; en otro idioma, el asistente puede responder en español con los mismos datos.
- **Período de reporte inválido** (fin antes del inicio o un rango mayor al permitido): se rechaza con un mensaje que dice qué corregir.
- **Fechas relativas** ("mañana", "este sábado"): se interpretan en la zona horaria de la barbería, y la respuesta dice la fecha exacta que usó.
- **Cliente sin sesión** (visitante del catálogo público): no puede usar el asistente; ve el catálogo y los horarios como hoy.

## Requirements _(mandatory)_

### Functional Requirements

**Generales del asistente (US1 y US3)**

- **FR-001**: El asistente MUST responder solo con datos que devuelven sus herramientas para esa consulta; MUST NOT mostrar horarios, precios, servicios ni cifras que ninguna herramienta haya devuelto. Si ninguna herramienta tiene el dato, MUST decirlo en lugar de suponerlo.
- **FR-002**: Cada herramienta del asistente MUST usar los casos de uso ya existentes de otros módulos, a través de sus interfaces públicas, con los permisos del usuario que pregunta; el asistente MUST NOT consultar la base de datos directamente, MUST NOT ejecutar consultas libres y MUST NOT escribir nada.
- **FR-003**: Las herramientas MUST ser cerradas y autorizadas por rol: el cliente solo tiene las de US1 y el propietario solo las de US3. Un rol MUST NOT poder invocar herramientas de otro rol.
- **FR-004**: La barbería consultada MUST ser siempre la de la sesión del usuario (la que viene en su token), nunca la que nombre el mensaje; ningún mensaje MUST poder hacer que el asistente consulte otra barbería.
- **FR-005**: El asistente MUST NOT reservar, cancelar, reprogramar ni cambiar ningún dato; ante esas peticiones MUST ofrecer el flujo normal de la plataforma.
- **FR-006**: Las instrucciones que lleguen en el mensaje del usuario o en textos de la barbería (nombres o descripciones del catálogo) MUST tratarse como datos, no como órdenes: MUST NOT cambiar las reglas del asistente, sus herramientas ni el alcance de la barbería y el rol.
- **FR-007**: El asistente MUST tener una **cuota por usuario** y una **cuota por barbería** de preguntas por período; al agotarse, MUST responder con un mensaje claro, decir cuándo vuelve a estar disponible y ofrecer el flujo manual. Las cuotas MUST contarse de forma compartida entre todas las réplicas y MUST NOT reiniciarse al cerrar sesión. Las cuotas MUST ser **fijas e iguales para todos los planes**: 20 preguntas por usuario y 200 por barbería al día, reiniciadas a medianoche de la zona horaria de la barbería. El asistente MUST NOT depender del plan de suscripción ni cambiar el modelo de planes de 003 (una cuota según el plan queda como evolución futura).
- **FR-008**: Si el proveedor de IA no responde dentro del tiempo límite, devuelve un error o tiene el circuito abierto, el asistente MUST responder con un mensaje claro y ofrecer el flujo manual en 3 segundos o menos desde que se detecta la falla, sin afectar al resto de la plataforma.
- **FR-009**: Las respuestas MUST NOT incluir datos personales de terceros: ningún nombre, teléfono, correo ni cita de otros clientes; al propietario, solo cifras agregadas, sin nombres ni datos de contacto de clientes.
- **FR-010**: Cada pregunta al asistente MUST quedar registrada con quién preguntó (usuario y barbería), cuándo, qué herramientas se usaron, si terminó bien, por cuota o por falla del proveedor, y el consumo; el registro MUST NOT guardar el texto de la pregunta ni de la respuesta ni datos personales de terceros, y los registros de la aplicación MUST NOT incluir la llave del proveedor ni el contenido de las conversaciones.
- **FR-011**: Al proveedor de IA MUST enviarse solo lo necesario para responder: la pregunta, el contexto mínimo de la conversación en curso y los resultados de las herramientas; MUST NOT enviarse datos de otras barberías, de otros clientes ni secretos.
- **FR-012**: La conversación MUST ser breve y sin historial guardado en el servidor: el asistente MUST tomar en cuenta solo las últimas intervenciones de la conversación abierta; al cerrarla o recargar la página, empieza de nuevo.
- **FR-013**: El asistente MUST rechazar con un mensaje claro una pregunta vacía o que supere el largo máximo, sin consumir cuota.
- **FR-014**: Las fechas relativas MUST interpretarse en la zona horaria de la barbería, y la respuesta MUST decir la fecha exacta usada.
- **FR-015**: El proveedor de IA MUST poder cambiarse sin modificar las reglas del asistente; en las pruebas automáticas MUST usarse un proveedor falso que no sale a internet. La llave del proveedor de desarrollo MUST estar solo en la configuración del servidor y MUST NOT guardarse en el repositorio.

**Asistente del cliente (US1)**

- **FR-016**: Solo un cliente con sesión en la barbería MUST poder usar el asistente del cliente; un visitante sin sesión MUST NOT poder usarlo.
- **FR-017**: El asistente del cliente MUST poder consultar los servicios activos (nombre, precio, duración y descripción pública), los barberos que los atienden (nombre visible) y los horarios libres de un servicio en una fecha, opcionalmente con un barbero, con los mismos resultados que el catálogo y el cálculo de horarios de la barbería.
- **FR-018**: Cuando muestre horarios libres, el asistente del cliente MUST ofrecer ir al flujo normal de reserva con el servicio (y, si corresponde, el barbero y la fecha) ya elegidos; MUST NOT ofrecer reservar si la barbería no acepta reservas por el estado de su suscripción.

**Reportes (US2)**

- **FR-019**: Solo el propietario de la barbería MUST poder ver los reportes; el barbero y el cliente MUST NOT poder verlos.
- **FR-020**: El propietario MUST poder elegir un período con fecha de inicio y de fin, en la zona horaria de la barbería, de hasta 366 días; un período inválido MUST rechazarse con un mensaje que diga qué corregir.
- **FR-021**: El reporte de **citas** MUST mostrar, para las citas cuya hora de inicio cae en el período, el total y el desglose por estado: pendientes, confirmadas, completadas, no asistió y canceladas, indicando cuántas de las canceladas fueron tardías.
- **FR-022**: El reporte de **servicios más solicitados** MUST mostrar, para el período, los servicios ordenados de más a menos citas no canceladas, con su número de citas, hasta los 10 primeros; el nombre del servicio MUST ser el que tenía la cita al reservarse.
- **FR-023**: El reporte de **actividad** MUST mostrar, para el período, el número de citas por barbero, por día de la semana, el número de cancelaciones tardías y el de no asistencias.
- **FR-024**: Los reportes MUST mostrarse en tablas, sin gráficos, y MUST NOT incluir nombres ni datos de contacto de clientes.
- **FR-025**: Los reportes MUST incluir solo datos de la barbería de la sesión del propietario, aunque se altere la solicitud.
- **FR-026**: Los reportes MUST NOT depender del proveedor de IA: MUST funcionar aunque el asistente no esté disponible.

**Asistente del propietario (US3)**

- **FR-027**: Solo el propietario MUST poder usar el asistente del propietario, con dos herramientas: el resumen de citas de un período y los servicios más solicitados de un período, que MUST devolver las mismas cifras que los reportes de US2.
- **FR-028**: El asistente del propietario MUST NOT tener herramientas que devuelvan datos de clientes individuales ni que cambien datos.

**Transversales**

- **FR-029**: El uso del asistente y de los reportes MUST quedar en la auditoría de la barbería como hoy (actor, acción, fecha), sin el contenido de las preguntas.
- **FR-030**: Esta funcionalidad MUST NOT cambiar el comportamiento de las funcionalidades existentes (catálogo, reservas, citas, suscripciones, pagos, avisos y adelanto).

### Key Entities

- **Pregunta al asistente**: un uso del asistente por un usuario en una barbería. Atributos: barbería, usuario, rol, momento, herramientas usadas, resultado (respondida, sin datos, cuota agotada, proveedor no disponible, rechazada por largo) y consumo. **No** guarda el texto de la pregunta ni de la respuesta.
- **Cuota del asistente**: el contador de preguntas de un usuario y de una barbería en un período (por ejemplo, un día), con su límite y el momento en que se reinicia. Se guarda en la base de datos principal, compartida entre réplicas.
- **Herramienta del asistente**: una consulta cerrada, autorizada para un rol, que llama a un caso de uso existente y devuelve datos de la barbería de la sesión (catálogo, horarios libres, resumen de citas, servicios más solicitados).
- **Reporte del período**: el resultado calculado, sin guardarse, de las citas de la barbería en un período: conteos por estado, servicios más solicitados y actividad por barbero y por día.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: En las pruebas, el **100 %** de los horarios, precios y servicios que muestra el asistente del cliente coinciden con los que devuelven el catálogo y el cálculo de horarios de la barbería para esa consulta; **0** respuestas con un horario que el sistema no dio.
- **SC-002**: **0 fugas** en el conjunto adversarial mínimo (PR19), de al menos 10 mensajes: pedir datos de otra barbería, de otros clientes, consultas libres a la base, ignorar las reglas, hacerse pasar por otro rol, reservar por el asistente e instrucciones escondidas en textos del catálogo. Ninguno obtiene datos fuera de la barbería y el rol del usuario ni produce un cambio.
- **SC-003**: Con el proveedor de IA caído o lento, el usuario ve el mensaje de "no disponible" con la alternativa manual en **3 segundos o menos**, y el resto de la plataforma (incluidos los reportes) responde igual.
- **SC-004**: Al agotar la cuota, el **100 %** de las preguntas siguientes del usuario (o de la barbería) se rechazan con el mensaje de cuota, también si llegan a dos réplicas a la vez, sin pasar del límite.
- **SC-005**: Los reportes de citas, servicios más solicitados y actividad dan exactamente los conteos esperados para un conjunto de citas sembradas (también en los bordes del período y con la zona horaria de la barbería), y el propietario los obtiene en **2 segundos o menos** para un período de un mes.
- **SC-006**: **0** datos de otra barbería en reportes y respuestas del asistente en las pruebas de aislamiento (PR09), y **0** nombres, teléfonos o correos de clientes en las respuestas del asistente y en los reportes.
- **SC-007**: **0** textos de preguntas o respuestas, llaves del proveedor o datos personales de terceros en el registro de preguntas y en los registros de la aplicación; el **100 %** de las preguntas queda registrado con su resultado.
- **SC-008**: Un cliente obtiene los horarios libres de un servicio para una fecha con una sola pregunta, y el propietario obtiene el resumen de citas de un período con una sola pregunta, en las pruebas con el proveedor falso.

## Assumptions

- **Solo con sesión:** el asistente del cliente lo usa un cliente con sesión en esa barbería (HU22, criterio 4: la barbería es la de su token). Los visitantes sin sesión siguen viendo el catálogo y los horarios públicos como hoy.
- **Reservar sigue siendo del flujo normal:** HU22 dice "para reservar más rápido" y "la reserva solo se confirma ejecutando el caso de uso"; aquí el asistente **ofrece** el flujo normal con los datos ya elegidos, y la reserva la confirma el cliente allí (FR-005, FR-018).
- **Sin acciones sensibles en US3:** HU23 pide confirmación adicional para acciones sensibles; como el asistente del propietario solo lee, no hay acciones que confirmar en esta versión.
- **Registro sin contenido:** HU23 pide que cada consulta quede registrada; se registran los metadatos (quién, cuándo, herramientas, resultado y consumo), no el texto, para cumplir "sin datos personales de terceros en los registros" (FR-010).
- **Cuotas y límites** (confirmados en la sesión de aclaraciones del 2026-11-14): 20 preguntas por usuario y 200 por barbería al día, iguales para todos los planes, reiniciadas a medianoche de la zona horaria de la barbería; largo máximo de una pregunta, 500 caracteres; contexto de la conversación, las últimas 6 intervenciones.
- **Período de reportes:** hasta 366 días; "servicios más solicitados" cuenta las citas no canceladas; las citas se asignan al período por su hora de inicio en la zona horaria de la barbería. Los reportes muestran solo conteos (sin montos ni ingresos) en esta versión mínima.
- **Idioma:** las respuestas son en español.
- **Proveedor:** OpenRouter solo en desarrollo, con datos de prueba (nunca datos reales de clientes); el proveedor de producción se decide en ADR-027 y no es necesario para la entrega. En las pruebas automáticas y en la CI, el proveedor falso.
- **Restricciones por suscripción:** el asistente y los reportes son lecturas; siguen la misma política de lecturas de la funcionalidad 003 y no dependen del plan.
- **Dependencias:** las interfaces públicas de M02 (catálogo, horarios libres y citas de la barbería) y de M03 (estado de la suscripción) ya existen o se exponen como lectura sin cambiar su comportamiento; ADR-027 y ADR-028 se escriben antes de implementar (principio XI).
- **Fuera de alcance:** reservar, cancelar o reprogramar desde el asistente; gráficos; exportar reportes; historial de conversaciones; asistente por WhatsApp o por voz; asistente para el barbero y para el administrador de la plataforma; reportes con montos o ingresos; cuotas o acceso al asistente según el plan de suscripción (evolución futura).
