# Feature Specification: Acceso verificado

**Feature Branch**: `010-acceso-verificado`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Feature 010: Acceso verificado (evolución del módulo M01, para clientes reales). Cuatro piezas, las tres primeras con el mismo mecanismo de enlace por correo con token de un solo uso: (1) verificación del correo del cliente (enlace de 24 h, un solo uso, solo el hash del token; sin verificar puede ver el catálogo pero no confirmar una reserva, usar el asistente ni pagar el adelanto; aviso con «Reenviar correo de verificación», máximo 3 reenvíos por hora por cuenta y límite por IP; respuestas neutras; cuentas existentes marcadas como verificadas; el personal sigue con su activación); (2) recuperación de contraseña para todos los roles (respuesta neutra, enlace de 1 hora de un solo uso, cierre de sesiones, límite de intentos, enlace «¿Olvidaste tu contraseña?»); (3) páginas públicas versionadas de «Términos y condiciones» y «Política de privacidad y datos personales» (Ley 29733), enlazadas desde el registro, el ingreso, la portada y el pie, con la versión aceptada registrada junto al consentimiento; borrador base que revisará el responsable; (4) acceso del cliente sin sesión: /asistente, /mis-avisos, /mis-datos y el pago del adelanto deben comportarse como /mis-citas, incluidos los enlaces de los recordatorios, el del pago del adelanto (el primer aviso ADELANTO_SOLICITADO debe llevar directo a la pantalla de pago) y el de verificación. Fuera de alcance: cambiar el 409 CORREO_NO_DISPONIBLE (riesgo aceptado en el ADR), dos factores, WhatsApp real, cobro real, directorio, registro sin barbería y carga masiva (011). Restricciones: sin cambiar RLS, el guard de autenticación ni el 409 UNIRSE_REQUIERE_CONSENTIMIENTO; correo solo por NotificationChannel de M05; pruebas con Mailpit y el proveedor de IA falso; adaptar la semilla y las pruebas que registran y reservan enseguida; ADR del flujo de tokens y del evento de M01 a M05; diseño visual nuevo y 360 px."

**Trazabilidad**: HU05 (ingreso), HU06 (registro del cliente), HU27 (derechos sobre los datos) → RF04 (autenticación; se amplía con la recuperación de contraseña), RF05 (registro con consentimiento; se amplía con la verificación del correo y los textos legales publicados), RF30 (avisos por correo; se reutiliza), RF32 (datos personales; se reutiliza el consentimiento) → AC01 Seguridad y privacidad / EQ-07 (autenticación), EQ-12 (límites de intentos), EQ-18 (consentimiento y derechos) → ADR-015 (autenticación antes del tenant), ADR-020 (cuenta de cliente con membresía por barbería), ADR-025 (salida de eventos), ADR-026 (correo detrás de `NotificationChannel`), y un **ADR nuevo** para los enlaces por correo de la cuenta y el evento de M01 a M05 → M01 Acceso y barberías (cuenta, tokens, verificación, contraseña), M05 Notificaciones (envío de los correos), M02 y M03 (comprobar la verificación antes de reservar y de pagar el adelanto), M04 (antes de usar el asistente), interfaz web → PR07, PR09, PR12, PR13. Los números de los RF y HU nuevos o ampliados se asignan en el plan.

**Origen**: la auditoría de coherencia del 2026-11-19 (`specs/auditoria-coherencia.md`, brechas bloqueantes 1 a 3 y brecha importante 7) encontró que el correo del cliente no se verifica, que no existe recuperación de contraseña para ningún rol, que los textos legales que se aceptan no están publicados y que varias pantallas del cliente sin sesión lo dejan sin salida. Las especificaciones 001 (supuestos) y 002 (fuera de alcance) habían dejado la recuperación de contraseña y la verificación del correo "para después".

**Reutiliza de las funcionalidades 001 a 009** (no se repite aquí): la cuenta única por correo y la membresía por barbería (001, 002, ADR-020); el ingreso desde el enlace de la barbería, la unión a otra barbería con consentimiento y su 409 `UNIRSE_REQUIERE_CONSENTIMIENTO` (002); la activación del personal con enlace de 72 h (001); el límite de intentos de ingreso con el origen guardado solo como hash (001, 007); los avisos por correo asíncronos, sin duplicados y sin bloquear la operación (004, ADR-025, ADR-026); las acciones por enlace del recordatorio (004, ADR-032); el adelanto con QR y confirmación manual (008, sin cambios); la pantalla "Ingresar" de /mis-citas sin sesión con la última barbería visitada; y el sistema de diseño de tokens del rediseño de 2026-11.

## Clarifications

### Session 2026-11-23

- Q: Cuando se publique una versión nueva de los textos legales, ¿qué pasa con quien aceptó la anterior? → A: Nada cambia en esta funcionalidad; se decidirá cuando exista una versión nueva (hoy solo existe la primera, así que nadie queda afectado). Se anota como decisión pendiente en el ADR.
- Q: ¿El propietario que registra una barbería también debe verificar su correo? → A: No en 010: solo se verifica el cliente; la verificación del propietario se anota como mejora en el ADR.
- Q: ¿Cómo se autorizan la verificación y la recuperación, que son operaciones sobre la cuenta sin sesión? → A: El plan propone una **enmienda acotada** del principio III (como las anteriores, por ejemplo 1.7.2): una excepción con las operaciones exactas, sin ampliar nada más. El plan incluye el borrador de la enmienda y el ADR, y la enmienda **no se aplica** a la constitución hasta que el responsable la revise.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - El cliente verifica su correo antes de reservar (Priority: P1)

Una persona crea su cuenta de cliente desde el enlace de una barbería. Puede seguir mirando el catálogo y los horarios, pero antes de confirmar su primera reserva tiene que demostrar que el correo es suyo: recibe un correo con un enlace, lo abre y su cuenta queda verificada. Mientras no lo haga, cuando intenta confirmar una reserva, usar el asistente o pagar un adelanto, ve un aviso claro que le explica qué falta y un botón "Reenviar correo de verificación".

**Why this priority**: es la brecha bloqueante número 1 de la auditoría. Sin ella, cualquiera puede registrarse con el correo de otra persona, reservar en su nombre y hacer que los avisos de las citas lleguen a un tercero. Es la condición mínima para recibir clientes reales.

**Independent Test**: registrar un cliente nuevo en una barbería de prueba; intentar reservar y comprobar que se pide la verificación; abrir el enlace que llega al buzón de pruebas; reservar con éxito. Una cuenta de cliente creada antes de esta funcionalidad reserva sin pasos nuevos.

**Acceptance Scenarios**:

1. **Given** una persona que se registra como cliente desde el enlace de una barbería, **When** termina el registro, **Then** su cuenta queda creada sin verificar, conserva la sesión para mirar el catálogo y recibe un correo con un enlace de verificación que vence a las 24 horas.
2. **Given** un cliente sin verificar, **When** intenta confirmar una reserva, usar el asistente o registrar el pago de un adelanto, **Then** la acción no se realiza y ve un aviso que explica que debe verificar su correo, con el correo al que se envió el enlace y el botón "Reenviar correo de verificación".
3. **Given** un cliente sin verificar, **When** abre el enlace de su correo dentro de las 24 horas, **Then** su cuenta queda verificada, el enlace deja de servir y se le lleva a la página de la barbería donde se registró.
4. **Given** un enlace de verificación ya usado, vencido o reemplazado por uno nuevo, **When** alguien lo abre, **Then** ve el mismo mensaje neutro (el enlace no es válido; si su cuenta aún no está verificada puede pedir otro desde la barbería), sin revelar cuál de los tres casos ocurrió ni a qué cuenta pertenecía.
5. **Given** un cliente sin verificar, **When** pulsa "Reenviar correo de verificación", **Then** recibe un enlace nuevo, el anterior deja de servir y, si ya pidió 3 reenvíos en la última hora, se le indica que espere sin enviarle otro.
6. **Given** una cuenta de cliente creada antes de esta funcionalidad, **When** reserva, usa el asistente o paga un adelanto, **Then** puede hacerlo sin ningún paso nuevo, porque quedó marcada como verificada.
7. **Given** un cliente verificado que se une a otra barbería con su misma cuenta, **When** reserva en esa barbería, **Then** no se le pide verificar de nuevo: la verificación es de la cuenta, no de cada barbería.

---

### User Story 2 - Cualquier persona recupera su contraseña (Priority: P1)

Un cliente, un propietario o un barbero olvida su contraseña. Desde la pantalla de ingreso pulsa "¿Olvidaste tu contraseña?", escribe su correo y recibe un enlace que vale una hora. Con él elige una contraseña nueva; todas sus sesiones abiertas se cierran y puede volver a ingresar con la nueva.

**Why this priority**: es la brecha bloqueante número 2 de la auditoría. Hoy quien olvida su contraseña no tiene salida, y la única alternativa sería una intervención manual en la base de datos, inaceptable con clientes reales.

**Independent Test**: con una cuenta de cada rol, pedir la recuperación, abrir el enlace del buzón de pruebas, cambiar la contraseña y comprobar que la anterior ya no sirve, que la nueva sí y que las sesiones abiertas en otro navegador se cerraron.

**Acceptance Scenarios**:

1. **Given** la pantalla de ingreso del personal o el ingreso desde el enlace de una barbería, **When** la persona pulsa "¿Olvidaste tu contraseña?", **Then** ve un formulario que pide solo su correo.
2. **Given** el formulario de recuperación, **When** la persona envía un correo con o sin cuenta, **Then** ve siempre el mismo mensaje ("si hay una cuenta con ese correo, te enviamos un enlace") y la respuesta no revela, ni por su contenido ni por su tiempo, si la cuenta existe.
3. **Given** una cuenta existente, **When** se pide la recuperación, **Then** su dueño recibe un correo con un enlace que vence a la hora, sirve una sola vez y reemplaza a cualquier enlace de recuperación anterior.
4. **Given** un enlace de recuperación vigente, **When** la persona elige una contraseña nueva que cumple las reglas de contraseña existentes, **Then** la contraseña cambia, el enlace deja de servir, todas sus sesiones abiertas (en todas sus barberías) se cierran y se le lleva a ingresar con la contraseña nueva.
5. **Given** un enlace de recuperación usado, vencido o reemplazado, **When** alguien lo abre, **Then** ve el mismo mensaje neutro y la opción de pedir uno nuevo.
6. **Given** una misma cuenta o un mismo origen, **When** se piden recuperaciones o se intentan cambios por encima del límite, **Then** se le indica que espere, sin enviar más correos ni revelar si la cuenta existe.
7. **Given** una cuenta de personal que aún no activó su acceso (pendiente), **When** se pide recuperar su contraseña, **Then** ve el mismo mensaje neutro y no se envía un enlace de recuperación: su camino sigue siendo el enlace de activación que le da el propietario.

---

### User Story 3 - Las personas pueden leer lo que aceptan (Priority: P1)

Quien se registra (propietario o cliente), quien se une a otra barbería y quien visita la portada puede abrir y leer los "Términos y condiciones" y la "Política de privacidad y datos personales", cada uno con su versión y su fecha de vigencia. La versión que la persona acepta queda registrada junto a su consentimiento.

**Why this priority**: es la brecha bloqueante número 3 de la auditoría. Hoy se pide aceptar una política "versión 2026-10" que no se puede leer en ninguna parte; para la Ley N.° 29733 el consentimiento debe ser informado.

**Independent Test**: desde la portada, el pie, el registro del propietario, el registro del cliente, la unión a otra barbería y las pantallas de ingreso, abrir los dos textos; registrar una cuenta y comprobar que la versión aceptada es la publicada.

**Acceptance Scenarios**:

1. **Given** cualquier visitante, **When** abre "Términos y condiciones" o "Política de privacidad y datos personales" desde la portada, el pie, el registro o el ingreso, **Then** ve el texto completo con su versión y su fecha de vigencia, legible a 360 px, sin necesidad de sesión.
2. **Given** el formulario de registro del propietario o del cliente, o el de unión a otra barbería, **When** la persona revisa la casilla de aceptación, **Then** el nombre del documento es un enlace que abre el texto sin perder lo que ya escribió en el formulario.
3. **Given** una persona que acepta y completa el registro, **When** se guarda su consentimiento, **Then** queda registrada la versión exacta del documento que tenía delante.
4. **Given** una versión publicada distinta de la que envía el formulario (por ejemplo, la página quedó abierta mientras se publicaba otra), **When** la persona envía el registro, **Then** no se guarda nada y se le pide recargar para aceptar la versión vigente.
5. **Given** la portada y su pie, **When** se muestran, **Then** "Términos y condiciones" y "Política de privacidad" son enlaces reales y ya no dicen "(en preparación)".

---

### User Story 4 - El cliente sin sesión siempre sabe cómo volver (Priority: P2)

Un cliente abre desde su correo o desde un marcador una pantalla suya (sus avisos, sus datos, el asistente, el pago de un adelanto o un enlace de verificación) sin tener la sesión abierta. En lugar de caer en el ingreso del personal, ve la misma pantalla que hoy muestra "Mis citas": un botón "Ingresar" hacia la última barbería que visitó o, si no se conoce, una explicación de cómo llegar a ella. Tras ingresar, llega a la pantalla que quería abrir.

**Why this priority**: es la brecha importante 7 de la auditoría, ya resuelta para /mis-citas. Las demás pantallas del cliente siguen sin salida. No bloquea la seguridad, pero sí la experiencia de un cliente real que llega desde un correo.

**Independent Test**: sin sesión, abrir cada pantalla del cliente y comprobar que nunca aparece el ingreso del personal; ingresar desde el botón y comprobar que se vuelve a la pantalla pedida; abrir el enlace del correo del adelanto y llegar a la pantalla de pago de esa cita.

**Acceptance Scenarios**:

1. **Given** un cliente sin sesión, **When** abre /asistente, /mis-avisos, /mis-datos o la pantalla de pago de un adelanto, **Then** ve la pantalla de "Ingresar" de su última barbería (o la explicación de cómo llegar a ella), nunca el ingreso del personal.
2. **Given** esa pantalla, **When** el cliente ingresa (o se une a la barbería con su consentimiento), **Then** llega a la pantalla que quería abrir, con la misma dirección.
3. **Given** el correo con las instrucciones de pago de un adelanto, **When** el cliente pulsa su enlace, **Then** llega a la pantalla de pago de esa cita (con sesión) o, sin sesión, a "Ingresar" y luego a esa pantalla.
4. **Given** el correo de un recordatorio o de otro aviso que enlaza a una pantalla del cliente, **When** el cliente lo abre sin sesión, **Then** sigue el mismo camino y nunca termina en el ingreso del personal.
5. **Given** un cliente sin sesión que abre su enlace de verificación, **When** el enlace es válido, **Then** ocurre lo mismo que en el escenario 3 de US1 (FR-015): no hace falta tener la sesión abierta.

---

### Edge Cases

- **Enlace abierto en otro dispositivo**: los enlaces de verificación y de recuperación funcionan en un navegador distinto del que se usó para pedirlos; no dependen de la sesión ni de lo guardado en el navegador.
- **Enlace abierto dos veces o por el filtro de un correo**: algunos programas de correo abren los enlaces para revisarlos. La verificación y el cambio de contraseña requieren una acción en la página (abrir no basta para gastar el enlace), de modo que una apertura automática no consume el enlace ni cambia nada.
- **Cliente ya verificado que pide otra verificación**: la respuesta es la misma que para cualquier reenvío; no se envía otro correo si ya está verificado.
- **Varias solicitudes seguidas**: solo el último enlace de cada tipo sirve; los anteriores quedan anulados.
- **Recuperación mientras hay un enlace de verificación pendiente**: son independientes; cambiar la contraseña no verifica el correo, y verificar no cambia la contraseña. Abrir con éxito un enlace de recuperación **sí** demuestra la posesión del correo; el plan decide si además marca la cuenta como verificada (ver Supuestos).
- **Cuenta suspendida o barbería suspendida**: la recuperación cambia la contraseña, pero el acceso sigue bloqueado por la suspensión, como hoy.
- **Correo que no llega** (servicio de correo caído): la operación principal (registro, solicitud) no falla; el envío se reintenta como los demás avisos y el usuario puede pedir un reenvío dentro de los límites.
- **Cliente presencial sin cuenta** (registrado por el propietario): no tiene correo que verificar ni contraseña; nada cambia para él ni para sus citas.
- **Reserva creada por el propietario para un cliente** (cita presencial): no se exige verificación, porque no la confirma el cliente.
- **Acciones por enlace del recordatorio** (confirmar, reprogramar o cancelar sin sesión, ADR-032): siguen funcionando igual; no dependen de la verificación.
- **Citas ya existentes de un cliente sin verificar**: no existen, porque hoy toda cuenta se marcará como verificada; las cuentas nuevas no pueden crear citas hasta verificar.
- **Versión legal nueva publicada**: las personas que aceptaron una versión anterior conservan su registro y no se les pide nada en esta funcionalidad (FR-024).
- **La política dice "borrador"**: mientras el responsable no la revise, el texto se publica con la marca de versión de borrador; la decisión de publicar la versión revisada es del responsable humano.

## Requirements _(mandatory)_

### Functional Requirements

**Mecanismo común de enlaces por correo (piezas 1 y 2)**

- **FR-001**: El sistema MUST enviar los enlaces de verificación y de recuperación solo por correo, por el mismo canal de avisos asíncronos que ya usa la plataforma, sin bloquear la operación que los origina.
- **FR-002**: Cada enlace MUST servir para un solo propósito (verificar el correo o recuperar la contraseña), para una sola cuenta y una sola vez, y MUST dejar de servir al vencer o al ser reemplazado por uno nuevo del mismo propósito.
- **FR-003**: El sistema MUST guardar de cada enlace solo un resumen que no permita reconstruirlo, su vencimiento, si se usó y si fue anulado; el enlace completo MUST existir solo en el correo y MUST NOT aparecer en registros, auditorías ni respuestas.
- **FR-004**: Abrir un enlace MUST NOT cambiar nada por sí solo: la verificación y el cambio de contraseña MUST requerir una acción explícita de la persona en la página.
- **FR-005**: Un enlace usado, vencido, anulado o inexistente MUST producir el mismo mensaje y la misma respuesta, sin indicar cuál de esos casos ocurrió ni a qué cuenta pertenecía.
- **FR-006**: Las solicitudes de enlace y los intentos de uso MUST limitarse por cuenta y por origen; el origen MUST guardarse solo como resumen con sal, nunca en claro, como los intentos de ingreso actuales.
- **FR-007**: Cada emisión y cada uso de un enlace **que pertenece a una cuenta** (aceptado, o rechazado por usado, vencido o anulado) MUST quedar en la auditoría de la barbería del enlace, sin el enlace ni la contraseña. Un enlace desconocido o mal formado no tiene cuenta ni barbería: MUST registrarse **solo** en el contador técnico de intentos como uso fallido por origen (FR-006), nunca en la auditoría (el principio III exige la barbería en todo registro de auditoría).

**Pieza 1: verificación del correo del cliente**

- **FR-008**: Al registrarse un cliente desde el enlace de una barbería, su cuenta MUST quedar sin verificar y MUST enviarse un enlace de verificación que vence a las 24 horas.
- **FR-009**: Un cliente sin verificar MUST poder ingresar, ver el catálogo, consultar horarios, ver sus avisos y sus datos, y unirse a otra barbería con su consentimiento.
- **FR-010**: Un cliente sin verificar MUST NOT poder confirmar una reserva, usar el asistente ni registrar el pago de un adelanto. El sistema MUST rechazar esas acciones en el servidor (no solo ocultarlas en la interfaz), con un motivo propio que la interfaz pueda distinguir.
- **FR-011**: Ante ese rechazo, la interfaz MUST mostrar un aviso claro con el correo al que se envió el enlace (parcialmente oculto) y el botón "Reenviar correo de verificación".
- **FR-012**: El cliente MUST poder pedir el reenvío como máximo 3 veces por hora por cuenta, con un límite adicional por origen; por encima del límite MUST indicarse cuánto esperar sin enviar más correos.
- **FR-013**: Las respuestas de verificar y de reenviar MUST ser neutras: MUST NOT revelar si un correo tiene cuenta ni si la cuenta ya estaba verificada.
- **FR-014**: La verificación MUST ser de la cuenta (una sola vez para todas las barberías del cliente) y MUST registrar la fecha en que ocurrió.
- **FR-015**: Tras verificar, el sistema MUST llevar al cliente a la página pública de la barbería donde se registró, tenga o no la sesión abierta en ese navegador.
- **FR-016**: Toda cuenta de cliente existente al activarse esta regla MUST quedar marcada como verificada, con la anotación de que fue verificada por la migración y no por un enlace.
- **FR-017**: Las cuentas de personal MUST seguir con su activación actual (enlace de 72 h entregado por el propietario); activar la cuenta MUST contar como verificación de su correo.

**Pieza 2: recuperación de contraseña**

- **FR-018**: Toda cuenta con contraseña (cliente, propietario o barbero activo) MUST poder pedir la recuperación desde un enlace "¿Olvidaste tu contraseña?" en cada pantalla de ingreso (la del personal y la de cada barbería).
- **FR-019**: La solicitud MUST pedir solo el correo y MUST responder siempre con el mismo mensaje y en un tiempo que no dependa de que la cuenta exista.
- **FR-020**: Si la cuenta existe y puede recuperarse, el sistema MUST enviar un enlace que vence a la hora y reemplaza a los anteriores de recuperación. Una cuenta de personal pendiente de activar MUST NOT recibir enlace de recuperación.
- **FR-021**: La contraseña nueva MUST cumplir las mismas reglas que al registrarse (incluida la que impide usar el propio correo).
- **FR-022**: Al cambiar la contraseña, el sistema MUST cerrar todas las sesiones abiertas de esa cuenta en todas sus barberías, MUST invalidar sus enlaces de recuperación pendientes y MUST llevar a la persona a ingresar de nuevo.
- **FR-023**: El sistema MUST avisar por correo al dueño de la cuenta que su contraseña cambió, sin incluir la contraseña.

**Pieza 3: textos legales**

- **FR-024**: El sistema MUST publicar, sin sesión, las páginas "Términos y condiciones" y "Política de privacidad y datos personales", cada una con su versión y su fecha de vigencia, enlazadas desde la portada, el pie, el registro del propietario, el registro del cliente, la unión a otra barbería y las pantallas de ingreso. Publicar una versión nueva no cambia nada para quien aceptó una anterior: esta funcionalidad no pide volver a aceptar ni muestra avisos (decisión pendiente para cuando exista una versión nueva, anotada en el ADR).
- **FR-025**: Los enlaces a los textos desde un formulario MUST abrirse sin perder los datos ya escritos.
- **FR-026**: Al registrar un consentimiento, el sistema MUST guardar la versión exacta aceptada y MUST rechazar, sin guardar nada, un registro que envíe una versión distinta de la vigente.
- **FR-027**: El contenido inicial de los dos textos MUST ser un borrador base que cubra lo que la Ley N.° 29733 y su reglamento exigen informar (responsable del tratamiento, finalidades, datos tratados, plazo de conservación, destinatarios, derechos y cómo ejercerlos, incluidas las solicitudes ya construidas en 007, y uso de cookies técnicas), marcado como borrador hasta que el responsable humano lo revise.

**Pieza 4: acceso del cliente sin sesión**

- **FR-028**: Las pantallas del cliente (/asistente, /mis-avisos, /mis-datos y el pago del adelanto) MUST comportarse sin sesión como /mis-citas: mostrar "Ingresar" hacia la última barbería visitada o la explicación de cómo llegar a ella, y MUST NOT llevar al ingreso del personal.
- **FR-029**: Tras ingresar o unirse desde esa pantalla, el cliente MUST llegar a la dirección que quería abrir.
- **FR-030**: El aviso de instrucciones de pago del adelanto MUST incluir un enlace que lleve a la pantalla de pago de esa cita; todo enlace de un correo al cliente que apunte a una pantalla suya MUST seguir el camino de FR-028.
- **FR-031**: Cubierto por FR-015 (el enlace de verificación funciona sin sesión y lleva a la barbería de origen). Se conserva el número solo para la trazabilidad con US4; no agrega una exigencia propia.

**Transversales**

- **FR-032**: Las pantallas nuevas (solicitar recuperación, elegir contraseña nueva, resultado de la verificación, aviso de verificación pendiente y textos legales) MUST usar los componentes y tokens del sistema de diseño, cumplir WCAG 2.2 AA y verse sin desbordes a 360 px.
- **FR-033**: Esta funcionalidad MUST NOT cambiar el aislamiento entre barberías, la forma en que se protege cada solicitud con sesión ni el consentimiento para unirse a otra barbería (409 `UNIRSE_REQUIERE_CONSENTIMIENTO`); el registro MUST conservar su respuesta actual ante un correo ya usado (riesgo aceptado y documentado).
- **FR-034**: Los datos de ejemplo y las pruebas automáticas que hoy registran un cliente y reservan enseguida MUST adaptarse para verificar el correo por el mismo enlace que recibe un cliente real, leyendo el buzón de pruebas.

### Key Entities _(include if feature involves data)_

- **Enlace de cuenta por correo**: autorización de un solo uso para una acción sobre una cuenta. Atributos: propósito (verificar el correo o recuperar la contraseña), cuenta a la que pertenece, barbería de origen cuando aplica (la del registro, para llevar al cliente allí al verificar), resumen no reversible del enlace, vencimiento, fecha de uso y fecha de anulación. No guarda el enlace completo.
- **Estado de verificación de la cuenta**: si el correo de la cuenta está verificado, cuándo y cómo (por enlace, por activación del personal o por la migración inicial).
- **Intento o solicitud limitada**: contador técnico de solicitudes y de usos fallidos por cuenta y por origen (el origen solo como resumen con sal), con purga periódica, como los intentos de ingreso actuales.
- **Documento legal**: tipo (términos o privacidad), versión, fecha de vigencia, texto y marca de borrador.
- **Consentimiento** (existente): ya registra la versión de la política aceptada; se asegura que la versión corresponda a un documento publicado.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: El 100 % de las cuentas de cliente creadas después de activar la regla no pueden confirmar una reserva, usar el asistente ni registrar un pago de adelanto antes de verificar, comprobado con pruebas que intentan las tres acciones.
- **SC-002**: El 100 % de las cuentas de cliente existentes al activar la regla siguen reservando sin pasos nuevos.
- **SC-003**: Una persona completa la verificación (desde el registro hasta poder reservar) en menos de 2 minutos con el buzón abierto, y la recuperación de contraseña (desde "¿Olvidaste tu contraseña?" hasta ingresar con la nueva) en menos de 3 minutos.
- **SC-004**: En el entorno de pruebas, el correo de verificación o de recuperación llega al buzón en menos de 1 minuto en el 95 % de los casos.
- **SC-005**: Las respuestas de solicitar recuperación, verificar y reenviar son idénticas para un correo con cuenta y sin cuenta (mismo estado y mismo mensaje). Además, en una medición de 100 solicitudes por serie (con cuenta y sin cuenta, por cada tipo), la diferencia entre las medianas de las dos series es **menor de 30 ms** y el **percentil 90 de ambas series** queda dentro del tiempo mínimo de respuesta configurado **más 50 ms** (400 + 50 = 450 ms con el valor por defecto).
- **SC-006**: Ningún enlace sirve dos veces ni después de su vencimiento (24 h para verificar, 1 h para recuperar), comprobado para cada propósito.
- **SC-007**: Tras cambiar la contraseña, el 100 % de las sesiones abiertas de esa cuenta dejan de servir en su siguiente uso.
- **SC-008**: Los dos textos legales son alcanzables en un clic desde los 6 lugares indicados (portada, pie, registro del propietario, registro del cliente, unión a otra barbería y pantallas de ingreso), y el 100 % de los consentimientos nuevos guarda la versión publicada.
- **SC-009**: Ninguna pantalla del cliente lleva al ingreso del personal cuando no hay sesión (0 casos en las 5 pantallas y en los enlaces de los correos al cliente).
- **SC-010**: Las pantallas nuevas no tienen incumplimientos de contraste ni de etiquetas en una revisión automática de accesibilidad, en tema claro y oscuro, a 360 px y en escritorio.

## Assumptions

- **Solo el cliente se verifica** (decisión del 2026-11-23). El propietario que registra su barbería no pasa por la verificación en esta funcionalidad (su registro abre la sesión como hoy); el personal se considera verificado al activar su cuenta. Verificar también al propietario se deja como mejora y se anota en el ADR, con su riesgo: un propietario con un correo ajeno o mal escrito no podría recuperar su contraseña ni recibir los avisos.
- **Abrir con éxito un enlace de recuperación** demuestra la posesión del correo; el plan decide si eso también marca la cuenta como verificada (lo razonable es que sí).
- **La verificación no inicia sesión**: abrir el enlace verifica la cuenta y lleva a la barbería, pero no crea una sesión nueva; si el navegador ya tenía la sesión del cliente, la conserva.
- **Conservación de los enlaces** (minimización de datos): los enlaces usados, anulados o vencidos se borran a los 30 días; los contadores de intentos, a las 24 horas.
- **Límites por defecto** (ajustables en el plan): reenvío de verificación 3 por hora por cuenta y 20 por hora por origen; solicitudes de recuperación 3 por hora por cuenta y 10 por hora por origen; intentos de uso fallidos limitados por origen como los enlaces de acción del recordatorio.
- **Mensajes neutros también en la interfaz**: el formulario de recuperación no confirma si el correo existe; el registro sigue diciendo "Ya tienes una cuenta con ese correo" (riesgo aceptado, FR-033).
- **Correo como único canal**: no se envían estos enlaces por WhatsApp; en pruebas y desarrollo llegan a Mailpit.
- **Textos legales**: se redactan como borrador base en español; la revisión legal y la decisión de publicar la versión definitiva son del responsable humano. No se agrega gestión de cookies más allá de declararlas (son técnicas).
- **Gobernanza, para el plan**: la verificación y la recuperación son operaciones sobre la cuenta antes de tener una sesión, y la recuperación de un cliente con varias barberías debe cerrar sesiones de todas ellas. El plan propone una enmienda acotada del principio III con las operaciones exactas (borrador para revisión del responsable, sin aplicarla a la constitución) y registra la decisión en el ADR nuevo junto con el evento de M01 a M05, el marcado de las cuentas existentes como verificadas y el riesgo aceptado del 409 `CORREO_NO_DISPONIBLE`.
- **Fuera de alcance** (no se construye aquí): cambiar el 409 `CORREO_NO_DISPONIBLE` del registro, autenticación de dos factores para barberías, WhatsApp real, cobro real de la suscripción, directorio de barberías, registro del cliente sin barbería, carga masiva de servicios o barberos (011), cambios en el adelanto (008) o en la pasarela simulada de la suscripción (003), y cambiar el correo de una cuenta.
- **Dependencias**: el envío de correo de M05 (004) y su buzón de pruebas; el sistema de diseño del rediseño de 2026-11; la pantalla de "Ingresar" de /mis-citas sin sesión y la memoria de la última barbería visitada (ya construidas).
