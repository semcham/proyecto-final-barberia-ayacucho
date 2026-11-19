# Feature Specification: Evidencia de calidad y despliegue

**Feature Branch**: `009-evidencia-calidad`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "Funcionalidad 009 "Evidencia de calidad y despliegue". Debe poder cortarse por historia. Fecha de entrega: finales de noviembre. US1 (P1) pruebas de carga con k6 (imagen oficial de Docker) sobre el Compose con 2 réplicas: catálogo público, horarios libres y reserva (EQ-01, EQ-02, PR02), con umbrales y resultados guardados; registrar el cambio respecto a 006. US2 (P1) pruebas End to End con Playwright contra el Compose (4 a 5 flujos), evaluar si pueden correr en el CI, y comprobaciones de accesibilidad (axe) y rendimiento (Lighthouse) de las pantallas principales a 360 px y en escritorio, con informes guardados. US3 (P1) arranque reproducible: script que genere las claves y sales de desarrollo sin tocar un .env existente, comandos para bash y PowerShell y una semilla versionada sin datos reales. US4 (P2) frontend de producción en Compose con cabeceras de caché y medición de PR02 y PR03. US5 (P2) escalabilidad de base de datos con evidencia: EXPLAIN, pool, mayor volumen, simulacro de respaldo y restauración (PR22) y lo no construido. US6 (P2) cobertura, insignia de CI y endurecer las pruebas de tiempo frágiles sin quitar aserciones de comportamiento. US7 (P3) subdominio, CDN y CD reales si son viables; si no, documentar el porqué. Condiciones: no cambiar el comportamiento de lo construido, proveedor de IA falso, secretos fuera del repositorio, no leer el .env del responsable, no inventar resultados."

**Trazabilidad**: no agrega RF (como 006): produce **evidencia** de atributos de calidad ya especificados.
EQ-01 → PR01 (catálogo y horarios con carga) · EQ-02 → PR02 (reservas con carga) · EQ-03 → PR03 (agregar una
instancia) · EQ-22 → PR22 (respaldo y restauración) · HU11 → PR23 (aceptación de extremo a extremo) · AC06 → PR29
(accesibilidad) · AC05 → PR30 (rendimiento de la interfaz) · AC05, DA03 → ADR-005, ADR-006, ADR-030 (despliegue) ·
principio X (CI) y principio XII (ubicación del código y de la CI). Cambia la decisión R13 de 006 ("no se descarga
k6"), que se registra como ADR.

## Clarifications

### Session 2026-11-19

- Q: ¿Qué alcance tiene la publicación de US7 (FR-041)? → A: Opción C ajustada. Dominio propio ya comprado,
  `ayacuchobarber.shop` (registrador Namecheap; DNS, CDN y HTTPS en Cloudflare, plan gratuito, zona ya agregada). La
  API y/o el frontend de producción se exponen con un túnel con nombre hacia el Compose local. Solo se publican
  datos de ejemplo. Se analiza si el frontend va a Cloudflare Pages o sale por el túnel desde el Nginx de Compose.
  Se requiere una enmienda del principio XII y un ADR que revise ADR-006; los dos quedan como borrador
  ([borradores/enmienda-xii-y-adr-publicacion.md](borradores/enmienda-xii-y-adr-publicacion.md)) y no se aplican a la
  constitución todavía. El subdominio por barbería pasa a una historia aparte y cortable (US8, P3).
- Q: ¿Cómo se tratan las pruebas cuyo límite de tiempo es la meta de un requisito (FR-034)? → A: Opción A. La meta
  se mantiene y se mide como la mediana de varias repeticiones, o en una suite aparte que no bloquee la corrida
  principal. A las demás pruebas frágiles se les suben los márgenes, sin quitar ninguna aserción de comportamiento.
- Q: ¿Cómo se carga la semilla, cuándo entran los recorridos E2E al CI y cuándo se abre la enmienda? → A: La semilla
  se carga con un comando explícito e idempotente. Los recorridos E2E entran al CI solo si son estables: 5 corridas
  seguidas en local y 3 en el CI. Si no lo son, se documenta el resultado de la evaluación y se ejecutan con un
  comando manual. La enmienda del principio XII se abre ahora como borrador.

## User Scenarios & Testing _(mandatory)_

Los "usuarios" de esta funcionalidad son el **responsable del proyecto**, la **docente que evalúa** y **cualquier
persona que clone el repositorio**. Ninguna historia cambia lo que ven o hacen el propietario, el barbero, el cliente
ni el administrador de la plataforma: solo se mide, se prueba y se publica lo que ya existe.

### User Story 1 - Pruebas de carga reproducibles con resultados guardados (Priority: P1)

El responsable ejecuta con un solo comando una prueba de carga sobre el entorno local con dos réplicas: el catálogo
público, los horarios libres y la reserva de citas. Cada escenario tiene umbrales de latencia (p95) y de tasa de
error, la ejecución dice si los cumple o no, y el resultado medido queda guardado en el repositorio con su fecha, el
equipo y la configuración usada. La herramienta corre en un contenedor y no se instala en el repositorio.

**Why this priority**: el criterio de evaluación pide pruebas de carga con k6 de forma explícita, y hoy no existe
ningún script. Es la falta más barata de cerrar y más visible en la nota.

**Independent Test**: con la demo levantada, el comando de carga produce un archivo de resultados por escenario y un
resumen que dice "cumple" o "no cumple" para cada umbral; los archivos se pueden abrir sin la herramienta instalada.

**Acceptance Scenarios**:

1. **Given** la demo con dos réplicas y datos de ejemplo, **When** se ejecuta el escenario de horarios libres
   (50 usuarios simultáneos, EQ-01), **Then** se guarda el p95, la tasa de errores 5xx y el reparto entre réplicas, y
   se compara con la meta p95 ≤ 800 ms y 0 % de 5xx.
2. **Given** la misma demo, **When** se ejecuta el escenario de reservas (20 por segundo durante 5 minutos sobre
   horarios distintos, EQ-02, PR02), **Then** se guarda el p95 y la tasa de error técnico, y se compara con la meta
   p95 ≤ 1 500 ms y error técnico < 1 %; un horario ya ocupado (409) **no** cuenta como error técnico.
3. **Given** el escenario del catálogo público, **When** se ejecuta, **Then** se guardan sus cifras con las mismas
   reglas.
4. **Given** un umbral que no se cumple, **When** termina la ejecución, **Then** el resultado se guarda igual,
   marcado "no cumple", y nadie lo reemplaza por otro número.
5. **Given** una ejecución terminada, **When** se revisa la base, **Then** las reservas creadas por la prueba se
   pueden distinguir o limpiar, y no quedan citas de prueba mezcladas con la semilla de la demo.

---

### User Story 2 - Recorridos de extremo a extremo, accesibilidad y rendimiento de la interfaz (Priority: P1)

El responsable ejecuta con un comando documentado de 4 a 5 recorridos completos en un navegador real contra la demo
local: registrar y activar una barbería; un cliente reserva y cancela una cita; el propietario ve su agenda; el
asistente responde con el proveedor de IA falso; y una barbería paga su suscripción con la pasarela simulada. Además,
un conjunto corto mide la accesibilidad y el rendimiento de las pantallas principales (catálogo público, reserva,
panel del propietario y panel de la plataforma) a 360 px y en escritorio, y guarda los informes.

**Why this priority**: los criterios de evaluación piden pruebas de extremo a extremo (hoy no hay ninguna; PR23 está
planificada) y una interfaz con evidencia; las únicas mediciones de accesibilidad y rendimiento son de 001 y no están
guardadas.

**Independent Test**: con la demo levantada, el comando de extremo a extremo informa cuántos recorridos pasaron, y la
carpeta de informes contiene un informe de accesibilidad y uno de rendimiento por pantalla y por tamaño.

**Acceptance Scenarios**:

1. **Given** la demo sin la barbería de la prueba, **When** se recorre el registro, **Then** la barbería queda creada,
   el correo de activación llega al buzón de desarrollo, y tras activarla el propietario entra a su panel.
2. **Given** una barbería con servicios y horario, **When** un cliente reserva y luego cancela, **Then** la cita
   aparece en "Mis citas" y, al cancelarla, el horario vuelve a estar libre.
3. **Given** citas del día, **When** el propietario abre su agenda, **Then** ve las citas de su barbería y ninguna de
   otra.
4. **Given** el proveedor de IA falso, **When** el cliente pregunta por los servicios, **Then** la respuesta muestra
   los servicios del catálogo, y en ningún momento se llama a un proveedor real.
5. **Given** la pasarela simulada, **When** el propietario paga su suscripción y la pasarela aprueba, **Then** la
   suscripción queda activa con el nuevo período.
6. **Given** las cuatro pantallas principales, **When** se miden a 360 px y en escritorio, **Then** se guardan los
   informes con los incumplimientos de accesibilidad encontrados y las puntuaciones de rendimiento **tal como
   salieron**, con la fecha y el equipo.
7. **Given** los recorridos, **When** se evalúa si pueden correr en el CI, **Then** entran al CI solo si pasan en
   5 corridas seguidas en local y en 3 corridas seguidas en el CI; si no, queda escrito el resultado de la
   evaluación (corridas probadas y fallas) y se ejecutan con un comando manual documentado.

---

### User Story 3 - Arranque reproducible con datos de ejemplo (Priority: P1)

Una persona que nunca vio el proyecto clona el repositorio y, siguiendo solo el README, genera las claves y sales de
desarrollo con un script, levanta la demo y encuentra dos barberías de ejemplo con servicios, barberos, clientes y
citas, con cuentas de demostración documentadas. Hay comandos equivalentes para bash y para PowerShell. El script
nunca modifica un archivo de configuración local que ya exista.

**Why this priority**: hoy un tercero debe generar claves con herramientas externas y pegarlas a mano, solo hay
comandos de PowerShell y no hay datos: la demo empieza vacía. US1 y US2 también necesitan datos conocidos.

**Independent Test**: en una copia limpia del repositorio, seguir el README de principio a fin en Linux (bash) y en
Windows (PowerShell) termina con la demo funcionando y las dos barberías visibles por su enlace público.

**Acceptance Scenarios**:

1. **Given** una copia sin archivo de configuración local, **When** se ejecuta el script, **Then** crea ese archivo a
   partir del ejemplo, con claves y sales nuevas válidas solo para desarrollo, y no imprime ningún secreto completo.
2. **Given** un archivo de configuración local que ya existe, **When** se ejecuta el script, **Then** no lo modifica,
   y solo informa qué variables le faltan (sin mostrar los valores existentes).
3. **Given** la demo levantada, **When** se carga la semilla con su comando explícito (no se carga sola al levantar
   la demo), **Then** hay dos barberías con servicios, barberos,
   clientes y citas, todos con datos inventados (nombres, correos de un dominio reservado para ejemplos y teléfonos no
   reales).
4. **Given** la semilla ya cargada, **When** se carga otra vez, **Then** no duplica nada ni falla.
5. **Given** la semilla, **When** se revisan los datos, **Then** cada barbería solo ve los suyos (el aislamiento se
   cumple también para los datos sembrados).

---

### User Story 4 - Interfaz servida como en producción y escalado medido (Priority: P2)

La demo sirve la interfaz como en producción (archivos compilados detrás de un servidor web, no el servidor de
desarrollo), con cabeceras de caché correctas para los archivos con hash y para la página principal. Con esa demo se
miden PR02 (reservas con carga) y PR03 (agregar una tercera instancia del backend con tráfico, sin perder
solicitudes).

**Why this priority**: el escalado del frontend hoy no tiene evidencia (la demo usa el servidor de desarrollo), y
PR02 y PR03 siguen sin medir desde 006.

**Independent Test**: con la demo, la interfaz responde con los archivos compilados y las cabeceras esperadas, y la
medición de PR03 guarda el throughput con dos y con tres instancias y las solicitudes perdidas durante el alta.

**Acceptance Scenarios**:

1. **Given** la demo de producción, **When** se pide un archivo con hash, **Then** responde con caché larga e
   inmutable; **When** se pide la página principal, **Then** responde sin caché; **When** se pide una ruta de la
   aplicación, **Then** responde con la página principal.
2. **Given** tráfico constante con dos instancias, **When** se agrega una tercera sin detener el tráfico, **Then** se
   guardan el throughput antes y después y el número de solicitudes perdidas, comparados con EQ-03 (≥ 1,6× y 0
   perdidas), aclarando que en un solo equipo las instancias comparten la CPU.
3. **Given** la demo de desarrollo, **When** se necesita la recarga en caliente, **Then** sigue disponible (la demo de
   producción se agrega, no reemplaza el modo de desarrollo).

---

### User Story 5 - Escalabilidad de la base de datos con evidencia (Priority: P2)

El responsable guarda en el repositorio la evidencia de cómo se comporta la base con más datos: los planes de
ejecución de las consultas críticas (horarios libres, agenda, reserva, reportes e indicadores), la configuración del
pool de conexiones y su cálculo con N instancias, una prueba con un volumen mayor que el actual, y un simulacro de
respaldo y restauración con su tiempo medido (PR22). Lo que no se construye (réplicas de lectura, particionado,
agrupador de conexiones externo) queda escrito como no construido, con su motivo y la condición para hacerlo.

**Why this priority**: el criterio de escalabilidad de base de datos hoy solo tiene diseño; el respaldo y la
restauración (EQ-22) nunca se probaron.

**Independent Test**: la carpeta de evidencia contiene los planes de ejecución, la prueba de volumen y el acta del
simulacro, con fecha, comandos y tiempos.

**Acceptance Scenarios**:

1. **Given** las consultas críticas, **When** se obtienen sus planes con el volumen de prueba, **Then** se guardan y
   se indica si usan los índices previstos; si alguna no los usa, se dice y no se oculta.
2. **Given** un respaldo de la base de la demo, **When** se restaura en una base vacía, **Then** las barberías, citas
   y roles quedan iguales (conteos comparados), la seguridad por barbería sigue activa, y se guardan los tiempos de
   respaldo y de restauración frente a EQ-22 (RPO ≤ 24 h, RTO ≤ 4 h).
3. **Given** el volumen mayor, **When** se miden las consultas críticas, **Then** se guardan los tiempos y se
   comparan con las metas de EQ-01 y EQ-02.

---

### User Story 6 - Calidad medible y pruebas estables (Priority: P2)

El responsable obtiene un informe de cobertura de las pruebas del backend y del frontend, el README muestra el estado
real de la integración continua, y las pruebas de tiempo que hoy fallan de forma intermitente bajo carga se vuelven
estables **sin quitar ninguna aserción de comportamiento**.

**Why this priority**: la cobertura no se mide hoy; el estado de la CI no se ve en el repositorio; y 11 pruebas de
tiempo fallan de forma intermitente en equipos cargados, lo que resta confianza a cada corrida.

**Independent Test**: el informe de cobertura queda guardado con su fecha; la insignia del README refleja la última
corrida; tres corridas completas seguidas de la suite no tienen fallas de tiempo en las 11 pruebas.

**Acceptance Scenarios**:

1. **Given** la suite, **When** se ejecuta con cobertura, **Then** se guarda el porcentaje real por backend y frontend
   (líneas y ramas), sin fijar un umbral que obligue a inventar pruebas.
2. **Given** las 11 pruebas frágiles, **When** se revisan, **Then** cada una conserva todas sus aserciones de
   comportamiento (qué responde, qué se guarda, qué no se duplica); en los límites que no son meta de un requisito
   solo suben los márgenes, y en las que comprueban la meta de un requisito (3 completas y una en parte, según la
   tabla de FR-034) la meta no cambia y se mide como mediana de repeticiones o en una suite aparte.
3. **Given** una medición de meta de requisito en la suite aparte, **When** no cumple la meta, **Then** el resultado
   se guarda como "no cumple" con la cifra real y la corrida principal no se bloquea.
4. **Given** el README, **When** se abre, **Then** muestra el estado de la última corrida de la CI de la rama
   principal.

---

### User Story 7 - Dominio propio, CDN y despliegue continuo (Priority: P3)

La demo se publica en el dominio propio `ayacuchobarber.shop` (DNS, CDN y HTTPS en Cloudflare, plan gratuito). La API
y/o la interfaz de producción de US4 salen por un **túnel con nombre** hacia el Compose local. Si la interfaz va a la
CDN de páginas (Cloudflare Pages), cada cambio en la rama principal que pasa todas las pruebas publica solo el
artefacto estático compilado. Si sale por el túnel desde el Nginx de Compose, no hay publicación desde la CI. Antes
de construir se analiza cuál de las dos vías se usa, teniendo en cuenta US8. Solo se publican datos de ejemplo.

**Why this priority**: es el criterio de dominio, DNS y CDN, y el de CD. Depende de cuentas externas y del equipo del
responsable encendido, y necesita una enmienda de la constitución (principio XII) y un ADR. Es lo más incierto.

**Independent Test**: con el Compose y el túnel levantados, el subdominio de la demo responde con HTTPS a través de la
CDN y muestra las barberías de ejemplo. Si se usa la publicación desde la CI: con la CI en verde en `main` se
publica la versión nueva; con la CI en rojo o desde otra rama, no se publica nada.

**Acceptance Scenarios**:

1. **Given** el Compose y el túnel levantados, **When** se abre la demo en el dominio propio, **Then** responde con
   HTTPS por la CDN, con las cabeceras de caché de US4, y solo muestra datos de la semilla.
2. **Given** la publicación desde la CI y la CI en verde en `main`, **When** termina, **Then** se publica solo el
   artefacto estático del frontend; **Given** la CI en rojo o otra rama, **Then** no se publica nada.
3. **Given** el equipo del responsable apagado o el túnel caído, **When** se abre la demo, **Then** la API no
   responde, y eso está escrito en el README y en el documento de despliegue: la versión publicada solo funciona
   mientras el equipo está encendido.
4. **Given** el análisis o el plazo, **When** el túnel, el DNS o la publicación no son viables, **Then** se documenta
   el motivo, la evidencia de despliegue es la demo local de US4 y nada se presenta como desplegado.

---

### User Story 8 - Subdominio por barbería (Priority: P3, la primera que se recorta)

Cada barbería pública se abre también en su propio subdominio, `slug.ayacuchobarber.shop`, con un DNS comodín. La
ruta actual `/b/slug` sigue funcionando sin cambios. El subdominio **solo identifica qué página pública mostrar**: el
aislamiento entre barberías no depende del nombre del host, y la barbería de cualquier operación autenticada sigue
saliendo de la sesión.

**Why this priority**: da una dirección propia a cada barbería, pero depende de US7 (dominio, DNS y túnel) y de que
la vía elegida admita un comodín en un dominio propio. Es lo primero que se recorta.

**Independent Test**: con US7 funcionando, `slug.ayacuchobarber.shop` muestra la misma página pública que
`/b/slug`; un subdominio sin barbería muestra lo mismo que un `/b/` desconocido; y una sesión de una barbería abierta
desde el subdominio de otra no ve datos de esta última.

**Acceptance Scenarios**:

1. **Given** una barbería de ejemplo activa, **When** se abre su subdominio, **Then** se ve su página pública, igual
   que por `/b/slug`.
2. **Given** la ruta `/b/slug`, **When** se abre, **Then** funciona exactamente como antes de 009.
3. **Given** un subdominio que no corresponde a ninguna barbería activa, **When** se abre, **Then** responde igual
   que un `/b/` desconocido, sin revelar si la barbería existe en otro estado.
4. **Given** una persona con sesión en la barbería A, **When** abre el subdominio de la barbería B y hace una
   operación autenticada, **Then** la operación usa la barbería de la sesión (A), nunca la del host, y no ve datos
   privados de B.
5. **Given** el análisis de US7, **When** la vía elegida no admite el comodín en el dominio propio, **Then** queda
   escrito y US8 se recorta sin afectar a US7.

---

### Edge Cases

- **Límite general de solicitudes:** la carga desde un solo origen choca con el límite por IP de 006; las pruebas de
  carga lo ajustan **solo en la demo y solo durante la medición**, y el resultado dice qué límite se usó.
- **Equipo cargado:** las cifras dependen del equipo (las réplicas comparten CPU); cada resultado guarda la CPU, la
  memoria y la carga del equipo, y no se presenta como medición de producción.
- **Umbral no cumplido:** se guarda "no cumple" con la cifra real; no se repite la medición hasta que salga bien sin
  decirlo (si se repite, se guardan todas las corridas).
- **Correos en los recorridos:** el correo de activación llega al buzón de desarrollo con demora; el recorrido espera
  un tiempo acotado y, si no llega, falla con un mensaje claro.
- **Semilla y pruebas:** los recorridos y la carga no deben romper la semilla de la demo (usan sus propias barberías
  o limpian lo que crean).
- **Archivo de configuración incompleto:** si el archivo local existe pero le faltan variables nuevas, el script las
  lista y no lo toca; la demo con Compose sigue arrancando con los valores de desarrollo que ya define.
- **Restauración en una base con roles distintos:** la restauración necesita los mismos roles de base; si faltan, el
  simulacro lo dice y documenta el paso previo.
- **Cobertura engañosa:** el archivo de pruebas de arquitectura y los simuladores no cuentan como código cubierto ni
  descubierto; el informe dice qué se excluyó.
- **CD sin secretos configurados:** si faltan las credenciales del despliegue en la CI, el paso de publicación no se
  ejecuta y lo informa, sin fallar la CI de pruebas.
- **Datos personales en una nube:** la demo publicada usa solo los datos inventados de la semilla; nunca datos
  reales. El tráfico pasa por la CDN de un proveedor fuera del país, y eso se escribe en el análisis.
- **Equipo apagado o túnel caído (US7):** la API publicada no responde; la interfaz, si está en la CDN de páginas,
  puede cargar pero mostrar el error de conexión que ya tiene. No se intenta ocultar.
- **Registros de terceros en la demo publicada:** cualquiera puede registrar una barbería o reservar en la demo
  pública. Lo que se cree no son datos de la semilla; el análisis dice cómo se limpia o se limita (por ejemplo,
  límites de solicitudes, o reinicio de la demo con la semilla).
- **Subdominios reservados (US8):** nombres como `www`, `api` o los de servicios propios no pueden resolverse como
  una barbería; un slug que coincida con uno de ellos se sigue abriendo por `/b/slug`.
- **Host falsificado (US8):** una cabecera de host manipulada solo puede cambiar qué página pública se muestra, nunca
  la barbería de una operación autenticada.

## Requirements _(mandatory)_

### Functional Requirements

**Generales**

- **FR-001**: Ninguna historia MUST cambiar el comportamiento de lo ya construido (respuestas, permisos, reglas,
  datos). Las pruebas existentes MUST seguir en verde sin quitar aserciones de comportamiento. La única conducta
  nueva es la de US8 (abrir la página pública por subdominio), que se agrega sin cambiar `/b/slug`.
- **FR-002**: Todo lo que toque la IA MUST usar el proveedor de IA falso; ninguna prueba, medición ni demo de 009
  MUST llamar a un proveedor real.
- **FR-003**: Ningún secreto real MUST quedar en el repositorio. Los valores de desarrollo que se versionen MUST
  marcarse como solo de desarrollo. Ningún script MUST leer, mostrar ni modificar el archivo de configuración local
  del responsable.
- **FR-004**: Ningún resultado MUST inventarse ni redondearse a favor: cada cifra (carga, rendimiento, accesibilidad,
  cobertura, tiempos de respaldo) MUST venir de una ejecución real, guardada en el repositorio con su fecha, el
  comando, la configuración y el equipo.
- **FR-005**: Cada historia MUST poder construirse y entregarse sola; si se recorta una, se registra como desviación
  en esta especificación y en la trazabilidad, y lo no construido se documenta como no construido.
- **FR-006**: Todo el código, los scripts y las configuraciones nuevas MUST quedar dentro de
  `tecnologia/plataforma-barberias/` (principio XII); en `.github/workflows/` solo lo que la constitución permita.

**US1 · Carga**

- **FR-007**: Los scripts de carga MUST versionarse en `tecnologia/plataforma-barberias/carga/` y ejecutarse con la
  imagen oficial de la herramienta en un contenedor, sin instalarla en el repositorio ni en el equipo.
- **FR-008**: MUST existir tres escenarios: catálogo público, horarios libres (EQ-01) y reserva (EQ-02, PR02), contra
  la demo con dos réplicas detrás del balanceador.
- **FR-009**: Cada escenario MUST declarar umbrales de p95 y de tasa de error tomados de EQ-01 y EQ-02, y la ejecución
  MUST indicar si se cumplen. En la reserva, un 409 por horario ocupado MUST contarse aparte y no como error técnico.
- **FR-010**: Los resultados MUST guardarse en el repositorio (resumen legible y datos de la ejecución), con el reparto
  de solicitudes entre réplicas.
- **FR-011**: El cambio respecto a la decisión R13 de 006 MUST registrarse como ADR (o revisión de uno existente), con
  el motivo: el criterio de evaluación pide k6 y la herramienta corre en un contenedor sin instalarse.
- **FR-012**: La relación con las mediciones anteriores de 006 MUST quedar explicada (qué es comparable y qué no).

**US2 · Extremo a extremo, accesibilidad y rendimiento**

- **FR-013**: MUST existir entre 4 y 5 recorridos de extremo a extremo en un navegador contra la demo: registro y
  activación de una barbería; reserva y cancelación por un cliente; agenda del propietario; asistente con el proveedor
  falso; pago de suscripción con la pasarela simulada.
- **FR-014**: Los recorridos MUST ejecutarse con un comando documentado en el README.
- **FR-015**: Los recorridos MUST entrar al CI solo si pasan en 5 corridas seguidas en local y en 3 corridas seguidas
  en el CI. Si no lo logran, MUST quedar escrito el resultado de la evaluación (corridas probadas, fallas y motivo) y
  se ejecutan con un comando manual documentado. MUST NOT agregarse al CI un paso que falle de forma intermitente.
- **FR-016**: MUST medirse la accesibilidad y el rendimiento de cuatro pantallas (catálogo público, reserva, panel del
  propietario y panel de la plataforma), a 360 px y en escritorio, y guardarse los informes completos. Los
  incumplimientos de accesibilidad encontrados MUST quedar listados con su corrección o el motivo para no corregirlos.

**US3 · Arranque reproducible**

- **FR-017**: MUST existir un script, con versión para bash y para PowerShell (o uno solo que corra en ambos), que
  genere las claves de firma de tokens y las sales y llaves de desarrollo.
- **FR-018**: Si el archivo de configuración local no existe, el script MUST crearlo desde el ejemplo con valores
  nuevos; si existe, MUST NOT modificarlo y MUST informar solo los nombres de las variables que faltan.
- **FR-019**: MUST existir una semilla versionada e idempotente con dos barberías, sus servicios, barberos, clientes
  y citas, con datos inventados (correos de un dominio reservado para ejemplos), cargada respetando el aislamiento por
  barbería y sin roles que omitan la seguridad por filas. Se carga con un **comando explícito** (no al levantar la
  demo), y cargarla de nuevo no duplica nada ni falla.
- **FR-020**: El README MUST permitir a un tercero clonar, preparar, levantar y abrir la demo con las cuentas de
  ejemplo, con comandos para bash y PowerShell.

**US4 · Frontend de producción y escalado**

- **FR-021**: La demo MUST poder servir la interfaz compilada detrás de un servidor web, con caché larga e inmutable
  para los archivos con hash, sin caché para la página principal y con la página principal para las rutas de la
  aplicación, como dice el documento de despliegue (§4.1).
- **FR-022**: El modo de desarrollo con recarga en caliente MUST seguir disponible.
- **FR-023**: MUST medirse PR02 (reservas con carga) y PR03 (agregar una tercera instancia con tráfico), y guardarse
  el throughput con dos y tres instancias y las solicitudes perdidas durante el alta.

**US5 · Base de datos**

- **FR-024**: MUST guardarse los planes de ejecución de las consultas críticas (horarios libres, agenda, reserva,
  reportes e indicadores) con el volumen de prueba, indicando qué índice usa cada una.
- **FR-025**: MUST documentarse la configuración del pool de conexiones por instancia y el cálculo del total con N
  instancias frente al máximo de la base.
- **FR-026**: MUST medirse las consultas críticas con un volumen mayor que el de las pruebas actuales, y guardarse
  los tiempos.
- **FR-027**: MUST hacerse un simulacro de respaldo y restauración en una base vacía (PR22), con conteos comparados,
  la seguridad por filas verificada y los tiempos medidos frente a EQ-22, guardado como acta.
- **FR-028**: Las réplicas de lectura, el particionado y el agrupador de conexiones externo MUST documentarse como no
  construidos, con su motivo y la condición para construirlos.

**US6 · Calidad medible**

- **FR-029**: MUST generarse un informe de cobertura del backend y del frontend, guardado en el repositorio con su
  fecha, diciendo qué se excluyó.
- **FR-030**: La CI MUST poder generar la cobertura sin volverse más lenta de lo necesario ni fallar por un umbral
  arbitrario.
- **FR-031**: El README raíz MUST mostrar una insignia del estado de la CI de la rama principal.
- **FR-032**: Las 11 pruebas frágiles (`balanceador`, `confirmacion-adelanto`, `redis-caido`,
  `degradacion-asistente`, `indicadores-plataforma`, `proveedor-caido`, `conciliacion`, `cache-catalogo`,
  `cache-compartida`, `historial-pagos` y `transferencia`) MUST conservar todas sus aserciones de comportamiento.
- **FR-033**: Cada cambio en una prueba frágil MUST registrar el valor anterior, el nuevo y el motivo.
- **FR-034**: En las pruebas cuyo límite de tiempo es la **meta de un requisito**, la meta MUST NOT relajarse:
  MUST medirse como la mediana de varias repeticiones, o en una suite aparte que no bloquee la corrida principal,
  y su resultado MUST guardarse como "cumple" o "no cumple" con la cifra real. En las demás pruebas frágiles MUST
  subirse solo los márgenes de tiempo, sin quitar ninguna aserción de comportamiento. Clasificación (revisada contra
  el código el 2026-11-19; el plan la confirma prueba por prueba):

  | Prueba | ¿Límite = meta de un requisito? | Meta o motivo |
  | --- | --- | --- |
  | `degradacion-asistente` | Sí | 005 FR-008 y SC-003 (EQ-06, PR06): el asistente avisa "no disponible" en ≤ 3 s con el proveedor caído o lento |
  | `proveedor-caido` | Sí | 003 FR-044 y SC-005 (EQ-06, PR06): con la pasarela caída o colgada, el propietario recibe el mensaje en ≤ 3 s |
  | `indicadores-plataforma` | Sí | 007 SC-005: los indicadores responden en ≤ 3 s con volumen |
  | `redis-caido` | En parte | El límite de 2 s con la caché caída es la meta de 006 SC-005 (EQ-05, p95 ≤ 2 s), así que se trata como meta. Los de 1 s y los derivados del tiempo límite de la caché (006 FR-019, "un tiempo límite corto", sin cifra) son márgenes |
  | `balanceador` | No | tiempos de espera de la prueba (caída de una réplica, reparto) |
  | `confirmacion-adelanto` | No | esperas de la prueba (recordatorio y estados de 008) |
  | `conciliacion` | No | esperas de la corrida de conciliación |
  | `cache-catalogo` | No | TTL y esperas de la caché (el TTL máximo de 006 FR-012 se comprueba como aserción, no como tiempo de respuesta) |
  | `cache-compartida` | No | TTL y tiempos de respuesta de la caché compartida |
  | `historial-pagos` | No | esperas de la prueba |
  | `transferencia` | No | esperas de la prueba |

  Si una aserción de TTL o de comportamiento depende del tiempo (por ejemplo, que una entrada no sobreviva al TTL),
  MUST conservarse; solo se amplía la espera alrededor de ella.

**US7 · Subdominio, CDN y CD**

- **FR-035**: Antes de construir, MUST documentarse el análisis de viabilidad: base de datos con seguridad por filas
  y varios roles, secretos, costos, datos personales fuera del país y plazo; con al menos dos alternativas.
- **FR-036**: Si hay publicación desde la CI, MUST publicar solo el artefacto estático del frontend, solo desde
  `main` y solo si todos los trabajos de pruebas de la misma corrida pasaron; MUST NOT tener acceso a la base de
  datos, a Redis ni a secretos de la aplicación. La interfaz MUST servirse con HTTPS y las cabeceras de US4.
- **FR-037**: Los secretos de la publicación (credencial del túnel, credencial de publicación en la CDN) MUST ser los
  mínimos, con permiso limitado a esa tarea, y guardarse solo en el equipo del responsable o en el almacén de
  secretos de la CI. Ningún archivo del repositorio MUST contener tokens, claves ni identificadores de cuenta o de
  zona de Cloudflare ni de Namecheap; los ejemplos usan marcadores.
- **FR-038**: La publicación desde `.github/workflows/` MUST contar antes con la enmienda del principio XII aprobada y
  aplicada, y con su ADR, que revisa ADR-006 solo para aclarar que la demo publicada no es el despliegue objetivo.
  Los dos están en borrador en [borradores/enmienda-xii-y-adr-publicacion.md](borradores/enmienda-xii-y-adr-publicacion.md),
  sin aplicar a la constitución hasta la revisión del responsable.
- **FR-039**: El README y el documento de despliegue MUST decir que la versión publicada solo funciona mientras el
  equipo del responsable está encendido con el Compose y el túnel levantados, que no es producción ni alta
  disponibilidad, y que producción real necesita un backend alojado y una base de datos administrada (con los roles y
  la seguridad por filas de la constitución), fuera de alcance de 009. Nada MUST presentarse como desplegado si no lo
  está.
- **FR-040**: **Criterio de corte:** si el túnel, el DNS o la publicación no son viables en el plazo, MUST
  documentarse el porqué y la evidencia de despliegue MUST ser la demo local de producción de US4.
- **FR-041**: El alcance de la publicación MUST ser el dominio propio `ayacuchobarber.shop` (registrador Namecheap;
  DNS, CDN y HTTPS en Cloudflare, plan gratuito) con un **túnel con nombre** hacia el Compose local para la API y/o la
  interfaz de producción, publicando solo los datos de ejemplo de la semilla de US3. El análisis (FR-035) MUST
  decidir, con su motivo, si la interfaz va a Cloudflare Pages (con publicación desde la CI) o sale por el túnel
  desde el Nginx de Compose. Debe considerar que algunos servicios gratuitos no admiten subdominios comodín en
  dominios propios, lo que condiciona US8.

**US8 · Subdominio por barbería**

- **FR-043**: La página pública de una barbería activa MUST poder abrirse también en `slug.ayacuchobarber.shop`
  (DNS comodín), mostrando lo mismo que `/b/slug`.
- **FR-044**: La ruta `/b/slug` MUST seguir funcionando sin cambios.
- **FR-045**: El nombre del host MUST usarse solo para elegir qué página pública mostrar. La barbería de cualquier
  operación autenticada MUST seguir saliendo de la sesión, y el aislamiento por barbería (seguridad por filas y
  comprobaciones de la aplicación) MUST NOT depender del host. Una prueba MUST demostrar que una sesión de la
  barbería A, usada desde el subdominio de B, no accede a datos privados de B.
- **FR-046**: Un subdominio sin barbería activa MUST responder igual que un `/b/` desconocido. Los subdominios
  reservados (por ejemplo, `www` y `api`) MUST NOT resolverse como barberías.
- **FR-047**: Si la vía elegida en US7 no admite el comodín en el dominio propio, US8 MUST recortarse y registrarse
  como desviación, sin afectar a US7.

**Documentación (principio XI)**

- **FR-042**: Cada historia construida MUST actualizar en su mismo cambio los documentos que afecta: pruebas,
  escenarios de calidad, despliegue, multi-tenancy y datos, trazabilidad y README.

### Key Entities

- **Resultado de medición**: lo que produjo una ejecución real (carga, rendimiento, accesibilidad, cobertura,
  respaldo). Atributos: fecha, comando, configuración (réplicas, límites, volumen), equipo (CPU, memoria, carga),
  cifras, umbral y "cumple" o "no cumple". Nunca se edita a mano.
- **Escenario de carga**: ruta medida, usuarios o tasa, duración, umbrales y criterio de error técnico.
- **Recorrido de extremo a extremo**: pasos de un usuario en el navegador, datos que necesita y qué comprueba al
  final.
- **Semilla de demostración**: dos barberías con servicios, barberos, clientes, citas y cuentas de ejemplo
  documentadas; datos inventados, carga idempotente.
- **Acta de simulacro**: respaldo, restauración, conteos antes y después, verificación de la seguridad por filas y
  tiempos frente a EQ-22.
- **Análisis de despliegue**: opciones (Cloudflare Pages o túnel desde el Nginx de Compose), limitaciones (equipo
  encendido, comodín, datos fuera del país), costos, secretos (solo nombres, nunca valores) y decisión, con su ADR.
- **Subdominio de barbería (US8)**: el slug de una barbería activa usado como nombre de host; solo elige la página
  pública; tiene nombres reservados.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Una persona que no conoce el proyecto levanta la demo con datos de ejemplo siguiendo solo el README, en
  bash y en PowerShell, en menos de 30 minutos (sin contar descargas), sin editar a mano ningún secreto.
- **SC-002**: Las pruebas de carga de los tres escenarios se ejecutan con un comando y dejan en el repositorio sus
  resultados y el veredicto frente a EQ-01 y EQ-02; el 100 % de las cifras citadas en `docs/` tienen su archivo de
  resultado.
- **SC-003**: Los 4 o 5 recorridos de extremo a extremo pasan en 5 corridas seguidas contra la demo local; si entran
  al CI, pasan en 3 corridas seguidas allí; si no entran, la evaluación está escrita.
- **SC-004**: Hay un informe de accesibilidad y uno de rendimiento guardados por cada una de las 4 pantallas a 360 px
  y en escritorio (16 informes), con 0 incumplimientos graves de accesibilidad sin explicar.
- **SC-005**: La interfaz de la demo de producción responde con las cabeceras de caché esperadas en el 100 % de los
  archivos con hash y en la página principal.
- **SC-006**: PR03 queda medido: throughput con dos y tres instancias y 0 solicitudes perdidas, o la cifra real si no
  se cumple.
- **SC-007**: El simulacro restaura la demo con conteos iguales y la seguridad por barbería activa, y su tiempo queda
  guardado frente a RTO ≤ 4 h.
- **SC-008**: La cobertura de backend y frontend queda publicada con su porcentaje real, y el README muestra el
  estado de la CI.
- **SC-009**: En 3 corridas completas seguidas de la suite principal, las 11 pruebas frágiles no fallan por tiempo,
  y ninguna perdió aserciones de comportamiento. Las metas de requisito de la tabla de FR-034 (≤ 3 s, ≤ 3 s, ≤ 3 s y
  p95 ≤ 2 s) siguen iguales y su medición (mediana o suite aparte) queda guardada con la cifra real.
- **SC-010**: Si US7 se construye, la demo responde con HTTPS en el dominio propio mientras el equipo está
  encendido. Si hay publicación desde la CI, un cambio en `main` con la CI en verde queda publicado en menos de
  15 minutos, y uno con la CI en rojo o desde otra rama no se publica. Si no se construye, el motivo está
  documentado.
- **SC-011**: Si US8 se construye, el 100 % de las barberías de ejemplo se abren por su subdominio con la misma
  página que por `/b/slug`, y la prueba de sesión cruzada (FR-045) da 0 datos privados de otra barbería.

## Assumptions

- **Fecha:** entrega a finales de noviembre de 2026; desde el 2026-11-18 quedan unos 12 días. Orden de recorte si
  falta tiempo: primero **US8**, después US7, US5, US6 y US4; US1, US2 y US3 no se recortan.
- **Dominio y cuentas:** `ayacuchobarber.shop` ya está comprado (Namecheap) y su zona está en Cloudflare (plan
  gratuito). Las cuentas y credenciales son del responsable; ningún identificador ni secreto entra al repositorio.
- **Entorno de medición:** el equipo del responsable con Docker Compose y dos réplicas; las cifras no representan
  producción, y así se dice (como en 006).
- **Herramientas:** el responsable pidió k6 para la carga y Playwright para los recorridos (criterios de evaluación);
  la accesibilidad con axe y el rendimiento con Lighthouse. Corren en contenedores o como dependencias de desarrollo
  del frontend; ninguna se instala en el sistema.
- **Metas:** las de EQ-01, EQ-02, EQ-03 y EQ-22 siguen siendo propuestas por validar; 009 las mide, no las cambia.
- **Límite de solicitudes durante la carga:** se ajusta solo en la demo, durante la medición, como en 006.
- **Semilla:** datos inventados; correos de un dominio reservado para ejemplos; ninguna persona real. Las cuentas de
  ejemplo usan contraseñas de demostración documentadas, solo para la demo local.
- **Pago simulado:** la pasarela simulada de 003; ningún cobro real.
- **CI:** GitHub Actions; las pruebas de integración ya corren allí con contenedores; la demo completa con dos
  réplicas puede no caber o ser inestable en el CI, y eso se evalúa (FR-015).
- **Constitución:** US7 con publicación desde `.github/workflows/` necesita un cambio del principio XII y un ADR
  que revise ADR-006. Tras el plan (research R09), la interfaz sale por el túnel y la CI no publica, así que basta
  una aclaración PATCH (se propone la 1.7.2) en lugar de la enmienda MINOR. Los dos están en
  [borradores/enmienda-xii-y-adr-publicacion.md](borradores/enmienda-xii-y-adr-publicacion.md), sin aplicar. El cambio
  de R13 de 006 (k6) necesita su propio ADR. Ninguna otra historia cambia la constitución.
- **Fuera de alcance:** alta disponibilidad, monitoreo con alertas (PR21), un proveedor real de pagos, de correo, de
  WhatsApp o de IA, y datos reales de barberías.

## Desviaciones

Aquí se registra cada recorte aplicado, con la fecha y el motivo. Cada desviación también va en la fila de 009 de
`docs/trazabilidad.md`.

- Ninguna todavía.
