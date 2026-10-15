# Feature Specification: Registro de barbería, acceso con roles y aislamiento por barbería

**Feature Branch**: `001-registro-acceso-barberia`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Registro de barbería, inicio de sesión con roles y aislamiento por barbería. Una barbería se registra y se crea su espacio de trabajo con su propietario y una prueba gratuita (RF01, RF18). Los usuarios inician y cierran sesión y reciben un token firmado con su rol y su barbería (RF04). El propietario crea usuarios con rol: administrativo o barbero (RF06). Un usuario nunca puede ver ni modificar datos de otra barbería. Lee docs/01-analisis-de-sistema/03-requisitos-funcionales.md, 02-historias-del-usuario.md y 08-escenarios-atributos-calidad.md para los criterios de aceptación y las historias relacionadas."

**Trazabilidad**: HU02, HU04, HU05 → RF01, RF04, RF06, RF18 → EQ-07, EQ-08, EQ-09, EQ-10, EQ-12, EQ-13 → ADR-003, ADR-010 → M01 Acceso y barberías (RF18 en M03) → PR07, PR08, PR09, PR10, PR12, PR13.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar la barbería y empezar la prueba gratuita (Priority: P1)

El propietario de una barbería de Ayacucho entra a la plataforma sin cuenta, completa un formulario corto con los datos de su barbería y los suyos, y obtiene de inmediato un espacio de trabajo propio en el que es propietario, con una prueba gratuita activa. No se le pide pago ni tarjeta (HU02).

**Why this priority**: Sin barbería registrada no existe ningún espacio de trabajo, ni usuarios, ni datos que aislar. Es la puerta de entrada al producto y la base de las demás historias.

**Independent Test**: Registrar una barbería nueva y comprobar que existe su espacio de trabajo, que el propietario queda asociado a él con rol propietario y que la suscripción está en prueba gratuita con fecha de vencimiento, sin que se haya pedido ningún dato de pago.

**Acceptance Scenarios**:

1. **Given** un visitante sin cuenta, **When** registra una barbería con nombre comercial, sus datos de propietario (nombre, correo, contraseña) y acepta los términos y la política de datos, **Then** se crea el espacio de trabajo de la barbería y la cuenta del propietario asociada a él con rol propietario.
2. **Given** un registro completado, **When** se consulta la suscripción de esa barbería, **Then** está en estado TRIAL con fecha de inicio igual a la del registro y fecha de vencimiento al final del periodo de prueba.
3. **Given** el formulario de registro, **When** el visitante lo recorre completo, **Then** en ningún paso se solicitan datos de pago ni de tarjeta.
4. **Given** un correo ya usado por otra cuenta, **When** se intenta registrar una barbería con ese correo de propietario, **Then** el registro se rechaza con un mensaje que no revela a qué barbería pertenece ese correo.
5. **Given** datos incompletos o inválidos (correo mal formado, contraseña débil, nombre vacío o demasiado largo), **When** se envía el registro, **Then** se rechaza indicando los campos a corregir y no se crea ningún espacio de trabajo parcial.

---

### User Story 2 - Iniciar y cerrar sesión de forma segura (Priority: P1)

Un usuario de una barbería (propietario o barbero) inicia sesión con su correo y contraseña y recibe una credencial de sesión firmada que indica quién es, qué rol tiene y a qué barbería pertenece. Al terminar, cierra sesión y esa credencial deja de servir (HU05).

**Why this priority**: Toda operación protegida depende de saber quién es el usuario, su rol y su barbería. Sin sesión no hay autorización ni aislamiento.

**Independent Test**: Con una barbería y su propietario ya registrados, iniciar sesión, usar la credencial para acceder a un recurso protegido de la propia barbería, cerrar sesión y verificar que la credencial ya no da acceso.

**Acceptance Scenarios**:

1. **Given** un usuario activo con credenciales correctas, **When** inicia sesión, **Then** recibe una credencial de sesión firmada que contiene su identidad, su rol y su barbería, con un vencimiento corto, y puede renovarla mientras su sesión siga vigente.
2. **Given** un correo inexistente o una contraseña incorrecta, **When** se intenta iniciar sesión, **Then** se responde con el mismo mensaje genérico en ambos casos ("credenciales inválidas"), sin indicar cuál dato falló.
3. **Given** cinco intentos fallidos en un minuto para la misma cuenta y el mismo origen, **When** se hace el sexto intento, **Then** se rechaza por exceso de intentos y se aplica una espera creciente, sin afectar a otros usuarios.
4. **Given** un usuario con sesión iniciada, **When** cierra sesión, **Then** su credencial y su posibilidad de renovarla quedan invalidadas y cualquier uso posterior se rechaza como no autenticado.
5. **Given** una solicitud a un recurso protegido sin credencial, con credencial vencida o con credencial alterada, **When** llega al sistema, **Then** se rechaza como no autenticada sin revelar detalles del motivo.
6. **Given** un usuario desactivado o una barbería suspendida, **When** uno de sus usuarios operativos intenta iniciar sesión, **Then** se rechaza el acceso y no se emite credencial.

---

### User Story 3 - Aislamiento total entre barberías (Priority: P1)

Cualquier usuario autenticado de la barbería A solo puede ver y modificar datos de la barbería A. Aunque cambie identificadores, parámetros o el contenido de una solicitud para apuntar a la barbería B, nunca obtiene ni altera datos de B. La barbería a la que pertenece se toma siempre de su credencial firmada, nunca de lo que envíe (EQ-09, principio III de la constitución).

**Why this priority**: Una fuga entre barberías es el riesgo más grave del sistema (R01) y es un principio no negociable. Debe estar garantizado desde la primera funcionalidad que maneja datos.

**Independent Test**: Crear dos barberías con sus usuarios; con la sesión de un usuario de A, intentar leer, listar, modificar y desactivar usuarios de B usando sus identificadores, y también intentar indicar la barbería B en parámetros o cuerpo. Ningún intento debe devolver ni alterar datos de B.

**Acceptance Scenarios**:

1. **Given** dos barberías A y B con usuarios cada una, **When** el propietario de A lista los usuarios, **Then** solo ve usuarios de A.
2. **Given** el identificador de un usuario de B, **When** un usuario de A intenta consultarlo, modificarlo o desactivarlo, **Then** el sistema responde como si el recurso no existiera y los datos de B no cambian.
3. **Given** un usuario de A, **When** envía una solicitud que indica la barbería B en la ruta, la consulta, el cuerpo o los encabezados, **Then** el sistema ignora o rechaza ese valor y opera solo sobre A.
4. **Given** un intento de acceso a datos de otra barbería, **When** se rechaza, **Then** queda registrado en la auditoría con el usuario, la barbería de origen, la acción y la fecha y hora.

---

### User Story 4 - El propietario crea usuarios barberos (Priority: P2)

El propietario, que administra todo en su barbería, da de alta a los barberos que atienden. Cada usuario que crea tiene el rol barbero en su barbería. Más adelante puede desactivarlo o reactivarlo (HU04).

**Why this priority**: Permite delegar tareas con límites. Depende de que existan barbería, sesión y aislamiento (P1), pero sin ella el propietario opera solo.

**Independent Test**: Con la sesión del propietario, crear un barbero, iniciar sesión con él y comprobar que su credencial lleva el rol barbero y la barbería del propietario, y que no puede crear usuarios.

**Acceptance Scenarios**:

1. **Given** un propietario con sesión iniciada, **When** crea un usuario con nombre, correo y rol barbero, **Then** el usuario queda asociado a la barbería del propietario con rol barbero y puede establecer su contraseña para iniciar sesión.
2. **Given** un propietario, **When** intenta crear un usuario con rol propietario, administrador de la plataforma, cliente o un rol inexistente, **Then** se rechaza.
3. **Given** un barbero con sesión iniciada, **When** intenta crear, modificar o desactivar usuarios, **Then** se rechaza por falta de permiso y el intento queda registrado.
4. **Given** una barbería que alcanzó el límite de usuarios de su plan (o de la prueba gratuita), **When** el propietario intenta crear otro usuario, **Then** se rechaza indicando que se alcanzó el límite del plan.
5. **Given** un usuario existente de su barbería, **When** el propietario lo desactiva, **Then** el cambio se aplica, queda en la auditoría (quién, qué, cuándo, sobre qué barbería) y el usuario desactivado ya no puede iniciar sesión; sus datos históricos se conservan.
6. **Given** un correo que ya pertenece a otra cuenta, **When** el propietario intenta crear un usuario con ese correo, **Then** se rechaza sin revelar a qué barbería pertenece.

---

### Edge Cases

- Dos registros simultáneos con el mismo correo de propietario: solo uno se completa; el otro recibe el rechazo de correo ya usado.
- Falla a mitad del registro (por ejemplo, después de crear la barbería y antes de crear la suscripción): no debe quedar una barbería sin propietario o sin prueba gratuita; el registro se completa entero o no se crea nada.
- Dos barberías con el mismo nombre comercial: se permite; cada una tiene su propio espacio de trabajo e identificador.
- El propietario intenta desactivarse a sí mismo: se rechaza, porque cada barbería debe conservar un propietario activo.
- Un usuario es desactivado mientras tiene una sesión abierta: su credencial vigente deja de aceptarse a más tardar al vencer o al intentar renovarla, y las operaciones sensibles se validan contra su estado actual.
- La prueba gratuita vence: el usuario puede seguir iniciando sesión; las restricciones de funciones por estado de suscripción corresponden a RF21/RF22 (fuera de esta funcionalidad).
- Correo escrito con mayúsculas o espacios: se normaliza para que "Ana@Mail.com " y "ana@mail.com" sean la misma cuenta.
- Entradas con scripts, inyección o longitudes excesivas en cualquier campo: se rechazan con mensaje controlado y no se ejecutan (EQ-10).
- Un mismo correo como personal de dos barberías: no se permite en esta funcionalidad (ver Supuestos).

## Requirements *(mandatory)*

### Functional Requirements

**Registro de barbería y prueba gratuita (RF01, RF18)**

- **FR-001**: El sistema MUST permitir a un visitante sin sesión registrar una barbería indicando, como mínimo, nombre comercial de la barbería y nombre, correo y contraseña del propietario, y aceptando los términos de uso y la política de tratamiento de datos.
- **FR-002**: Al completar el registro, el sistema MUST crear en una sola operación indivisible el espacio de trabajo de la barbería, la cuenta del propietario con rol propietario asociada a esa barbería y la suscripción en prueba gratuita; si cualquier parte falla, no se crea nada.
- **FR-003**: La suscripción creada MUST quedar en estado TRIAL con fecha de inicio igual a la del registro y fecha de vencimiento al final del periodo de prueba configurado por la plataforma.
- **FR-004**: El registro MUST NOT solicitar ni aceptar datos de pago o de tarjeta.
- **FR-005**: El sistema MUST registrar la aceptación del propietario con fecha y versión del texto aceptado.
- **FR-006**: El sistema MUST rechazar el registro si el correo del propietario ya pertenece a otra cuenta, con un mensaje que no revele a qué barbería pertenece.

**Inicio y cierre de sesión (RF04)**

- **FR-007**: El sistema MUST permitir a los usuarios activos de una barbería iniciar sesión con correo y contraseña.
- **FR-008**: Al iniciar sesión, el sistema MUST emitir una credencial de sesión firmada, de vida corta, que contenga la identidad del usuario, su rol y su barbería, junto con un medio para renovarla sin volver a escribir la contraseña mientras la sesión siga vigente.
- **FR-009**: Ante credenciales inválidas, el sistema MUST responder con un mensaje genérico idéntico, sin indicar si falló el correo o la contraseña.
- **FR-010**: El sistema MUST limitar los intentos de inicio de sesión: a partir del sexto intento fallido en un minuto para la misma cuenta y origen, MUST rechazarlos con espera creciente.
- **FR-011**: El sistema MUST permitir cerrar sesión; tras hacerlo, la credencial y su renovación MUST quedar invalidadas.
- **FR-012**: El sistema MUST rechazar como no autenticada toda solicitud a un recurso protegido sin credencial, con credencial vencida, alterada o invalidada, sin revelar detalles del motivo.
- **FR-013**: El sistema MUST impedir el inicio de sesión y la renovación de sesión a usuarios desactivados y a usuarios operativos de barberías suspendidas.
- **FR-014**: Las contraseñas MUST almacenarse solo como resumen con algoritmo lento y sal; nunca en texto legible ni en registros.

**Usuarios y roles (RF06)**

- **FR-015**: El sistema MUST permitir solo al propietario crear usuarios en su barbería con nombre, correo y rol barbero.
- **FR-016**: Cada usuario MUST tener exactamente un rol en su barbería: propietario o barbero.
- **FR-017**: El sistema MUST rechazar la asignación de cualquier rol distinto de barbero al crear usuarios del personal.
- **FR-018**: El sistema MUST permitir al propietario listar los usuarios de su barbería y desactivarlos y reactivarlos; la desactivación MUST conservar sus datos históricos.
- **FR-019**: El sistema MUST impedir que la barbería se quede sin propietario activo (el propietario no puede desactivarse a sí mismo).
- **FR-020**: El sistema MUST rechazar la creación de usuarios cuando la barbería haya alcanzado el límite de usuarios de su plan o de la prueba gratuita.
- **FR-021**: El sistema MUST aplicar control de acceso por rol en cada operación, según la matriz rol × operación del proyecto; una operación no permitida para el rol MUST rechazarse por falta de permiso y registrarse.
- **FR-022**: El usuario creado por el propietario MUST poder establecer su propia contraseña mediante un mecanismo seguro de un solo uso con vencimiento, sin que el propietario conozca la contraseña final.

**Aislamiento por barbería**

- **FR-023**: La barbería del usuario MUST determinarse exclusivamente a partir de su credencial firmada; el sistema MUST ignorar o rechazar cualquier indicación de barbería enviada en la ruta, la consulta, el cuerpo o los encabezados.
- **FR-024**: Ningún usuario MUST poder leer, listar, crear, modificar ni desactivar datos de una barbería distinta de la suya; ante un recurso de otra barbería, el sistema MUST responder como si no existiera.
- **FR-025**: El aislamiento MUST garantizarse en más de una barrera independiente, de modo que un error en una sola de ellas no exponga datos de otra barbería.
- **FR-026**: Todo dato de negocio creado por esta funcionalidad (usuarios, roles asignados, suscripción, registros de auditoría) MUST quedar asociado a su barbería.

**Auditoría y validación**

- **FR-027**: El sistema MUST registrar en auditoría, con quién, qué, cuándo, desde dónde y sobre qué barbería: el registro de una barbería, la creación de usuarios, las desactivaciones y reactivaciones, los accesos denegados por rol y los intentos de acceso a otra barbería.
- **FR-028**: El sistema MUST validar todas las entradas (formato, longitud, caracteres) y rechazar las inválidas con un mensaje controlado, sin ejecutar su contenido.
- **FR-029**: El correo MUST normalizarse (sin espacios y sin distinguir mayúsculas) para la unicidad y el inicio de sesión.

### Key Entities *(include if feature involves data)*

- **Barbería (espacio de trabajo)**: unidad de aislamiento. Atributos: identificador, nombre comercial, estado (activa, suspendida), fecha de registro. Tiene un propietario, usuarios y una suscripción.
- **Usuario**: persona que inicia sesión. Atributos: identificador, nombre, correo único normalizado, resumen de contraseña, estado (pendiente de activar, activo, desactivado), fecha de creación. Pertenece a una sola barbería.
- **Rol asignado**: relación usuario–barbería con exactamente un rol: propietario o barbero. El catálogo de roles de la plataforma incluye además administrador de la plataforma y cliente, que no se asignan en esta funcionalidad.
- **Suscripción**: estado comercial de la barbería. Atributos: estado (TRIAL en esta funcionalidad), plan, fecha de inicio, fecha de vencimiento, límite de usuarios.
- **Aceptación de términos**: evidencia de lo que aceptó el propietario. Atributos: usuario, barbería, versión del texto, fecha y hora.
- **Sesión**: periodo autenticado de un usuario. Atributos: usuario, barbería, rol, emisión, vencimiento, estado (vigente, cerrada, revocada).
- **Registro de auditoría**: hecho sensible. Atributos: actor, acción, recurso afectado, barbería, origen, fecha y hora, resultado (permitido o denegado). No modificable por la aplicación.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un propietario sin capacitación completa el registro de su barbería y entra a su espacio de trabajo en menos de 3 minutos desde un celular.
- **SC-002**: El 100 % de los registros completados tienen espacio de trabajo, propietario y prueba gratuita con fecha de vencimiento; 0 registros parciales tras fallos simulados a mitad del proceso.
- **SC-003**: 0 datos de otra barbería visibles o modificables en la suite de pruebas de fuga que recorre todas las operaciones de esta funcionalidad con identificadores, parámetros y contenido manipulados (EQ-09).
- **SC-004**: El 100 % de las solicitudes sin credencial, con credencial vencida, alterada o posterior al cierre de sesión se rechazan (EQ-07).
- **SC-005**: El 100 % de las combinaciones rol × operación de esta funcionalidad se permiten o rechazan según la matriz (EQ-08).
- **SC-006**: A partir del sexto intento fallido de inicio de sesión en un minuto, el 100 % se rechazan, y los usuarios legítimos de otras cuentas no ven bloqueos (EQ-12).
- **SC-007**: El 100 % de las acciones sensibles listadas en FR-027 generan un registro de auditoría completo (EQ-13).
- **SC-008**: El inicio de sesión con credenciales correctas se completa en menos de 2 segundos para el 95 % de los intentos en operación normal.
- **SC-009**: El propietario crea un usuario barbero nuevo en menos de 1 minuto.

## Assumptions

- La duración de la prueba gratuita es configurable por la plataforma; se propone 14 días como valor inicial (por validar con el modelo comercial). La documentación del proyecto no fija un valor.
- El límite de usuarios durante la prueba gratuita lo define el plan de prueba configurado por la plataforma; esta funcionalidad solo lo hace cumplir. Los precios y límites de planes son referenciales.
- En esta funcionalidad cada usuario del personal pertenece a una sola barbería y un correo identifica una sola cuenta. Que una persona trabaje en varias barberías con la misma cuenta queda como evolución futura.
- El usuario creado por el propietario activa su cuenta con un enlace de un solo uso enviado a su correo. Si el envío de correo no estuviera disponible aún (M05), el enlace se muestra al propietario para entregarlo en persona; esto no bloquea la creación del usuario.
- Los roles del personal son solo dos: propietario, que administra todo en su barbería, y barbero. El propietario solo crea usuarios con rol barbero.
- Suspender o reactivar barberías (RF02, HU01) no es parte de esta funcionalidad; aquí solo se respeta el estado al iniciar sesión.
- Las restricciones de funciones según estado de suscripción (RF21, RF22), el pago (RF23–RF25) y el registro de clientes (RF05) quedan fuera del alcance.
- La recuperación de contraseña olvidada queda fuera del alcance de esta funcionalidad y se tratará por separado.
- Las medidas numéricas (5 intentos por minuto, tiempos de respuesta) provienen de los escenarios EQ del proyecto y son propuestas por validar.
- La plataforma es solo web responsive; los usuarios acceden desde el navegador de su celular o computadora.
