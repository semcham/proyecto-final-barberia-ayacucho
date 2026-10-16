# Plataforma de barberías: aplicación

Código de la plataforma, construido con desarrollo guiado por especificaciones (Spec Kit). Hoy contiene la
funcionalidad [001 · Registro de barbería, acceso con roles y aislamiento](../../specs/001-registro-acceso-barberia/spec.md).

La guía completa (requisitos, escenarios manuales, criterios de cierre y registro de ejecuciones) está en
[quickstart.md](../../specs/001-registro-acceso-barberia/quickstart.md). Este archivo es el resumen.

## Contenido

| Carpeta o archivo    | Qué es                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `backend/`           | API REST en NestJS 11: módulos M01, M03 (mínimo) y M06, 4 capas, PostgreSQL 16 con RLS (Kysely)     |
| `frontend/`          | Aplicación web en React 19 + Vite 6 con sistema de diseño propio y Radix UI (ADR-014, ADR-016)      |
| `db/init/`           | Roles de PostgreSQL que crea el contenedor de la base al iniciar por primera vez                    |
| `docker-compose.yml` | Entorno de desarrollo: `db` (postgres:16), `backend` y `frontend`                                   |
| `.env.example`       | Variables de entorno de desarrollo (copiar a `.env`)                                                |

## Ejecutar con Docker Compose

Requisitos: Docker Desktop con Compose v2 y los puertos 5433, 3000 y 5173 libres.

```powershell
cd tecnologia/plataforma-barberias
Copy-Item .env.example .env      # completar las claves JWT de desarrollo (ver comentarios del archivo)
docker compose up -d
docker compose exec backend npm run migrate
```

- Aplicación web: <http://localhost:5173> · API: <http://localhost:3000/api/v1/salud>.
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

`DATABASE_URL_APP` y `DATABASE_URL_OWNER` en `.env` deben usar el mismo puerto que la base (5433 si es la
de Compose).

## Comprobaciones

| Dónde       | Comandos                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `backend/`  | `npx prettier --check .` · `npm run lint` · `npm run build` · `npm test` · `npm run test:int` (Testcontainers) · `npm run test:arch` |
| `frontend/` | `npx prettier --check .` · `npm run lint` · `npm run build` (incluye `tsc --noEmit`) · `npm test`                        |

Son los mismos pasos que ejecuta el CI ([`.github/workflows/plataforma-barberias.yml`](../../.github/workflows/plataforma-barberias.yml)).

## Referencias

- Plan técnico: [plan.md](../../specs/001-registro-acceso-barberia/plan.md) · contrato:
  [openapi.yaml](../../specs/001-registro-acceso-barberia/contracts/openapi.yaml) · permisos:
  [rbac.md](../../specs/001-registro-acceso-barberia/contracts/rbac.md).
- Decisiones: [ADR-014 a ADR-018](../../docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md)
  (frontend, autenticación sin tenant, sistema de diseño, indicador de sesión, carga diferida).
- Librerías, versiones, licencias y mediciones: [tecnologias.md](../../docs/02-arquitectura-software/tecnologias.md).
- Imágenes de marca (formato, peso máximo, licencia y autoría): [frontend/public/img/README.md](frontend/public/img/README.md).
