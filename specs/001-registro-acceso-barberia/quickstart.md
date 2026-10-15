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
docker compose up -d --build
docker compose exec backend npm run migrate     # aplica migraciones como barberias_owner
```

Esperado: `GET http://localhost:3000/api/v1/salud` → `200 {"estado":"ok"}`; la aplicación web
abre en `http://localhost:5173`. Desde el equipo, la base de Compose responde en `localhost:5433` (o el
`DB_PUERTO` configurado); los comandos `psql` de la sección 4 se ejecutan dentro del contenedor y no
dependen de ese puerto.

## 3. Ejecutar las pruebas

```powershell
cd tecnologia/plataforma-barberias/backend
npm ci
npm run test            # unitarias de dominio (sin base)
npm run test:int        # integración y contrato HTTP con PostgreSQL en Testcontainers
npm run test:arch       # PR14: matriz de módulos y regla de capas
cd ../frontend
npm ci
npm run test            # formularios y manejo de sesión
```

Esperado: todo en verde. Suites obligatorias que deben aparecer en el informe:
`aislamiento/rls`, `aislamiento/funciones-definer`, `aislamiento/aislamiento-tenant` y
`aislamiento/filtro-repositorios` (PR09, ADR-015), `autenticacion (PR07)`, `rbac (PR08)` y
`autorizacion` (permisos en casos de uso), `entradas (PR10)`, `limite-intentos (PR12)`,
`auditoria (PR13)`, `arquitectura (PR14)`.

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
(200); el log del backend no registró errores. **La interfaz no se recorrió a mano en un navegador.**

Las pruebas de integración también se ejecutaron con **Testcontainers** (`npm run test:int` sin
`TEST_DATABASE_ADMIN_URL`): 237 de 237 en verde contra un contenedor `postgres:16`.

### 6.2 Sin Docker (primera ejecución)

**Fecha:** 2026-10-15. **Cómo se ejecutó:** el equipo de desarrollo no tenía Docker, así que no se usó
Docker Compose. Se reprodujo el mismo entorno a mano: PostgreSQL 16 local con una base nueva
(`barberias_quickstart`), el mismo `db/init/01-roles.sql` y las 7 migraciones aplicadas como
`barberias_owner`, y el backend **compilado** (`node dist/src/main.js`) conectado como `barberias_app`. Los
escenarios se ejecutaron por HTTP con un script contra ese backend, y los escenarios 14 y 15 con `psql`
como `barberias_app`. **No se comprobó la interfaz en un navegador**: la parte visual de los escenarios 1,
3, 6 y 7 la cubren las pruebas del frontend (Vitest + MSW), no esta ejecución.

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

**Pendiente para el cierre formal (sección 5):** ver las suites en verde en GitHub Actions, aprobar
ADR-015 y validar el rol `BYPASSRLS` en Amazon RDS. (La repetición con Docker Compose está hecha: 6.1.)
