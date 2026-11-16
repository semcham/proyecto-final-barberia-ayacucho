# Feature Specification: Indicadores y datos personales (versión mínima)

**Feature Branch**: `007-indicadores-datos-personales`

**Created**: 2026-11-15

**Status**: En implementación. Fase 1 (US1) construida (2026-11-16). Fase 2a hecha (2026-11-16): la enmienda 1.7.0 del principio III y la revisión de ADR-031 están aprobadas y aplicadas, así que **no hay corte**: las fases 2b, 2c y 3 se construyen.

**Input**: User description: "Funcionalidad 007 "Indicadores y datos personales" (módulos M06 y M01). Versión MÍNIMA para la entrega del 18 de noviembre; alcance cortable por historia. US1 (P1) RF32: registro y seguimiento de solicitudes de acceso, rectificación y eliminación de datos personales, con estado y registro, atendidas A MANO por la barbería o el administrador según corresponda, sin exportación automática; quién crea, quién atiende y qué ve cada rol sale de los roles y el aislamiento existentes. US2 (P1) RF31: indicadores agregados de uso para el administrador de la plataforma (barberías activas, citas por mes, usuarios), sin datos personales de clientes, con el rol de lectura de la plataforma (ADR-031), nunca BYPASSRLS. US3 (P3, la primera que se recorta): login_attempt con hash de la IP con sal, como action_link_attempt, con su migración. Condiciones: constitución, aislamiento, matriz de permisos, auditoría, no cambiar otras funcionalidades; lo no construido se documenta como no construido."

**Trazabilidad**: HU27 → RF32 → AC01 / EQ-18 (consentimiento y derechos sobre los datos) → DA11 (privacidad) → ADR-003, ADR-010 → M01 → PR18, PR08, PR09, PR13. HU26 → RF31 → AC01, AC03 / EQ-13 (auditoría), EQ-21 (observabilidad) → DA11, DA12 → ADR-010, **ADR-031** (operaciones de la plataforma) → M06 (indicadores) y M01/M03 (lectura de la plataforma) → PR09 (`lectura-plataforma`), PR08, PR13, PR21 (parcial). Mejora de la constitución 1.4.1 (principio III, tablas técnicas de intentos) → M01 (`login_attempt`) → PR12, PR09.

**Plazo y forma de corte**: entrega el **18 de noviembre de 2026**. Cada historia se entrega y se prueba sola: **US1** y **US2** (P1) y después **US3** (P3), la **primera que se recorta**. Líneas de corte del [backlog](../../docs/05-gestion/02-backlog-y-sprints.md) para 007: pocos indicadores (barberías activas, citas por mes, usuarios) y solicitudes de datos atendidas a mano, con estado y registro, sin exportación automática.

**Acuerdos que no se reabren aquí** (constitución 1.6.0): el tenant sale siempre del token (principio III); el administrador de la plataforma no pertenece a ninguna barbería, lee entre barberías solo con el rol de lectura de la plataforma, sin `BYPASSRLS`, y **no ve ni modifica citas, clientes, catálogo ni usuarios** (principio III, excepción "operaciones de la plataforma", y ADR-031); las acciones sensibles se auditan (ADR-010); ningún contador de seguridad vive en Redis (principio VIII).

**Reutiliza** (sin cambiar su comportamiento): los roles y la matriz de permisos de 001 a 008; la cuenta del cliente y su membresía por barbería (002, ADR-020); el consentimiento registrado (002 y 004); la auditoría de la barbería y la del acceso del administrador (001 y 003); la identidad y el segundo factor del administrador de la plataforma y su rol de lectura (003, ADR-031); el patrón de origen con hash y sal de `action_link_attempt` (004).

## Clarifications

### Session 2026-11-15

- Q: ¿De dónde salen los conteos de citas y usuarios del administrador, si el rol de lectura de la plataforma no tiene permisos sobre esas tablas (FR-012)? → A: Opción A acotada: vistas de **solo conteo**, con columnas sin datos personales (barbería, fecha y estado de la cita; tipo de membresía; el plan y el borrador de la enmienda las dejan todavía más estrictas: ya agregadas y **sin ninguna columna de barbería ni de persona**, ver FR-012); el rol de lectura de la plataforma lee **solo esas vistas** y no recibe ningún permiso sobre las tablas de citas ni de usuarios. Requiere una enmienda acotada del principio III y de ADR-031, más una prueba de permisos exactos. **Criterio de corte:** si la enmienda se complica, se recorta a la opción C (solo barberías por estado) y las citas por mes y los usuarios quedan como no construidos.
- Q: ¿Quién atiende las solicitudes del propietario sobre su propia cuenta (FR-005)? → A: Opción C: **quedan fuera de 007** y se documentan como no construidas, porque atenderlas exigiría que el administrador toque datos de una barbería, lo que choca con el aislamiento. Los **clientes y los barberos** registran solicitudes sobre sus propios datos, y las atiende el **propietario de su barbería**.
- Q: ¿Qué hace el sistema al atender una eliminación (FR-008)? → A: Opción A: **solo registra la respuesta**; el borrado se hace a mano con lo que ya existe. La anonimización del perfil queda como **evolución futura, no construida**.
- Q: ¿Se confirman el barbero como solicitante, el plazo interno y que la auditoría de HU26 queda fuera? → A: Sí: el barbero puede registrar solicitudes; el plazo interno es de **10 días hábiles**, pendiente de validar contra el plazo legal; ver la auditoría (HU26) queda **fuera de 007**.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - El cliente o el barbero pide acceso, corrección o eliminación de sus datos y el propietario la atiende con seguimiento (Priority: P1)

Un cliente con sesión en su barbería, o un barbero de esa barbería, registra una solicitud sobre **sus propios** datos personales: **acceso** (saber qué datos tiene la plataforma), **rectificación** (corregir un dato, indicando cuál) o **eliminación** (que se borren o anonimicen, salvo lo que haya que conservar por obligación). La solicitud queda con un estado (recibida, en atención, atendida o rechazada con motivo), su fecha y el plazo interno para responder (10 días hábiles, por validar contra el plazo legal). La atiende el **propietario de la barbería**, que la trabaja **a mano**: revisa, hace lo que corresponde con las herramientas que ya existen o fuera del sistema, y anota qué hizo y cuándo. El solicitante ve el estado y la respuesta de sus solicitudes. Cada cambio de estado queda en la auditoría. Las solicitudes del **propietario** sobre su propia cuenta **no se construyen en 007** (ver FR-005).

**Why this priority**: RF32 y HU27 cumplen un derecho de la Ley N.° 29733 (acceso, rectificación, cancelación y oposición) que hoy no tiene ningún registro: es el único RF del alcance completamente sin construir, junto con RF31. Es independiente del resto y no depende de proveedores.

**Independent Test**: un cliente registra una solicitud de acceso y un barbero una de rectificación; el propietario las ve en su bandeja, cambia su estado y deja la respuesta; cada solicitante ve solo las suyas, con sus estados y respuestas; nadie de otra barbería ve nada; la auditoría tiene cada paso.

**Acceptance Scenarios**:

1. **Given** un cliente con sesión en la barbería A, **When** registra una solicitud de acceso a sus datos, **Then** queda en estado "recibida", con la fecha, el tipo y el plazo interno de respuesta, y el cliente la ve en su lista.
2. **Given** una solicitud de rectificación, **When** el cliente la registra, **Then** debe indicar qué dato quiere corregir y cómo (texto libre acotado); sin eso no se registra.
3. **Given** una solicitud recibida, **When** el propietario la pasa a "en atención" y luego a "atendida" con una respuesta, **Then** el solicitante ve el nuevo estado y la respuesta, y cada cambio queda auditado con quién y cuándo.
4. **Given** una solicitud, **When** el propietario la rechaza, **Then** debe escribir el motivo, que el solicitante ve.
5. **Given** dos barberías, **When** el propietario de A abre su bandeja, **Then** no ve ninguna solicitud de clientes ni barberos de B, ni aunque sea la misma persona con cuenta en las dos (cada membresía es aparte).
6. **Given** una solicitud de eliminación, **When** el propietario la atiende, **Then** el sistema solo registra su respuesta, que dice qué se borró a mano y qué se conserva por obligación (por ejemplo, la evidencia del consentimiento o la auditoría); el sistema **no** borra ni anonimiza nada por su cuenta.
7. **Given** una solicitud atendida o rechazada, **When** el solicitante intenta cambiarla, **Then** no puede: queda cerrada y solo puede registrar una nueva.
8. **Given** un barbero con sesión, **When** abre la bandeja de solicitudes de la barbería, **Then** se rechaza: solo ve las suyas.
9. **Given** el propietario, **When** busca registrar una solicitud sobre su propia cuenta, **Then** no existe esa opción en 007 (no construida, FR-005).

---

### User Story 2 - El administrador de la plataforma ve pocos indicadores agregados de uso (Priority: P1)

El administrador de la plataforma abre una pantalla de indicadores con números **agregados de todas las barberías**, sin ningún dato de una persona: cuántas barberías hay activas (y por estado de su suscripción), cuántas citas se registraron por mes y cuántos usuarios hay (por tipo: personal y clientes). Cada cifra dice a qué momento corresponde. No puede bajar al detalle de una barbería ni de una persona desde esta pantalla.

**Why this priority**: RF31 y HU26 piden indicadores de uso para operar y dar soporte; hoy el administrador solo ve suscripciones y pagos. Es P1 porque es la otra mitad del alcance de 007, pero se separa de US1 y puede entregarse sola.

**Independent Test**: con varias barberías sembradas en distintos estados y con citas y usuarios conocidos, el administrador obtiene exactamente esos conteos; la respuesta no contiene nombres, correos, teléfonos ni identificadores de personas; ningún rol de barbería accede a la pantalla.

**Acceptance Scenarios**:

1. **Given** barberías sembradas en prueba, activas, vencidas y suspendidas, **When** el administrador abre los indicadores, **Then** ve el número de barberías por estado y el total de activas, iguales a los sembrados.
2. **Given** citas sembradas en varios meses, **When** consulta las citas por mes, **Then** ve un conteo por mes (de los últimos 12, en la zona horaria de la plataforma) igual al sembrado, sin datos de ninguna cita.
3. **Given** usuarios sembrados, **When** consulta los usuarios, **Then** ve el total de personal y de clientes, sin ningún dato de una persona.
4. **Given** un propietario, un barbero o un cliente, **When** intentan abrir los indicadores, **Then** se rechaza (como toda ruta de la plataforma), y el token del administrador sigue rechazado en las rutas de barbería.
5. **Given** la lectura entre barberías, **When** se calculan los indicadores, **Then** se usa solo la lectura de la plataforma sobre las vistas de solo conteo (FR-012), sin omitir el aislamiento, sin ningún permiso sobre las tablas de citas ni de usuarios y sin escribir nada.
6. **Given** cada consulta de indicadores, **When** se responde, **Then** queda en la auditoría del acceso del administrador.

---

### User Story 3 - Los intentos de inicio de sesión ya no guardan la IP en claro (Priority: P3)

Hoy, cada intento fallido de inicio de sesión (del personal, de los clientes y del administrador de la plataforma) guarda la IP de origen tal cual. Como ya ocurre con los intentos de los enlaces del recordatorio (004), el origen pasa a guardarse **solo como un valor derivado con sal secreta**, que permite contar los intentos de un mismo origen pero no recuperar la IP. El límite de intentos funciona igual que antes.

**Why this priority**: es una mejora de privacidad que la constitución 1.4.1 asignó a 007; no la pide un RF y el límite ya funciona hoy, por eso es la primera que se recorta.

**Independent Test**: tras la migración, ninguna fila de intentos tiene una IP legible; seis intentos fallidos desde el mismo origen siguen bloqueando como antes, y desde otro origen no; un ingreso correcto sigue borrando los fallos de ese par.

**Acceptance Scenarios**:

1. **Given** el sistema migrado, **When** se registra un intento fallido, **Then** la fila guarda el origen derivado con la sal y nunca la IP en claro.
2. **Given** filas anteriores a la migración con la IP en claro, **When** se migra, **Then** ya no queda ninguna IP legible (se derivan con la sal o se descartan, porque solo valen 24 h).
3. **Given** el límite de intentos vigente, **When** se superan los intentos desde un mismo origen, **Then** el bloqueo y su mensaje son los mismos de antes, para el personal, los clientes y el administrador.
4. **Given** la sal, **When** se configura, **Then** fuera del entorno de desarrollo es un secreto que no está en el repositorio (el repositorio solo lleva valores de desarrollo), y nunca aparece en registros, errores ni auditoría.

---

### Edge Cases

- **Solicitud de un cliente con cuenta en varias barberías:** cada solicitud es de su membresía en una barbería; la de A no se ve en B.
- **Cliente presencial sin cuenta** (lo registró la barbería): no puede entrar a pedir nada; la barbería puede registrar la solicitud en su nombre si la recibe por otro medio, dejando constancia de quién la registró.
- **Varias solicitudes abiertas del mismo tipo:** se permite registrar una nueva solo si no hay otra abierta del mismo tipo; si la hay, se le muestra la existente.
- **Plazo vencido:** una solicitud abierta más allá de su plazo interno se marca como vencida en la bandeja de quien atiende; no se cierra sola.
- **Eliminación con obligaciones de conservación:** la respuesta debe decir qué se conserva y por qué (por ejemplo, la evidencia del consentimiento, la auditoría o los datos de pagos de la suscripción).
- **Solicitud del propietario sobre sus propios datos:** no construida en 007 (FR-005); si la pide, se le indica que no está disponible en esta versión.
- **Solicitud de un barbero que deja de ser personal:** la solicitud ya registrada sigue visible para el propietario y conserva su estado; el barbero desactivado ya no puede entrar a verla. **Asunción sin prueba propia:** sale del comportamiento existente de la desactivación de usuarios (001), que ya impide su ingreso.
- **Enmienda no aprobada a tiempo:** se aplica el criterio de corte de FR-012 (solo barberías por estado), y las citas por mes y los usuarios se documentan como no construidos. **No aplica:** la enmienda se aprobó el 2026-11-16.
- **Indicadores sin datos:** una plataforma sin citas en un mes muestra ese mes en cero, no un error.
- **Indicadores y barberías suspendidas:** se cuentan en su estado; sus citas y usuarios cuentan igual en los totales.
- **Texto de la solicitud con datos de terceros:** el texto libre se guarda como dato de la solicitud, con su aislamiento, y nunca se copia a la auditoría ni a los registros de la aplicación.
- **Migración de los intentos con réplicas en marcha:** durante el cambio, el límite de intentos no se apaga.

## Requirements _(mandatory)_

### Functional Requirements

**US1 · Solicitudes sobre datos personales (RF32)**

- **FR-001**: El sistema MUST permitir a un **cliente con sesión** registrar una solicitud sobre sus propios datos en la barbería de su sesión, de tipo **acceso**, **rectificación** o **eliminación**. Una de rectificación MUST indicar qué dato y cómo corregirlo (texto de hasta 500 caracteres).
- **FR-002**: El sistema MUST permitir a un **barbero** con sesión registrar una solicitud sobre sus propios datos en su barbería, con las mismas reglas que el cliente.
- **FR-003**: El sistema MUST permitir al propietario registrar una solicitud **en nombre** de un cliente de su barbería que la pidió por otro medio (por ejemplo, un cliente presencial sin cuenta), dejando constancia de quién la registró.
- **FR-004**: Cada solicitud MUST tener: tipo, estado (`RECIBIDA`, `EN_ATENCION`, `ATENDIDA`, `RECHAZADA`), fecha de registro, plazo interno de respuesta (**10 días hábiles**, pendiente de validar contra el plazo legal vigente), quién la registró, la respuesta y la fecha de cada cambio. `ATENDIDA` y `RECHAZADA` MUST ser estados finales; `RECHAZADA` MUST llevar motivo.
- **FR-005**: Las solicitudes de los **clientes** y de los **barberos** de una barbería MUST atenderlas el **propietario de esa barbería** (la barbería es la responsable de los datos de sus clientes y de su personal). Las solicitudes del **propietario** sobre su propia cuenta **no se construyen en 007**: atenderlas exigiría que el administrador de la plataforma vea o toque datos de una barbería, lo que choca con el aislamiento (principio III y ADR-031). Se documentan como no construidas y quedan como evolución futura.
- **FR-006**: El solicitante MUST ver sus solicitudes, su estado y la respuesta; MUST NOT ver las de otras personas. El propietario MUST ver solo las solicitudes de su barbería. El barbero y el cliente MUST NOT ver la bandeja de la barbería. El administrador de la plataforma MUST NOT ver ninguna solicitud.
- **FR-007**: La atención MUST ser **manual**: el sistema registra el estado y la respuesta, pero MUST NOT exportar datos automáticamente (ni archivo, ni correo con los datos).
- **FR-008**: Al atender una **eliminación**, el sistema MUST solo registrar la respuesta del propietario: el borrado o la corrección se hacen **a mano** con las pantallas que ya existen, y la respuesta dice qué se hizo y qué se conserva por obligación (la evidencia del consentimiento y la auditoría). El sistema MUST NOT borrar ni anonimizar datos por su cuenta. La **anonimización del perfil** queda como evolución futura, no construida; lo que no pueda borrarse con las pantallas existentes se documenta así en la respuesta.
- **FR-009**: Cada registro y cada cambio de estado de una solicitud MUST auditarse en la barbería con el actor y el tipo, **sin** el texto de la solicitud ni de la respuesta.
- **FR-010**: Las solicitudes MUST quedar aisladas por barbería (principio III): con el token de A no se lee, cambia ni crea una de B.
- **FR-011**: Una solicitud nueva del mismo tipo MUST rechazarse mientras haya otra abierta del mismo solicitante en esa barbería, indicando la existente.

**US2 · Indicadores de la plataforma (RF31)**

- **FR-012**: El administrador de la plataforma MUST poder ver tres indicadores agregados de todas las barberías: barberías por estado de suscripción (y el total de activas), citas registradas por mes (últimos 12 meses) y usuarios (personal y clientes). Las barberías por estado ya salen de lo que su rol de lectura puede leer hoy. Las **citas por mes** y los **usuarios** MUST salir de **vistas de solo conteo ya agregadas**, sin ninguna columna de barbería ni de persona: las citas, agrupadas por mes de registro y estado; las membresías activas, agrupadas por tipo (personal o cliente). El rol de lectura de la plataforma MUST poder leer **solo esas vistas** y MUST NOT recibir ningún permiso sobre las tablas de citas, clientes ni usuarios. Esto requiere una **enmienda acotada del principio III** de la constitución y de **ADR-031**, aprobadas antes de implementar (principio XI), y una **prueba de permisos exactos** (PR09, `lectura-plataforma`) que falle si el rol puede leer algo más. **Criterio de corte:** si la enmienda no se aprueba a tiempo o se complica, US2 se recorta a **solo las barberías por estado**, y las citas por mes y los usuarios se documentan como no construidos (desviación en esta spec y en la trazabilidad).
- **FR-013**: Los indicadores MUST NOT contener nombres, correos, teléfonos ni identificadores de personas, ni datos de una barbería concreta más allá de los conteos por estado. Un conteo MUST NOT poder filtrarse por una sola barbería ni por una persona.
- **FR-014**: Solo el administrador de la plataforma, con su sesión y segundo factor, MUST poder ver los indicadores; cualquier token de barbería MUST recibir el rechazo de las rutas de la plataforma, como hoy.
- **FR-015**: Calcular los indicadores MUST NOT escribir datos de negocio ni usar un rol que omita RLS. Cada consulta MUST quedar en la auditoría del acceso del administrador.
- **FR-016**: Cada indicador MUST indicar la fecha y hora de su cálculo; los meses MUST contarse en la zona horaria de la plataforma (America/Lima), con un mes sin citas en cero.

**US3 · Intentos de inicio de sesión con el origen derivado (mejora de la constitución 1.4.1)**

- **FR-017**: Los intentos fallidos de inicio de sesión (personal, clientes y administrador) MUST guardar el origen solo como un valor derivado con una **sal secreta** del servidor, como los intentos de los enlaces (004); MUST NOT guardar la IP en claro.
- **FR-018**: El límite de intentos MUST comportarse igual que antes para todos los ingresos (mismos umbrales, mismo bloqueo, mismo mensaje, mismo borrado de los fallos tras un ingreso correcto y la misma limpieza de las filas de más de 24 h).
- **FR-019**: La migración MUST dejar sin ninguna IP legible las filas existentes (derivándolas o descartándolas; duran 24 h) y MUST NOT dejar el límite apagado durante el cambio.
- **FR-020**: El valor de la sal de cualquier entorno distinto del de desarrollo MUST ir fuera del repositorio; el repositorio solo lleva valores de desarrollo (en `.env.example`, en `docker-compose.yml` y en las pruebas). La sal MUST NOT aparecer en registros, errores ni auditoría.

**Comunes**

- **FR-021**: Ninguna historia MUST cambiar el comportamiento de otra funcionalidad: las rutas y pantallas de 001 a 008 siguen haciendo lo mismo (US3 cambia cómo se guarda el origen, no el límite). Las pruebas existentes se **amplían sin quitar ninguna aserción**, salvo la de permisos de tabla de `lectura-plataforma` en la fase 2c, que pasa de "ningún permiso de tabla" a "exactamente las dos vistas". Las vistas de conteo de FR-012 solo suman permisos de lectura al rol de la plataforma sobre ellas; no cambian las tablas ni sus permisos para los demás roles.
- **FR-022**: Las rutas nuevas MUST sumarse a la matriz de permisos por rol con su prueba celda por celda (PR08), y las tablas nuevas de barbería MUST tener RLS y su prueba de aislamiento (PR09).
- **FR-023**: Lo que no se construya MUST documentarse como "no construido" en esta especificación y en la trazabilidad, sin presentarlo como implementado.

### Key Entities _(include if feature involves data)_

- **Solicitud sobre datos personales**: de una persona (cliente o barbero) en una barbería; tipo (acceso, rectificación, eliminación), estado, fechas, plazo interno, quién la registró (el titular o la barbería en su nombre), el detalle pedido, la respuesta y, si se rechaza, el motivo. Es un dato de la barbería, aislado por barbería.
- **Cambio de estado de la solicitud**: quién y cuándo pasó una solicitud de un estado a otro; alimenta la auditoría, sin el texto.
- **Indicador de la plataforma**: un conteo agregado (barberías por estado, citas por mes, usuarios por tipo) con su momento de cálculo; no se guarda ningún dato de personas.
- **Vista de solo conteo**: una lectura que ya entrega números agregados (citas por mes de registro y estado; membresías activas por tipo), sin ninguna columna de barbería ni de persona; es lo único de citas y usuarios que puede leer el rol de la plataforma.
- **Intento de inicio de sesión** (existente, se modifica en US3): el correo como hash, el origen como valor derivado con sal (antes, la IP) y la fecha.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: El **100 %** de las solicitudes registradas en las pruebas queda con su tipo, estado, fechas y plazo, y el **100 %** de sus cambios de estado queda auditado sin el texto.
- **SC-002**: **0** solicitudes de una barbería visibles o modificables desde otra barbería o por un rol sin permiso, en las pruebas de aislamiento y de permisos.
- **SC-003**: Un cliente registra una solicitud en **menos de 1 minuto** desde su lista de solicitudes, y quien atiende cambia su estado y deja la respuesta en **menos de 1 minuto** por solicitud (medido con cronómetro por el responsable).
- **SC-004**: Los indicadores dan **exactamente** los conteos esperados para un conjunto sembrado de barberías, citas y usuarios, y contienen **0** nombres, correos, teléfonos o identificadores de personas.
- **SC-005**: El administrador ve los indicadores en **3 segundos o menos** con el volumen de datos de las pruebas de escalado.
- **SC-006**: Tras US3, **0** filas de intentos con una IP legible, y el límite de intentos rechaza el **100 %** de los intentos por encima del umbral, igual que antes.

## Assumptions

- **Quién crea las solicitudes** (confirmado el 2026-11-15): el cliente con sesión y el barbero, sobre sus propios datos; el propietario puede registrar una en nombre de un cliente. HU27 nombra también al propietario como titular: **sus solicitudes no se construyen en 007** (FR-005), y HU27 queda "parcial" por eso.
- **Plazo interno** (confirmado): 10 días hábiles, el de EQ-18 y PR18, **pendiente de validar contra el plazo legal vigente** (Ley N.° 29733 y su reglamento); el sistema muestra el plazo y marca las vencidas, pero no cierra nada solo.
- **Oposición:** HU27 nombra acceso, rectificación y eliminación; la oposición (ARCO) queda fuera de esta versión mínima y se documenta como no construida.
- **Sin exportación automática:** el acceso se responde con un texto que escribe quien atiende; no se genera ningún archivo ni se envía un correo con los datos.
- **Sin avisos:** registrar o atender una solicitud no envía correos ni WhatsApp en esta versión (el solicitante la consulta en su lista); se documenta como no construido.
- **HU26 y la auditoría** (confirmado): HU26 pide además que el administrador vea **los registros de auditoría**; esta versión solo agrega los indicadores. La consulta de la auditoría por el administrador queda **fuera de 007** y HU26 sigue "parcial".
- **Observabilidad (EQ-21, PR21):** la correlación de solicitudes y las alertas no son parte de 007.
- **Zona horaria de los indicadores:** America/Lima, la de todas las barberías hoy.
- **Usuarios en los indicadores:** se cuentan cuentas con membresía activa, por tipo de membresía (personal o cliente); una persona con membresía en dos barberías cuenta una vez por barbería.
- **La sal de US3:** una sal propia para los intentos de inicio de sesión, distinta de la de los enlaces; su nombre y su manejo se deciden en el plan.
- **Restricciones por suscripción:** registrar y consultar solicitudes sobre datos personales MUST funcionar en cualquier estado de la suscripción, porque es un derecho del titular (asunción; las lecturas ya no se restringen en ningún estado, 003).
- **Dependencias:** la enmienda acotada del principio III y la revisión de ADR-031 para las vistas de solo conteo (FR-012) se escriben y aprueban antes de implementar US2 más allá de las barberías por estado (principio XI); sin ellas, se aplica el criterio de corte.
- **Fuera de alcance (no construido):** las solicitudes del propietario sobre su propia cuenta (FR-005); exportación de datos; borrado o anonimización automática (la anonimización del perfil es evolución futura, FR-008); oposición; avisos al solicitante; vista de la auditoría para el administrador; indicadores por barbería o por persona; tableros con gráficos.

## Desviaciones

Aquí se registra cada recorte aplicado (por ejemplo, US3 completa, o las citas y los usuarios de los indicadores), con la fecha y el motivo. Cada desviación también va en la fila de 007 de `docs/trazabilidad.md`.

- **Alcance decidido en la aclaración del 2026-11-15** (no es un recorte del código, porque todavía no hay código):
  las solicitudes del **propietario** sobre su propia cuenta quedan fuera de 007 (FR-005), y con ello HU27 queda
  "parcial"; la anonimización del perfil queda como evolución futura (FR-008); la auditoría de HU26, fuera de 007.
- **Recortes:** ninguno. El 2026-11-16 el responsable aprobó la enmienda 1.7.0, la revisión de ADR-031 y la aclaración
  PATCH de US3: el criterio de corte de FR-012 **no se aplica**, y las fases 2b, 2c y 3 se construyen.
