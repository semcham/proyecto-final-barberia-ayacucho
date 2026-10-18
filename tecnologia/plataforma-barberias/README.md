# Plataforma de barberías: aplicación

Código de la plataforma, construido con desarrollo guiado por especificaciones (Spec Kit). Hoy contiene las
funcionalidades:

- [001 · Registro de barbería, acceso con roles y aislamiento](../../specs/001-registro-acceso-barberia/spec.md);
- [002 · Catálogo, citas y cuenta de cliente](../../specs/002-catalogo-citas-cliente/spec.md).

Las guías completas (requisitos, escenarios manuales, criterios de cierre y registro de ejecuciones) están en
[quickstart de 001](../../specs/001-registro-acceso-barberia/quickstart.md) y
[quickstart de 002](../../specs/002-catalogo-citas-cliente/quickstart.md). Este archivo es el resumen.

## Contenido

| Carpeta o archivo    | Qué es                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `backend/`           | API REST en NestJS 11: módulos M01, M02, M03 (mínimo) y M06, 4 capas, PostgreSQL 16 con RLS (Kysely) |
| `frontend/`          | Aplicación web en React 19 + Vite 6 con sistema de diseño propio y Radix UI (ADR-014, ADR-016)       |
| `db/init/`           | Roles de PostgreSQL que crea el contenedor de la base al iniciar por primera vez                     |
| `docker-compose.yml` | Entorno de desarrollo: `db` (postgres:16), `backend` y `frontend`                                    |
| `.env.example`       | Variables de entorno de desarrollo (copiar a `.env`)                                                 |

## Ejecutar con Docker Compose

Requisitos: Docker Desktop con Compose v2 y los puertos 5433, 3000 y 5173 libres.

```powershell
cd tecnologia/plataforma-barberias
Copy-Item .env.example .env      # completar las claves JWT de desarrollo (ver comentarios del archivo)
docker compose up -d             # el backend aplica las migraciones pendientes al arrancar
```

- Aplicación web: <http://localhost:5173> · API: <http://localhost:3000/api/v1/salud>.
- **Página pública de una barbería (002):** <http://localhost:5173/b/{slug}> muestra el catálogo y los
  horarios libres sin sesión; desde ahí el cliente se registra (`/b/{slug}/registro`), ingresa
  (`/b/{slug}/ingresar`) y reserva (`/b/{slug}/reservar`). El `slug` es el enlace que el propietario ve y
  cambia en la pantalla Barbería del panel. Sus citas están en `/mis-citas`.
- **Migraciones:** el contenedor `backend` ejecuta `npm run migrate` antes de iniciar el servidor; si una
  falla, no arranca y el error queda en `docker compose logs backend`. Solo se aplican al arrancar: **si
  llega una migración nueva con el backend ya corriendo** (por ejemplo, al bajar cambios), ejecuta
  `docker compose restart backend` o `docker compose exec backend npm run migrate`. Si no, el backend falla
  con errores como "column … does not exist".
- La base se publica en `localhost:5433` (`DB_PUERTO` en `.env`); dentro de Compose es `db:5432`.
- `VITE_SONDEO` (por defecto `true`) hace que Vite revise los archivos periódicamente: en Windows y macOS
  el volumen montado no avisa los cambios. En Linux se puede poner `VITE_SONDEO=false` en `.env` para
  ahorrar CPU.
- **Tras agregar o actualizar dependencias** (`package.json`), reinicia el contenedor para que vuelva a
  ejecutar `npm ci` en su volumen de `node_modules`: `docker compose restart frontend` (o `backend`). Si
  no, el contenedor sigue con las dependencias anteriores y la interfaz puede no reflejar los cambios.

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
$env:VITE_API_PROXY = 'http://localhost:3000'    # por defecto el proxy apunta a http://backend:3000 (Compose)
npm run dev                                      # http://localhost:5173
```

`DATABASE_URL_APP`, `DATABASE_URL_OWNER` y `DATABASE_URL_PUBLICO` en `.env` deben usar el mismo puerto que
la base (5433 si es la de Compose).

## Funcionalidad 002: rol de base, variables y migraciones

- **Migraciones `0009`–`0012`:** cuenta de cliente (`customer_profile`, `consent_record`, membresía
  `CLIENTE`), catálogo (`business_hours`, `service`, `barber`, `working_hours`, `time_off` y RLS de
  `tenant`), citas (`appointment` con sus dos restricciones de exclusión e historial) y permisos por
  columna del rol público. El backend de Compose las aplica al arrancar; sin Compose, con el comando de
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

## Comprobaciones

| Dónde       | Comandos                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/`  | `npx prettier --check .` · `npm run lint` · `npm run build` · `npm test` · `npm run test:int` (Testcontainers) · `npm run test:arch` |
| `frontend/` | `npx prettier --check .` · `npm run lint` · `npm run build` (incluye `tsc --noEmit`) · `npm test`                                    |

Son los mismos pasos que ejecuta el CI ([`.github/workflows/plataforma-barberias.yml`](../../.github/workflows/plataforma-barberias.yml)).

## Referencias

- Plan técnico: [plan de 001](../../specs/001-registro-acceso-barberia/plan.md) y
  [plan de 002](../../specs/002-catalogo-citas-cliente/plan.md) · contratos:
  [openapi de 001](../../specs/001-registro-acceso-barberia/contracts/openapi.yaml) y
  [openapi de 002](../../specs/002-catalogo-citas-cliente/contracts/openapi.yaml) · permisos:
  [rbac de 001](../../specs/001-registro-acceso-barberia/contracts/rbac.md) y
  [rbac de 002](../../specs/002-catalogo-citas-cliente/contracts/rbac.md).
- Decisiones: [ADR-014 a ADR-021](../../docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md)
  (frontend, autenticación sin tenant, sistema de diseño, indicador de sesión, carga diferida, período de
  gracia en la renovación, cuenta de cliente en varias barberías y lecturas públicas por enlace).
- Librerías, versiones, licencias y mediciones: [tecnologias.md](../../docs/02-arquitectura-software/tecnologias.md).
- Imágenes de marca (formato, peso máximo, licencia y autoría): [frontend/public/img/README.md](frontend/public/img/README.md).
