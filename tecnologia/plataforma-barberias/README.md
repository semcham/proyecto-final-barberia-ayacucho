# Plataforma de barberías: aplicación

Código de la plataforma, construido con desarrollo guiado por especificaciones (Spec Kit). Hoy contiene las
funcionalidades:

- [001 · Registro de barbería, acceso con roles y aislamiento](../../specs/001-registro-acceso-barberia/spec.md);
- [002 · Catálogo, citas y cuenta de cliente](../../specs/002-catalogo-citas-cliente/spec.md);
- [006 · Escalabilidad: balanceador Nginx, dos réplicas y Redis](../../specs/006-escalado-cache-balanceo/spec.md).

Las guías completas (requisitos, escenarios manuales, criterios de cierre y registro de ejecuciones) están en
[quickstart de 001](../../specs/001-registro-acceso-barberia/quickstart.md),
[quickstart de 002](../../specs/002-catalogo-citas-cliente/quickstart.md) y
[quickstart de 006](../../specs/006-escalado-cache-balanceo/quickstart.md). Este archivo es el resumen.

## Contenido

| Carpeta o archivo    | Qué es                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `backend/`           | API REST en NestJS 11: módulos M01, M02, M03 (mínimo) y M06, 4 capas, PostgreSQL 16 con RLS (Kysely)              |
| `frontend/`          | Aplicación web en React 19 + Vite 6 con sistema de diseño propio y Radix UI (ADR-014, ADR-016)                    |
| `db/init/`           | Roles de PostgreSQL que crea el contenedor de la base al iniciar por primera vez                                  |
| `docker-compose.yml` | Entorno de desarrollo escalado: `db`, `redis`, `preparar-backend`, `backend-1`, `backend-2`, `nginx` y `frontend` |
| `nginx/`             | Configuración del balanceador local (`nginx.conf` y la plantilla del upstream, ADR-030)                           |
| `.env.example`       | Variables de entorno de desarrollo (copiar a `.env`)                                                              |

## Ejecutar con Docker Compose

Requisitos: Docker Desktop con Compose v2, **3 GB de memoria asignados a Docker** y los puertos 5433, 6380,
3000 y 5173 libres.

```powershell
cd tecnologia/plataforma-barberias
Copy-Item .env.example .env      # completar las claves JWT de desarrollo (ver comentarios del archivo)
docker compose up -d             # preparar-backend compila y migra una vez; luego arrancan las dos réplicas
```

| Servicio           | Puerto en el equipo | Memoria | Qué hace                                                                                       |
| ------------------ | ------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `nginx`            | **3000**            | 32 MB   | Balanceador: la API entra siempre por aquí y se reparte entre las dos réplicas                 |
| `backend-1`, `-2`  | — (sin publicar)    | 384 MB  | Réplicas del backend; responden con `X-Instancia` para ver cuál atendió                        |
| `preparar-backend` | —                   | 1 GB    | Una sola vez: `npm ci`, build y migraciones; copia el build a un volumen que leen las réplicas |
| `redis`            | 6380 (para depurar) | 64 MB   | Caché del catálogo público y contadores del límite por IP; sin persistencia                    |
| `db`               | 5433                | 512 MB  | PostgreSQL 16                                                                                  |
| `frontend`         | 5173                | 512 MB  | Vite; reenvía `/api` a Nginx                                                                   |

- Aplicación web: <http://localhost:5173> · API (por Nginx): <http://localhost:3000/api/v1/salud> y
  `/api/v1/salud/listo`. Para ver el reparto: `curl.exe -si http://localhost:3000/api/v1/salud` dos veces y
  mirar `X-Instancia`.
- **Aplicar un cambio de código del backend:** `docker compose up -d --force-recreate preparar-backend
backend-1 backend-2` (vuelve a compilar y migrar una vez, y reinicia las réplicas). Lo mismo tras cambiar
  dependencias del backend.
- **Reiniciar una sola réplica:** siempre con `--no-deps`, p. ej. `docker compose up -d --no-deps backend-2`.
  Sin él, Compose vuelve a ejecutar `preparar-backend` (unos 2 minutos) y reescribe `node_modules` con la
  otra réplica en marcha.
- **Sin Redis:** las réplicas arrancan igual (no dependen de `redis`), quedan listas y funcionan sin caché y
  con el límite por instancia; cuando Redis responde, lo vuelven a usar solas, sin reiniciar.
- **Esto no es alta disponibilidad:** Nginx, PostgreSQL y Redis son únicos (ADR-006, ADR-030).
- **Página pública de una barbería (002):** <http://localhost:5173/b/{slug}> muestra el catálogo y los
  horarios libres sin sesión; desde ahí el cliente se registra (`/b/{slug}/registro`), ingresa
  (`/b/{slug}/ingresar`) y reserva (`/b/{slug}/reservar`). El `slug` es el enlace que el propietario ve y
  cambia en la pantalla Barbería del panel. Sus citas están en `/mis-citas`.
- **Migraciones:** las aplica `preparar-backend`, una sola vez antes de las réplicas; si una falla, las
  réplicas no arrancan y el error queda en `docker compose logs preparar-backend`. **Si llega una migración
  nueva** (por ejemplo, al bajar cambios), aplica el cambio de código como arriba. Mientras falten
  migraciones, `/salud/listo` responde 503 y Nginx no envía tráfico a esa réplica.
- La base se publica en `localhost:5433` (`DB_PUERTO` en `.env`); dentro de Compose es `db:5432`.
- `VITE_SONDEO` (por defecto `true`) hace que Vite revise los archivos periódicamente: en Windows y macOS
  el volumen montado no avisa los cambios. En Linux se puede poner `VITE_SONDEO=false` en `.env` para
  ahorrar CPU.
- **Tras agregar o actualizar dependencias** (`package.json`), reinicia el contenedor para que vuelva a
  ejecutar `npm ci` en su volumen de `node_modules`: `docker compose restart frontend` (el backend, con el
  comando de cambio de código de arriba). Si no, el contenedor sigue con las dependencias anteriores y la
  interfaz puede no reflejar los cambios.

## Ejecutar sin Docker (backend y frontend locales)

Con PostgreSQL 16 propio (o solo la base de Compose: `docker compose up -d db`) y Node.js 22:

```powershell
cd tecnologia/plataforma-barberias/backend
npm ci
npx tsx --env-file=../.env src/shared/persistence/migrate.ts   # migraciones con DATABASE_URL_OWNER
npm run build
node --env-file=../.env dist/src/main.js         # API en http://localhost:3000

cd ../frontend
npm ci
$env:VITE_API_PROXY = 'http://localhost:3000'    # por defecto el proxy apunta a http://nginx:80 (Compose)
npm run dev                                      # http://localhost:5173
```

`DATABASE_URL_APP`, `DATABASE_URL_OWNER` y `DATABASE_URL_PUBLICO` en `.env` deben usar el mismo puerto que
la base (5433 si es la de Compose).

**Redis es opcional en local:** con `REDIS_URL=redis://localhost:6380` usa el Redis de Compose
(`docker compose up -d redis`); con `REDIS_URL` vacía, el backend funciona sin caché y con el límite de
solicitudes en memoria, sin alertas.

## Funcionalidad 002: rol de base, variables y migraciones

- **Migraciones `0009`–`0012`:** cuenta de cliente (`customer_profile`, `consent_record`, membresía
  `CLIENTE`), catálogo (`business_hours`, `service`, `barber`, `working_hours`, `time_off` y RLS de
  `tenant`), citas (`appointment` con sus dos restricciones de exclusión e historial) y permisos por
  columna del rol público. En Compose las aplica `preparar-backend`; sin Compose, con el comando de
  migraciones de arriba.
- **Rol `barberias_publico`** (ADR-021, lecturas públicas por enlace): `LOGIN NOBYPASSRLS`, sin
  privilegios por defecto; la migración `0012` le concede `SELECT` solo sobre las columnas públicas. El
  contenedor de la base lo crea al iniciar **por primera vez** (`db/init/01-roles.sql`). En una base que ya
  existía (volumen de datos anterior a 002), créalo una vez como superusuario **antes** de migrar:

  ```sql
  CREATE ROLE barberias_publico LOGIN PASSWORD 'barberias_publico_dev'
    NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE;
  GRANT CONNECT ON DATABASE barberias TO barberias_publico;
  GRANT USAGE ON SCHEMA public TO barberias_publico;
  ```

  Con Compose: `docker compose exec db psql -U postgres -d barberias` y pegar esas líneas. La contraseña
  es solo de desarrollo.

- **`DATABASE_URL_PUBLICO`:** conexión del rol público (pool propio de la vía pública). Con Compose la
  define `docker-compose.yml`; sin Compose, en `.env`, por ejemplo
  `postgres://barberias_publico:barberias_publico_dev@localhost:5433/barberias`.
- **Otras variables nuevas** (`.env.example`): `HORARIOS_PASO_MINUTOS` (15), `RESERVA_HORIZONTE_DIAS` (30)
  y `PUBLICO_LIMITE_POR_MINUTO` (120 solicitudes por IP a la vía pública).
- **Medición de horarios (fuera de CI):** `npm run medir:horarios` en `backend/` (ver
  [quickstart de 002](../../specs/002-catalogo-citas-cliente/quickstart.md) §5).

## Funcionalidad 006: caché, límite compartido y balanceo

- **Decisiones:** ADR-029 (caché compartida con claves por barbería y límite general compartido) y ADR-030
  (balanceo local como representación de ADR-006). Contratos:
  [entorno de Compose](../../specs/006-escalado-cache-balanceo/contracts/entorno-compose.md) y
  [claves de caché](../../specs/006-escalado-cache-balanceo/contracts/cache-claves.md).
- **Migración `0013`:** permite al rol de la aplicación leer la tabla de migraciones para `/salud/listo`.
- **Variables nuevas** (`.env.example`): `REDIS_URL`, `REDIS_PUERTO`, `CACHE_CATALOGO_ACTIVA` (true),
  `CACHE_HORARIOS_ACTIVA` (false), `CACHE_CATALOGO_TTL_SEGUNDOS` (120), `CACHE_TIMEOUT_MS` (100),
  `CACHE_FALLOS_PARA_ABRIR` (5), `CACHE_PAUSA_MS` (10000), `PROXIES_CONFIABLES` (loopback en local; la IP
  de Nginx en Compose), `INSTANCIA_ID`, `DB_POOL_APP_MAX` y `DB_POOL_PUBLICO_MAX` (10), y la red de Compose
  (`RED_SUBRED`, `IP_NGINX`, `IP_BACKEND_1`, `IP_BACKEND_2`, `IP_REDIS`).
- **Medición de horarios (fuera de CI):** con el límite de la vía pública subido solo en la terminal,
  `$env:PUBLICO_LIMITE_POR_MINUTO='100000'; docker compose up -d`, y en `backend/`:
  `npm run medir:horarios -- --etiqueta D-2r-con-cache --salida ../../../tmp/medicion.json` (opciones
  `--url`, `--etiqueta`, `--salida` y `--no-precargar`). Variantes A–D en el
  [quickstart de 006](../../specs/006-escalado-cache-balanceo/quickstart.md) §4.3.
- **Demostración de caída (fuera de CI):** `npm run demo:caida -- --objetivo replica` o `--objetivo redis`
  (opciones `--url`, `--duracion`, `--parada`, `--arranque`, `--salida` y `--manual`). Detiene y vuelve a
  iniciar `backend-2` o `redis` con tráfico continuo e informa errores, reparto y p95. Fijar
  `PUBLICO_LIMITE_POR_MINUTO` en la **misma terminal**: la réplica que se reinicia toma sus variables.

## Comprobaciones

| Dónde       | Comandos                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/`  | `npx prettier --check .` · `npm run lint` · `npm run build` · `npm test` · `npm run test:int` (Testcontainers) · `npm run test:arch` |
| `frontend/` | `npx prettier --check .` · `npm run lint` · `npm run build` (incluye `tsc --noEmit`) · `npm test`                                    |

Son los mismos pasos que ejecuta el CI ([`.github/workflows/plataforma-barberias.yml`](../../.github/workflows/plataforma-barberias.yml)).

## Funcionalidad 003: suscripciones y pagos (en construcción)

- **Rol `barberias_plataforma`** (ADR-031, lecturas entre barberías del administrador de la plataforma, de
  las notificaciones de la pasarela y de las tareas programadas): `LOGIN NOBYPASSRLS`, sin privilegios por
  defecto y **sin ninguna escritura**; la migración `0016` le concede `SELECT` solo sobre las columnas
  permitidas. El contenedor de la base lo crea al iniciar **por primera vez** (`db/init/01-roles.sql`). En
  una base que ya existía (volumen de datos anterior a 003), créalo una vez como superusuario **antes** de
  migrar:

  ```sql
  CREATE ROLE barberias_plataforma LOGIN PASSWORD 'barberias_plataforma_dev'
    NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE;
  GRANT CONNECT ON DATABASE barberias TO barberias_plataforma;
  GRANT USAGE ON SCHEMA public TO barberias_plataforma;
  ```

  Con Compose: `docker compose exec db psql -U postgres -d barberias` y pegar esas líneas. La contraseña
  es solo de desarrollo.

- **Variables nuevas** (`.env.example`): `PAGOS_*`, `PLATAFORMA_LLAVE_TOTP`, `DATABASE_URL_PLATAFORMA`,
  `SIMULADOR_TOKEN_CONTROL`, `TAREAS_ACTIVAS` y `TAREAS_INTERVALO_MS`. Con Compose, `docker-compose.yml`
  da valores de desarrollo a las que falten en `.env`.

## Referencias

- Plan técnico: [plan de 001](../../specs/001-registro-acceso-barberia/plan.md) y
  [plan de 002](../../specs/002-catalogo-citas-cliente/plan.md) · contratos:
  [openapi de 001](../../specs/001-registro-acceso-barberia/contracts/openapi.yaml) y
  [openapi de 002](../../specs/002-catalogo-citas-cliente/contracts/openapi.yaml) · permisos:
  [rbac de 001](../../specs/001-registro-acceso-barberia/contracts/rbac.md) y
  [rbac de 002](../../specs/002-catalogo-citas-cliente/contracts/rbac.md).
- Decisiones: [ADR-014 a ADR-021](../../docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md)
  (frontend, autenticación sin tenant, sistema de diseño, indicador de sesión, carga diferida, período de
  gracia en la renovación, cuenta de cliente en varias barberías y lecturas públicas por enlace), y
  ADR-029 y ADR-030 (caché compartida y balanceo local, funcionalidad 006).
- Librerías, versiones, licencias y mediciones: [tecnologias.md](../../docs/02-arquitectura-software/tecnologias.md).
- Imágenes de marca (formato, peso máximo, licencia y autoría): [frontend/public/img/README.md](frontend/public/img/README.md).
