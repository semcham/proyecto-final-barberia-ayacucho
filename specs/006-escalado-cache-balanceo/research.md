# Research: Escalabilidad y rendimiento de la plataforma

**Funcionalidad**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Fecha**: 2026-10-18

Fase 0 del plan. Cada decisión indica qué se eligió, por qué y qué se descartó. Las herramientas
(Nginx, Redis y Docker Compose) las fijó el responsable; aquí se decide cómo usarlas.

## Punto de partida medido (002)

- `GET /publico/{slug}/horarios` abre **tres transacciones** por consulta:
  - `BarberiasApi.resolverSlugPublico` (pool de la aplicación);
  - `BarberiasApi.datosPublicos` (pool de la aplicación);
  - `LecturaPublica.ejecutar` (pool público, seis consultas: servicio, horario de atención,
    barberos candidatos, disponibilidad semanal, bloqueos y citas).
- Cada pool tiene 10 conexiones; con 50 consultas simultáneas, la espera de conexión domina.
- El límite general de solicitudes usa `@nestjs/throttler` con su almacenamiento en memoria: por
  instancia.
- `trust proxy` confía en `loopback, linklocal, uniquelocal`: cualquier dirección privada puede
  fijar `X-Forwarded-For`.
- El `docker-compose.yml` de desarrollo ejecuta `npm ci && npm run migrate && npm run start:dev` en
  el único contenedor `backend`.

---

## R01 · Topología de Docker Compose

**Decisión**:

- **Un servicio de preparación de una sola ejecución, `preparar-backend`**, ejecuta
  `npm ci && npm run build && npm run migrate`, copia el build al volumen `backend-dist` y termina.
- **Dos servicios explícitos, `backend-1` y `backend-2`**, definidos con un ancla YAML común
  (`x-backend`). Arrancan solo cuando `preparar-backend` terminó bien
  (`condition: service_completed_successfully`) y ejecutan el build compilado
  (`node dist/src/main.js`), sin `--watch`.
- **Las réplicas no leen la carpeta del equipo** (ajuste del 2026-10-22, al verificar con Compose): usan
  `backend-dist` y `backend-node-modules` montados de solo lectura. En Docker Desktop sobre Windows, leer
  `dist/` desde la carpeta montada hizo que un arranque tardara más de 2 minutos; desde un volumen de
  Docker tarda segundos. De paso, las réplicas no cambian si se edita el código hasta repetir la
  preparación.
- **Reiniciar una réplica con `docker compose up -d --no-deps backend-N`:** `docker compose start` o
  `up` sin `--no-deps` vuelven a ejecutar `preparar-backend`, su dependencia (unos 2 minutos), y
  reescriben `node_modules` con la otra réplica en marcha.
- **`nginx`** (imagen `nginx:1.27-alpine`) es el único punto de entrada de la API. Publica el puerto
  `3000` del equipo, así las URL de siempre (`http://localhost:3000/api/v1/...`) siguen funcionando.
  Los backends ya no publican puertos.
- **`redis`** (imagen `redis:7.4-alpine`).
- **Red propia `plataforma`** con subred fija (`172.28.0.0/24`): `nginx` .10, `backend-1` .11 y
  `backend-2` .12.
- **El frontend (Vite)** apunta su proxy a `http://nginx:80`.

**Por qué**:

- Dos `npm ci` simultáneos sobre el mismo volumen de `node_modules`, o dos `nest start --watch`
  compilando a la misma carpeta `dist/`, se pisan. Un único paso de preparación lo evita y además
  hace que las migraciones se apliquen una sola vez.
- Dos servicios con nombre propio permiten la demo exacta (`docker compose stop backend-2`).
- Nginx de código abierto resuelve los nombres del `upstream` **una sola vez al arrancar**: si una
  réplica se recrea con otra IP, o no existe al arrancar, Nginx falla o envía tráfico a una IP vieja.
  Con IP fijas, el `upstream` no depende del DNS de Docker.

**Alternativas descartadas**:

- `deploy.replicas: 2` sobre un solo servicio: el nombre resuelve a varias IP solo al arrancar
  Nginx; la demo no puede detener "una" réplica con nombre; comparten volumen y comando.
- `resolver 127.0.0.11` con variables en `proxy_pass`: obliga a abandonar el bloque `upstream` y,
  con él, `max_fails` y el reparto.
- Mantener `start:dev` en las réplicas: dos compiladores escribiendo en la misma carpeta.

**Consecuencia para el desarrollo diario**:

- Con el entorno escalado, un cambio de código se aplica con
  `docker compose up -d --force-recreate preparar-backend backend-1 backend-2`.
- Para recargar en caliente se sigue usando el backend local
  (`npm run start:dev` con la base y Redis de Compose), como describe el README.

## R02 · Comprobación de salud y "listo para recibir tráfico"

**Decisión**:

- **Dos rutas:**
  - `GET /api/v1/salud` (existente, vivacidad): la base de datos responde.
  - **`GET /api/v1/salud/listo`** (nueva, disponibilidad): la base de datos responde **y** la última
    migración aplicada en `kysely_migration` coincide con la última que conoce el código
    (`ProveedorDeMigraciones`). Responde 200 `{ estado: 'listo' }` o 503. Redis **no** cuenta: sin
    Redis, la instancia sigue lista (FR-019).
- **Permiso de lectura:** la migración **0013** concede `SELECT` sobre `kysely_migration` a
  `barberias_app`. Es una tabla técnica, sin datos de negocio ni de barberías. Antes de aplicarla,
  la ruta responde 503, que es lo correcto, porque faltan migraciones.
- **Docker:** cada réplica tiene un `healthcheck` que llama a `/salud/listo` con
  `node -e "fetch(...)"`: intervalo 5 s, tiempo límite 2 s, 5 reintentos y `start_period` de 60 s
  (ajustado el 2026-10-22: con 20 s y 3 reintentos, un arranque de 36 s en este equipo se marcaba como
  fallido). `nginx` depende de que ambas estén sanas en el primer arranque.
- **Sin dependencia de Redis al arrancar:** las réplicas no esperan a `redis` (no hay
  `depends_on` hacia él). El backend arranca y queda listo sin Redis, y empieza a usarlo cuando
  responde (interruptor, R06), igual que tras una caída (FR-019).
- **Nginx (de código abierto) no tiene comprobación activa** (es de Nginx Plus). Usa la **pasiva**:
  - `max_fails=3 fail_timeout=10s` (ajustado el 2026-10-22: con `max_fails=1`, mientras una réplica
    arrancaba con el equipo cargado, un único fallo pasajero de la otra dejó a Nginx sin réplicas y
    respondió 503 durante 10 s; con 3, una réplica caída se detecta igual en milisegundos con tráfico);
  - `proxy_connect_timeout 1s`;
  - `proxy_next_upstream error timeout http_502 http_503`, con `proxy_next_upstream_tries 2` y
    `proxy_next_upstream_timeout 3s`.
- **Efecto:**
  - Una réplica detenida rechaza la conexión al instante, y una pausada no responde en 1 s. En ambos
    casos Nginx reintenta en la otra las solicitudes idempotentes (GET y HEAD) y saca la réplica 10 s
    del reparto.
  - Luego prueba con una solicitud y, si responde, la reincorpora sola.
  - Las solicitudes no idempotentes (POST, PUT, PATCH, DELETE) **no se reintentan**: es el
    comportamiento por defecto de Nginx desde 1.9.13. Una reserva en curso hacia la réplica que cae
    puede fallar; el cliente la reintenta con la misma `Idempotency-Key` y no se duplica (002).
  - La detección ocurre con los primeros fallos: menos de 15 s (FR-003, SC-002).

**Alternativas descartadas**:

- Comprobación activa con un módulo de terceros (`nginx_upstream_check_module`): exige compilar
  Nginx y descargar más.
- HAProxy o Traefik, que sí la tienen: el responsable fijó Nginx, y la pasiva cumple la medida.
- Leer `kysely_migration` con el rol dueño: el backend no tiene esas credenciales, y no debe
  tenerlas.

## R03 · Migraciones una sola vez con dos réplicas

**Decisión**:

- **En Compose**, las aplica solo `preparar-backend` (R01).
- **Como defensa**, si dos procesos ejecutan `npm run migrate` a la vez (por ejemplo, en un
  despliegue en la nube con dos tareas), el `Migrator` de Kysely ya toma un bloqueo de PostgreSQL
  (`pg_advisory_xact_lock` en el adaptador de PostgreSQL) y vuelve a leer las migraciones aplicadas
  dentro de ese bloqueo: el segundo proceso espera y no aplica nada. Una prueba de integración lo
  demuestra lanzando `migrarHastaLaUltima` dos veces en paralelo sobre una base vacía (cada
  migración queda una vez en `kysely_migration` y no hay errores).

**Alternativa descartada**: un bloqueo propio alrededor del `Migrator`, que duplica lo que Kysely
ya hace.

## R04 · IP real del cliente detrás de Nginx

**Decisión**:

- **Nginx sobrescribe** `X-Forwarded-For` y `X-Real-IP` con `$remote_addr`, en lugar de agregar al
  valor recibido (`$proxy_add_x_forwarded_for`). Lo que envíe el cliente se descarta.
- **El backend confía solo en el balanceador:** `trust proxy` pasa a ser configurable con la
  variable **`PROXIES_CONFIABLES`**.
  - El valor por defecto pasa a ser `loopback` (hoy es `loopback, linklocal, uniquelocal`).
  - En Compose, `PROXIES_CONFIABLES=172.28.0.10`, la IP fija de Nginx.
  - Express toma la dirección de `X-Forwarded-For` solo si la conexión llega desde una dirección de
    confianza.
- **Los backends no publican puertos**, así que solo se llega a ellos a través de Nginx.
- **Límite conocido de Docker Desktop:** en Windows y macOS, Nginx ve como cliente la puerta de
  enlace de Docker. Todas las solicitudes desde el propio equipo comparten IP; desde otro equipo de
  la red, también. La medición y las demos fijan límites altos por variable de entorno (R13). En la
  nube, el balanceador gestionado entrega la IP real (documentado en ADR-030).
- **En desarrollo**, a través de Vite, la IP vista es la del contenedor del frontend; no afecta a
  la producción.

**Por qué**: con `uniquelocal`, cualquier contenedor o equipo de una red privada que llegara al
backend podría fijar su propia IP y saltarse el límite o falsear la IP de la auditoría. Las pruebas
actuales que simulan IP con `X-Forwarded-For` (`limite-intentos`, `entradas`) llegan desde
`loopback` y siguen funcionando.

**Alternativas descartadas**:

- `trust proxy = 1` (un salto): confiaría en el encabezado aunque alguien llegue directo a la
  réplica.
- El módulo `real_ip` de Nginx: aquí no hay otro proxy delante de Nginx.

## R05 · Adaptador de caché en M06

**Decisión**:

- **Puerto en M06** (`shared/cache/cache-compartida.ts`, exportado en `shared/index.ts`), clase
  abstracta `CacheCompartida` con cuatro operaciones:
  - `obtener<T>(clave: ClaveCache): Promise<T | null>`;
  - `guardarSiGeneracion(clave, generacion: ClaveGeneracion, esperada: number, valor, ttlSegundos)`;
  - `invalidar(clave, generacion)`;
  - `contar(clave: ClaveContador, ventanaMs): Promise<{ total; msRestantes } | null>`.
- **Toda operación de datos de barbería recibe una `ClaveCache`, nunca un texto.** Las claves se
  construyen solo con la fábrica `ClavesCache` (`shared/cache/claves-cache.ts`):
  - `ClavesCache.catalogoPublico(tenantId: TenantId)` → `bp:v1:t:{uuid}:catalogo-publico`;
  - `ClavesCache.generacionCatalogo(tenantId)` → `bp:v1:t:{uuid}:catalogo-publico:gen`;
  - para FR-013b: `ClavesCache.horarios(tenantId, …)` y `ClavesCache.generacionHorarios(tenantId)`.
  - El constructor de `ClaveCache` es privado y exige un `TenantId` (objeto de valor ya validado).
    Una prueba unitaria y el tipo impiden construir una clave de barbería sin tenant (FR-014). El
    prefijo `bp:v1:` permite descartar todo el formato si cambia (FR-015).
- **Contadores:** `ClaveContador` (`rl:v1:{hash}`) es otro tipo, construido solo por el
  almacenamiento de límites (R09). Al ser por IP, no lleva tenant, como permite el principio VIII.
- **Implementaciones:**
  - `RedisCacheCompartida` (`shared/cache/redis-cache-compartida.ts`), con `ioredis`, con un tiempo
    límite corto por operación y sin cola de comandos mientras no hay conexión, para fallar rápido
    en lugar de esperar (R06);
  - `CacheInactiva`, que siempre falla en silencio: `obtener` devuelve `null` y `contar` devuelve
    `null`. Se usa cuando no hay `REDIS_URL` (pruebas actuales y desarrollo sin Redis).
- **Valores:** se guardan como JSON con un campo `v` (versión del formato). Si el JSON no se puede
  leer o la versión es otra, se trata como ausente (FR-015).
- **Pruebas de arquitectura:** una regla nueva de PR14, `redis-confinado`, permite importar
  `ioredis` solo desde `shared/cache/`.

**Librería**: `ioredis` **5.4.2** (MIT), fijada exacta (`--save-exact`). Si al instalar hubiera
un motivo para otra 5.x (por ejemplo, un aviso de seguridad), se usa la más reciente con al menos
2 semanas de publicada y se anota en `tecnologias.md`.

- **Ventajas:** tiempo límite por comando (`commandTimeout`), `enableOfflineQueue: false`,
  `maxRetriesPerRequest: 0`, reconexión con `retryStrategy`, y scripts Lua con `defineCommand`.
- **Se instala sin tocar el disco C::**
  `npm install ioredis@<versión> --save-exact --cache D:\proyecto-final-barberia-ayacucho\tmp\npm-cache`,
  y luego se borra esa carpeta. En los contenedores, `npm ci` corre dentro de Docker, cuyos datos
  están en D:.

**Alternativas descartadas**:

- `redis` (node-redis 4): sin tiempo límite por comando integrado.
- `cache-manager`: no permite el guardado condicionado ni los contadores atómicos que hacen falta.
- Claves como texto libre: es justo lo que FR-014 prohíbe.

## R06 · Tiempo límite e interruptor de circuito

**Decisión**:

- **Tiempo límite** por operación: **100 ms** (`CACHE_TIMEOUT_MS`). En una red local de contenedores,
  una operación normal tarda menos de 2 ms.
- **Interruptor** propio en M06 (`shared/cache/interruptor.ts`), sin dependencias y con reloj
  inyectable para probarlo sin infraestructura:
  - **Cerrado:** cuenta fallos consecutivos. Con **5** (`CACHE_FALLOS_PARA_ABRIR`), se abre.
  - **Abierto:** durante **10 s** (`CACHE_PAUSA_MS`) ninguna operación llega a Redis. La lectura va
    directa a PostgreSQL y el límite usa el almacenamiento por instancia.
  - **Semiabierto:** deja pasar una operación de prueba. Si funciona, se cierra; si falla, vuelve a
    abrirse.
- **Registros:** al abrirse se escribe **una** línea `CACHE_NO_DISPONIBLE` con la hora (la "alerta"
  de EQ-05, FR-020), y al cerrarse, `CACHE_RECUPERADA`. Nunca una línea por solicitud.

**Por qué**: sin interruptor, cada solicitud con Redis caído sumaría el tiempo límite. Los valores
salen de ADR-012 (5 fallos) y quedan configurables.

**Alternativa descartada**: `opossum`, que agrega una dependencia para 40 líneas de lógica.

## R07 · Qué se guarda del catálogo

**Decisión**:

- **Una entrada por barbería**, `bp:v1:t:{tenantId}:catalogo-publico`, con
  `{ v: 1, generacion, horario, servicios, barberos }`: exactamente el `CatalogoPublicoDatos` que ya
  devuelve `CatalogoPublicoRepository.catalogo` (solo columnas públicas de ADR-021).
- **Los datos de la barbería** (nombre, enlace, dirección, teléfono, descripción, zona horaria)
  **no** se guardan. Se leen en cada solicitud, junto con la resolución del enlace, en **una sola**
  transacción de M01: método nuevo `BarberiasApi.barberiaPublicaPorEnlace(slug)`, que reemplaza las
  dos llamadas actuales del controlador público.
- **La correspondencia enlace → barbería no se guarda en la caché.**
  - El principio III exige que toda clave de caché incluya el tenant, y una clave por `slug` no
    puede incluirlo.
  - Leer el enlace en cada solicitud es una consulta por índice único sobre una tabla pequeña.
  - Además, resuelve sin código extra el cambio de enlace (FR-011), el enlace reutilizado por otra
    barbería, la barbería suspendida y el enlace inexistente: no se crean entradas por enlaces
    inventados (FR-009).
- **Horarios libres:** hay dos fuentes del día, y ambas abren **una sola** transacción pública.
  - **Con la entrada en caché (acierto):** `fuenteDelDia(tenantId, catalogo)` toma de la entrada
    la duración del servicio, el horario de atención y los barberos que ofrecen el servicio, y lee
    de PostgreSQL solo la disponibilidad semanal, los bloqueos y las citas del día (3 consultas).
  - **Sin entrada** (caché desactivada, fallo de caché o Redis caído): `fuenteCompleta(tenantId)`
    lee todo en una transacción (6 consultas), como hace 002 hoy.
  - En ambos casos, disponibilidad, bloqueos y citas se leen **siempre** vigentes (FR-013, US2
    escenario 9).
  - **Ruta de horarios:** solo lee la entrada; no la llena. La llena `GET /publico/{slug}`, que la
    página pública pide antes de los horarios. Así un fallo en los horarios no suma una
    transacción más.
  - **Cuenta por consulta:**
    - hoy, 3 transacciones y 8 consultas;
    - con acierto, **2 transacciones y 4 consultas** (el enlace con los datos de la barbería en M01,
      más la fuente del día);
    - sin entrada, **2 transacciones y 7 consultas** (el enlace más la fuente completa).
  - Si el servicio pedido no está en la entrada (inexistente o inactivo), la respuesta es la misma
    que hoy.

**Alternativas descartadas**:

- Guardar también la correspondencia por `slug`: incumple el principio III tal como está escrito y
  abre el caso del enlace reutilizado.
- Guardar la disponibilidad semanal: el escenario 9 de US2 pide que se lea vigente.
- Guardar la respuesta HTTP completa: mezclaría datos de M01 y M02 y obligaría a M01 a invalidar
  entradas de M02 (M01 no depende de M02).

**Aparte de la caché**: la fusión en una transacción de M01 baja el tiempo con y sin caché.
Mejora también la medición sin caché, y así se registra (R13).

## R08 · Invalidación después de confirmar y carrera entre lectura e invalidación

**Decisión**:

- **Después de confirmar.** `UnitOfWork` agrega `alConfirmar(fn)`, que registra una acción que se
  ejecuta solo si la transacción más externa se confirma. Si se revierte, se descarta. Un error de
  la acción se registra y no cambia la respuesta (FR-010).
- **Invalidador.** Los casos de uso llaman a
  `InvalidadorCatalogoPublico.catalogoCambio(tenantId)` (M02, `catalogo/application`), que hace
  `uow.alConfirmar(() => cache.invalidar(clave, generacion))`.
- **Casos de uso que invalidan** (la matriz completa está en
  [contracts/cache-claves.md](contracts/cache-claves.md)):

  | Caso de uso                 | Cambio                                                      |
  | --------------------------- | ----------------------------------------------------------- |
  | `CrearServicio`             | Servicio nuevo                                              |
  | `ActualizarServicio`        | Nombre, descripción, precio, duración, activar o desactivar |
  | `CrearBarbero`              | Barbero nuevo                                               |
  | `ActualizarBarbero`         | Nombre visible, activar o desactivar, servicios asignados   |
  | `ReemplazarHorarioAtencion` | Horario de atención                                         |
  - `ActualizarBarberia` (M01: datos comerciales y enlace) **no** necesita invalidar: esos datos no
    se guardan (R07).
  - `ReemplazarDisponibilidad` y los bloqueos tampoco: no están en la entrada (salvo con FR-013b,
    R10).

- **Carrera entre lectura e invalidación** (caso límite de la especificación). Se usa un contador
  de generación por barbería:
  1. **Lector:** lee la generación `G` (`GET …:gen`, ausente = 0); si no hay entrada, lee el
     catálogo de PostgreSQL y llama a `guardarSiGeneracion(entrada, gen, G, valor, ttl)`.
  2. **Guardado condicionado:** un script Lua escribe la entrada **solo si** la generación sigue
     siendo `G`. Es atómico en Redis.
  3. **Escritor, después de confirmar:** en un `MULTI`, `INCR …:gen` y `DEL` de la entrada.
  - Si el escritor confirma entre la lectura de PostgreSQL y el guardado, la generación ya es
    `G+1`, el guardado no ocurre y el siguiente lector lee el dato nuevo.
  - Si la invalidación se pierde (Redis caído en ese instante), el **tiempo máximo de vida** acota el
    dato viejo (FR-012, FR-021).
  - La clave de generación vive 24 h y se renueva con cada `INCR`; si expira, vale 0. Ninguna
    entrada vive más que el TTL, que es mucho menor.
- **Prueba de la carrera:** con `ajustar()` de `crearApp`, se sustituye el repositorio del catálogo
  por uno que espera una señal entre su lectura y su retorno. Mientras espera, el escritor confirma
  un cambio. Al liberarlo, la entrada no queda guardada y la siguiente visita trae el dato nuevo.

**TTL de la entrada**: **120 s** por defecto (`CACHE_CATALOGO_TTL_SEGUNDOS`, de 10 a 300). Una
lectura de PostgreSQL por barbería cada 2 minutos no pesa, y acota el peor caso de dato viejo muy
por debajo de los 5 minutos de FR-012.

**Alternativas descartadas**:

- Actualizar la caché con el valor nuevo al escribir: carrera conocida (estrategia de caché, §3).
- Invalidar dentro de la transacción: si se revierte, se borra sin motivo, y otro lector puede
  volver a guardar el dato viejo antes del `COMMIT`.
- Usar solo el TTL: no cumple SC-003 ("la siguiente visita muestra el cambio").
- Bloqueos distribuidos: más complejos que la generación, sin ventaja para esta carga.

## R09 · Límite de solicitudes compartido

**Decisión**:

- **Almacenamiento compartido.** `@nestjs/throttler` 6 acepta un `storage` propio que implementa
  `ThrottlerStorage.increment(key, ttl, limit, blockDuration, throttlerName)`. Se implementa
  `AlmacenLimitesCompartido` en M06 (`shared/limites/`):
  - construye `ClaveContador` = `rl:v1:` + la clave que ya calcula el guard (hash de controlador,
    ruta, nombre del límite e IP);
  - llama a `cache.contar(clave, ttl)`: un script Lua hace `INCR` y, si es el primero, `PEXPIRE`, y
    devuelve el total y el tiempo restante;
  - arma el `ThrottlerStorageRecord` (`totalHits`, `timeToExpire`, `isBlocked = total > limit`,
    `timeToBlockExpire`).
- **Respaldo por instancia.** Si `contar` devuelve `null` (Redis caído, tiempo límite o interruptor
  abierto), se delega en `ThrottlerStorageService`, el almacenamiento en memoria de
  `@nestjs/throttler`. Con Redis caído, el límite real es el configurado por cada instancia; el
  principio VIII acepta esa degradación. Al volver Redis, los contadores empiezan de cero, porque no
  son críticos.
- **Valores y respuesta:** se mantienen los límites actuales (general 300, vía pública 120,
  registro y activación 10, por IP y minuto), su configuración por variable de entorno y la
  respuesta 429 `DEMASIADOS_INTENTOS` (FR-018).
- **No se toca:** `IntentosRepository` (intentos de inicio de sesión) sigue en PostgreSQL. Una
  prueba comprueba que tras varios inicios de sesión fallidos no aparece en Redis ninguna clave
  relacionada con el correo ni con el inicio de sesión fuera de `rl:v1:*` (FR-017).

**Alternativas descartadas**:

- `@nest-lab/throttler-storage-redis`: una dependencia más, sin respaldo en memoria ni interruptor.
- Contar en Nginx (`limit_req`): es por proceso de Nginx, no conoce las rutas por nombre y
  duplicaría la configuración de los límites.
- Dividir el límite de respaldo entre el número de réplicas: complica la configuración para un caso
  degradado y temporal.

## R10 · Ajuste condicionado: caché de horarios calculados (FR-013b)

**Decisión**: queda diseñado, pero desactivado (`CACHE_HORARIOS_ACTIVA=false`). Solo se implementa
si la medición con el catálogo en caché no cumple la meta (Clarifications, P1).

- **Clave:**
  `bp:v1:t:{tenantId}:horarios:g{generacion}:{servicioId}:{fecha}:{barberoId|todos}`, con TTL de
  **30 s**.
- **Invalidación:** un `INCR` de `…:horarios:gen` por barbería, después de confirmar cualquiera de
  estos cambios:
  - en citas: `ReservarCita` (también la presencial), `CancelarCita` y `CambiarEstadoCita`;
  - en disponibilidad: `CrearBloqueo`, `EliminarBloqueo` y `ReemplazarDisponibilidad`;
  - en el catálogo: todos los de R08.
- **Por qué un `INCR` basta:** la generación forma parte de la clave, así que las entradas
  anteriores quedan inalcanzables al instante y expiran solas. No hace falta conocer todas las
  combinaciones de servicio, fecha y barbero para borrarlas.
- **Lectura:** `GET` de la generación y luego `GET` de la clave (dos idas a Redis, menos de 2 ms).
- **La reserva no cambia:** sigue usando la restricción de exclusión (principio IV).
- **Pruebas propias:** invalidación por cada caso de uso de la lista, desde la otra instancia, y
  aislamiento PR09. La decisión, con la medición antes y después, se agrega a ADR-029.

**Alternativa descartada**: borrar por patrón (`SCAN` + `DEL`), que es lento, no atómico y deja
carreras.

## R11 · Comportamiento con Redis caído (EQ-05)

**Decisión**: todo pasa por `CacheCompartida` con interruptor (R06).

| Función                           | Con Redis caído                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Catálogo                          | Se lee de PostgreSQL y no se intenta guardar                                                                                                                                               |
| Horarios                          | `fuenteCompleta`: una sola transacción pública que lee también el servicio, el horario de atención y los barberos (R07), como en 002 pero con el enlace resuelto en una transacción de M01 |
| Reservas, cancelaciones y estados | No usan Redis; solo la invalidación posterior falla en silencio                                                                                                                            |
| Límite de solicitudes             | Respaldo por instancia (R09)                                                                                                                                                               |
| Registros                         | Una línea `CACHE_NO_DISPONIBLE`                                                                                                                                                            |

- **Al volver Redis:** el interruptor se cierra solo. Las entradas que sobrevivieron a una caída de
  red (no a un reinicio, porque Redis no persiste) pueden estar viejas como máximo el TTL de 120 s
  (FR-021). Si la caída dura más que el TTL, ya expiraron.

## R12 · Límites de memoria en un equipo de 8 GB

**Decisión**: `deploy.resources.limits.memory`, que Compose v2 respeta sin Swarm, en cada servicio.

| Servicio                 | Límite          | Ajustes                                                                                                                                                                                                         |
| ------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`                     | 512 MB          | `shared_buffers` por defecto (128 MB), `max_connections=100`                                                                                                                                                    |
| `redis`                  | 64 MB           | `--maxmemory 48mb --maxmemory-policy allkeys-lru --save "" --appendonly no` (caché sin persistencia; si se llena, expulsa)                                                                                      |
| `nginx`                  | 32 MB           | `nginx/nginx.conf` propio con `worker_processes 1`: la plantilla de `conf.d` no puede fijar esa directiva y `-g` choca con la que ya define la imagen. Compose y el ayudante de pruebas montan el mismo archivo |
| `backend-1`, `backend-2` | 384 MB cada uno | `NODE_OPTIONS=--max-old-space-size=256`                                                                                                                                                                         |
| `preparar-backend`       | 1 GB            | Solo mientras compila y migra; luego termina y libera la memoria                                                                                                                                                |
| `frontend` (Vite)        | 512 MB          | —                                                                                                                                                                                                               |

- **Uso estable:** unos 1,9 GB, más el pico de 1 GB de la preparación, que ocurre antes de que
  arranquen las réplicas.
- **Conexiones a PostgreSQL:** con dos réplicas, son 2 × (10 de la aplicación + 10 públicas) = 40,
  bien por debajo de 100.
- **Docker Desktop (WSL 2):** se documenta que conviene asignarle al menos 3 GB. El archivo
  `.wslconfig` está en el perfil de Windows (disco C:), así que **no** se modifica: solo se indica.
- **Sin límites de CPU:** con CPU repartida a mano, la medición dependería del reparto y no del
  diseño. El hecho de que las réplicas compartan CPU se declara en los resultados (Assumptions de
  la especificación).

## R13 · Prueba de carga reproducible y demos de caída

**Decisión**: se amplían los scripts propios en `backend/scripts/`. No se descarga k6: sería otra
imagen y otra herramienta, y la medición debe ser comparable con la de 002.

- **`npm run medir:horarios`** (script existente) gana tres opciones:
  - `--url` (por defecto `http://localhost:3000/api/v1`, es decir, Nginx);
  - `--etiqueta` (nombre de la variante);
  - `--salida` (archivo JSON dentro de `tmp/`).

  Siembra los mismos datos (5 barberos y 60 citas), hace 10 rondas de 50 consultas simultáneas,
  informa p50, p95, máximo, estados y porcentaje de 5xx, cuenta cuántas respuestas atendió cada
  réplica (encabezado `X-Instancia`, R14) y limpia lo que creó.

- **Cuatro variantes** para separar el efecto de cada pieza (US5, escenario 2):

  | Variante | Réplicas | Caché del catálogo |
  | -------- | -------- | ------------------ |
  | A        | 1        | Inactiva           |
  | B        | 1        | Activa             |
  | C        | 2        | Inactiva           |
  | D        | 2        | Activa             |
  - Se pasa a una réplica con `docker compose stop backend-2`.
  - La caché se activa o desactiva con `CACHE_CATALOGO_ACTIVA` y
    `docker compose up -d --no-deps backend-1 backend-2`.
  - El límite de la vía pública se sube solo para la medición
    (`PUBLICO_LIMITE_POR_MINUTO=100000`), porque desde el equipo todas las solicitudes comparten IP
    (R04).
  - **Qué mide cada variante** (R07):
    - **A y C** (caché inactiva): las consultas usan `fuenteCompleta`, con 2 transacciones por
      consulta. Ya incluyen la mejora de M01 (enlace y datos de la barbería en una transacción), así
      que no equivalen exactamente a la medición de 002.
    - **B y D** (caché activa): el script hace un `GET /publico/{slug}` de precarga antes de las
      rondas, y las consultas usan `fuenteDelDia` (acierto).
  - **Cada variante se ejecuta dos veces** y se registran ambas, como en 002.
  - Si D no cumple los 800 ms, se evalúa R10 y se mide una variante E.

- **`npm run demo:caida -- --objetivo replica|redis`** (script nuevo, `scripts/demo-caida.ts`):
  - genera tráfico continuo por Nginx (unas 20 solicitudes por segundo, mezcla de catálogo y
    horarios) durante 60 s;
  - a los 15 s ejecuta `docker compose stop backend-2` (o `redis`) y a los 40 s,
    `docker compose up -d --no-deps` del mismo servicio;
  - informa por segundo las solicitudes, los errores y la réplica que atendió, el tiempo hasta que
    `backend-2` deja de recibir tráfico, el porcentaje de errores en la transición, la
    reincorporación y el p95 durante la caída;
  - con `redis`, también hace 20 reservas durante la caída y comprueba en la base que no hay
    duplicados.
  - Si la automatización falla en el equipo, la línea de corte 2 del backlog permite hacer la demo
    a mano con los mismos comandos, documentados en [quickstart.md](quickstart.md).
- **Ninguno corre en la integración continua.** Los resultados se registran en el quickstart y en
  la trazabilidad (FR-027).

## R14 · Identificar la réplica que respondió

**Decisión**:

- Variable `INSTANCIA_ID` (`backend-1` o `backend-2` en Compose). Si existe, el backend agrega el
  encabezado de respuesta **`X-Instancia`**.
- Si no existe (pruebas y despliegue real), no se envía. Nginx lo deja pasar sin cambios.
- No expone nada sensible: es el nombre lógico de la réplica, sin IP ni versión.

**Por qué**: es la única forma de demostrar el reparto y la salida de una réplica sin leer
registros.

## R15 · Pruebas: qué corre en CI y qué no

**En CI** (Testcontainers con PostgreSQL y Redis; Nginx en un contenedor para el balanceo):

| Prueba                          | Tipo                    | Qué demuestra                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claves-cache`                  | Unitaria                | No se construye una clave de barbería sin `TenantId`; prefijo y formato                                                                                                                                                                                                                                                                                   |
| `interruptor`                   | Unitaria                | Abre con 5 fallos, pausa de 10 s, semiabierto, cierra; reloj falso                                                                                                                                                                                                                                                                                        |
| `almacen-limites`               | Unitaria                | Usa la caché si responde; respaldo en memoria si devuelve `null`                                                                                                                                                                                                                                                                                          |
| `entrada-catalogo`              | Unitaria                | Formato desconocido o JSON roto → ausente                                                                                                                                                                                                                                                                                                                 |
| `cache-catalogo`                | Integración             | Fallo y acierto; invalidación por cada caso de uso de R08, comprobada desde una **segunda instancia** que comparte Redis; cambio revertido sin invalidar; carrera de R08; TTL. En `catalogo/horarios`: `fuenteDelDia` y `fuenteCompleta` dan los mismos horarios libres para los mismos datos (T035)                                                      |
| `aislamiento-cache` (PR09)      | Integración             | Dos barberías con nombres iguales; todas las claves de Redis contienen el tenant de su dueña; ningún valor contiene datos canario (correos, teléfonos de clientes y del personal, motivos de bloqueo); A deja el enlace `x` y B lo toma: `/publico/x` muestra B                                                                                           |
| `limite-compartido`             | Integración             | Dos instancias sobre el mismo Redis: N aceptadas en total, 429 después; otra IP no afectada; Redis detenido → límite por instancia; intentos de inicio de sesión sin claves en Redis                                                                                                                                                                      |
| `redis-caido` (PR05, funcional) | Integración             | Contenedor de Redis detenido: catálogo y horarios correctos, reservas correctas, interruptor abierto con una sola línea `CACHE_NO_DISPONIBLE`; Redis de nuevo → se usa sin reiniciar. Redis lento (`docker pause`): respuesta en menos de 1 s, el interruptor se abre y se recupera con `unpause`; sin entrada, los horarios usan `fuenteCompleta` (T045) |
| `salud-listo`                   | Integración             | 503 antes de las migraciones y 200 después; dos `migrarHastaLaUltima` en paralelo aplican cada migración una vez                                                                                                                                                                                                                                          |
| `balanceador`                   | Integración             | Nginx con la **misma configuración** del repositorio, delante de dos instancias en proceso. Ver el detalle abajo                                                                                                                                                                                                                                          |
| PR14                            | Arquitectura            | Regla `redis-confinado` y el resto sin cambios                                                                                                                                                                                                                                                                                                            |
| `SERVICIO_NO_DISPONIBLE`        | Frontend (Vitest + MSW) | La interfaz muestra el mensaje del 503 del balanceador                                                                                                                                                                                                                                                                                                    |

Detalle de `balanceador` (tal como quedó al implementar, 2026-10-22):

- Nginx alcanza las instancias por el túnel de `TestContainers.exposeHostPorts`.
- Comprueba que ambas instancias reciben tráfico (`X-Instancia`) y que Nginx no revela su versión.
- La sesión vale en ambas instancias, el cierre en una rige en la otra y los intentos de inicio de
  sesión se cuentan juntos.
- Un `X-Forwarded-For` falso no cambia la IP que ve la aplicación (la que usan el límite y la
  auditoría).
- Repite **PR16** a través de Nginx: 200 reservas simultáneas, 1 creada y 0 respuestas 5xx.

**Fuera de CI** (manuales, con comandos documentados): `medir:horarios` (PR01, cuatro variantes),
`demo:caida --objetivo replica` (PR04 con el entorno real) y `--objetivo redis` (PR05 con carga), y
el recorrido del entorno completo con `docker compose up -d`.

**Riesgo y respaldo — respaldo aplicado el 2026-10-22**:

- `exposeHostPorts` usa un contenedor auxiliar con SSH (imagen pequeña, también en D:). Con las dos
  instancias en marcha es estable (reparto, IP, sesión y PR16 pasaron en todas las corridas).
- **Con una instancia detenida, el túnel no se comporta como una red real:** acepta la conexión aunque
  la instancia ya no exista y la deja colgada o la cierra según el momento, y su reenvío emite errores
  no capturados (`AggregateError`) dentro de Jest. En dos corridas iguales, la caída de una instancia dio
  0 % y 50 % de errores; sin réplicas, Nginx tardó 30 s (su `proxy_read_timeout`) en responder el 503.
- **Por eso la caída de una réplica con tráfico (PR04) y el 503 sin réplicas (FR-007) se verifican con
  el entorno real de Docker Compose**, donde una réplica detenida rechaza la conexión al instante
  (T028 y quickstart.md §6). No se ejecutan las instancias como contenedores dentro de la prueba: eso
  sumaría imágenes, red y tiempo de CI para medir algo que Compose ya mide en condiciones reales.
- **Las conexiones** que llegan por el túnel aparecen como `loopback`, así que la prueba usa
  `PROXIES_CONFIABLES=loopback`. La prueba de encabezado falso sigue siendo válida, porque Nginx
  sobrescribe el encabezado.

## R16 · Documentación y nube

**Decisión**: [despliegue y escalabilidad](../../docs/02-arquitectura-software/despliegue-y-escalabilidad.md)
agrega una tabla de equivalencias. No se ejecuta nada en la nube.

| Local                     | Nube                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Nginx                     | Application Load Balancer, con comprobación activa de salud sobre `/api/v1/salud/listo` |
| `backend-1` y `backend-2` | Tareas o instancias del mismo contenedor                                                |
| Redis                     | ElastiCache for Redis (sin persistencia)                                                |
| `preparar-backend`        | Tarea de migración previa al despliegue                                                 |
| `PROXIES_CONFIABLES`      | Subred del balanceador                                                                  |

Sigue vigente la aclaración de ADR-006: **un balanceador no es alta disponibilidad**. Nginx local
es además un punto único de falla.
