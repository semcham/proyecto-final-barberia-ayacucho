# Feature Specification: Escalabilidad y rendimiento de la plataforma

**Feature Branch**: `006-escalado-cache-balanceo`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Funcionalidad 006: escalabilidad y rendimiento de la plataforma. Un balanceador de carga delante de 2 réplicas del backend, y una caché compartida para el catálogo y los límites de uso. Alcance: (1) el balanceador reparte el tráfico entre 2 réplicas y las pruebas demuestran que si una réplica cae, el servicio sigue; (2) la caché guarda el catálogo público de cada barbería con claves que incluyen el identificador de la barbería, y se invalida cuando el propietario cambia servicios, barberos, horarios o el enlace; (3) la caché lleva los contadores de límite de solicitudes por IP, compartidos entre réplicas; los contadores de seguridad y costo siguen en la base de datos (constitución, principio VIII); (4) una prueba de carga con meta de p95 de 800 ms en horarios libres con 50 consultas simultáneas (hoy 935 a 1011 ms), medida con y sin caché, con dos réplicas; (5) verificar que ninguna barbería puede ver datos en caché de otra (PR09). Fuera de alcance: despliegue real en la nube (solo se documenta). Todo se levanta en el entorno local de contenedores. Responde al requisito del curso de balanceador de carga y caché."

**Trazabilidad**: HU10, HU11 → RF10, RF11, RF12 → AC01, AC02, AC03 / EQ-01 a EQ-05 → DA03, DA04, DA05 → ADR-005, ADR-006, ADR-009, ADR-021; ADR-029 (caché compartida para el catálogo y el límite general de solicitudes, con claves por barbería) y ADR-030 (balanceo local como representación de ADR-006), Aceptados (2026-10-19) → M06 Núcleo compartido (adaptador de caché y límites), M02 Catálogo y citas (vía pública e invalidación), M01 (cambio de enlace y datos de la barbería), Host → PR01, PR04, PR05, PR09, PR16 (PR02 y PR03 quedan pendientes).

**Decisiones ya tomadas por el responsable** (no se reabren aquí; se registran en ADR-029 y ADR-030): el balanceador local es Nginx, la caché compartida es Redis y todo se levanta con Docker Compose. El resto de esta especificación describe el comportamiento sin depender de esas herramientas.

**Reutiliza de las funcionalidades 001 y 002** (no se repite aquí): vía pública por enlace con solo columnas públicas (ADR-021), cálculo de horarios libres, reserva sin duplicados garantizada por la base de datos y su prueba de 200 solicitudes simultáneas en dos instancias (PR16), límite de intentos de inicio de sesión en la base de datos, sesiones sin estado en el servidor con revocación en la base de datos, auditoría y medición preliminar de horarios (`medir:horarios`, quickstart de 002 §6).

**Esta funcionalidad no agrega requisitos funcionales (RF)**: demuestra atributos de calidad (rendimiento, escalabilidad y disponibilidad) sobre lo que ya existe.

## Clarifications

### Session 2026-10-18

- Q: ¿Los horarios libres ya calculados también se guardan en la caché? → A: No, en principio solo se guardan el enlace y el catálogo, y los horarios se calculan siempre con los datos vigentes. Salvaguarda: si la medición con el catálogo en caché no cumple la meta de 800 ms, se evalúa dentro de esta misma funcionalidad guardar los horarios calculados por barbero y fecha, hasta 30 s, invalidados al reservar, cancelar o bloquear, y se registra la medición antes y después del ajuste (FR-013a, FR-013b).
- Q: ¿Qué cubre la prueba de carga de 006? → A: Horarios libres con y sin caché (EQ-01), más las demos de caída de una instancia (EQ-04) y de la caché (EQ-05). La carga de reservas (EQ-02) y el escalado de una a dos instancias (EQ-03) quedan fuera de esta funcionalidad y se registran como pendientes (FR-027a).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - El servicio sigue si cae una instancia (Priority: P1)

Un cliente consulta el catálogo o reserva mientras la plataforma corre en dos instancias idénticas detrás de un balanceador. Si una instancia deja de responder (se cae, se reinicia o se detiene para mantenimiento), el balanceador deja de enviarle tráfico y la otra atiende sin que el cliente tenga que hacer nada (EQ-04).

**Why this priority**: Es el requisito explícito del curso (balanceador de carga) y la base de las demás historias: la caché compartida y el límite compartido solo tienen sentido con más de una instancia.

**Independent Test**: Levantar el entorno con dos instancias, enviar tráfico continuo a la vía pública y a rutas autenticadas, detener una instancia y medir cuántas solicitudes fallan durante la transición y cuánto tarda el balanceador en dejar de usarla; volver a iniciarla y comprobar que vuelve a recibir tráfico.

**Acceptance Scenarios**:

1. **Given** dos instancias sanas detrás del balanceador, **When** llegan solicitudes de distintos clientes, **Then** ambas instancias reciben una parte del tráfico y las respuestas son iguales a las de una sola instancia.
2. **Given** tráfico continuo, **When** una instancia deja de responder, **Then** el balanceador la detecta en 15 segundos o menos, deja de enviarle solicitudes y como máximo el 2 % de las solicitudes de ese intervalo falla; después, el 100 % de las solicitudes las atiende la otra instancia.
3. **Given** una instancia que había caído, **When** vuelve a estar sana, **Then** el balanceador la reincorpora sin intervención manual y sin solicitudes perdidas durante el alta.
4. **Given** un cliente con sesión iniciada, **When** sus solicitudes sucesivas llegan a instancias distintas, **Then** la sesión sigue válida, el cierre de sesión hecho en una instancia rige en la otra y el límite de intentos de inicio de sesión se cuenta una sola vez para ambas.
5. **Given** dos instancias, **When** se repite la prueba de 200 reservas simultáneas del mismo barbero y hora a través del balanceador, **Then** se crea exactamente una cita y las demás reciben "horario no disponible", sin errores del servidor.
6. **Given** las dos instancias caídas, **When** llega una solicitud, **Then** el cliente recibe un error claro de servicio no disponible (no una página en blanco ni un tiempo de espera indefinido) y la interfaz web lo muestra como tal.

---

### User Story 2 - El catálogo público responde rápido, actualizado y sin mezclar barberías (Priority: P1)

Cualquier persona abre el enlace de una barbería y ve su catálogo (datos de la barbería, servicios y barberos). La respuesta sale de una caché compartida por ambas instancias, de modo que no hace falta consultar la base de datos en cada visita. Cuando el propietario cambia algo que se ve en el catálogo, la siguiente visita ya muestra el cambio, desde cualquier instancia. Una barbería nunca recibe datos guardados de otra (EQ-01, PR09).

**Why this priority**: Es el segundo requisito explícito del curso (caché) y ataca la causa medida de la lentitud de los horarios libres: cada consulta pública vuelve a leer el enlace y el catálogo en la base de datos. El aislamiento entre barberías es no negociable (principio III).

**Independent Test**: Con dos barberías con catálogos distintos, visitar sus enlaces varias veces y comprobar que, a partir de la segunda visita, la respuesta sale de la caché; cambiar un servicio, un barbero, el horario de atención y el enlace de una de ellas y comprobar desde ambas instancias que la visita siguiente refleja el cambio; comprobar que en ningún caso una barbería recibe datos de la otra.

**Acceptance Scenarios**:

1. **Given** el catálogo de una barbería todavía no guardado en la caché, **When** alguien abre su enlace, **Then** el catálogo se lee de la base de datos, se devuelve y queda guardado en la caché asociado al identificador interno de esa barbería.
2. **Given** el catálogo guardado en la caché, **When** otra persona abre el mismo enlace, por cualquier instancia, **Then** recibe el mismo contenido sin que se lea el catálogo en la base de datos.
3. **Given** el catálogo guardado en la caché, **When** el propietario crea, edita, desactiva o reactiva un servicio o un barbero, cambia los servicios asignados a un barbero, cambia los datos comerciales o el horario de atención de la barbería, **Then** la siguiente visita al enlace, por cualquier instancia, muestra el cambio.
4. **Given** el catálogo guardado en la caché, **When** el propietario cambia el enlace de su barbería, **Then** el enlace nuevo muestra el catálogo y el enlace anterior responde "barbería no disponible" desde la visita siguiente, por cualquier instancia.
5. **Given** un cambio del propietario que falla y no se guarda, **When** alguien abre el enlace, **Then** el catálogo sigue mostrando los datos anteriores (la caché solo se invalida después de confirmar el cambio).
6. **Given** dos barberías A y B con catálogos guardados en la caché, **When** se consulta el enlace de A, **Then** la respuesta nunca contiene datos de B, aunque ambas tengan servicios o barberos con el mismo nombre, y aunque el enlace de A haya sido antes el enlace de B.
7. **Given** el catálogo guardado en la caché, **When** se inspecciona lo guardado, **Then** contiene solo las columnas públicas que ya devuelve la vía pública (ADR-021): ningún dato personal de clientes ni datos de contacto o de cuenta del personal.
8. **Given** un enlace inexistente, **When** se consulta repetidamente, **Then** responde "barbería no disponible" y no se llena la caché con entradas por cada enlace inventado.
9. **Given** el catálogo guardado en la caché, **When** se consultan los horarios libres de esa barbería, **Then** el enlace y el catálogo pueden salir de la caché, pero la disponibilidad (citas, bloqueos y disponibilidad de los barberos) se calcula con los datos vigentes de la base de datos (salvo el ajuste condicionado de FR-013b, si se activa).
10. **Given** el ajuste de FR-013b activado y los horarios de un barbero y una fecha guardados en la caché, **When** se reserva, se cancela o se cambia el estado de una cita, o se crea o borra un bloqueo que afecta ese barbero y esa fecha, **Then** la siguiente consulta de esos horarios, por cualquier instancia, refleja el cambio; y sin ningún cambio, lo guardado no se usa más de 30 segundos.

---

### User Story 3 - El límite de solicitudes por IP es el mismo con una o dos instancias (Priority: P2)

Una persona o un programa que abusa de la vía pública o de los formularios abiertos (registro, activación) es frenado al superar el límite por minuto de su dirección IP, sin importar a qué instancia llegue cada solicitud. Hoy cada instancia cuenta por su cuenta, así que con dos instancias el límite real se duplica.

**Why this priority**: Sin contadores compartidos, agregar instancias debilita la protección contra abuso. Es menos visible que las historias 1 y 2, pero el backlog lo marca como algo que no se recorta.

**Independent Test**: Con dos instancias y un límite bajo configurado para la prueba, enviar desde una misma IP más solicitudes que el límite, repartidas entre ambas instancias, y comprobar que el total aceptado en el minuto no supera el límite; comprobar que otra IP no se ve afectada.

**Acceptance Scenarios**:

1. **Given** un límite de N solicitudes por minuto por IP en una ruta y dos instancias, **When** una misma IP envía más de N solicitudes en un minuto repartidas entre ambas, **Then** se aceptan como máximo N y las demás reciben "demasiados intentos" con el tiempo de espera.
2. **Given** una IP que alcanzó el límite, **When** pasa la ventana de un minuto, **Then** vuelve a ser atendida.
3. **Given** dos IP distintas, **When** una alcanza el límite, **Then** la otra sigue siendo atendida.
4. **Given** solicitudes que pasan por el balanceador, **When** se aplica el límite, **Then** se cuenta la IP real del cliente que entrega el balanceador, no la del balanceador, y un cliente no puede cambiar su IP contada enviando él mismo un encabezado de reenvío falso.
5. **Given** los intentos fallidos de inicio de sesión, **When** se cuentan, **Then** siguen guardándose en la base de datos y no en la caché (principio VIII), y su bloqueo rige igual en ambas instancias.

---

### User Story 4 - La plataforma sigue funcionando si la caché cae (Priority: P2)

Si el servicio de caché deja de estar disponible, los clientes siguen viendo el catálogo y los horarios libres y pueden reservar; todo es algo más lento porque se lee de la base de datos. Cuando la caché vuelve, se usa de nuevo sin reiniciar nada (EQ-05).

**Why this priority**: La constitución exige que la caché nunca sea imprescindible (principio VIII) y el backlog lo marca como algo que no se recorta; pero solo importa una vez que existe la caché (historia 2).

**Independent Test**: Con tráfico de consultas y reservas, detener la caché, comprobar que las respuestas siguen siendo correctas y medir su tiempo; volver a iniciarla y comprobar que se vuelve a usar.

**Acceptance Scenarios**:

1. **Given** la caché caída, **When** alguien abre el enlace de una barbería o consulta sus horarios libres, **Then** recibe los datos correctos leídos de la base de datos, con p95 de 2 segundos o menos.
2. **Given** la caché caída, **When** se reserva, se cancela o se cambia el estado de una cita, **Then** el resultado es el mismo que con la caché disponible (0 reservas incorrectas).
3. **Given** la caché caída, **When** el propietario cambia su catálogo, **Then** el cambio se guarda igual y, cuando la caché vuelve, no se muestra un catálogo anterior al cambio.
4. **Given** la caché caída, **When** se aplica el límite de solicitudes por IP, **Then** cada instancia lo aplica por su cuenta (degradación aceptada por el principio VIII).
5. **Given** la caché caída, **When** pasa el tiempo, **Then** queda una alerta en los registros con la hora de la caída, sin que cada solicitud espere el tiempo límite completo de la caché.
6. **Given** la caché vuelve a estar disponible, **When** llegan nuevas consultas, **Then** se vuelve a usar sin reiniciar las instancias.

---

### User Story 5 - Evidencia medida del rendimiento con dos instancias (Priority: P3)

El responsable ejecuta una prueba de carga reproducible y obtiene una tabla con los tiempos de respuesta de los horarios libres con 50 consultas simultáneas, con dos instancias, con y sin caché, comparable con la medición preliminar de 002 (p95 de 935 a 1011 ms con una instancia y sin caché). Los resultados quedan registrados en la documentación con la fecha, el equipo y las condiciones (EQ-01).

**Why this priority**: Es la evidencia que se presenta, pero depende de las historias 1 y 2 para tener algo que medir.

**Independent Test**: Ejecutar la prueba de carga con el entorno de dos instancias en ambas variantes (caché activa y caché desactivada) y comprobar que produce la tabla de resultados y la deja registrada.

**Acceptance Scenarios**:

1. **Given** el entorno con dos instancias y la caché activa y precargada, **When** se ejecuta la prueba de 50 consultas simultáneas a los horarios libres de una barbería con datos realistas (5 barberos y 60 citas en el día), **Then** se informa p50, p95, máximo y porcentaje de errores, y el p95 es de 800 ms o menos con 0 % de errores del servidor.
2. **Given** el mismo entorno con la caché desactivada, **When** se ejecuta la misma prueba, **Then** se informan las mismas medidas, para comparar el efecto de la caché y el de la segunda instancia por separado.
3. **Given** los resultados, **When** la meta no se cumple, **Then** se registra el resultado real tal cual, con la causa probable, sin cambiar la meta ni ocultar la ejecución.
4. **Given** la prueba de carga, **When** se ejecuta, **Then** se puede repetir con un solo comando documentado, limpia los datos que crea y no forma parte de la integración continua.
5. **Given** la medición con dos instancias y el catálogo en caché, **When** el p95 supera 800 ms, **Then** se evalúa el ajuste de FR-013b, se vuelve a medir y se registran ambas mediciones (antes y después del ajuste), cumpla o no la meta.
6. **Given** el alcance de la prueba de carga, **When** se registran los resultados, **Then** la carga de reservas (EQ-02) y el escalado de una a dos instancias (EQ-03) figuran como pendientes, no medidos en esta funcionalidad.

---

### Edge Cases

- **Cambio de enlace y reutilización:** la barbería A deja el enlace `x` y luego la barbería B toma `x`. Una visita a `x` debe mostrar el catálogo de B, nunca el de A guardado antes.
- **Cambio confirmado en una instancia, visita servida por la otra:** la invalidación debe valer para ambas instancias, no solo para la que atendió el cambio.
- **Lectura y escritura cruzadas:** una visita lee el catálogo antiguo de la base de datos justo antes de que el propietario guarde un cambio, y lo escribe en la caché después de la invalidación. El catálogo desactualizado no puede quedar más allá de un tiempo máximo de vida acotado (red de seguridad), y la prueba debe demostrarlo.
- **Barbería sin servicio público:** una barbería que deja de estar disponible públicamente (por ejemplo, suspendida, cuando exista la funcionalidad 003) no puede seguir mostrándose desde la caché.
- **Datos guardados corruptos o con otro formato** (por ejemplo, tras desplegar una versión nueva): se descartan y se lee de la base de datos, sin error para el visitante.
- **Caché llena o expulsando entradas:** el catálogo se vuelve a leer de la base de datos; nunca se devuelve un catálogo incompleto.
- **Caché lenta pero no caída:** cada consulta a la caché tiene un tiempo límite corto; si se supera, se lee de la base de datos.
- **Instancia que cae a mitad de una solicitud:** las lecturas pueden reintentarse en la otra instancia; una reserva no se reenvía automáticamente salvo que lleve la clave de idempotencia, que ya evita duplicados.
- **Instancia que arranca:** no recibe tráfico hasta estar lista (base de datos accesible y migraciones aplicadas).
- **Ráfaga sobre un catálogo recién invalidado:** muchas visitas simultáneas tras un cambio no deben producir errores; leer varias veces de la base de datos en ese instante es aceptable.
- **IP detrás de un proxy o de una red compartida** (por ejemplo, el wifi de una universidad): todas esas personas comparten el límite por IP; el límite por defecto debe tolerarlo, como hoy.
- **Datos de auditoría:** la IP registrada en la auditoría debe seguir siendo la del cliente, no la del balanceador.

## Requirements _(mandatory)_

### Functional Requirements

**Balanceo y réplicas**

- **FR-001**: El entorno local MUST levantar con un solo comando un balanceador de carga, dos instancias idénticas del backend, la base de datos, la caché compartida y el frontend, sin pasos manuales adicionales.
- **FR-002**: El balanceador MUST repartir las solicitudes de la API entre las dos instancias y ser el único punto de entrada de la API para el frontend.
- **FR-003**: El balanceador MUST comprobar periódicamente la salud de cada instancia, dejar de enviar tráfico a una instancia que no responde en 15 segundos o menos y reincorporarla automáticamente cuando vuelve a estar sana.
- **FR-004**: Una instancia MUST NOT declararse lista para recibir tráfico hasta poder atender (base de datos accesible y migraciones aplicadas); las migraciones MUST aplicarse una sola vez aunque arranquen dos instancias a la vez.
- **FR-005**: Las instancias MUST seguir sin estado propio: sesiones, revocación, intentos de inicio de sesión, idempotencia de reservas y disponibilidad MUST quedar en la base de datos, de modo que cualquier instancia pueda atender cualquier solicitud.
- **FR-006**: El balanceador MUST entregar a las instancias la IP real del cliente, y las instancias MUST tomarla solo del balanceador de confianza; un encabezado de reenvío enviado por el propio cliente MUST NOT cambiar la IP usada para límites ni auditoría.
- **FR-007**: Si ninguna instancia está disponible, el balanceador MUST responder un error de servicio no disponible en un tiempo acotado, y la interfaz web MUST mostrarlo como tal.

**Caché del catálogo público**

- **FR-008**: El catálogo público de cada barbería (los mismos datos y columnas que ya devuelve la vía pública) MUST guardarse en la caché compartida, bajo una clave que incluya el identificador interno de la barbería, y MUST leerse de ahí cuando esté disponible.
- **FR-009**: La correspondencia entre enlace público y barbería MAY guardarse en la caché solo para enlaces existentes; un enlace inexistente MUST NOT crear entradas en la caché.
- **FR-010**: Después de confirmar en la base de datos cualquier cambio que afecte lo que se ve en el catálogo público (servicios, barberos, servicios asignados, datos comerciales, horario de atención o enlace), la entrada de esa barbería MUST invalidarse para ambas instancias; la invalidación MUST ocurrir después de confirmar el cambio, nunca antes.
- **FR-011**: Al cambiar el enlace, MUST invalidarse tanto la correspondencia del enlace anterior como la del nuevo.
- **FR-012**: Toda entrada de la caché MUST tener un tiempo máximo de vida acotado (red de seguridad ante invalidaciones perdidas); el valor por defecto se fija en el plan y MUST NOT superar 5 minutos.
- **FR-013**: La caché MUST NOT guardar datos personales de clientes ni datos de contacto o de cuenta del personal, y MUST NOT decidir la disponibilidad: los horarios libres y la reserva MUST usar siempre las citas, bloqueos y disponibilidad vigentes en la base de datos (principios IV y VIII).
- **FR-013a**: Por defecto, los horarios libres calculados MUST NOT guardarse en la caché: solo se guardan el enlace y el catálogo.
- **FR-013b**: Si la medición de SC-001 con el catálogo en caché no cumple la meta, MUST evaluarse dentro de esta funcionalidad guardar los horarios libres calculados por barbería, barbero y fecha, con un tiempo máximo de vida de 30 segundos, invalidados para ambas instancias después de confirmar una reserva, una cancelación, un cambio de estado de cita o un bloqueo que afecte ese barbero y esa fecha. Aun así, la reserva MUST seguir comprobando la disponibilidad en la base de datos. Si se activa, MUST tener sus propias pruebas de invalidación y de aislamiento (FR-022, FR-023), y la decisión, con la medición antes y después, MUST registrarse en ADR-029.
- **FR-014**: Toda clave de caché de datos de una barbería MUST construirse en un único punto que incluya obligatoriamente el identificador de la barbería; MUST existir una prueba que falle si una clave se construye sin él.
- **FR-015**: Una entrada que no pueda leerse o que tenga un formato inesperado MUST descartarse y reemplazarse con datos de la base de datos, sin error para el visitante.

**Límite de solicitudes compartido**

- **FR-016**: Los contadores del límite general de solicitudes por IP (vía pública, límite general y formularios abiertos de registro y activación) MUST guardarse en la caché compartida, con una ventana de un minuto, de modo que el límite sea el mismo con una o con dos instancias.
- **FR-017**: Los contadores de seguridad y de costo (intentos de inicio de sesión hoy; cuota de IA en la funcionalidad 005) MUST seguir en la base de datos (principio VIII).
- **FR-018**: Los valores de cada límite MUST seguir siendo configurables por variable de entorno, como hoy, y la respuesta al superarlo MUST seguir siendo "demasiados intentos" con el tiempo de espera.

**Funcionamiento sin caché**

- **FR-019**: Si la caché no está disponible o no responde dentro de un tiempo límite corto, el sistema MUST leer de la base de datos y aplicar el límite de solicitudes por instancia, sin errores para el cliente.
- **FR-020**: Ante fallos repetidos de la caché, el sistema MUST dejar de intentar usarla durante un intervalo (para no sumar su tiempo límite a cada solicitud), registrar una alerta con la hora de la caída y volver a usarla sola cuando se recupere.
- **FR-021**: Un cambio de catálogo confirmado mientras la caché está caída MUST NOT dejar, al recuperarse la caché, un catálogo anterior visible por más del tiempo máximo de vida de FR-012.

**Pruebas y evidencia**

- **FR-022**: MUST existir pruebas automáticas de aislamiento de la caché (PR09) que demuestren que una barbería nunca recibe datos guardados de otra, incluidos el caso de nombres iguales y el de un enlace reutilizado por otra barbería.
- **FR-023**: MUST existir pruebas automáticas de invalidación para cada tipo de cambio de FR-010, que comprueben el resultado desde una instancia distinta de la que hizo el cambio.
- **FR-024**: MUST existir pruebas automáticas del límite compartido entre dos instancias y del funcionamiento con la caché caída (PR05).
- **FR-025**: MUST existir una prueba de caída de una instancia con tráfico (PR04) y una prueba de carga reproducible de los horarios libres con 50 consultas simultáneas y dos instancias, con y sin caché (PR01); la prueba de carga y las demos de caída MAY quedar fuera de la integración continua, documentadas como comandos.
- **FR-026**: Las pruebas obligatorias existentes (PR09, PR14, PR16) MUST seguir en verde; PR16 MUST ejecutarse también a través del balanceador con dos instancias.
- **FR-027**: Los resultados medidos (carga, caída de una instancia, caída de la caché) MUST registrarse con fecha, equipo y condiciones en la guía de validación de esta funcionalidad y en la trazabilidad, incluso si no cumplen la meta.
- **FR-027a**: La carga de reservas (EQ-02, PR02) y el escalado de una a dos instancias (EQ-03, PR03) MUST registrarse como pendientes en la guía de validación, en la trazabilidad y en el plan de pruebas; no se miden en esta funcionalidad.

**Documentación**

- **FR-028**: El despliegue en la nube MUST documentarse (equivalencia entre el balanceador, las instancias y la caché locales y los servicios gestionados de ADR-006), sin ejecutarse, y sin presentar el balanceo local como alta disponibilidad (ADR-006).
- **FR-029**: ADR-029 y ADR-030 MUST registrarse antes de implementar, y ADR-005 y la estrategia de caché MUST actualizarse con lo decidido (principio XI).

### Key Entities

- **Entrada de catálogo en caché**: copia del catálogo público de una barbería (datos comerciales públicos, horario de atención, servicios activos y barberos activos con sus servicios). Se identifica por la barbería; tiene un tiempo máximo de vida; se invalida al cambiar el catálogo.
- **Correspondencia de enlace en caché**: asocia un enlace público existente al identificador interno de su barbería. Se invalida al cambiar el enlace.
- **Contador de límite de solicitudes**: número de solicitudes de una IP en una ruta o grupo de rutas durante la ventana de un minuto. No crítico: si se pierde, el conteo se reinicia.
- **Instancia del backend**: copia idéntica y sin estado de la aplicación; tiene un estado de salud que consulta el balanceador.
- **Ejecución de medición**: registro de una prueba de carga o de caída con fecha, equipo, condiciones (número de instancias, caché activa o no, datos) y resultados (p50, p95, máximo, errores, tiempo de detección).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Con dos instancias y la caché activa, el p95 de 50 consultas simultáneas a los horarios libres de una barbería con 5 barberos y 60 citas en el día es de 800 ms o menos, con 0 % de errores del servidor (EQ-01). La misma medición sin caché queda registrada para comparar. Si solo con el catálogo en caché no se cumple, se mide de nuevo con el ajuste de FR-013b y se registran ambas.
- **SC-002**: Al detener una de las dos instancias con tráfico continuo, deja de recibir solicitudes en 15 segundos o menos y como máximo el 2 % de las solicitudes de ese intervalo falla; después, el 0 % falla (EQ-04).
- **SC-003**: Tras un cambio confirmado del propietario en su catálogo o su enlace, la siguiente visita al enlace por cualquiera de las dos instancias muestra el cambio en el 100 % de las pruebas de invalidación.
- **SC-004**: 0 respuestas con datos de otra barbería en las pruebas de aislamiento de la caché (PR09).
- **SC-005**: Con la caché caída, el catálogo y los horarios libres responden correctamente con p95 de 2 segundos o menos y 0 reservas incorrectas (EQ-05).
- **SC-006**: Con dos instancias, una IP que envía el doble del límite por minuto obtiene como máximo el límite configurado de respuestas aceptadas en ese minuto (nunca el doble).
- **SC-007**: La prueba de 200 reservas simultáneas a través del balanceador con dos instancias crea exactamente 1 cita, con 0 errores del servidor.
- **SC-008**: El entorno completo (balanceador, dos instancias, base de datos, caché y frontend) se levanta con un solo comando y la aplicación es utilizable sin pasos manuales adicionales.
- **SC-009**: Cada medición (carga con y sin caché, caída de instancia, caída de caché) tiene su resultado real registrado con fecha y condiciones, y EQ-02 y EQ-03 figuran como pendientes.

## Assumptions

- **Herramientas fijadas por el responsable:** Nginx como balanceador local, Redis como caché compartida y Docker Compose como entorno; se registran en ADR-030 y ADR-029. En la nube equivaldrían al balanceador gestionado y a la caché gestionada de ADR-006, solo documentados.
- **Equipo de medición:** el mismo equipo de desarrollo de la medición de 002 (Windows 11, 8 GB de RAM), con todos los contenedores en la misma máquina. Las dos instancias comparten CPU y la base de datos, así que la segunda instancia mejora la disponibilidad más que el rendimiento; los resultados se interpretan con esa limitación.
- **Las metas son las de los escenarios de calidad** (EQ-01, EQ-04, EQ-05), todavía "propuestas por validar"; esta funcionalidad las mide por primera vez.
- **El límite general por IP y los de registro y activación** son contadores no críticos (anti abuso); los únicos contadores de seguridad existentes son los intentos de inicio de sesión, que ya están en la base de datos.
- **Valores de los límites:** se mantienen los actuales (general 300 por minuto, vía pública 120, registro y activación 10), configurables.
- **El catálogo público** son los datos que ya devuelve la vía pública de 002 para un enlace; esta funcionalidad no cambia su contenido ni su contrato.
- **La caché no es persistente:** si se reinicia, se vacía y se vuelve a llenar; no requiere respaldo.
- **Tareas programadas:** 002 no tiene; las que lleguen con 003 y 004 resolverán su ejecución sin duplicados entre instancias en ADR-024.
- **Integración continua:** las pruebas de caché, aislamiento, invalidación y límite compartido corren en CI; la prueba de carga y las demos de caída se ejecutan a mano con comandos documentados (línea de corte 2 del backlog).
- **Fuera de alcance:** carga de reservas (EQ-02) y escalado de una a dos instancias (EQ-03), que quedan pendientes; despliegue real en la nube, alta disponibilidad del balanceador, de la base de datos o de la caché, escalado automático, terminación TLS local y caché de rutas autenticadas.
