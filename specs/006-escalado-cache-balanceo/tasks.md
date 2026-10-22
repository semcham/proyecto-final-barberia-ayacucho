---
description: 'Lista de tareas de la funcionalidad 006: escalabilidad y rendimiento de la plataforma'
---

# Tasks: Escalabilidad y rendimiento de la plataforma

**Input**: Documentos de diseño en `specs/006-escalado-cache-balanceo/`

**Prerequisites**:

- Diseño: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
  [data-model.md](data-model.md), [quickstart.md](quickstart.md).
- Contratos: [contracts/openapi.yaml](contracts/openapi.yaml),
  [contracts/cache-claves.md](contracts/cache-claves.md),
  [contracts/entorno-compose.md](contracts/entorno-compose.md).
- ADR (Aceptados el 2026-10-19):
  [ADR-029](../../docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-029-caché-compartida-con-claves-por-barbería-y-límite-general-compartido)
  y [ADR-030](../../docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-030-balanceo-local-con-nginx-como-representación-de-adr-006).
- Constitución 1.2.0.

**Tests**: OBLIGATORIAS (constitución, principio X). Cada historia incluye sus pruebas, que se
escriben primero y deben fallar antes de implementar. Esta funcionalidad toca:

- aislamiento entre barberías (**PR09**) en la caché;
- reservas simultáneas (**PR16**), repetida a través de Nginx con dos instancias;
- arquitectura (**PR14**): regla nueva `redis-confinado`;
- fallo de un servicio externo (Redis) con degradación probada (**PR05**).

No toca webhooks de pago.

**Organization**: tareas agrupadas por historia de usuario.

- **Prioridad:** US1 y US2 (P1) → US3 y US4 (P2) → US5 (P3).
- **Independencia:** la fase 2 deja el adaptador de caché, la configuración y los ayudantes de
  Redis y Nginx para las pruebas, así que cada historia se prueba sola.
- **Orden recomendado** (días 7–9): US1 (entorno y balanceo) y US2 (caché) el día 7, US3 y US4 el
  día 8, y US5 (medición) y el pulido el día 9.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: historia a la que pertenece (US1 a US5).
- Cada tarea indica la ruta exacta del archivo.

## Path Conventions

- **Ubicación (principio XII):** todo el código vive en `tecnologia/plataforma-barberias/`.
  - Backend: `tecnologia/plataforma-barberias/backend/src/`, con pruebas en
    `tecnologia/plataforma-barberias/backend/test/`, migraciones en `…/backend/migrations/` y
    scripts en `…/backend/scripts/`.
  - Frontend: `tecnologia/plataforma-barberias/frontend/src/`.
  - Entorno: `tecnologia/plataforma-barberias/docker-compose.yml` y
    `tecnologia/plataforma-barberias/nginx/templates/`.
- **Caché y límites:** viven en M06 (`shared/cache/`, `shared/limites/`). Solo `shared/cache/`
  importa `ioredis` (regla `redis-confinado`).
- **Claves:** solo `ClavesCache` construye claves de datos de barbería, con un `TenantId`. Ninguna
  clave se deriva del `slug` ([contracts/cache-claves.md](contracts/cache-claves.md)).
- **Invalidación:** siempre con `UnitOfWork.alConfirmar`, nunca dentro de la transacción.
- **Sin descargas a C::** toda instalación de npm usa
  `--cache D:\proyecto-final-barberia-ayacucho\tmp\npm-cache`, y esa carpeta se borra al terminar.
  Las imágenes de Docker quedan en los datos de Docker, que están en D:. Los archivos temporales van
  a `tmp/`, ignorada por git.
- Los identificadores R01–R16 remiten a [research.md](research.md); los FR y SC, a [spec.md](spec.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencia nueva, variables de entorno y carpetas.

- [X] T001 Instalar `ioredis` 5.4.2 con versión exacta en `tecnologia/plataforma-barberias/backend/package.json` y `package-lock.json` ([research.md](research.md) R05):
  - ejecutar `npm install ioredis@5.4.2 --save-exact --cache D:\proyecto-final-barberia-ayacucho\tmp\npm-cache` en `backend/`;
  - si hubiera un motivo para otra 5.x, como un aviso de seguridad, usar la más reciente con al menos 2 semanas de publicada y anotar el motivo en T055;
  - borrar `tmp/npm-cache` al terminar;
  - comprobar que no queda nada nuevo en `%LOCALAPPDATA%\npm-cache` por esta instalación.
- [X] T002 [P] Agregar a `tecnologia/plataforma-barberias/.env.example`, con comentarios, las variables de [data-model.md](data-model.md) §4:
  - `REDIS_URL`, `CACHE_CATALOGO_ACTIVA`, `CACHE_HORARIOS_ACTIVA`, `CACHE_CATALOGO_TTL_SEGUNDOS`, `CACHE_TIMEOUT_MS`, `CACHE_FALLOS_PARA_ABRIR`, `CACHE_PAUSA_MS`;
  - `PROXIES_CONFIABLES`, `INSTANCIA_ID`, `DB_POOL_APP_MAX`, `DB_POOL_PUBLICO_MAX`;
  - `RED_SUBRED`, `IP_NGINX`, `IP_BACKEND_1`, `IP_BACKEND_2`, `REDIS_PUERTO`.
- [X] T003 [P] Crear las carpetas `tecnologia/plataforma-barberias/backend/src/shared/cache/`, `tecnologia/plataforma-barberias/backend/src/shared/limites/`, `tecnologia/plataforma-barberias/backend/test/integration/escalado/` y `tecnologia/plataforma-barberias/nginx/templates/`, con `.gitkeep` donde queden vacías.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: configuración, puerto de caché con sus claves, interruptor y adaptador Redis,
`alConfirmar` y ayudantes de prueba. Todas las historias dependen de esta fase.

**⚠️ CRITICAL**: ninguna historia empieza hasta terminar esta fase.

### Pruebas de la base (primero, deben fallar)

- [X] T004 [P] Pruebas unitarias de las claves en `tecnologia/plataforma-barberias/backend/test/unit/shared/claves-cache.spec.ts` (FR-014):
  - `ClavesCache.catalogoPublico(TenantId)` produce `bp:v1:t:{uuid}:catalogo-publico`, y `generacionCatalogo`, `…:catalogo-publico:gen`;
  - no existe forma de crear una `ClaveCache` sin `TenantId`: constructor privado, y `ClavesCache` no acepta `string` (comprobación de tipos con `// @ts-expect-error` y error en tiempo de ejecución si llega un valor que no es `TenantId`);
  - toda clave empieza por `bp:v1:` y ninguna contiene texto libre (`slug`).
- [X] T005 [P] Pruebas unitarias del interruptor en `tecnologia/plataforma-barberias/backend/test/unit/shared/interruptor.spec.ts`, con reloj falso (R06):
  - sigue cerrado con 4 fallos y se abre con el 5.º seguido;
  - un éxito reinicia la cuenta;
  - abierto, no llama a la operación durante `pausaMs`;
  - al vencer la pausa pasa a semiabierto: un éxito lo cierra y un fallo lo reabre;
  - avisa `abierto` y `recuperado` una sola vez por transición.
- [X] T006 [P] Integración de la confirmación en `tecnologia/plataforma-barberias/backend/test/integration/shared/al-confirmar.spec.ts` (necesita una transacción real de PostgreSQL de Testcontainers; `unit-of-work.spec.ts` ya existe desde 001 y no se toca):
  - `alConfirmar` ejecuta las acciones solo después del `COMMIT` de la transacción más externa;
  - con un error o un `ROLLBACK`, no las ejecuta;
  - llamado dentro de una transacción anidada (mismo tenant), espera a la externa;
  - si una acción falla, se registra y no cambia el resultado del caso de uso;
  - fuera de una transacción, lanza un error.

### Implementación de la base

- [X] T007 Ampliar `Configuracion` en `tecnologia/plataforma-barberias/backend/src/shared/config/configuracion.ts` con las variables de [data-model.md](data-model.md) §4, validadas al arrancar con los rangos de esa tabla:
  - `redisUrl` es opcional; `cache.catalogoActiva`, `cache.horariosActiva`, `cache.ttlCatalogoSegundos`, `cache.timeoutMs`, `cache.fallosParaAbrir`, `cache.pausaMs`;
  - `proxiesConfiables` (por defecto `loopback`), `instanciaId` (opcional, `^[a-z0-9-]{1,32}$`), `pools.appMax`, `pools.publicoMax`;
  - sus casos en `tecnologia/plataforma-barberias/backend/test/unit/shared/configuracion.spec.ts`.
- [X] T008 [P] Hacer configurable el tamaño de los pools:
  - `crearBaseDeDatos` en `tecnologia/plataforma-barberias/backend/src/shared/persistence/database.ts` y donde se construye en `tecnologia/plataforma-barberias/backend/src/shared/shared.module.ts` usan `pools.appMax`;
  - `LecturaPublica.conectar` en `tecnologia/plataforma-barberias/backend/src/shared/persistence/lectura-publica.ts`, llamado desde `catalogo-publico.repository.ts`, usa `pools.publicoMax`;
  - los valores por defecto (10) no cambian el comportamiento actual.
- [X] T009 Agregar `alConfirmar(accion: () => Promise<void> | void)`:
  - abstracto en `tecnologia/plataforma-barberias/backend/src/shared/persistence/unit-of-work.ts`;
  - implementado en `tecnologia/plataforma-barberias/backend/src/shared/persistence/kysely-unit-of-work.ts`: guarda la lista en el almacén de la transacción más externa, la ejecuta tras `execute()` resuelto y la descarta si se rechaza;
  - un error se registra con `Logger` y no se propaga;
  - hace pasar T006.
- [X] T010 [P] Crear las claves en `tecnologia/plataforma-barberias/backend/src/shared/cache/claves-cache.ts` ([contracts/cache-claves.md](contracts/cache-claves.md) §2):
  - `ClaveCache` y `ClaveGeneracion` (constructores privados) y la fábrica `ClavesCache` con `catalogoPublico`, `generacionCatalogo`, `horarios` y `generacionHorarios`, todas con `TenantId`;
  - `ClaveContador.desde(hashDelLimite)`, con prefijo `rl:v1:`;
  - hace pasar T004.
- [X] T011 [P] Crear el interruptor en `tecnologia/plataforma-barberias/backend/src/shared/cache/interruptor.ts`:
  - clase pura con `Clock` inyectado, `ejecutar<T>(op, siAbierto)` y eventos `alAbrir` y `alRecuperar`;
  - sin dependencias externas;
  - hace pasar T005.
- [X] T012 Crear el puerto `CacheCompartida` en `tecnologia/plataforma-barberias/backend/src/shared/cache/cache-compartida.ts` con `obtener`, `guardarSiGeneracion`, `leerGeneracion`, `invalidar` y `contar`:
  - recibe `ClaveCache`, `ClaveGeneracion` y `ClaveContador`, nunca `string`;
  - el contrato de "ausente" y `null` sigue [contracts/cache-claves.md](contracts/cache-claves.md) §5;
  - implementar también `CacheInactiva`, que siempre da ausente o `null` y nunca falla, en `tecnologia/plataforma-barberias/backend/src/shared/cache/cache-inactiva.ts`.
- [X] T013 Crear el adaptador `RedisCacheCompartida` en `tecnologia/plataforma-barberias/backend/src/shared/cache/redis-cache-compartida.ts`:
  - `ioredis` con `commandTimeout = cache.timeoutMs`, `enableOfflineQueue: false`, `maxRetriesPerRequest: 0`, `lazyConnect` y `retryStrategy` con espera creciente hasta 2 s;
  - los tres scripts Lua de [contracts/cache-claves.md](contracts/cache-claves.md) §4 con `defineCommand`;
  - valores JSON con campo `v`: ilegible u otra versión equivale a ausente (FR-015);
  - toda operación pasa por el `Interruptor`, que registra `CACHE_NO_DISPONIBLE` y `CACHE_RECUPERADA` una sola vez por transición;
  - cierra la conexión en `onModuleDestroy`.
- [X] T014 Registrar la caché en `tecnologia/plataforma-barberias/backend/src/shared/shared.module.ts` y exportarla en `tecnologia/plataforma-barberias/backend/src/shared/index.ts`:
  - fábrica de `CacheCompartida`: `RedisCacheCompartida` si hay `redisUrl` y `CacheInactiva` si no;
  - exportar `CacheCompartida`, `ClavesCache`, `ClaveCache`, `ClaveGeneracion` y `ClaveContador` (no el adaptador Redis).
- [X] T015 [P] Agregar la regla `redis-confinado` en `tecnologia/plataforma-barberias/backend/.dependency-cruiser.cjs`:
  - `ioredis` solo puede importarse desde `src/shared/cache/`;
  - agregar el caso de violación en el fixture de `tecnologia/plataforma-barberias/backend/test/architecture/` (archivo de módulo que importa `ioredis`), con su verificación en la prueba de PR14.
- [X] T016 [P] Ayudante de Redis para las pruebas en `tecnologia/plataforma-barberias/backend/test/helpers/redis.ts`:
  - `iniciarRedis()` con `GenericContainer('redis:7.4-alpine')`, el mismo comando sin persistencia de [research.md](research.md) R12, que fija `REDIS_URL`;
  - `detener()`, `reiniciar()`, `vaciar()` (`FLUSHALL`), `claves(patron)` y `valores()` para inspeccionar.
  - Usa `testcontainers`, que ya está instalado.
- [X] T017 [P] Ampliar `crearApp` en `tecnologia/plataforma-barberias/backend/test/helpers/app.ts`:
  - opción `escuchar: true`, que levanta la aplicación en un puerto libre de `127.0.0.1` y devuelve `puerto`, para las pruebas con dos instancias y con Nginx;
  - opción `entorno`, que fija variables antes de construir el módulo (`INSTANCIA_ID`, `CACHE_*`) y las restaura al cerrar.

**Checkpoint**: la caché, la configuración y los ayudantes funcionan. Las suites de 001 y 002 siguen
en verde sin `REDIS_URL` (usan `CacheInactiva`).

---

## Phase 3: User Story 1 - El servicio sigue si cae una instancia (Priority: P1) 🎯 MVP

**Goal**: Nginx delante de dos réplicas idénticas, con salud, migraciones una sola vez, IP real del
cliente, 503 claro sin réplicas y PR16 a través del balanceador (FR-001 a FR-007, FR-026).

**Independent Test**: con dos instancias detrás de Nginx, enviar tráfico continuo, cerrar una y
medir los errores de la transición; volver a levantarla y comprobar que recibe tráfico; repetir
PR16 por Nginx.

### Tests for User Story 1 (MANDATORY - constitution Principle X) ⚠️

- [ ] T018 [P] [US1] Ayudante de Nginx para las pruebas en `tecnologia/plataforma-barberias/backend/test/helpers/nginx.ts`:
  - `iniciarNginx({ backends: [puerto1, puerto2] })` con `GenericContainer('nginx:1.27-alpine')` y el mismo comando que Compose (`nginx -g "daemon off; worker_processes 1;"`);
  - copia **la plantilla del repositorio** (`nginx/templates/default.conf.template`) y fija `BACKEND_1` y `BACKEND_2` a `host.testcontainers.internal:{puerto}` mediante `TestContainers.exposeHostPorts`;
  - devuelve la URL publicada.
  - Si `exposeHostPorts` es inestable, aplicar el respaldo de [research.md](research.md) R15 y dejarlo anotado en la tarea.
- [ ] T019 [P] [US1] Integración de salud en `tecnologia/plataforma-barberias/backend/test/integration/escalado/salud-listo.spec.ts` (FR-004):
  - con una base sin la migración `0013`, `GET /salud/listo` responde 503, y tras migrar, 200 `{ estado: 'listo' }`;
  - con la base caída, 503;
  - sin Redis (`CacheInactiva`) sigue en 200;
  - dos `migrarHastaLaUltima` en paralelo sobre una base vacía terminan sin error y cada migración aparece una sola vez en `kysely_migration`;
  - `/salud/listo` no tiene límite de solicitudes.
- [ ] T020 [P] [US1] Integración del balanceador en `tecnologia/plataforma-barberias/backend/test/integration/escalado/balanceador.spec.ts`: dos instancias en proceso con `INSTANCIA_ID` distinto y `PROXIES_CONFIABLES=loopback`, detrás de Nginx (T018). Casos:
  - **Reparto:** 20 `GET /salud` por Nginx devuelven `X-Instancia` `backend-1` y `backend-2`, y el cuerpo es igual en todas (escenario 1).
  - **PR04:** con tráfico continuo de GET (unas 20 por segundo), cerrar una instancia. En la ventana de transición, como máximo el 2 % de errores; a partir de 15 s del cierre, 0 % de errores y todas las respuestas de la otra instancia. Al levantarla de nuevo en el mismo puerto, vuelve a recibir tráfico sin intervención, y entre el nuevo arranque y el fin de la prueba hay **0 %** de errores: el alta no pierde solicitudes (escenarios 2 y 3; SC-002).
  - **Sesión entre instancias:** iniciar sesión en una instancia y usar el token en la otra; cerrar sesión en una y comprobar 401 en la otra; los intentos fallidos de inicio de sesión se cuentan en conjunto (escenario 4).
  - **IP real (FR-006):** una solicitud con `X-Forwarded-For: 203.0.113.9` queda auditada o limitada con la IP que entrega Nginx, no con `203.0.113.9`.
  - **Sin réplicas (FR-007):** con ambas cerradas, 503 con cuerpo `{ codigo: 'SERVICIO_NO_DISPONIBLE', … }` y `Retry-After` en menos de 3 s (escenario 6).
  - **PR16 por Nginx (FR-026, SC-007):** 200 `POST /citas` simultáneos (mismo barbero y hora, `Idempotency-Key` distintas) a través de Nginx dan 1 × 201, 199 × 409 `HORARIO_NO_DISPONIBLE`, 0 × 5xx y 1 cita activa en la base. Reutiliza la siembra de `test/integration/citas/concurrencia-reservas.spec.ts`.
- [ ] T021 [P] [US1] Prueba del frontend en `tecnologia/plataforma-barberias/frontend/test/api/servicio-no-disponible.test.tsx` (Vitest + MSW):
  - un 503 con `codigo: 'SERVICIO_NO_DISPONIBLE'` llega como `ApiError` con su mensaje;
  - la página pública muestra ese mensaje, no "Ocurrió un error inesperado".
  - Si hace falta, ajustar `tecnologia/plataforma-barberias/frontend/src/api/client.ts` solo lo necesario.

### Implementation for User Story 1

- [ ] T022 [US1] Crear la migración `tecnologia/plataforma-barberias/backend/migrations/0013_salud_listo.ts`:
  - `GRANT SELECT ON kysely_migration TO barberias_app` y, en `down`, `REVOKE`;
  - registrarla en el proveedor de `tecnologia/plataforma-barberias/backend/migrations/index.ts`.
- [ ] T023 [US1] Agregar `VerificadorMigraciones` en `tecnologia/plataforma-barberias/backend/src/shared/persistence/database.ts`, exportado en `shared/index.ts`:
  - compara el nombre máximo en `kysely_migration` con la última migración de `ProveedorDeMigraciones`;
  - devuelve `false` ante un error de permisos o de conexión;
  - recuerda el `true` (las migraciones no se deshacen), pero sigue consultando la base en cada llamada.
- [ ] T024 [US1] Agregar `GET /salud/listo` en `tecnologia/plataforma-barberias/backend/src/host/salud.controller.ts` según [contracts/openapi.yaml](contracts/openapi.yaml):
  - `@Publica()` y `@SkipThrottle()`;
  - 200 `{ estado: 'listo' }` o 503;
  - registrar `VerificadorMigraciones` en el módulo;
  - hace pasar T019.
- [ ] T025 [US1] Cambiar `configurarApp` en `tecnologia/plataforma-barberias/backend/src/main.ts`:
  - `app.set('trust proxy', configuracion.proxiesConfiables)`, en lugar del valor fijo con `uniquelocal` (R04);
  - si hay `instanciaId`, un middleware agrega `X-Instancia` a toda respuesta (R14).
  - Las pruebas existentes que simulan IP desde `loopback` (`limite-intentos`, `entradas`) deben seguir en verde.
- [ ] T026 [US1] Crear la plantilla de Nginx `tecnologia/plataforma-barberias/nginx/templates/default.conf.template` según [contracts/entorno-compose.md](contracts/entorno-compose.md) §2:
  - `upstream api` con `${BACKEND_1}` y `${BACKEND_2}`, cada uno con `max_fails=1 fail_timeout=10s`, y `keepalive 16`;
  - `location /api/`: `proxy_pass`, `proxy_http_version 1.1`, `proxy_set_header X-Forwarded-For $remote_addr`, `X-Real-IP $remote_addr`, `Host` y `X-Forwarded-Proto`;
  - tiempos: `proxy_connect_timeout 1s`, `proxy_read_timeout 30s`, `proxy_next_upstream error timeout http_502 http_503`, `proxy_next_upstream_tries 2`, `proxy_next_upstream_timeout 3s`;
  - `client_max_body_size 16k` y `server_tokens off`. `worker_processes 1` no va en la plantilla: lo fija el comando del contenedor (`nginx -g "daemon off; worker_processes 1;"`), en T027 y en el ayudante T018;
  - `error_page 502 503 504 = @sin_servicio`, que devuelve 503 JSON `SERVICIO_NO_DISPONIBLE` con `Retry-After: 5` y `default_type application/json`;
  - `location = /nginx-salud` devuelve 200, y todo lo demás, 404.
  - Hace pasar T020 junto con T024 y T025.
- [ ] T027 [US1] Reescribir `tecnologia/plataforma-barberias/docker-compose.yml` según [contracts/entorno-compose.md](contracts/entorno-compose.md) §1 (R01, R12):
  - red `plataforma` con `ipam` (`${RED_SUBRED:-172.28.0.0/24}`);
  - `db` con límite de 512 MB;
  - `redis` (`redis:7.4-alpine`, `--maxmemory 48mb --maxmemory-policy allkeys-lru --save "" --appendonly no`, healthcheck `redis-cli ping`, 64 MB, puerto `${REDIS_PUERTO:-6380}`);
  - `preparar-backend` (`npm ci && npm run build && npm run migrate`, `restart: "no"`, 1 GB);
  - ancla `x-backend` para `backend-1` y `backend-2`: `node dist/src/main.js`, IP fijas, sin puertos, `depends_on` con `preparar-backend: service_completed_successfully` y `db: service_healthy` (**sin** dependencia de `redis`: el backend arranca y queda listo sin Redis, FR-019), healthcheck `node -e "fetch('http://localhost:3000/api/v1/salud/listo').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"` (5 s, 2 s, 3 reintentos, `start_period` 20 s), 384 MB, y las variables de entorno-compose §1;
  - `nginx` (`nginx:1.27-alpine`, `command: ["nginx", "-g", "daemon off; worker_processes 1;"]`, plantilla montada en `/etc/nginx/templates`, `BACKEND_1` y `BACKEND_2` con las IP fijas, puerto `3000:80`, `depends_on` con ambas réplicas sanas, healthcheck `/nginx-salud`, 32 MB);
  - `frontend` con `VITE_API_PROXY=http://nginx:80` y 512 MB;
  - actualizar el comentario de cabecera del archivo, que hoy dice "Sin Redis".
- [ ] T028 [US1] Verificar a mano el entorno real y anotar el resultado para el quickstart:
  - `docker compose up -d` y `docker compose ps`: `preparar-backend` sale con 0; réplicas y Nginx quedan `healthy`;
  - `docker compose logs preparar-backend` muestra `0013` aplicada una vez;
  - `http://localhost:3000/api/v1/salud/listo` y `http://localhost:5173` responden;
  - el reparto por `X-Instancia` (quickstart §3.1);
  - `docker stats --no-stream`: el uso estable queda por debajo de unos 2 GB;
  - con `docker compose stop redis` antes de `docker compose up -d --force-recreate backend-1 backend-2`, las réplicas arrancan y quedan `healthy` sin Redis.

**Checkpoint**: el balanceo funciona y se demuestra solo, sin depender de la caché (US2).

---

## Phase 4: User Story 2 - El catálogo público responde rápido, actualizado y sin mezclar barberías (Priority: P1)

**Goal**: catálogo público en la caché compartida por barbería, enlace resuelto en una transacción
de M01, invalidación tras confirmar desde cualquier instancia, sin carreras y con aislamiento PR09
(FR-008 a FR-015, FR-022, FR-023).

**Independent Test**: dos barberías con catálogos distintos; visitar sus enlaces y ver claves
`bp:v1:t:{uuid}:catalogo-publico`; cambiar cada dato de la matriz y comprobarlo desde la otra
instancia; ninguna fuga entre barberías.

### Tests for User Story 2 (MANDATORY - constitution Principle X) ⚠️

- [ ] T029 [P] [US2] Prueba unitaria de la entrada en `tecnologia/plataforma-barberias/backend/test/unit/catalogo/entrada-catalogo.spec.ts`:
  - serializar y leer una entrada `v: 1` con sus campos ([data-model.md](data-model.md) §2.1);
  - otra versión o un JSON ilegible equivale a ausente;
  - la entrada no admite campos fuera de la lista: un objeto con `telefono` de un cliente o el `reason` de un bloqueo no se serializa.
- [ ] T030 [P] [US2] Integración de M01 en `tecnologia/plataforma-barberias/backend/test/integration/barberias/barberias-api.spec.ts` (ampliar):
  - `barberiaPublicaPorEnlace(slug)` devuelve `tenantId` y los datos públicos en **una** transacción;
  - un enlace inexistente, mal formado o de una barbería suspendida da `BarberiaNoDisponible`, igual que `resolverSlugPublico`;
  - tras cambiar el enlace, el anterior da `BarberiaNoDisponible` al instante.
- [ ] T031 [P] [US2] Integración de la caché del catálogo en `tecnologia/plataforma-barberias/backend/test/integration/escalado/cache-catalogo.spec.ts`: dos instancias (A y B) sobre el mismo PostgreSQL y el mismo Redis (T016, T017). Casos:
  - **Fallo y acierto:** la primera visita por A lee la base y crea `bp:v1:t:{id}:catalogo-publico`; la segunda, por B, no lee el catálogo de la base (espía en el puerto `CatalogoPublicoQuery`) y devuelve el mismo cuerpo (escenarios 1 y 2).
  - **Matriz (FR-023, SC-003):** para cada fila con ✓ en la columna "Catálogo" de [contracts/cache-claves.md](contracts/cache-claves.md) §3 (crear servicio, editar precio, desactivar y reactivar servicio, crear barbero, cambiar nombre, desactivar barbero, cambiar servicios asignados, reemplazar horario de atención), hacer el cambio por A con la sesión del propietario y comprobar por B que la visita siguiente lo muestra. Se genera desde la tabla para que una fila nueva sin caso haga fallar la prueba.
  - **Enlace:** `ActualizarBarberia` cambia nombre o enlace y la visita siguiente, por B, ya los refleja; el enlace anterior da 404 `BARBERIA_NO_DISPONIBLE` (escenario 4).
  - **Revertido:** un cambio que falla a mitad, sustituyendo un repositorio con `ajustar()` para que lance después de escribir, no invalida, y la entrada sigue igual (escenario 5).
  - **Carrera (R08):** un repositorio sustituido se detiene entre su lectura y su retorno; mientras espera, el propietario confirma un cambio; al liberarlo, la entrada **no** queda guardada, y la visita siguiente trae el dato nuevo.
  - **TTL:** con `CACHE_CATALOGO_TTL_SEGUNDOS=10`, la clave tiene un TTL de 10 s o menos.
  - **Horarios:** con la entrada en caché, crear una cita o un bloqueo cambia los horarios libres en la visita siguiente, porque se leen vigentes (escenario 9).
  - **Desactivada:** con `CACHE_CATALOGO_ACTIVA=false` no se escribe ninguna clave `bp:v1:*`.
  - **Contrato:** la respuesta de `GET /publico/{slug}` sigue validando contra el esquema de 002, en ambas variantes.
- [ ] T032 [P] [US2] **PR09** de la caché en `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/aislamiento-cache.spec.ts` (FR-022, SC-004):
  - Barberías A y B con servicios y barberos de **nombres iguales**, sembradas con datos canario: correos y teléfonos únicos de clientes y del personal, motivos de bloqueo y nombres de clientes en citas.
  - Tras visitar ambos enlaces y sus horarios: cada clave `bp:v1:t:*` contiene el `tenantId` de la barbería cuyos datos guarda (se compara el contenido con la base); ninguna clave contiene un `slug`; ningún valor en Redis contiene un dato canario.
  - `/publico/{slug-A}` nunca devuelve ids de servicios ni barberos de B.
  - **Enlace reutilizado:** A cambia su enlace de `x` a `y` y B toma `x`; `/publico/x` muestra el catálogo de B y `/publico/y`, el de A, por ambas instancias.
  - **Enlace inexistente:** 50 consultas a enlaces inexistentes no crean ninguna clave (FR-009).

### Implementation for User Story 2

- [ ] T033 [US2] Agregar `barberiaPublicaPorEnlace(slug): Promise<{ tenantId: TenantId; barberia: DatosPublicosBarberia }>` en M01:
  - método abstracto en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/api-publica.ts`;
  - implementación en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/application/barberias-api.ts`: misma validación de formato que `resolverSlugPublico`, una sola `ejecutarSinTenant`;
  - consulta única `datosPublicosPorSlug` (barbería activa por enlace, con columnas públicas) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/application/ports/tenant-repository.ts` y `…/infrastructure/kysely-tenant-repository.ts`;
  - `resolverSlugPublico` y `datosPublicos` se mantienen para el registro, el inicio de sesión y el cambio de barbería;
  - hace pasar T030.
- [ ] T034 [US2] Crear el puerto `CatalogoPublicoQuery` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/ports/catalogo-publico-query.ts`:
  - `catalogo(tenantId): Promise<CatalogoPublicoDatos>` (mueve aquí la interfaz `CatalogoPublicoDatos`);
  - `fuenteDelDia(tenantId, catalogo): FuenteDisponibilidad`, una fuente que toma el servicio, el horario de atención y los barberos candidatos del `catalogo` recibido y lee de la base solo la disponibilidad semanal, los bloqueos y las citas del día, en **una** transacción;
  - `fuenteCompleta(tenantId): FuenteDisponibilidad`, una fuente que lee todo (servicio, horario de atención, barberos candidatos, disponibilidad, bloqueos y citas) en **una sola** transacción. Se usa cuando no hay entrada en caché: caché desactivada, fallo o Redis caído ([research.md](research.md) R07 y R11).
- [ ] T035 [US2] Adaptar `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/infrastructure/publico/catalogo-publico.repository.ts` para que implemente `CatalogoPublicoQuery`:
  - `fuenteDelDia` con una transacción `LecturaPublica` y tres consultas (`working_hours`, `time_off` y `appointment`, columnas de ADR-021);
  - candidatos en el mismo orden que hoy (nombre e id);
  - `fuenteCompleta` es el actual `fuente(tenantId)` (`leerDia` con 6 consultas en una transacción), renombrado; actualizar sus usos en las pruebas;
  - una prueba en `tecnologia/plataforma-barberias/backend/test/integration/catalogo/horarios.spec.ts` (ampliar) comprueba que ambas fuentes dan los mismos horarios libres para los mismos datos.
- [ ] T036 [US2] Crear `ObtenerCatalogoPublico` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/obtener-catalogo-publico.ts`:
  - **cache-aside con generación** (R08): `obtener` → si está ausente, `leerGeneracion` → `CatalogoPublicoQuery.catalogo` → `guardarSiGeneracion` con el TTL de la configuración;
  - con `cache.catalogoActiva=false`, va directo a la consulta;
  - agrega `soloDesdeCache(tenantId): Promise<CatalogoPublicoDatos | null>`, que lee la entrada sin llenarla. Devuelve `null` si la caché está desactivada, si hay un fallo o si Redis está caído. Lo usan los horarios;
  - la serialización de la entrada `v: 1` con lista cerrada de campos, en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/entrada-catalogo.ts`;
  - hace pasar T029.
- [ ] T037 [US2] Crear `InvalidadorCatalogoPublico` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/invalidador-catalogo-publico.ts`:
  - `catalogoCambio(tenantId)` hace `uow.alConfirmar(() => cache.invalidar(ClavesCache.catalogoPublico(t), ClavesCache.generacionCatalogo(t)))`.
- [ ] T038 [US2] Llamar al invalidador dentro de la transacción de cada caso de uso de la matriz:
  - `CrearServicio` y `ActualizarServicio` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/servicios.ts`;
  - `CrearBarbero` y `ActualizarBarbero` en `…/catalogo/application/barberos.ts`;
  - `ReemplazarHorarioAtencion` en `…/catalogo/application/horarios.ts`.
  - **No** llamarlo desde `ReemplazarDisponibilidad` ni desde los bloqueos (fuera de la entrada).
- [ ] T039 [US2] Cambiar `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/presentation/publico.controller.ts`:
  - `barberiaDelEnlace` usa `barberiaPublicaPorEnlace` (una transacción);
  - `GET :slug` devuelve `{ barberia, ...await obtenerCatalogo.ejecutar(tenantId) }`;
  - `GET :slug/horarios`: si `soloDesdeCache(tenantId)` devuelve la entrada, pasa `repositorio.fuenteDelDia(tenantId, entrada)` a `ConsultarHorarios`; si no, `repositorio.fuenteCompleta(tenantId)`. Siempre es una sola transacción pública, además de la de M01;
  - el contrato de 002 no cambia.
- [ ] T040 [US2] Registrar `CatalogoPublicoQuery` (con `useExisting` del repositorio), `ObtenerCatalogoPublico` e `InvalidadorCatalogoPublico` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo-citas.module.ts`.
  - Ejecutar la suite de 002 (`lectura-publica`, `publico.contract`, `horarios`, `rbac-002`, `entradas`) y comprobar que sigue en verde.
  - Hace pasar T031 y T032.

**Checkpoint**: catálogo en caché, invalidado y aislado; la vía pública conserva su contrato.

---

## Phase 5: User Story 3 - El límite de solicitudes por IP es el mismo con una o dos instancias (Priority: P2)

**Goal**: contadores del límite general por IP en Redis, compartidos entre réplicas, con respaldo
por instancia; los intentos de inicio de sesión siguen en PostgreSQL (FR-016 a FR-018).

**Independent Test**: dos instancias sobre el mismo Redis con un límite bajo; una IP envía el doble
del límite repartido entre ambas y solo pasan N.

### Tests for User Story 3 (MANDATORY - constitution Principle X) ⚠️

- [ ] T041 [P] [US3] Prueba unitaria del almacenamiento en `tecnologia/plataforma-barberias/backend/test/unit/shared/almacen-limites.spec.ts`, con caché falsa:
  - si `contar` responde, arma `totalHits`, `timeToExpire`, `isBlocked = total > limit` y `timeToBlockExpire`;
  - si devuelve `null`, delega en el almacenamiento en memoria;
  - la clave pasada a la caché es `rl:v1:` más la clave del guard, sin tenant.
- [ ] T042 [P] [US3] Integración del límite compartido en `tecnologia/plataforma-barberias/backend/test/integration/escalado/limite-compartido.spec.ts`: dos instancias sobre el mismo Redis, con `PUBLICO_LIMITE_POR_MINUTO=10`. Casos:
  - **Compartido:** 20 `GET /publico/{slug}` desde la misma IP (`X-Forwarded-For` desde `loopback`), alternando instancias, dan exactamente 10 aceptadas y 10 × 429 `DEMASIADOS_INTENTOS` con tiempo de espera (escenario 1; SC-006).
  - **Otra IP:** no se ve afectada (escenario 3).
  - **Ventana:** con un TTL de prueba corto, pasada la ventana vuelve a ser atendida (escenario 2).
  - **Redis detenido:** cada instancia aplica el límite por su cuenta, hasta 10 por instancia, sin 5xx (US4, escenario 4).
  - **Formularios abiertos (FR-016):** con `REGISTRO_LIMITE_POR_MINUTO=4`, 8 `POST /clientes/registro` desde la misma IP, alternando instancias, dan como máximo 4 respuestas que no son 429, y el resto, 429.
  - **Sin Redis para los intentos (FR-017):** tras 5 inicios de sesión fallidos, el bloqueo de `limite-intentos` rige en ambas instancias y en Redis no hay ninguna clave fuera de `rl:v1:*` y `bp:v1:*`.

### Implementation for User Story 3

- [ ] T043 [US3] Crear `AlmacenLimitesCompartido implements ThrottlerStorage` en `tecnologia/plataforma-barberias/backend/src/shared/limites/almacen-limites-compartido.ts`:
  - recibe `CacheCompartida` y una instancia de `ThrottlerStorageService` (memoria) como respaldo;
  - cumple la firma `increment(key, ttl, limit, blockDuration, throttlerName)` de `@nestjs/throttler` 6;
  - exportarlo en `tecnologia/plataforma-barberias/backend/src/shared/index.ts`;
  - hace pasar T041.
- [ ] T044 [US3] Configurar `ThrottlerModule.forRootAsync` en `tecnologia/plataforma-barberias/backend/src/host/app.module.ts`:
  - mismos límites (`general` de 300 por 60 s) y `storage: AlmacenLimitesCompartido`;
  - actualizar el comentario "Freno general por instancia" para decir que es compartido, con respaldo por instancia (ADR-029);
  - comprobar que los `@Throttle` de `publico`, `clientes`, `barberias` y `auth` siguen funcionando;
  - hace pasar T042.

**Checkpoint**: el límite es el mismo con una o dos réplicas, y el inicio de sesión no cambia.

---

## Phase 6: User Story 4 - La plataforma sigue funcionando si la caché cae (Priority: P2)

**Goal**: con Redis caído, el catálogo, los horarios y las reservas siguen correctos, el límite pasa
a ser por instancia, queda una sola alerta y se recupera sin reiniciar (FR-019 a FR-021, PR05).

**Independent Test**: detener Redis con tráfico, verificar respuestas correctas y una sola línea
`CACHE_NO_DISPONIBLE`; volver a iniciarlo y ver claves `bp:v1:*` de nuevo.

### Tests for User Story 4 (MANDATORY - constitution Principle X) ⚠️

- [ ] T045 [P] [US4] **PR05** funcional en `tecnologia/plataforma-barberias/backend/test/integration/escalado/redis-caido.spec.ts`: una instancia con Redis (T016), con `CACHE_FALLOS_PARA_ABRIR=5` y `CACHE_PAUSA_MS=1000`. Casos:
  - **Lecturas sin Redis:** con Redis detenido, `GET /publico/{slug}` y `/horarios` responden 200 con los datos correctos (iguales a los de la base), cada una en menos de 2 s (escenario 1).
  - **Escrituras sin Redis:** reservar, cancelar y cambiar estado dan los mismos resultados que con Redis, y la doble reserva sigue dando 409 (escenario 2).
  - **Cambio durante la caída:** un cambio del catálogo durante la caída se guarda; al volver Redis, la entrada vieja que pudiera quedar no sobrevive al TTL de prueba (escenario 3; FR-021).
  - **Una sola alerta:** tras más de 5 solicitudes, una sola línea `CACHE_NO_DISPONIBLE` en el `Logger` (espía) y ninguna solicitud tarda el tiempo límite estando abierto el interruptor (escenario 5).
  - **Recuperación:** con Redis de nuevo, tras la pausa vuelve a escribir `bp:v1:*` sin reiniciar la aplicación y registra `CACHE_RECUPERADA` (escenario 6).
  - **Redis lento (caso límite "Caché lenta pero no caída"):** con el contenedor en `docker pause`, cada lectura pública responde en menos de 1 s (tiempo límite de 100 ms más PostgreSQL), con los datos correctos; tras 5 tiempos límite, el interruptor se abre. Con `docker unpause` se recupera.
  - **Horarios sin entrada:** con Redis detenido, `/horarios` usa `fuenteCompleta` (espía): una transacción pública.
  - **Sin `REDIS_URL`:** `CacheInactiva`, sin alertas.

### Implementation for User Story 4

- [ ] T046 [US4] Revisar y ajustar las rutas sin Redis para que T045 pase sin cambios de contrato:
  - `ObtenerCatalogoPublico` trata un fallo como ausente y no intenta guardar con el interruptor abierto;
  - `InvalidadorCatalogoPublico` falla en silencio;
  - el respaldo del límite (T043);
  - registros del interruptor en `redis-cache-compartida.ts` con nivel `warn` y una línea por transición.
  - Si `ioredis` emite errores no capturados, agregar el manejador `client.on('error', …)` sin registrar una línea por intento.
- [ ] T047 [US4] Crear `tecnologia/plataforma-barberias/backend/scripts/demo-caida.ts` y el script `"demo:caida": "tsx scripts/demo-caida.ts"` en `tecnologia/plataforma-barberias/backend/package.json` (R13):
  - opciones `--objetivo replica|redis`, `--url` (por defecto `http://localhost:3000/api/v1`), `--duracion` (60 s), `--parada` (15 s), `--arranque` (40 s) y `--salida` (JSON en `tmp/`);
  - siembra una barbería de prueba como `medir-horarios.ts` y la limpia al terminar;
  - genera tráfico continuo (unas 20 por segundo, catálogo y horarios);
  - ejecuta `docker compose stop` o `start` (`backend-2` o `redis`) con `child_process` desde `tecnologia/plataforma-barberias/`;
  - informa, por segundo, las solicitudes, los errores y el reparto por `X-Instancia`; el tiempo hasta que `backend-2` deja de aparecer; el porcentaje de errores en la transición; la reincorporación; y el p95 durante la caída;
  - con `redis`, hace además 20 reservas durante la caída y comprueba en la base que no hay duplicados;
  - con `--manual`, no ejecuta `docker compose` e indica cuándo hacerlo (línea de corte 2).
  - Incluir `scripts/` en la revisión de tipos, que ya lo hace desde 002.

**Checkpoint**: la caída de Redis está probada en CI y se demuestra con el entorno real.

---

## Phase 7: User Story 5 - Evidencia medida del rendimiento con dos instancias (Priority: P3)

**Goal**: medición reproducible de horarios libres con 50 consultas simultáneas en cuatro variantes,
registrada con su resultado real; ajuste FR-013b solo si hace falta; EQ-02 y EQ-03 registradas como
pendientes (FR-025, FR-027, FR-027a, SC-001, SC-009).

**Independent Test**: ejecutar `medir:horarios` en las variantes A–D con el entorno de Compose y
obtener la tabla registrada.

### Tests for User Story 5 (MANDATORY - constitution Principle X) ⚠️

- [ ] T048 [P] [US5] Prueba unitaria de las estadísticas en `tecnologia/plataforma-barberias/backend/test/unit/scripts/estadisticas.spec.ts`:
  - p50, p95 y máximo con listas conocidas (incluidos los casos borde de 1 y 2 elementos);
  - porcentaje de 5xx;
  - conteo por `X-Instancia`.
  - Extraer el cálculo a `tecnologia/plataforma-barberias/backend/scripts/estadisticas.ts`, compartido por `medir-horarios.ts` y `demo-caida.ts`.

### Implementation for User Story 5

- [ ] T049 [US5] Ampliar `tecnologia/plataforma-barberias/backend/scripts/medir-horarios.ts` (R13):
  - opciones `--url` (por defecto `http://localhost:3000/api/v1`), `--etiqueta` y `--salida` (JSON en `tmp/`);
  - reparto por `X-Instancia` en el informe;
  - un aviso si la tasa de 429 es mayor que 0 (límite de la vía pública sin subir);
  - opción `--precargar` (por defecto, activada): un `GET /publico/{slug}` antes de las rondas, para que en las variantes con caché los horarios lean la entrada ([research.md](research.md) R13);
  - mantener la siembra (5 barberos, 60 citas), las 10 rondas de 50 y la limpieza;
  - usar `scripts/estadisticas.ts`;
  - hace pasar T048.
- [ ] T050 [US5] Ejecutar las variantes A, B, C y D de [quickstart.md](quickstart.md) §4.3 con el entorno de Compose:
  - `PUBLICO_LIMITE_POR_MINUTO=100000` y `CACHE_CATALOGO_ACTIVA` según la variante;
  - dos ejecuciones por variante, registradas ambas;
  - anotar que A y C usan `fuenteCompleta` (2 transacciones por consulta, con la mejora de M01) y no equivalen exactamente a la medición de 002;
  - anotar fecha, equipo, memoria asignada a Docker, p50, p95, máximo, % de 5xx y reparto;
  - volver a los valores normales y borrar `tmp/` al terminar.
- [ ] T051 [US5] Ejecutar `npm run demo:caida -- --objetivo replica` y `-- --objetivo redis` (quickstart §4.1 y §4.2) y anotar los resultados (detección, errores en la transición, p95 durante la caída, reincorporación y reservas sin duplicados).
- [ ] T052 [US5] **Condicional (FR-013b):** solo si la variante D supera los 800 ms. Implementar la caché de horarios según [research.md](research.md) R10:
  - con `cache.horariosActiva`: claves `ClavesCache.horarios` y `generacionHorarios`, TTL de 30 s, en el controlador público o en un caso de uso `ObtenerHorariosPublicos` en `…/catalogo/application/`;
  - un `InvalidadorHorarios`, cuyo `INCR` se ejecuta tras confirmar en todos los casos de uso de la columna "Horarios" de [contracts/cache-claves.md](contracts/cache-claves.md) §3 (incluidos `ReservarCita`, `CancelarCita` y `CambiarEstadoCita` en `…/citas/application/`, y los bloqueos y la disponibilidad);
  - sus pruebas de matriz y de PR09 en `cache-catalogo.spec.ts` y `aislamiento-cache.spec.ts`;
  - medir la variante E y agregar la decisión con D y E a ADR-029.
  - Si D cumple la meta, marcar la tarea como **no aplicada** con la medición que lo justifica.
- [ ] T053 [US5] Registrar los resultados de T050–T052 en la sección 6 de [quickstart.md](quickstart.md), con la tabla de variantes, las demos y la causa probable si alguna meta no se cumple. Dejar **EQ-02/PR02** y **EQ-03/PR03** como pendientes (FR-027a).

**Checkpoint**: la evidencia está medida y registrada, cumpla o no la meta.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: documentación exigida por ADR-029 y ADR-030 (principio XI), suite completa y limpieza.

- [ ] T054 [P] Actualizar `docs/02-arquitectura-software/despliegue-y-escalabilidad.md` con el entorno escalado local (diagrama Mermaid: Nginx, dos réplicas, Redis y PostgreSQL), la tabla de equivalencias con la nube de [research.md](research.md) R16 y la aclaración de que no es alta disponibilidad (FR-028).
- [ ] T055 [P] Actualizar `docs/02-arquitectura-software/tecnologias.md`:
  - `ioredis` con versión exacta y licencia MIT;
  - imágenes `nginx:1.27-alpine` y `redis:7.4-alpine`;
  - límites de memoria por contenedor.
- [ ] T056 [P] Actualizar `docs/02-arquitectura-software/api-rest.md` con `GET /salud/listo`, la respuesta 503 `SERVICIO_NO_DISPONIBLE` del balanceador y el encabezado `X-Instancia`.
- [ ] T057 [P] Actualizar `docs/02-arquitectura-software/estrategia-de-cache.md`:
  - reemplazar la tabla de la sección 2 por lo implementado (claves `bp:v1:` y `rl:v1:`, TTL y matriz);
  - el comportamiento sin Redis de la sección 4, con el respaldo por instancia **con los mismos valores** (en lugar de "más estrictos");
  - quitar la nota provisional de la sección 1.
- [ ] T058 [P] Actualizar `tecnologia/plataforma-barberias/README.md`:
  - servicios de Compose y puertos (la API por Nginx en el 3000);
  - cómo aplicar un cambio de código con el entorno escalado;
  - ejecución local sin Docker (Redis opcional);
  - que las réplicas arrancan y funcionan sin Redis, y lo vuelven a usar cuando responde;
  - variables nuevas, memoria recomendada para Docker (3 GB), `demo:caida`, `medir:horarios` con opciones, y ADR-029 y ADR-030.
- [ ] T059 [P] Actualizar `docs/05-gestion/04-pruebas.md`:
  - PR01, PR04, PR05 y PR09 (caché) con su estado y resultado;
  - PR02 y PR03 como pendientes.
- [ ] T060 Actualizar `docs/trazabilidad.md`:
  - fila de 006 con el estado real y los números de la suite;
  - nueva subsección con los componentes de 006 y su evidencia;
  - fila de "Rendimiento de horarios libres" con el resultado oficial.
- [ ] T061 Actualizar `docs/05-gestion/02-backlog-y-sprints.md`: 006 implementada, líneas de corte aplicadas si se usaron, y ADR-029 y ADR-030 marcados como Aceptados en la sección 3.3.
- [ ] T062 Ejecutar la suite completa y registrar los totales en la sección 6 del quickstart:
  - **backend:** `npx prettier --check .`, `npm run lint`, `npm run build`, `npm test`, `npm run test:int` y `npm run test:arch`;
  - **frontend:** `npx prettier --check .`, `npm run lint`, `npm run build` y `npx vitest run --maxWorkers=1 --minWorkers=1`.
  - Si una prueba de tiempos falla por la carga del equipo, repetirla sola y anotarlo.
- [ ] T063 Recorrido manual de [quickstart.md](quickstart.md) §3 con el entorno real (reparto, claves en Redis, invalidación, cambio de enlace, IP falsa y sin réplicas) y anotar el resultado.
- [ ] T064 Limpieza:
  - borrar `tmp/` (resultados, caché de npm);
  - `docker compose down` o dejar el entorno según lo acordado;
  - comprobar que no quedaron contenedores de Testcontainers;
  - formatear con el Prettier local los documentos tocados.

### Pruebas opcionales (sin obligación)

Casos límite de la especificación que el análisis dejó como opcionales. Si se hacen, se agregan a
las suites indicadas; si no, se dejan anotadas como no hechas en la sección 6 del quickstart.

- [ ] T065 [P] _(Opcional)_ En `tecnologia/plataforma-barberias/backend/test/integration/escalado/balanceador.spec.ts`: un `GET` lento hacia la réplica que se cierra a mitad de la solicitud se reintenta en la otra y termina en 200 (caso límite "Instancia que cae a mitad de una solicitud"; `proxy_next_upstream`).
- [ ] T066 [P] _(Opcional)_ En `tecnologia/plataforma-barberias/backend/test/integration/escalado/cache-catalogo.spec.ts`: 50 visitas simultáneas al catálogo justo después de una invalidación dan 0 × 5xx y la entrada queda guardada una sola vez (caso límite "Ráfaga sobre un catálogo recién invalidado").

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (fase 1):** sin dependencias.
- **Foundational (fase 2):** depende de la 1 y **bloquea** todas las historias.
- **US1 (fase 3) y US2 (fase 4):** dependen solo de la 2 y pueden hacerse en paralelo.
- **US3 (fase 5):** depende de la 2. Su prueba con dos instancias no necesita Nginx.
- **US4 (fase 6):** depende de la 2. Su prueba cubre lo que exista de US2 y US3; conviene hacerla
  después de US2 para probar el catálogo real.
- **US5 (fase 7):** T048–T049 dependen de la 2. Las mediciones T050–T051 necesitan US1 (Compose)
  y US2 (caché); `demo:caida redis` (T051) necesita US4 (T047).
- **Polish (fase 8):** después de las historias que se entreguen.

### User Story Dependencies

- **US1:** independiente.
- **US2:** independiente. Su prueba usa dos instancias en proceso, no Nginx.
- **US3:** independiente.
- **US4:** sin dependencias duras; prueba la degradación de lo construido en US2 y US3.
- **US5:** necesita US1 y US2 para medir; T052 solo si D no cumple la meta.

### Within Each User Story

- Las pruebas se escriben primero y deben fallar.
- Puertos y configuración antes de los casos de uso, y estos antes de los controladores y el
  entorno.
- La historia queda en verde antes de pasar a la siguiente prioridad.

### Parallel Opportunities

- Fase 1: T002 y T003.
- Fase 2: T004–T006 (pruebas), T008, T010, T011, T015, T016 y T017.
- US1: T018–T021 en paralelo; T022–T023 antes de T024; T026 y T027 en paralelo con T025.
- US2: T029–T032 en paralelo; T033 y T034 en paralelo.
- US3 y US4: sus pruebas (T041, T042 y T045) en paralelo con las de US2.
- Polish: T054–T059, y T065 y T066 (opcionales).

---

## Parallel Example: User Story 1

```bash
# Pruebas de US1 juntas:
Task: "Ayudante de Nginx en backend/test/helpers/nginx.ts"
Task: "Integración de salud en backend/test/integration/escalado/salud-listo.spec.ts"
Task: "Integración del balanceador en backend/test/integration/escalado/balanceador.spec.ts"
Task: "Prueba del frontend en frontend/test/api/servicio-no-disponible.test.tsx"

# Implementación en paralelo tras la migración:
Task: "Plantilla de Nginx en nginx/templates/default.conf.template"
Task: "Reescribir docker-compose.yml"
```

## Parallel Example: User Story 2

```bash
Task: "Unitaria de la entrada en backend/test/unit/catalogo/entrada-catalogo.spec.ts"
Task: "Integración de barberiaPublicaPorEnlace en backend/test/integration/barberias/barberias-api.spec.ts"
Task: "Integración de la caché en backend/test/integration/escalado/cache-catalogo.spec.ts"
Task: "PR09 de la caché en backend/test/integration/aislamiento/aislamiento-cache.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Fases 1 y 2.
2. Fase 3 (US1): balanceo, salud, IP real y PR16 por Nginx.
3. **Detenerse y validar:** `balanceador.spec.ts` en verde y el entorno real con dos réplicas
   (T028). Con esto ya se cumple el requisito del curso sobre el balanceador.

### Incremental Delivery

1. US1 → balanceador demostrable.
2. US2 → caché del catálogo con aislamiento (requisito del curso sobre la caché).
3. US3 → límite compartido.
4. US4 → degradación sin Redis.
5. US5 → medición y registro; ajuste FR-013b solo si hace falta.
6. Pulido: documentación, suite completa y limpieza.

### Líneas de corte (backlog §3.2)

Si hay atraso:

1. Reducir la medición a las variantes C y D, con una ejecución cada una.
2. Hacer las demos a mano (`demo:caida --manual` o los comandos de quickstart §4).

**Nunca se recortan:** las claves con tenant (T004, T010, T032), el funcionamiento sin Redis (T045)
ni el límite compartido entre réplicas (T042).

---

## Notes

- [P] = archivos distintos y sin dependencias pendientes.
- [Story] enlaza cada tarea con su historia.
- Verificar que las pruebas fallan antes de implementar.
- No hacer commits salvo que el responsable lo pida.
- Detenerse en cada checkpoint para validar la historia por separado.
- Nada se descarga ni se instala fuera de D:. Los temporales van a `tmp/` y se borran al terminar.
