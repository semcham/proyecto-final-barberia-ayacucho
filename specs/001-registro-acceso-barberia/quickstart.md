# Guía rápida de validación: funcionalidad 001

Cómo levantar el entorno y comprobar, de punta a punta, que la funcionalidad cumple la
[especificación](spec.md). Contrato: [contracts/openapi.yaml](contracts/openapi.yaml). Permisos:
[contracts/rbac.md](contracts/rbac.md). Datos: [data-model.md](data-model.md).

Todas las rutas son relativas a `tecnologia/plataforma-barberias/`.

## 1. Requisitos previos

- Docker Desktop con Docker Compose v2.
- Node.js 22 LTS (solo para ejecutar las pruebas fuera de contenedores).
- Puertos libres: 5433 (PostgreSQL de Compose), 3000 (backend), 5173 (frontend). El puerto de la base
  se cambia con `DB_PUERTO` en `.env` (por defecto 5433, para no chocar con un PostgreSQL instalado en el
  equipo en el 5432). Dentro de la red de Compose el backend siempre usa `db:5432`.

## 2. Levantar el entorno

```powershell
cd tecnologia/plataforma-barberias
Copy-Item .env.example .env      # completar claves JWT de desarrollo (ver comentarios del archivo)
docker compose up -d
docker compose exec backend npm run migrate     # aplica migraciones como barberias_owner
```

Resumen de ejecución también en el [README de la aplicación](../../tecnologia/plataforma-barberias/README.md).

Esperado: `GET http://localhost:3000/api/v1/salud` → `200 {"estado":"ok"}`; la aplicación web
abre en `http://localhost:5173`. Desde el equipo, la base de Compose responde en `localhost:5433` (o el
`DB_PUERTO` configurado); los comandos `psql` de la sección 4 se ejecutan dentro del contenedor y no
dependen de ese puerto.

Notas sobre el contenedor `frontend`:

- `VITE_SONDEO` (por defecto `true`, ver `.env.example`) hace que Vite revise los archivos cada 300 ms: en
  Windows y macOS el volumen montado no avisa los cambios y, sin esto, la aplicación seguiría mostrando la
  versión anterior del código. En Linux se puede poner `VITE_SONDEO=false` en `.env`.
- `backend` y `frontend` guardan `node_modules` en un volumen propio y ejecutan `npm ci` al arrancar. **Tras
  agregar o actualizar dependencias**, hay que reiniciarlos (`docker compose restart frontend` o
  `backend`); si no, siguen con las dependencias anteriores.

### 2.1 Sin Docker (backend y frontend locales)

Con PostgreSQL 16 propio o solo la base de Compose (`docker compose up -d db`), y con `DATABASE_URL_APP` y
`DATABASE_URL_OWNER` de `.env` apuntando al puerto de esa base:

```powershell
cd tecnologia/plataforma-barberias/backend
npm ci
npx tsx --env-file=../.env src/shared/persistence/migrate.ts
npm run build
node --env-file=../.env dist/src/main.js         # API en http://localhost:3000
cd ../frontend
npm ci
$env:VITE_API_PROXY = 'http://localhost:3000'    # sin esto, el proxy apunta a http://backend:3000 (Compose)
npm run dev                                      # http://localhost:5173
```

## 3. Ejecutar las pruebas

```powershell
cd tecnologia/plataforma-barberias/backend
npm ci
npx prettier --check .  # formato
npm run lint
npm run build           # compilación de TypeScript
npm run test            # unitarias de dominio (sin base)
npm run test:int        # integración y contrato HTTP con PostgreSQL en Testcontainers
npm run test:arch       # PR14: matriz de módulos y regla de capas
cd ../frontend
npm ci
npx prettier --check .
npm run lint
npm run build           # tsc --noEmit y build de producción de Vite
npm run test            # formularios, sesión, usuarios, activación y componentes base
```

Son los mismos pasos que ejecuta el CI. Esperado: todo en verde. Suites obligatorias que deben aparecer en
el informe del backend: `aislamiento/rls`, `aislamiento/funciones-definer`,
`aislamiento/aislamiento-tenant` y `aislamiento/filtro-repositorios` (PR09, ADR-015),
`autenticacion (PR07)`, `rbac (PR08)` y `autorizacion` (permisos en casos de uso), `entradas (PR10)`,
`limite-intentos (PR12)`, `auditoria (PR13)`, `arquitectura (PR14)`. Del frontend (33 pruebas):
`registro`, `sesion` (incluye el indicador `hay_sesion`, ADR-017), `usuarios`, `activar`, `client` y
`components/ui`.

### 3.1 Calidad de la interfaz (Lighthouse y axe-core)

Medición manual, sin instalar nada global ni descargar navegadores (registro de la última en
[tecnologías §5.1](../../docs/02-arquitectura-software/tecnologias.md)):

1. `npm run build` en `frontend/` y servirlo con `vite preview --port 4173`, con `VITE_API_PROXY`
   apuntando al backend en ejecución.
2. En una carpeta temporal fuera del repositorio (por ejemplo `tmp/`, que está en `.gitignore`), instalar
   `lighthouse`, `axe-core` y `playwright-core` con versión exacta, y usar el Chrome ya instalado
   (`channel: 'chrome'`).
3. Lighthouse en modo celular y escritorio, mediana de 3 pasadas por pantalla. Para las pantallas con
   sesión, iniciar sesión antes de cada pasada (ver R18 en la
   [matriz de riesgos](../../docs/05-gestion/05-riesgos.md)).
4. axe-core con las reglas WCAG 2.2 A y AA sobre los estados interactivos (menús abiertos, modales,
   errores de formulario, avisos, 320 px) en tema claro y oscuro.
5. Borrar la carpeta temporal al terminar.

Metas: Lighthouse ≥ 90 en rendimiento (celular), accesibilidad y buenas prácticas; 0 incumplimientos
WCAG A/AA en axe.

## 4. Escenarios manuales

Se pueden hacer desde la aplicación web o con cualquier cliente HTTP contra
`http://localhost:3000/api/v1`.

| # | Escenario (historia) | Pasos | Resultado esperado |
| - | -------------------- | ----- | ------------------ |
| 1 | Registro con prueba gratuita (HU02) | En `/registro`, crear "Barbería Huamanga" con un correo nuevo | Entra directo a su espacio; `GET /auth/yo` da rol `PROPIETARIO`; la respuesta del registro trae `suscripcion.estado = TRIAL` y `venceEn` a 14 días. Ningún paso pide tarjeta |
| 2 | Correo repetido | Repetir el registro con el mismo correo | 409 `CORREO_NO_DISPONIBLE`, sin nombre de barbería |
| 3 | Inicio de sesión (HU05) | Cerrar sesión y entrar en `/ingresar` | 200 con `tokenAcceso`; cookie `rt` HttpOnly |
| 4 | Mensaje genérico | Entrar con correo inexistente y luego con contraseña errada | Ambos 401 `CREDENCIALES_INVALIDAS` con el mismo cuerpo |
| 5 | Límite de intentos (EQ-12) | 6 intentos fallidos en menos de 1 min | El sexto da 429 con `Retry-After`; otra cuenta entra sin problema |
| 6 | Crear personal (HU04) | Como propietario, en `/app/usuarios` crear un BARBERO; intentar crear otro con rol `PROPIETARIO` | El primero 201 con enlace de activación y estado `PENDIENTE`; el segundo 400 `VALIDACION` |
| 7 | Activación | Abrir el enlace del barbero y fijar contraseña; reutilizar el enlace | Primera vez 204; segunda vez 400 `ENLACE_INVALIDO` |
| 8 | Permisos por rol (EQ-08) | Iniciar sesión como barbero y llamar `POST /usuarios` | 403 `ACCESO_DENEGADO`; aparece `ACCESO_DENEGADO_ROL` en `audit_log` |
| 9 | Cierre de sesión (SC-004) | Guardar el `tokenAcceso`, cerrar sesión y reutilizarlo en `GET /auth/yo` | 401 inmediato, aunque el token no haya vencido |
| 10 | Desactivación | El propietario desactiva al barbero mientras este tiene sesión | La siguiente solicitud del barbero da 401 y no puede volver a entrar (403 `ACCESO_SUSPENDIDO`) |
| 11 | Autoprotección | El propietario intenta desactivarse a sí mismo | 422 `OPERACION_NO_PERMITIDA` |
| 12 | Límite del plan | Crear usuarios hasta superar 5 en total | 403 `SUSCRIPCION_NO_PERMITE`, `motivo = LIMITE_USUARIOS` |
| 13 | Aislamiento (EQ-09) | Registrar "Barbería B" con un usuario. Con el token del propietario de A: `GET /usuarios/{id de B}`, `PATCH` del mismo id, y `POST /usuarios` con `"tenantId": "<id de B>"` en el cuerpo | 404, 404 y 400 respectivamente; los datos de B no cambian; `GET /usuarios` de A no muestra a nadie de B |
| 14 | RLS en la base | `docker compose exec db psql -U barberias_app -d barberias -c "select count(*) from membership"` y lo mismo con `user_account` | `0` en ambas (sin contexto de tenant, RLS no deja ver filas; ADR-015) |
| 15 | Contraseñas no legibles | `docker compose exec db psql -U barberias_app -d barberias -c "select password_hash from user_account"` | Error de permiso: el rol de aplicación no puede leer esa columna |

## 5. Criterios de cierre

- Escenarios 1–15 conformes.
- Suites de la sección 3 en verde en CI (GitHub Actions bloquea la fusión si fallan).
- ADR-015 aprobado por el equipo y la creación del rol `BYPASSRLS` validada en el entorno de
  despliegue (Amazon RDS, **por validar**).
- Documentos actualizados en el mismo cambio que el código: librerías elegidas
  (`docs/02-arquitectura-software/tecnologias.md`) y estado de componentes en `docs/trazabilidad.md`.
- Interfaz con las metas de 3.1: Lighthouse ≥ 90 y 0 incumplimientos WCAG A/AA.

## 6. Registro de ejecución (T120)

### 6.1 Con Docker Compose (ejecución de referencia)

**Fecha:** 2026-10-15. **Entorno:** Docker 29.8, Docker Compose 5.6, `docker compose up -d` con el
`docker-compose.yml` del proyecto, `.env` generado desde `.env.example` con claves ES256 de desarrollo y
`docker compose exec backend npm run migrate` (7 migraciones aplicadas). En esa primera ejecución el
puerto 5432 del equipo lo ocupaba un PostgreSQL instalado en Windows y se usó un override temporal; desde
entonces `docker-compose.yml` publica la base en `DB_PUERTO` (5433 por defecto) y `docker compose up`
funciona sin override. Los escenarios se ejecutaron por HTTP contra `localhost:3000` y los
escenarios 14 y 15 con `docker compose exec db psql -U barberias_app -d barberias`.

**Resultado: 15 de 15 conformes**, con la misma evidencia que la tabla de 6.2. Además: el contenedor del
frontend sirve la aplicación en `localhost:5173` (200, UTF-8) y su proxy reenvía `/api/v1/salud` al backend
(200); el log del backend no registró errores. En esta ejecución la interfaz no se recorrió en un
navegador; eso se hizo después del rediseño (ver 6.3).

Las pruebas de integración también se ejecutaron con **Testcontainers** (`npm run test:int` sin
`TEST_DATABASE_ADMIN_URL`): 237 de 237 en verde contra un contenedor `postgres:16`.

### 6.2 Sin Docker (primera ejecución)

**Fecha:** 2026-10-15. **Cómo se ejecutó:** el equipo de desarrollo no tenía Docker, así que no se usó
Docker Compose. Se reprodujo el mismo entorno a mano: PostgreSQL 16 local con una base nueva
(`barberias_quickstart`), el mismo `db/init/01-roles.sql` y las 7 migraciones aplicadas como
`barberias_owner`, y el backend **compilado** (`node dist/src/main.js`) conectado como `barberias_app`. Los
escenarios se ejecutaron por HTTP con un script contra ese backend, y los escenarios 14 y 15 con `psql`
como `barberias_app`. En esta ejecución no se comprobó la interfaz en un navegador: la parte visual de los
escenarios 1, 3, 6 y 7 la cubrían las pruebas del frontend (Vitest + MSW). Ver 6.3 para el recorrido
posterior en Chrome.

| #   | Escenario                      | Resultado | Evidencia                                                                                          |
| --- | ------------------------------ | --------- | -------------------------------------------------------------------------------------------------- |
| 1   | Registro con prueba gratuita   | Conforme  | 201; `GET /auth/yo` → `PROPIETARIO`; suscripción `TRIAL` a 14 días                                  |
| 2   | Correo repetido                | Conforme  | 409 `CORREO_NO_DISPONIBLE`, sin nombre de barbería                                                  |
| 3   | Inicio de sesión               | Conforme  | 200 con `tokenAcceso`; cookie `rt` HttpOnly                                                         |
| 4   | Mensaje genérico               | Conforme  | 401 y 401 con el mismo cuerpo                                                                       |
| 5   | Límite de intentos             | Conforme  | 5 × 401 y el sexto 429 (`Retry-After: 60`), aun con la contraseña correcta; otra cuenta desde la misma IP: 200 |
| 6   | Crear personal                 | Conforme  | BARBERO → 201 `PENDIENTE` con enlace; PROPIETARIO → 400                                             |
| 7   | Activación                     | Conforme  | Primera vez 204; reutilizar el enlace → 400 `ENLACE_INVALIDO`                                       |
| 8   | Permisos por rol               | Conforme  | Barbero en `POST /usuarios` → 403 `ACCESO_DENEGADO`; 1 registro `ACCESO_DENEGADO_ROL`               |
| 9   | Cierre de sesión               | Conforme  | El mismo token: 200 antes y 401 después                                                             |
| 10  | Desactivación                  | Conforme  | Siguiente solicitud del barbero → 401; su inicio de sesión → 403 `ACCESO_SUSPENDIDO`               |
| 11  | Autoprotección                 | Conforme  | 422 `OPERACION_NO_PERMITIDA`                                                                        |
| 12  | Límite del plan                | Conforme  | Altas hasta llegar a 5 vigentes; la siguiente → 403 `SUSCRIPCION_NO_PERMITE` / `LIMITE_USUARIOS`    |
| 13  | Aislamiento                    | Conforme  | `GET` y `PATCH` del usuario de B → 404; `POST` con `tenantId` → 400; A no lista a nadie de B; B sin cambios |
| 14  | RLS en la base                 | Conforme  | `membership` = 0 y `user_account` = 0 como `barberias_app`                                          |
| 15  | Contraseñas no legibles        | Conforme  | `permission denied for table user_account`                                                         |

### 6.3 Interfaz en el navegador (tras el rediseño, ADR-016 a ADR-018)

**Fecha:** 2026-10-16. **Cómo se ejecutó:** base en Docker Compose (`docker compose up -d db`), backend
compilado y frontend locales (sección 2.1), y Chrome del equipo controlado con `playwright-core` instalado
en una carpeta temporal. Anchos de 320, 768 y 1280 px, tema claro y oscuro, servidor de desarrollo y build
de producción (`vite preview`).

**Recorrido conforme:**

- Escenarios 1, 3, 6 y 7 desde la interfaz: registro con prueba gratuita, ingreso, creación de barbero con
  el enlace de activación (copiar al portapapeles) y pantalla de activación.
- Desactivar, reactivar y generar un nuevo enlace desde el menú de cada fila, con modal de confirmación y
  aviso de resultado; búsqueda sin tildes y filtro por estado.
- Teclado: "Saltar al contenido", menús con flechas y Escape, foco inicial en Cancelar en las
  confirmaciones y foco devuelto al control de origen al cerrar.
- Sin desborde horizontal en 320 px; sin errores de JavaScript; la primera visita sin sesión no llama a
  `/auth/refresh` (ADR-017).
- Lighthouse y axe-core según 3.1: resultados en
  [tecnologías §5.1](../../docs/02-arquitectura-software/tecnologias.md).

**Observación:** al medir con sesión apareció `SESION_REUTILIZADA` en `audit_log` y la sesión se cerró
(riesgo R18 en la [matriz de riesgos](../../docs/05-gestion/05-riesgos.md)).

**Pendiente para el cierre formal (sección 5):** ver las suites en verde en GitHub Actions, aprobar
ADR-015 (y ADR-016 a ADR-018) y validar el rol `BYPASSRLS` en Amazon RDS. (La repetición con Docker
Compose está hecha: 6.1.)
