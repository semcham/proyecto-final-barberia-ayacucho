# Feature Specification: Carga masiva de servicios y barberos

**Feature Branch**: `011-carga-masiva-catalogo`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "Carga masiva de servicios y barberos para una barbería. Contexto: hoy el propietario crea servicios y barberos de uno en uno, y al incorporar una barbería real eso es lento. Quiero que el propietario o el administrador pueda cargar varios a la vez desde el panel. Servicios en lote: una tabla editable donde se agregan filas (nombre, duración en minutos, precio en soles), con opción de pegar filas desde Excel o Google Sheets y un botón para agregar servicios típicos de barbería (por ejemplo corte, barba, corte y barba, cejas) que luego se pueden editar. Barberos en lote: una tabla editable (nombre y datos básicos del perfil); los barberos se crean como perfiles sin cuenta de usuario, igual que hoy. Reglas: máximo 50 filas por carga. Antes de guardar se muestra una vista previa con los errores por fila (nombre vacío, duración o precio inválidos, nombres repetidos dentro de la carga o ya existentes) y no se guarda nada hasta corregirlos. La carga es todo o nada: o se guardan todas las filas o ninguna, en una sola transacción. Debe respetar el límite de servicios y de barberos del plan de la barbería (prueba, Básico, Pro) calculado para el lote completo, con el mismo bloqueo que usa hoy la creación individual para que dos cargas a la vez no superen el cupo. Reutiliza las reglas de creación individual (no dupliques la validación). Solo roles con permiso de gestionar catálogo. Cada barbería solo ve y carga lo suyo (aislamiento RLS). Se registra en la auditoría. Responde con un resumen: cuántos se crearon. Fuera de alcance: importar archivos .xlsx o .csv (solo pegar o escribir en la tabla), cuentas de usuario para barberos, edición en lote de lo ya existente, fotos. Interfaz: sigue el diseño actual (tokens, claro y oscuro, 360 px, accesible con teclado y axe en 0), con textos en español simple."

**Trazabilidad**: HU07 (catálogo de servicios), HU08 (barberos) → RF07 (gestionar servicios), RF08 (gestionar barberos y asignarles servicios); se amplían con la creación en lote → AC02 Consistencia / EQ-16 (todo o nada), AC01 Seguridad / EQ de aislamiento por barbería → ADR del límite de barberos del plan (R13 de 002, bloqueo de la suscripción en la transacción) → M02 Catálogo y citas (catálogo), M03 Suscripciones (cupo del plan y catálogo de solo lectura con la suscripción vencida o suspendida), interfaz web del panel del propietario. Los números de RF y HU ampliados y cualquier ADR nuevo se asignan en el plan.

## Clarifications

### Session 2026-11-25

- Q: ¿Se respeta un límite de servicios del plan? (hoy los planes solo limitan barberos activos y usuarios) → A: No. Solo se respeta el límite de barberos; los servicios siguen sin límite y los planes no cambian (FR-016).
- Q: ¿Un nombre de barbero repetido (en la carga o con uno existente) es error? → A: No: es una advertencia de la fila que deja guardar; la creación individual no cambia (FR-009).
- Q: ¿Quién es "el administrador"? → A: Solo el propietario (confirmado por el usuario; ver abajo).
- Q: ¿Qué son los "datos básicos" del barbero? → A: Nombre y servicios que ofrece (confirmado por el usuario; ver abajo).

- Q: ¿Los servicios típicos traen precio? → A: No. Solo nombre y duración sugerida editable; el precio queda vacío y la revisión marca "Falta el precio" hasta que el propietario lo escriba (FR-003, FR-003a; ajuste del usuario antes de las tareas).

### Decisiones tomadas al especificar (2026-11-25, confirmadas por el usuario)

- **"El propietario o el administrador"**: en una barbería el propietario es quien administra todo (no existe un rol administrativo aparte, ACT-02). El **administrador de la plataforma queda fuera**: la constitución (principio III, excepción de operaciones de la plataforma) dice que MUST NOT ver ni modificar el catálogo de una barbería. La carga en lote la usa solo quien hoy puede gestionar servicios y barberos: el **propietario**.
- **Datos básicos del barbero**: hoy un barbero tiene nombre visible y los servicios que ofrece (el vínculo con un usuario queda fuera, como pide la descripción). La carga de barberos pide **nombre** (obligatorio) y **servicios que ofrece** (opcional, elegidos entre los servicios activos de la barbería).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cargar varios servicios a la vez (Priority: P1)

El propietario de una barbería que recién se incorpora abre "Servicios", elige "Agregar varios" y ve una tabla con filas vacías (nombre, duración en minutos, precio en soles, y descripción opcional). Puede escribir en la tabla, pegar filas copiadas de Excel o Google Sheets, o pulsar "Agregar servicios típicos" para llenar filas con nombres comunes (Corte, Barba, Corte y barba, Cejas, Corte para niños, Lavado) y una duración sugerida, **con el precio vacío**: escribe el precio de cada uno y edita o borra lo que no ofrece. Pulsa "Revisar", ve la vista previa con los errores marcados en cada fila, los corrige y pulsa "Guardar". Recibe un resumen: "Se crearon 8 servicios".

**Why this priority**: Los servicios son lo primero que necesita una barbería para recibir reservas, y los barberos se asignan a servicios. Es el mayor ahorro de tiempo al incorporar una barbería real.

**Independent Test**: Con una barbería sin servicios, cargar 10 servicios pegados desde una hoja de cálculo, corregir los errores de la vista previa y guardar: aparecen los 10 en la lista de servicios y en el catálogo público, y el resumen dice "Se crearon 10 servicios".

**Acceptance Scenarios**:

1. **Given** el propietario en "Agregar varios servicios", **When** pega desde una hoja de cálculo un bloque de filas con columnas nombre, duración y precio (separadas por tabulaciones), **Then** cada línea pegada se convierte en una fila de la tabla en el orden en que venía, sin pasar de 50 filas.
2. **Given** la tabla, **When** pulsa "Agregar servicios típicos", **Then** se agregan filas editables con servicios comunes de barbería (Corte, Barba, Corte y barba, Cejas, Corte para niños y Lavado) con su nombre y una duración sugerida, **el precio vacío** y nada guardado; si pulsa "Revisar" sin escribir los precios, cada una de esas filas queda marcada con "Falta el precio" y no puede guardar.
3. **Given** filas con errores (nombre vacío o demasiado corto, duración fuera de rango o que no es múltiplo de 5, precio con formato inválido, nombre repetido dentro de la carga o igual al de un servicio que ya existe en la barbería, sin distinguir mayúsculas), **When** pulsa "Revisar", **Then** ve cada error junto a su fila y su columna, con un texto simple que dice cómo corregirlo, el total de filas con error, y el botón "Guardar" deshabilitado.
4. **Given** una vista previa sin errores, **When** pulsa "Guardar", **Then** se crean todos los servicios a la vez, ve "Se crearon N servicios" y la lista de servicios los muestra.
5. **Given** que, entre la vista previa y el guardado, otra persona creó un servicio con un nombre de la carga, **When** pulsa "Guardar", **Then** no se guarda ninguno, la tabla conserva lo escrito y la fila en conflicto queda marcada con su error.

---

### User Story 2 - Cargar varios barberos a la vez (Priority: P2)

El propietario abre "Barberos", elige "Agregar varios" y escribe o pega los nombres de su equipo. En cada fila puede marcar qué servicios ofrece ese barbero (entre los servicios activos de su barbería). Revisa la vista previa, corrige y guarda. Los barberos se crean como perfiles sin cuenta de usuario, como hoy; el resumen dice "Se crearon 4 barberos".

**Why this priority**: Completa la incorporación, pero una barbería suele tener pocos barberos y el plan limita cuántos puede tener activos; el ahorro es menor que con los servicios.

**Independent Test**: Con una barbería con servicios y cupo para 3 barberos más, cargar 3 barberos con sus servicios y guardar: aparecen en la lista de barberos y en el catálogo público con sus servicios; un cuarto intento que pasa el cupo no guarda nada.

**Acceptance Scenarios**:

1. **Given** la tabla de barberos, **When** pega una columna de nombres, **Then** cada línea se convierte en una fila con el nombre y sin servicios marcados.
2. **Given** una carga de N barberos y una barbería con A barberos activos y un plan que permite M, **When** A + N supera M, **Then** la vista previa lo dice antes de guardar ("Tu plan permite M barberos activos; ya tienes A. Quita X filas o cambia de plan") y no se guarda ninguno.
3. **Given** filas con nombre vacío o demasiado corto, o con un servicio que ya no está activo, **When** pulsa "Revisar", **Then** ve el error en su fila y no puede guardar.
4. **Given** una fila con un nombre repetido dentro de la carga o igual al de un barbero existente, **When** pulsa "Revisar", **Then** ve una advertencia en esa fila (no un error) y puede guardar igual.
5. **Given** una vista previa sin errores y dentro del cupo, **When** pulsa "Guardar", **Then** se crean todos los barberos con sus servicios, activos y sin usuario vinculado, y ve "Se crearon N barberos".

---

### User Story 3 - Dos cargas a la vez no pasan el cupo (Priority: P2)

Dos personas con sesión de propietario en la misma barbería (o la misma persona en dos pestañas) guardan a la vez dos cargas de barberos que, juntas, superan el cupo del plan. Solo la primera se guarda entera; la segunda no guarda nada y explica por qué.

**Why this priority**: Es la garantía de consistencia que ya existe para la creación individual; sin ella, la carga en lote abriría un camino para superar el plan pagado.

**Independent Test**: Con cupo para 3 barberos, lanzar a la vez dos cargas de 2 barberos: exactamente una se guarda (2 barberos nuevos), la otra responde que se superó el cupo y no crea ninguno.

**Acceptance Scenarios**:

1. **Given** cupo para K barberos y dos cargas simultáneas cuya suma supera K, **When** ambas se guardan a la vez, **Then** a lo sumo una se guarda completa y la otra no crea ningún barbero.
2. **Given** una carga en lote y una creación individual simultáneas que juntas superan el cupo, **When** ambas se guardan, **Then** el total de barberos activos nunca supera el máximo del plan.

---

### Edge Cases

- **Más de 50 filas**: al pegar o agregar, la tabla no pasa de 50 filas; si lo pegado tenía más, se avisa cuántas filas quedaron fuera. Un envío con más de 50 filas se rechaza entero.
- **Filas completamente vacías**: se ignoran al revisar y al guardar (no cuentan como error ni como creadas).
- **Pegado con encabezados**: si la primera línea pegada parece un encabezado (por ejemplo "Nombre", "Duración", "Precio"), se descarta.
- **Precio con coma decimal o símbolo** ("25,50", "S/ 25"): se acepta la coma como separador decimal y se ignora el símbolo "S/"; cualquier otro formato es un error de la fila.
- **Duración con texto** ("30 min"): se toma el número; si no hay número válido, es un error de la fila.
- **Columnas de menos o de más al pegar**: las que faltan quedan vacías (y se marcan si son obligatorias); las que sobran se ignoran.
- **Suscripción vencida o suspendida**: como en la creación individual, el catálogo queda de solo lectura; la carga no se ofrece o, si se intenta, no guarda nada y lo explica.
- **Servicio desactivado con el mismo nombre**: cuenta como "ya existe" (la regla actual compara con todos los servicios de la barbería, activos o no); el mensaje sugiere reactivarlo en lugar de crearlo de nuevo.
- **Sesión vencida o pérdida de conexión al guardar**: la tabla conserva lo escrito; al reintentar no se crean duplicados.
- **Doble clic en "Guardar"**: se crea una sola vez.
- **Rol sin permiso** (barbero o cliente): no ve la opción y el servidor rechaza la carga.

## Requirements *(mandatory)*

### Functional Requirements

**Carga de servicios (US1)**

- **FR-001**: El sistema MUST permitir al propietario crear entre 1 y 50 servicios en una sola carga, cada uno con nombre, duración en minutos, precio en soles y descripción opcional.
- **FR-002**: La interfaz MUST ofrecer una tabla editable a la que se pueden agregar y quitar filas, y en la que se puede pegar un bloque de filas copiado de una hoja de cálculo (columnas separadas por tabulaciones, en el orden nombre, duración, precio, descripción).
- **FR-003**: La interfaz MUST ofrecer "Agregar servicios típicos", que agrega filas editables con Corte, Barba, Corte y barba, Cejas, Corte para niños y Lavado, cada una con su nombre y una duración sugerida, y con el **precio vacío**; el sistema MUST NOT proponer precios. Las filas no se guardan hasta pulsar "Guardar".
- **FR-003a**: Un precio vacío MUST marcarse en la revisión como error de la fila con el texto "Falta el precio" (distinto del error de formato), y MUST impedir guardar hasta que se escriba.
- **FR-004**: Cada fila de servicio MUST validarse con **las mismas reglas que la creación individual** (nombre de 2 a 80 caracteres sin contar espacios de los extremos; duración entera de 5 a 480 minutos y múltiplo de 5; precio de 0 a 99 999,99 con hasta dos decimales; descripción de hasta 300 caracteres), sin una segunda copia de esas reglas que pueda quedar distinta.
- **FR-005**: El sistema MUST rechazar como error de fila un nombre de servicio repetido dentro de la misma carga o igual al de un servicio que ya existe en la barbería, sin distinguir mayúsculas, igual que la creación individual.

**Carga de barberos (US2)**

- **FR-006**: El sistema MUST permitir al propietario crear entre 1 y 50 barberos en una sola carga, cada uno con nombre visible y, opcionalmente, los servicios que ofrece, elegidos entre los servicios activos de la barbería.
- **FR-007**: Los barberos cargados MUST crearse activos y **sin usuario vinculado**, como perfiles, igual que la creación individual sin vínculo.
- **FR-008**: Cada fila de barbero MUST validarse con las mismas reglas que la creación individual (nombre de 2 a 80 caracteres; servicios existentes de la barbería).
- **FR-009**: Un nombre de barbero repetido dentro de la carga o igual al de un barbero que ya existe en la barbería (sin distinguir mayúsculas) MUST mostrarse en la vista previa como **advertencia** de esa fila ("Ya hay un barbero llamado …; revisa que no sea el mismo"), MUST NOT impedir guardar y MUST NOT cambiar la creación individual, que hoy permite nombres repetidos.

**Vista previa y todo o nada (US1, US2)**

- **FR-010**: Antes de guardar, la interfaz MUST mostrar una vista previa que señale cada error junto a su fila y su columna, con texto simple, y el total de filas con error; mientras haya errores, MUST NOT permitir guardar.
- **FR-011**: El servidor MUST volver a validar toda la carga al guardar (no confía en la vista previa) y MUST responder, si hay errores, con la lista de errores por número de fila y campo, sin crear nada.
- **FR-012**: La carga MUST ser **todo o nada**: o se crean todas las filas válidas de la carga o no se crea ninguna, también si falla una regla al final (por ejemplo, un nombre que otra persona acaba de usar).
- **FR-013**: Si la carga se guarda, el sistema MUST responder con un resumen de cuántos servicios o barberos se crearon, y la interfaz MUST mostrarlo y actualizar la lista.
- **FR-014**: Un reintento del mismo envío (por pérdida de conexión o doble clic) MUST NOT crear los elementos dos veces.

**Límites del plan y concurrencia (US2, US3)**

- **FR-015**: Una carga de barberos MUST respetar el máximo de barberos activos del plan de la barbería, calculado para **el lote completo** (activos actuales + filas de la carga), con el mismo bloqueo de la suscripción que usa la creación individual, de modo que dos cargas o una carga y una creación individual simultáneas nunca superen el máximo.
- **FR-016**: Los planes no tienen límite de servicios, y esta funcionalidad MUST NOT agregarlo: una carga de servicios solo está limitada por las 50 filas por carga y por las reglas de cada fila. Los planes y la creación individual de servicios no cambian.
- **FR-017**: Con la suscripción vencida o suspendida, la carga MUST rechazarse como hoy se rechaza la creación individual (catálogo de solo lectura), sin crear nada.

**Permisos, aislamiento y auditoría**

- **FR-018**: Solo los roles con permiso de gestionar servicios (para servicios) o de gestionar barberos (para barberos) MUST poder cargar en lote; hoy, solo el propietario. El barbero, el cliente y el administrador de la plataforma MUST NOT poder hacerlo.
- **FR-019**: Cada carga MUST crear elementos solo en la barbería de la sesión del propietario; la barbería MUST NOT tomarse de la ruta ni del cuerpo, y la comprobación de nombres existentes MUST ver solo los de esa barbería.
- **FR-020**: Cada carga guardada MUST registrarse en la auditoría de la barbería con quién la hizo, el tipo (servicios o barberos), cuándo y cuántos elementos se crearon; una carga rechazada por permisos MUST registrarse como intento denegado, como las demás operaciones del catálogo.
- **FR-021**: Tras una carga guardada, el catálogo público de la barbería MUST mostrar los elementos nuevos con la misma actualidad que tras una creación individual.

**Interfaz**

- **FR-022**: La interfaz MUST seguir el diseño actual del panel (tokens de color y tipografía, modo claro y oscuro), funcionar a 360 px de ancho sin desplazamiento horizontal de la página, poder usarse por completo con el teclado (agregar, editar, quitar filas, revisar y guardar) y no tener errores de accesibilidad automáticos.
- **FR-023**: Los textos MUST estar en español simple; cada error MUST decir qué está mal y cómo corregirlo (por ejemplo, "La duración debe ser un número de minutos entre 5 y 480, múltiplo de 5").

### Key Entities *(include if feature involves data)*

- **Carga en lote**: una solicitud del propietario para crear de una vez varios servicios o varios barberos de su barbería. Tiene un tipo (servicios o barberos), de 1 a 50 filas y un resultado: creada entera (con el número de elementos) o rechazada (con los errores por fila). No se guarda como registro propio salvo en la auditoría.
- **Fila de servicio**: nombre, duración en minutos, precio en soles y descripción opcional; al guardarse se convierte en un Servicio activo de la barbería, igual que uno creado de uno en uno.
- **Fila de barbero**: nombre visible y servicios que ofrece (opcional); al guardarse se convierte en un Barbero activo de la barbería, sin usuario vinculado.
- **Error de fila**: número de fila, campo y motivo en texto simple; impide guardar.
- **Advertencia de fila**: número de fila, campo y motivo; no impide guardar (hoy, solo el nombre de barbero repetido).
- **Servicio típico**: una plantilla fija de servicio común de barbería (nombre y duración sugerida, **sin precio**) que solo llena filas de la tabla; no se guarda por sí misma.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un propietario carga 20 servicios pegados desde una hoja de cálculo, desde abrir "Agregar varios" hasta ver el resumen, en menos de 3 minutos (frente a unos 20 formularios individuales hoy).
- **SC-002**: En 100 cargas de prueba que contienen al menos una fila inválida, ninguna crea elementos (0 cargas parciales).
- **SC-003**: En una prueba de concurrencia con dos cargas simultáneas que juntas superan el cupo de barberos, repetida 50 veces, el número de barberos activos nunca supera el máximo del plan.
- **SC-004**: Una carga de 50 filas válidas se guarda y muestra el resumen en menos de 3 segundos en el entorno local de referencia.
- **SC-005**: Cada regla de validación de la creación individual produce el mismo resultado en la carga en lote para el mismo dato (prueba que compara ambos caminos con los mismos casos).
- **SC-006**: Las pantallas de carga pasan la revisión automática de accesibilidad sin errores a 360 px y en escritorio, en modo claro y oscuro, y se completan solo con el teclado.
- **SC-007**: Ninguna carga puede leer ni crear elementos en otra barbería (pruebas de aislamiento con dos barberías).

## Assumptions

- El único rol que gestiona el catálogo es el propietario (matriz de permisos de 002); si en el futuro otro rol recibe esos permisos, la carga lo sigue automáticamente porque usa los mismos permisos.
- Los servicios típicos son una lista fija en la aplicación (no configurable por la plataforma) con nombre y duración sugerida; el precio lo escribe siempre el propietario (la aplicación no inventa precios).
- Los servicios del lote se cargan antes que los barberos; una carga de barberos solo puede asignar servicios que ya existen y están activos (no los de una carga de servicios aún sin guardar).
- La carga no edita, reactiva ni desactiva elementos existentes; solo crea.
- La vista previa la calcula el servidor con las mismas reglas que al guardar, pero sin guardar nada (así las reglas viven en un solo lugar); la interfaz solo ordena lo pegado (columnas, coma decimal, "S/"). Al guardar, el servidor vuelve a revisar todo: lo de la vista previa puede quedar viejo y el guardado tiene la última palabra (escenario 5 de US1).
- El orden de las filas no tiene significado para el catálogo; los elementos quedan en la lista con el orden habitual.
- Fuera de alcance: importar archivos .xlsx o .csv, cuentas de usuario para barberos, edición en lote de lo existente, fotos, disponibilidad semanal de los barberos en lote y la carga por el administrador de la plataforma.
