---

description: "Lista de tareas de la funcionalidad 001: registro de barbería, acceso con roles y aislamiento"
---

# Tasks: Registro de barbería, acceso con roles y aislamiento por barbería

**Input**: Documentos de diseño en `specs/001-registro-acceso-barberia/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/openapi.yaml](contracts/openapi.yaml), [contracts/rbac.md](contracts/rbac.md), [quickstart.md](quickstart.md)

**Tests**: OBLIGATORIAS (constitución, principio X). Cada historia incluye sus pruebas. Esta funcionalidad toca aislamiento entre barberías (**PR09**) y arquitectura de capas y módulos (**PR14**); no toca reservas (PR16), webhooks de pago ni proveedores externos.

**Organization**: Tareas agrupadas por historia de usuario para implementarlas y probarlas de forma independiente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: Historia a la que pertenece (US1, US2, US3, US4)
- Cada tarea indica la ruta exacta del archivo

## Path Conventions

- Todo el código vive en `tecnologia/plataforma-barberias/` (principio XII). Única excepción: el flujo de CI en `.github/workflows/` (constitución v1.0.1).
- Backend: `tecnologia/plataforma-barberias/backend/src/` · pruebas en `tecnologia/plataforma-barberias/backend/test/` · migraciones en `tecnologia/plataforma-barberias/backend/migrations/`.
- Frontend: `tecnologia/plataforma-barberias/frontend/src/` · pruebas en `tecnologia/plataforma-barberias/frontend/test/`.
- Cada submódulo tiene `presentation/`, `application/`, `domain/` e `infrastructure/`. `domain/` no importa `@nestjs/*`, `kysely`, `pg`, `argon2` ni `jose`.
- Entre módulos solo se importa su `index.ts` (matriz de [estilo-arquitectonico.md §3](../../docs/02-arquitectura-software/estilo-arquitectonico.md)).
- Los identificadores de decisión (R01–R21) remiten a [research.md](research.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Inicializar backend, frontend, base de datos local y herramientas.

- [ ] T001 Crear la estructura de carpetas del plan bajo `tecnologia/plataforma-barberias/` (backend/src/host, backend/src/modules/acceso-barberias/{identidad,barberias}/{presentation,application,domain,infrastructure}, backend/src/modules/suscripciones-pagos/suscripciones/{application,domain,infrastructure}, backend/src/shared/{tenant,persistence,audit,clock}, backend/migrations, backend/test/{unit,integration,contract,architecture,helpers}, frontend/src/{api,auth,pages,components}, frontend/test, db/init) con un `.gitkeep` en cada carpeta vacía
- [ ] T002 Inicializar el proyecto NestJS 11 con TypeScript `strict` en `tecnologia/plataforma-barberias/backend/package.json` y `tecnologia/plataforma-barberias/backend/tsconfig.json`; dependencias: `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/throttler`, `kysely`, `pg`, `argon2`, `jose`, `class-validator`, `class-transformer`, `cookie-parser`, `uuid`; desarrollo: `jest`, `ts-jest`, `supertest`, `@testcontainers/postgresql`, `dependency-cruiser`, `eslint`, `prettier`. Versiones exactas fijadas (sin `^`). Scripts: `start:dev`, `build`, `migrate`, `test` (test/unit), `test:int` (test/integration y test/contract), `test:arch`, `lint`
- [ ] T003 [P] Inicializar el frontend React 19 + Vite 6 + TypeScript en `tecnologia/plataforma-barberias/frontend/package.json`, `tecnologia/plataforma-barberias/frontend/vite.config.ts` y `tecnologia/plataforma-barberias/frontend/tsconfig.json`; dependencias: `react-router-dom`, `@tanstack/react-query`, `react-hook-form`, `zod`, `@hookform/resolvers`; desarrollo: `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `msw`, `openapi-typescript`. Proxy de Vite `/api` → `http://backend:3000`. Versiones exactas fijadas
- [ ] T004 [P] Configurar ESLint y Prettier del backend en `tecnologia/plataforma-barberias/backend/eslint.config.mjs` y `tecnologia/plataforma-barberias/backend/.prettierrc`, con la regla `no-restricted-imports` que prohíbe importar rutas internas de otro módulo (solo `modules/<modulo>/index.ts`)
- [ ] T005 [P] Configurar ESLint y Prettier del frontend en `tecnologia/plataforma-barberias/frontend/eslint.config.mjs` y `tecnologia/plataforma-barberias/frontend/.prettierrc`
- [ ] T006 [P] Crear `tecnologia/plataforma-barberias/db/init/01-roles.sql` que cree la base `barberias`, el rol `barberias_owner` (dueño, ejecuta migraciones) y el rol `barberias_app` con `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` (R04); `barberias_app` sin privilegios por defecto sobre `public`
- [ ] T007 Crear `tecnologia/plataforma-barberias/docker-compose.yml` con los servicios `db` (`postgres:16`, monta `db/init/` en `/docker-entrypoint-initdb.d`, volumen persistente, healthcheck `pg_isready`), `backend` (Node 22, `npm run start:dev`, puerto 3000, depende de `db` sano) y `frontend` (Node 22, `npm run dev -- --host`, puerto 5173); sin Redis (R20)
- [ ] T008 [P] Crear `tecnologia/plataforma-barberias/.env.example` con `DATABASE_URL_APP` (rol `barberias_app`), `DATABASE_URL_OWNER` (rol `barberias_owner`), `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEYS` (JSON `{kid: pem}`), `JWT_ACTIVE_KID`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_TTL_SECONDS=900`, `ARGON2_MEMORY_KIB=19456`, `ARGON2_TIME_COST=2`, `ARGON2_PARALLELISM=1`, `CORS_ORIGIN=http://localhost:5173`, `FRONTEND_BASE_URL=http://localhost:5173`, `TERMS_VERSION`, `PRIVACY_POLICY_VERSION`, con comentarios para generar un par de claves ES256 de desarrollo; agregar `.env` a `tecnologia/plataforma-barberias/.gitignore`
- [ ] T009 [P] Crear el flujo de CI en `.github/workflows/plataforma-barberias.yml` (excepción del principio XII; sin lógica de la aplicación, solo comandos ejecutados dentro de `tecnologia/plataforma-barberias/`): en `tecnologia/plataforma-barberias/backend` ejecutar `npm ci`, `npm run lint`, `npm test`, `npm run test:int` (Docker disponible en el runner para Testcontainers) y `npm run test:arch`; en `tecnologia/plataforma-barberias/frontend` ejecutar `npm ci`, `npm run lint` y `npm test`. Falla si cualquier paso falla

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Núcleo compartido (M06), esquema base con RLS, emisión y validación de sesiones, guards y formato de errores. Lo usan todas las historias.

**⚠️ CRITICAL**: Ninguna historia puede empezar hasta terminar esta fase.

### Base de datos y entorno de pruebas

- [ ] T010 Configurar el migrador de Kysely en `tecnologia/plataforma-barberias/backend/src/shared/persistence/migrate.ts` (ejecutable con `npm run migrate`), que se conecta con `DATABASE_URL_OWNER` y aplica en orden los archivos de `tecnologia/plataforma-barberias/backend/migrations/`
- [ ] T011 Crear la migración `tecnologia/plataforma-barberias/backend/migrations/0001_nucleo_identidad.ts` en SQL explícito según [data-model.md](data-model.md): tablas globales `tenant`, `role` (semilla `ADMIN_PLATAFORMA`, `PROPIETARIO`, `BARBERO`, `CLIENTE`) y `user_account`; tabla `membership` con `CHECK role_code IN ('PROPIETARIO','BARBERO')`, `CHECK status IN ('PENDIENTE','ACTIVA','DESACTIVADA')`, `UNIQUE (tenant_id, user_id)`, `UNIQUE (tenant_id, id)`, índices únicos parciales `membership_staff_one_tenant` y `one_owner_per_tenant`; tabla `audit_log`. En `membership` y `audit_log`: `ENABLE` + `FORCE ROW LEVEL SECURITY` y política `tenant_isolation` (USING y WITH CHECK sobre `current_setting('app.tenant_id', true)::uuid`). GRANT a `barberias_app`: `tenant` SELECT/INSERT; `role` SELECT; `user_account` SELECT/INSERT/UPDATE(password_hash, full_name); `membership` SELECT/INSERT/UPDATE(status, updated_at); `audit_log` solo SELECT/INSERT. Incluir función `down`
- [ ] T012 Crear la migración `tecnologia/plataforma-barberias/backend/migrations/0002_sesiones.ts`: tabla `auth_session` (columnas de [data-model.md](data-model.md), `CHECK status IN ('ACTIVA','CERRADA','REVOCADA')`, `UNIQUE (refresh_token_hash)`, FK compuesta `(tenant_id, user_id)` hacia la membresía) con RLS `FORCE` y política `tenant_isolation`; GRANT SELECT/INSERT/UPDATE a `barberias_app`; función `auth_buscar_sesion(char(64))` `SECURITY DEFINER`, propiedad de `barberias_owner`, `SET search_path = public, pg_temp`, que busca por `refresh_token_hash` o `previous_token_hash` y devuelve como máximo una fila (`session_id`, `tenant_id`, `user_id`, `status`, `es_token_anterior`); `REVOKE ALL ... FROM PUBLIC` y `GRANT EXECUTE` a `barberias_app` (R05)
- [ ] T013 Crear el entorno de pruebas de integración en `tecnologia/plataforma-barberias/backend/test/helpers/test-db.ts`: levanta `postgres:16` con Testcontainers, ejecuta `db/init/01-roles.sql`, aplica todas las migraciones como `barberias_owner` y expone un pool `barberias_app` (para que RLS actúe) y un pool `barberias_owner` (solo para sembrar datos); configurar `globalSetup`/`globalTeardown` de Jest en `tecnologia/plataforma-barberias/backend/jest.int.config.ts`
- [ ] T014 [P] Crear los ayudantes de datos en `tecnologia/plataforma-barberias/backend/test/helpers/fixtures.ts`: `sembrarBarberia({nombre, propietario})` y `sembrarUsuario({tenantId, rol, estado, contrasena})` que insertan directamente con el pool `barberias_owner` (hash Argon2 real), para que cada historia se pruebe sin depender de las demás
- [ ] T015 [P] Crear `tecnologia/plataforma-barberias/backend/test/helpers/app.ts` con `crearApp()` que levanta la aplicación Nest completa contra la base de Testcontainers (mismos pipes, filtros y guards que `main.ts`) y devuelve un agente `supertest` que conserva cookies

### M06 Núcleo compartido

- [ ] T016 [P] Crear el objeto de valor `TenantId` (UUID validado) en `tecnologia/plataforma-barberias/backend/src/shared/tenant/tenant-id.ts`
- [ ] T017 [P] Crear `TenantContext` basado en `AsyncLocalStorage` (`ejecutarCon(tenantId, fn)`, `actual()` que lanza si no hay tenant) en `tecnologia/plataforma-barberias/backend/src/shared/tenant/tenant-context.ts`
- [ ] T018 [P] Crear el puerto `Clock` (`ahora(): Date`) y su implementación de sistema en `tecnologia/plataforma-barberias/backend/src/shared/clock/clock.ts`
- [ ] T019 [P] Crear la conexión Kysely con el pool `barberias_app` y los tipos de tablas en `tecnologia/plataforma-barberias/backend/src/shared/persistence/database.ts` y `tecnologia/plataforma-barberias/backend/src/shared/persistence/db-types.ts`
- [ ] T020 Crear el puerto `UnitOfWork` (`ejecutar(tenantId, fn)` y `ejecutarSinTenant(fn)`) en `tecnologia/plataforma-barberias/backend/src/shared/persistence/unit-of-work.ts` y su implementación `KyselyUnitOfWork` en `tecnologia/plataforma-barberias/backend/src/shared/persistence/kysely-unit-of-work.ts`: abre una transacción, ejecuta `SELECT set_config('app.tenant_id', $1, true)`, guarda la transacción en `AsyncLocalStorage` y expone `transaccionActual()` para los repositorios de cualquier módulo (R03); incluir `fijarTenant(tenantId)` para el registro, donde el tenant nace dentro de la transacción
- [ ] T021 Crear `AuditLog.registrar({accion, actorId, recurso, resultado, ip, correlationId})` en `tecnologia/plataforma-barberias/backend/src/shared/audit/audit-log.ts`, que toma el tenant de `TenantContext` y escribe en `audit_log`; con variante `registrarEnTransaccionPropia` para denegaciones cuyo caso de uso se revierte (R17)
- [ ] T022 Crear la interfaz pública de M06 en `tecnologia/plataforma-barberias/backend/src/shared/index.ts` y el módulo Nest `SharedModule` en `tecnologia/plataforma-barberias/backend/src/shared/shared.module.ts`
- [ ] T023 [P] Prueba unitaria de `TenantContext` (aislamiento entre ejecuciones concurrentes, error sin tenant) en `tecnologia/plataforma-barberias/backend/test/unit/shared/tenant-context.spec.ts`
- [ ] T024 Prueba de integración de `KyselyUnitOfWork` en `tecnologia/plataforma-barberias/backend/test/integration/shared/unit-of-work.spec.ts`: el valor de `app.tenant_id` no sobrevive a la transacción ni pasa a otra solicitud que reutiliza la conexión del pool; un error revierte todo

### M01 dominio compartido por todas las historias

- [ ] T025 [P] Crear el objeto de valor `Correo` (normaliza `trim` + minúsculas, formato, ≤ 254) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/correo.ts`
- [ ] T026 [P] Crear el objeto de valor `Contrasena` (10–128, lista corta de contraseñas comunes en el mismo archivo, no contiene el correo) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/contrasena.ts` (R16)
- [ ] T027 [P] Crear el objeto de valor `Rol` (`PROPIETARIO`, `BARBERO`; `esAsignablePorPropietario()` verdadero solo para `BARBERO`) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/rol.ts`
- [ ] T028 [P] Crear los errores de dominio (`CredencialesInvalidas`, `AccesoSuspendido`, `CorreoNoDisponible`, `NoEncontrado`, `OperacionNoPermitida`, `EnlaceInvalido`, `LimiteUsuariosAlcanzado`, `DemasiadosIntentos`) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/errores.ts`
- [ ] T029 [P] Crear la entidad `Membresia` con estados `PENDIENTE`/`ACTIVA`/`DESACTIVADA`, transiciones del diagrama de [data-model.md §4](data-model.md) y la regla "el propietario no puede desactivarse a sí mismo" en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/membresia.ts`
- [ ] T030 [P] Crear la entidad `Sesion` (`rotar()`, `cerrar()`, `revocar()`, `estaVigente(ahora)` con 7 días deslizantes y 30 absolutos, detección de reutilización) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/sesion.ts`
- [ ] T031 [P] Pruebas unitarias de `Correo`, `Contrasena` y `Rol` en `tecnologia/plataforma-barberias/backend/test/unit/identidad/objetos-valor.spec.ts`
- [ ] T032 [P] Pruebas unitarias de `Membresia` y `Sesion` (transiciones válidas e inválidas, vencimientos con `Clock` simulado, reutilización) en `tecnologia/plataforma-barberias/backend/test/unit/identidad/membresia-sesion.spec.ts`

### M01 emisión y validación de sesión (la usan el registro y el inicio de sesión)

- [ ] T033 [P] Crear el puerto `PasswordHasher` (`hash`, `verificar`, `verificarFicticio` para igualar tiempos) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/ports/password-hasher.ts` y su adaptador Argon2id con parámetros del entorno en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/argon2-password-hasher.ts` (R06)
- [ ] T034 [P] Crear el puerto `TokenSigner` (`firmar(claims)`, `verificar(token)`) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/ports/token-signer.ts` y su adaptador con `jose` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/jose-token-signer.ts`: ES256, `kid` activo para firmar, varias claves públicas para verificar, `iss`/`aud`/`exp` obligatorios, algoritmos distintos de ES256 rechazados; reclamaciones `sub`, `tid`, `rol`, `sid`, `jti`, `iat`, `exp` (R07)
- [ ] T035 [P] Crear el puerto `SesionRepository` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/ports/sesion-repository.ts` y su implementación Kysely en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/kysely-sesion-repository.ts` (crear, buscar por id filtrando por tenant, actualizar, revocar todas las de un usuario, `buscarPorHash` vía `auth_buscar_sesion`)
- [ ] T036 Crear el servicio de aplicación `EmitirSesion` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/emitir-sesion.ts`: genera token de renovación de 256 bits, guarda solo su SHA-256 en `auth_session` dentro de la transacción vigente y firma el token de acceso; devuelve `{tokenAcceso, expiraEn, tokenRenovacion}` (R08)
- [ ] T037 Crear el caso de uso `ValidarSolicitud` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/validar-solicitud.ts`: con el `tid` del token ya verificado, en una transacción con ese tenant, comprueba con una consulta por clave que la sesión `sid` esté `ACTIVA`, la membresía `ACTIVA` con el mismo rol y el tenant `ACTIVA` (R09)
- [ ] T038 Crear la interfaz pública de M01 en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/index.ts` (exporta `ValidarSolicitud`, `AccesoBarberiasModule` y los tipos del usuario autenticado) y el módulo Nest en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/acceso-barberias.module.ts`

### Host: guards, validación y errores

- [ ] T039 Crear `AuthGuard` en `tecnologia/plataforma-barberias/backend/src/host/auth.guard.ts`: lee `Authorization: Bearer`, verifica con `TokenSigner`, llama a `ValidarSolicitud`, fija `TenantContext` con el `tid` del token y adjunta el usuario a la solicitud; cualquier fallo responde 401 `NO_AUTENTICADO` sin detalle; las rutas marcadas con `@Publica()` (decorador en `tecnologia/plataforma-barberias/backend/src/host/publica.decorator.ts`) lo omiten
- [ ] T040 Crear `RolesGuard` y el decorador `@Roles(...)` en `tecnologia/plataforma-barberias/backend/src/host/roles.guard.ts`: si el rol no está permitido responde 403 `ACCESO_DENEGADO` y registra `ACCESO_DENEGADO_ROL` con `AuditLog.registrarEnTransaccionPropia`
- [ ] T041 [P] Crear `TenantHeaderInterceptor` en `tecnologia/plataforma-barberias/backend/src/host/tenant-header.interceptor.ts`: rechaza con 400 `VALIDACION` cualquier solicitud con encabezado `X-Tenant-Id` o con parámetros de consulta `tenantId`, `tenant_id` o `barberiaId` (R11)
- [ ] T042 [P] Crear `ErrorFilter` en `tecnologia/plataforma-barberias/backend/src/host/error.filter.ts` que traduce errores de dominio y de validación al formato `{codigo, mensaje, detalles}` con los códigos y estados de [contracts/openapi.yaml](contracts/openapi.yaml); errores no previstos → 500 `ERROR_INTERNO` sin traza (R21)
- [ ] T043 Crear `tecnologia/plataforma-barberias/backend/src/host/app.module.ts` y `tecnologia/plataforma-barberias/backend/src/main.ts`: prefijo `/api/v1`, `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted`, límite de cuerpo 16 KB, `cookie-parser`, CORS solo `CORS_ORIGIN` con credenciales, `ThrottlerModule` en memoria como freno general, guards globales `AuthGuard` y `RolesGuard`, `TenantHeaderInterceptor`, `ErrorFilter` e identificador de correlación por solicitud
- [ ] T044 [P] Crear `GET /api/v1/salud` (público; consulta `SELECT 1`; 503 si falla) en `tecnologia/plataforma-barberias/backend/src/host/salud.controller.ts`
- [ ] T045 Prueba de integración de `AuthGuard` en `tecnologia/plataforma-barberias/backend/test/integration/host/auth-guard.spec.ts` (PR07 base): sin token, token vencido, firma alterada, algoritmo `none`/HS256, `kid` desconocido y sesión `CERRADA` → 401 con el mismo cuerpo; token válido de una sesión sembrada → pasa y fija el tenant
- [ ] T046 Prueba de arquitectura PR14: configurar `tecnologia/plataforma-barberias/backend/.dependency-cruiser.cjs` con (a) la matriz de módulos (M01 → M03 y M06; M03 → M06; M06 → ninguno; entre módulos solo `index.ts`) y (b) la regla de capas (`domain` no importa otras capas ni `@nestjs/*`, `kysely`, `pg`, `argon2`, `jose`; `application` no importa `infrastructure` ni `presentation`), y el script `test:arch` que falla ante cualquier violación; añadir `tecnologia/plataforma-barberias/backend/test/architecture/reglas.spec.ts` que comprueba que una importación prohibida de ejemplo es detectada

### Frontend base

- [ ] T047 [P] Generar los tipos de la API desde `specs/001-registro-acceso-barberia/contracts/openapi.yaml` con el script `gen:api` en `tecnologia/plataforma-barberias/frontend/package.json` hacia `tecnologia/plataforma-barberias/frontend/src/api/schema.d.ts`
- [ ] T048 Crear el cliente HTTP en `tecnologia/plataforma-barberias/frontend/src/api/client.ts`: base `/api/v1`, `credentials: 'include'`, añade el token de acceso en memoria, ante 401 intenta una sola vez `POST /auth/refresh` y repite la solicitud, y convierte el formato de error en un `ApiError` tipado
- [ ] T049 [P] Crear la estructura de la aplicación con React Router y TanStack Query en `tecnologia/plataforma-barberias/frontend/src/main.tsx`, `tecnologia/plataforma-barberias/frontend/src/routes.tsx` y estilos base móvil primero en `tecnologia/plataforma-barberias/frontend/src/styles/global.css`
- [ ] T050 [P] Configurar Vitest con jsdom y MSW en `tecnologia/plataforma-barberias/frontend/vite.config.ts` y `tecnologia/plataforma-barberias/frontend/test/setup.ts`, con los manejadores base en `tecnologia/plataforma-barberias/frontend/test/msw-handlers.ts`

**Checkpoint**: Fundación lista; las historias pueden empezar.

---

## Phase 3: User Story 1 - Registrar la barbería y empezar la prueba gratuita (Priority: P1) 🎯 MVP

**Goal**: Un visitante registra su barbería y obtiene, en una sola transacción, su espacio de trabajo, la cuenta de propietario y la suscripción TRIAL, y entra con sesión iniciada (RF01, RF18, HU02).

**Independent Test**: `POST /api/v1/barberias` con datos válidos crea `tenant`, `user_account`, `membership` PROPIETARIO, `terms_acceptance` y `subscription` TRIAL con `trial_ends_at` a 14 días, devuelve 201 con sesión y no pide datos de pago; un fallo simulado a mitad no deja nada (quickstart escenarios 1 y 2).

### Tests for User Story 1 (MANDATORY - constitution Principle X) ⚠️

> **NOTE: Escribir estas pruebas PRIMERO y comprobar que FALLAN antes de implementar**

- [ ] T051 [P] [US1] Pruebas unitarias de `NombreBarberia`, `Slug` y `Suscripcion.iniciarPrueba` (TRIAL, `trial_ends_at = inicio + trial_days`) en `tecnologia/plataforma-barberias/backend/test/unit/barberias/registro-dominio.spec.ts`
- [ ] T052 [P] [US1] Prueba de contrato de `POST /api/v1/barberias` contra [contracts/openapi.yaml](contracts/openapi.yaml) (201 con `barberia`, `suscripcion`, `sesion` y cookie `rt` HttpOnly/Secure/SameSite=Strict/Path=/api/v1/auth; 400 con campos inválidos o con `tenantId` en el cuerpo; 409 `CORREO_NO_DISPONIBLE` sin nombre de barbería) en `tecnologia/plataforma-barberias/backend/test/contract/registro-barberia.contract.spec.ts`
- [ ] T053 [P] [US1] Prueba de integración del registro en `tecnologia/plataforma-barberias/backend/test/integration/barberias/registrar-barberia.spec.ts`: crea todas las filas con el mismo `tenant_id`; correo con mayúsculas y espacios se normaliza; dos barberías con el mismo nombre obtienen slugs distintos; dos registros simultáneos con el mismo correo → uno 201 y otro 409; un fallo forzado en `iniciarPruebaGratuita` revierte todo (0 filas nuevas en todas las tablas); se registra `BARBERIA_REGISTRADA` en `audit_log`; versiones de términos distintas de las vigentes → 400
- [ ] T054 [P] [US1] Prueba de la página de registro en `tecnologia/plataforma-barberias/frontend/test/pages/registro.spec.tsx`: validación de campos, ausencia de cualquier campo de pago, envío correcto redirige a `/app`, error 409 muestra mensaje genérico

### Implementation for User Story 1

- [ ] T055 [P] [US1] Crear la migración M03 `tecnologia/plataforma-barberias/backend/migrations/0003_suscripciones.ts`: tabla global `plan` con semilla `TRIAL` (`trial_days = 14`, `max_users = 5`, `max_barbers = 5`, `ai_enabled = false`) y tabla `subscription` (`UNIQUE (tenant_id)`, `CHECK status IN (...)` de [data-model.md](data-model.md)) con RLS `FORCE` y política `tenant_isolation`; GRANT `plan` SELECT y `subscription` SELECT/INSERT a `barberias_app`
- [ ] T056 [P] [US1] Crear la migración `tecnologia/plataforma-barberias/backend/migrations/0004_aceptacion_terminos.ts`: tabla `terms_acceptance` con `CHECK document IN ('TERMINOS','POLITICA_DATOS')`, RLS `FORCE`, política `tenant_isolation` y GRANT solo SELECT/INSERT
- [ ] T057 [P] [US1] Crear las entidades `Plan` y `Suscripcion` (`iniciarPrueba(plan, ahora)`) en `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/suscripciones/domain/plan.ts` y `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/suscripciones/domain/suscripcion.ts`
- [ ] T058 [US1] Crear el repositorio Kysely de suscripciones (usa la transacción de `UnitOfWork`) en `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/suscripciones/infrastructure/kysely-suscripcion-repository.ts` y los casos de uso `IniciarPruebaGratuita` y `ObtenerLimiteUsuarios` en `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/suscripciones/application/iniciar-prueba-gratuita.ts` y `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/suscripciones/application/obtener-limite-usuarios.ts`
- [ ] T059 [US1] Crear la interfaz pública de M03 `SuscripcionesApi` (`iniciarPruebaGratuita(tenantId)` → `{estado, plan, iniciaEn, venceEn}`, `obtenerLimiteUsuarios(tenantId)`) en `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/index.ts` y el módulo Nest en `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/suscripciones-pagos.module.ts`
- [ ] T060 [P] [US1] Crear `Barberia`, `NombreBarberia`, `Slug` (derivado del nombre, solo `[a-z0-9-]`) y `AceptacionTerminos` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/domain/barberia.ts`, `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/domain/nombre-barberia.ts`, `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/domain/slug.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/domain/aceptacion-terminos.ts`
- [ ] T061 [P] [US1] Crear `TenantRepository` (insertar con slug único reintentando con sufijo, buscar estado) y `TermsAcceptanceRepository` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/infrastructure/kysely-tenant-repository.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/infrastructure/kysely-terms-acceptance-repository.ts`
- [ ] T062 [P] [US1] Crear el puerto `UsuarioRepository` (crear cuenta, crear membresía, buscar cuenta por correo; traduce la violación de `UNIQUE (email)` a `CorreoNoDisponible`) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/ports/usuario-repository.ts` y su implementación en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/kysely-usuario-repository.ts`
- [ ] T063 [US1] Crear el caso de uso `RegistrarBarberia` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/application/registrar-barberia.ts`: valida versiones de términos vigentes; en un solo `UnitOfWork` inserta `tenant`, fija el tenant nuevo, crea `user_account` con hash Argon2id, `membership` PROPIETARIO `ACTIVA`, dos `terms_acceptance`, llama a `SuscripcionesApi.iniciarPruebaGratuita`, registra `BARBERIA_REGISTRADA` y llama a `EmitirSesion`; cualquier error revierte todo (FR-001 a FR-006, R12)
- [ ] T064 [US1] Crear el DTO `RegistroBarberiaDto` (validaciones y longitudes de [contracts/openapi.yaml](contracts/openapi.yaml)) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/presentation/registro-barberia.dto.ts` y `BarberiasController` (`POST /barberias`, `@Publica()`, 201 + cookie `rt`) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/presentation/barberias.controller.ts`; aplicar un límite de solicitudes por IP a esta ruta (429 `DEMASIADOS_INTENTOS`)
- [ ] T065 [US1] Registrar `BarberiasController`, `RegistrarBarberia` y repositorios en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/acceso-barberias.module.ts` e importar `SuscripcionesPagosModule` solo a través de `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/index.ts`
- [ ] T066 [US1] Crear la página de registro en `tecnologia/plataforma-barberias/frontend/src/pages/Registro.tsx` (react-hook-form + zod con las reglas del contrato; casillas de términos y política con sus versiones; sin campos de pago; tras 201 guarda la sesión y navega a `/app`) y su ruta `/registro` en `tecnologia/plataforma-barberias/frontend/src/routes.tsx`
- [ ] T067 [US1] Crear una pantalla `/app` mínima de bienvenida que muestra el nombre de la barbería y los días restantes de prueba en `tecnologia/plataforma-barberias/frontend/src/pages/Inicio.tsx`

**Checkpoint**: Registro funcional y probado por sí solo (quickstart escenarios 1 y 2).

---

## Phase 4: User Story 2 - Iniciar y cerrar sesión de forma segura (Priority: P1)

**Goal**: Usuarios activos inician sesión con correo y contraseña, renuevan su token, consultan quiénes son y cierran sesión; el sistema limita intentos y rechaza usuarios desactivados o barberías suspendidas (RF04, HU05).

**Independent Test**: Con una barbería y su propietario sembrados por `fixtures.ts`, iniciar sesión, llamar a `GET /auth/yo`, renovar, cerrar sesión y comprobar que el token anterior da 401 (quickstart escenarios 3, 4, 5 y 9).

### Tests for User Story 2 (MANDATORY - constitution Principle X) ⚠️

- [ ] T068 [P] [US2] Prueba unitaria de `PoliticaIntentos` (sexto fallo en 60 s bloquea; `Retry-After` 30, 60, 120 s… hasta 900 s; un acierto reinicia) en `tecnologia/plataforma-barberias/backend/test/unit/identidad/politica-intentos.spec.ts`
- [ ] T069 [P] [US2] Prueba de contrato de `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` y `GET /auth/yo` contra [contracts/openapi.yaml](contracts/openapi.yaml) en `tecnologia/plataforma-barberias/backend/test/contract/auth.contract.spec.ts`
- [ ] T070 [P] [US2] Prueba de integración PR07 en `tecnologia/plataforma-barberias/backend/test/integration/identidad/autenticacion.spec.ts`: correo inexistente, contraseña errada y cuenta `PENDIENTE` → mismo 401 `CREDENCIALES_INVALIDAS`; el token emitido contiene `sub`, `tid`, `rol`, `sid` y vence en 900 s; usuario `DESACTIVADA` o tenant `SUSPENDIDA` → 403 `ACCESO_SUSPENDIDO` sin token; renovar rota la cookie y reutilizar la anterior revoca la sesión y registra `SESION_REUTILIZADA`; tras `logout`, el token de acceso y la cookie dan 401 de inmediato (SC-004); la base guarda contraseñas solo como cadena Argon2id
- [ ] T071 [P] [US2] Prueba de integración PR12 en `tecnologia/plataforma-barberias/backend/test/integration/identidad/limite-intentos.spec.ts`: 5 fallos en 60 s para la misma cuenta e IP pasan, el sexto da 429 con `Retry-After`; otra cuenta desde la misma IP y la misma cuenta desde otra IP siguen pudiendo entrar (SC-006)
- [ ] T072 [P] [US2] Prueba del flujo de sesión del frontend en `tecnologia/plataforma-barberias/frontend/test/auth/sesion.spec.tsx`: inicio de sesión guarda el token solo en memoria, la recarga recupera la sesión con `/auth/refresh`, un 401 dispara una sola renovación, cerrar sesión limpia el estado y lleva a `/ingresar`, y un 429 muestra el tiempo de espera

### Implementation for User Story 2

- [ ] T073 [P] [US2] Crear la migración `tecnologia/plataforma-barberias/backend/migrations/0005_inicio_sesion.ts`: tabla global `login_attempt` (`email_hash`, `ip`, `attempted_at`, índice `(email_hash, ip, attempted_at)`, GRANT SELECT/INSERT/DELETE a `barberias_app`) y función `auth_resolver_membresia(uuid)` `SECURITY DEFINER` con `search_path` fijo que devuelve como máximo una fila (`tenant_id`, `role_code`, `membership_status`, `tenant_status`) de la membresía de personal del usuario; `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE` a `barberias_app` (R05, R10)
- [ ] T074 [P] [US2] Crear `PoliticaIntentos` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/politica-intentos.ts`
- [ ] T075 [P] [US2] Crear el puerto `IntentosRepository` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/ports/intentos-repository.ts` y su implementación (contar fallos de la ventana por `email_hash` + IP, registrar fallo, borrar al acertar, purgar filas de más de 24 h) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/kysely-intentos-repository.ts`
- [ ] T076 [P] [US2] Añadir a `UsuarioRepository` `buscarParaAutenticar(correo)` (incluye `password_hash`) y `resolverMembresia(userId)` vía `auth_resolver_membresia` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/kysely-usuario-repository.ts`
- [ ] T077 [US2] Crear el caso de uso `IniciarSesion` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/iniciar-sesion.ts`: aplica `PoliticaIntentos`; busca la cuenta y, si no existe o no tiene contraseña, ejecuta `verificarFicticio` y lanza `CredencialesInvalidas`; verifica la contraseña; resuelve la membresía; si el usuario o el tenant no están activos lanza `AccesoSuspendido`; en `UnitOfWork` con ese tenant llama a `EmitirSesion` (FR-007 a FR-010, FR-013)
- [ ] T078 [US2] Crear los casos de uso `RenovarSesion` (busca por hash con `auth_buscar_sesion`; si es token anterior revoca y registra `SESION_REUTILIZADA`; comprueba vigencia, membresía y tenant; rota) y `CerrarSesion` (marca `CERRADA` la sesión `sid` del token) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/renovar-sesion.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/cerrar-sesion.ts` (FR-008, FR-011)
- [ ] T079 [US2] Crear el caso de uso `ObtenerUsuarioActual` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/obtener-usuario-actual.ts` (usuario y barbería del tenant del contexto)
- [ ] T080 [US2] Crear `LoginDto` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/presentation/login.dto.ts` y `AuthController` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/presentation/auth.controller.ts` con `POST /auth/login` (`@Publica()`, cookie `rt`), `POST /auth/refresh` (`@Publica()`, lee y rota la cookie), `POST /auth/logout` (204, borra la cookie con `Max-Age=0`) y `GET /auth/yo`; respuesta 429 con encabezado `Retry-After`
- [ ] T081 [US2] Registrar `AuthController` y los casos de uso de sesión en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/acceso-barberias.module.ts`
- [ ] T082 [P] [US2] Crear `SesionProvider` y el hook `useSesion` en `tecnologia/plataforma-barberias/frontend/src/auth/SesionProvider.tsx` (token en memoria, renovación al cargar, `iniciarSesion`, `cerrarSesion`, usuario actual)
- [ ] T083 [P] [US2] Crear el componente `RutaProtegida` (redirige a `/ingresar` sin sesión; acepta roles permitidos) en `tecnologia/plataforma-barberias/frontend/src/auth/RutaProtegida.tsx`
- [ ] T084 [US2] Crear la página `/ingresar` en `tecnologia/plataforma-barberias/frontend/src/pages/Ingresar.tsx` (mensaje genérico ante 401, mensaje de cuenta suspendida ante 403, tiempo de espera ante 429) y un botón "Cerrar sesión" en `tecnologia/plataforma-barberias/frontend/src/components/BarraSuperior.tsx`; proteger `/app` con `RutaProtegida` en `tecnologia/plataforma-barberias/frontend/src/routes.tsx`

**Checkpoint**: US1 y US2 funcionan cada una por sí sola.

---

## Phase 5: User Story 3 - Aislamiento total entre barberías (Priority: P1)

**Goal**: Demostrar y reforzar que ningún usuario de la barbería A puede ver ni modificar datos de B, con la barbería tomada solo del token (EQ-09, principio III).

**Independent Test**: Ejecutar `npm run test:int -- aislamiento` con dos barberías sembradas: todas las comprobaciones de PR09 en verde y 0 filas de B visibles o modificadas desde A (quickstart escenarios 13 y 14).

### Tests for User Story 3 (MANDATORY - constitution Principle X) ⚠️

- [ ] T085 [P] [US3] Prueba PR09 a nivel de base en `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/rls.spec.ts`: con el pool `barberias_app` (a) sin `set_config`, `SELECT count(*)` da 0 en `membership`, `auth_session`, `terms_acceptance`, `subscription` y `audit_log` (la lista se obtiene de `pg_class` filtrando tablas con `relrowsecurity` y `relforcerowsecurity`, y la prueba falla si alguna tabla con columna `tenant_id` no tiene ambas); (b) con el contexto de A no aparece ninguna fila de B; (c) `INSERT`/`UPDATE` con `tenant_id` de B estando en el contexto de A fallan por `WITH CHECK`; (d) `barberias_app` no tiene `rolbypassrls` ni es dueño de ninguna tabla; (e) `UPDATE`/`DELETE` sobre `audit_log` están denegados
- [ ] T086 [P] [US3] Prueba PR09 de las funciones `SECURITY DEFINER` en `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/funciones-definer.spec.ts`: `auth_buscar_sesion` y `auth_resolver_membresia` devuelven como máximo una fila, no aceptan `tenant_id`, devuelven 0 filas con entradas inexistentes y `barberias_app` no puede ejecutar ninguna otra función `SECURITY DEFINER` del esquema
- [ ] T087 [US3] Prueba PR09 HTTP parametrizada en `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/aislamiento-tenant.spec.ts`, que recorre un registro de endpoints protegidos exportado desde `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/endpoints-protegidos.ts` (inicialmente `GET /auth/yo` y `POST /auth/logout`): con el token del propietario de A, enviando `tenantId`/`tenant_id`/`barberiaId` de B en cuerpo y consulta, y `X-Tenant-Id` de B en encabezado, la respuesta es 400 `VALIDACION` y la de `GET /auth/yo` sin esos campos solo muestra la barbería A; cada intento queda en `audit_log` de A como `ACCESO_TENANT_AJENO`; los datos de B no cambian (comparación de filas antes y después con el pool `barberias_owner`)
- [ ] T088 [P] [US3] Prueba de que un token firmado con una clave ajena, o con `tid` alterado sin volver a firmar, da 401, en `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/token-tenant.spec.ts`

### Implementation for User Story 3

- [ ] T089 [US3] Ampliar `TenantHeaderInterceptor` en `tecnologia/plataforma-barberias/backend/src/host/tenant-header.interceptor.ts` para detectar también `tenantId`, `tenant_id` y `barberiaId` en el cuerpo antes de la validación, y registrar cada intento explícito (cuerpo, consulta o encabezado `X-Tenant-Id`) como `ACCESO_TENANT_AJENO` con `AuditLog.registrarEnTransaccionPropia` en el tenant del token (si la solicitud está autenticada) antes de responder 400
- [ ] T090 [US3] Asegurar que todo repositorio de tablas con tenant filtra explícitamente por `TenantContext.actual()` además de RLS (defensa en profundidad): revisar y completar `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/kysely-sesion-repository.ts`, `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/kysely-usuario-repository.ts`, `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/infrastructure/kysely-terms-acceptance-repository.ts` y `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/suscripciones/infrastructure/kysely-suscripcion-repository.ts`
- [ ] T091 [US3] Añadir una regla a `tecnologia/plataforma-barberias/backend/.dependency-cruiser.cjs` que prohíba importar `kysely` o `src/shared/persistence/database.ts` fuera de carpetas `infrastructure/` y de `src/shared/persistence/`, para que ningún controlador o caso de uso consulte la base sin pasar por un repositorio con contexto

**Checkpoint**: US1, US2 y US3 completas; PR09 en verde sobre todos los endpoints existentes.

---

## Phase 6: User Story 4 - El propietario crea usuarios barberos (Priority: P2)

**Goal**: El propietario crea usuarios con rol BARBERO, les entrega un enlace de activación de un solo uso, los lista, y los desactiva o reactiva; los barberos no pueden gestionar usuarios (RF06, HU04).

**Independent Test**: Con la sesión de un propietario sembrado, crear un barbero, activar su cuenta con el enlace, iniciar sesión como barbero y comprobar que su token lleva `rol = BARBERO` y el `tid` del propietario y que `POST /usuarios` le da 403 (quickstart escenarios 6, 7, 8, 10, 11 y 12).

### Tests for User Story 4 (MANDATORY - constitution Principle X) ⚠️

- [ ] T092 [P] [US4] Pruebas unitarias de `Activacion` (un solo uso, vencimiento a 72 h, revocada) y `LimiteUsuarios` (cuenta `PENDIENTE` + `ACTIVA`) en `tecnologia/plataforma-barberias/backend/test/unit/identidad/activacion-limite.spec.ts`
- [ ] T093 [P] [US4] Prueba de contrato de `GET/POST /usuarios`, `GET/PATCH /usuarios/{id}`, `POST /usuarios/{id}/activacion` y `POST /auth/activar` contra [contracts/openapi.yaml](contracts/openapi.yaml) en `tecnologia/plataforma-barberias/backend/test/contract/usuarios.contract.spec.ts`
- [ ] T094 [P] [US4] Prueba PR08 parametrizada en `tecnologia/plataforma-barberias/backend/test/contract/rbac.spec.ts`: cada celda de [contracts/rbac.md](contracts/rbac.md) (PUB, PROPIETARIO, BARBERO × operación) es un caso con el estado esperado (200/201/204, 401 o 403); cada 403 deja `ACCESO_DENEGADO_ROL` en `audit_log`
- [ ] T095 [P] [US4] Prueba de integración en `tecnologia/plataforma-barberias/backend/test/integration/identidad/usuarios.spec.ts`: crear con `rol` distinto de `BARBERO` (`PROPIETARIO`, `CLIENTE`, `ADMIN_PLATAFORMA`, inexistente) → 400; crear barbero → `PENDIENTE` con enlace; activar → 204 y el barbero inicia sesión; reutilizar, usar vencido o usar revocado → 400 `ENLACE_INVALIDO`; regenerar invalida el anterior; correo existente → 409 sin barbería; superar `max_users` del plan → 403 `SUSCRIPCION_NO_PERMITE` con `motivo = LIMITE_USUARIOS`; desactivar revoca sus sesiones (su siguiente solicitud da 401 y su login da 403) y conserva sus datos; reactivar sin contraseña vuelve a `PENDIENTE`; el propietario no puede desactivarse a sí mismo (422); cada acción queda en `audit_log` (PR13)
- [ ] T096 [US4] Añadir `GET /usuarios`, `GET /usuarios/{id}`, `PATCH /usuarios/{id}`, `POST /usuarios` y `POST /usuarios/{id}/activacion` al registro de `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/endpoints-protegidos.ts`, y ampliar `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/aislamiento-tenant.spec.ts` para que, con el token de A y el `id` de un usuario de B, `GET` y `PATCH` den 404 `NO_ENCONTRADO`, `POST /usuarios/{id de B}/activacion` dé 404, `GET /usuarios` de A no liste a nadie de B y los datos de B no cambien (PR09); verificar también que esas respuestas 404 no crean filas `ACCESO_TENANT_AJENO` (solo los intentos explícitos se auditan, escenario 4 de US3)
- [ ] T097 [P] [US4] Pruebas de las páginas de usuarios y activación en `tecnologia/plataforma-barberias/frontend/test/pages/usuarios.spec.tsx` y `tecnologia/plataforma-barberias/frontend/test/pages/activar.spec.tsx`: crear barbero muestra el enlace con botón copiar; desactivar pide confirmación; el propietario no ve la acción de desactivarse; un barbero no ve el menú de usuarios; enlace inválido muestra mensaje

### Implementation for User Story 4

- [ ] T098 [P] [US4] Crear la migración `tecnologia/plataforma-barberias/backend/migrations/0006_activacion.ts`: tabla `account_activation` (`UNIQUE (token_hash)`, FK compuesta a la membresía) con RLS `FORCE`, política `tenant_isolation` y GRANT SELECT/INSERT/UPDATE(used_at, revoked_at); función `auth_buscar_activacion(char(64))` `SECURITY DEFINER` con `search_path` fijo, máximo una fila, `REVOKE ALL FROM PUBLIC` y `GRANT EXECUTE` a `barberias_app`; añadir esta función a la lista de `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/funciones-definer.spec.ts`
- [ ] T099 [P] [US4] Crear la entidad `Activacion` y el servicio de dominio `LimiteUsuarios` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/activacion.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/limite-usuarios.ts`
- [ ] T100 [P] [US4] Crear el puerto `ActivacionRepository` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/ports/activacion-repository.ts` y su implementación (crear, revocar vigentes de un usuario, buscar por hash vía `auth_buscar_activacion`, marcar usada) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/kysely-activacion-repository.ts`
- [ ] T101 [US4] Añadir a `UsuarioRepository` `listar({pagina, tamano, rol, estado})`, `obtener(id)`, `contarPersonalVigente()` y `actualizarEstado(id, estado)`, todos filtrados por el tenant del contexto, en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/kysely-usuario-repository.ts`
- [ ] T102 [US4] Crear el caso de uso `CrearUsuario` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/crear-usuario.ts`: exige `Rol.esAsignablePorPropietario()`; consulta `SuscripcionesApi.obtenerLimiteUsuarios` y aplica `LimiteUsuarios`; crea `user_account` sin contraseña y `membership` `BARBERO` `PENDIENTE`; genera token de activación de 256 bits (guarda su SHA-256, vence a 72 h); registra `USUARIO_CREADO`; devuelve el usuario y el enlace `FRONTEND_BASE_URL/activar?token=…` (FR-015 a FR-017, FR-020, FR-022, R14)
- [ ] T103 [US4] Crear los casos de uso `ListarUsuarios` y `ObtenerUsuario` (404 si no está en el tenant del contexto) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/listar-usuarios.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/obtener-usuario.ts`
- [ ] T104 [US4] Crear el caso de uso `ActualizarUsuario` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/actualizar-usuario.ts`: solo cambia `estado`; rechaza sobre sí mismo (`OperacionNoPermitida`); al desactivar revoca todas las sesiones del usuario en la misma transacción; al reactivar vuelve a `ACTIVA` o a `PENDIENTE` si nunca fijó contraseña; registra `USUARIO_DESACTIVADO` o `USUARIO_REACTIVADO` (FR-018, FR-019)
- [ ] T105 [US4] Crear los casos de uso `RegenerarActivacion` (solo usuarios `PENDIENTE`, revoca el token anterior, registra `ACTIVACION_REGENERADA`) y `ActivarCuenta` (busca por hash, valida con `Activacion.usar`, fija la contraseña con `Contrasena` y Argon2id, membresía `ACTIVA`) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/regenerar-activacion.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/activar-cuenta.ts`
- [ ] T106 [US4] Crear los DTO `CrearUsuarioDto` (`rol` solo `BARBERO`), `ActualizarUsuarioDto` (`estado` obligatorio: `ACTIVA` o `DESACTIVADA`), `ListarUsuariosQuery` y `ActivacionDto` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/presentation/usuarios.dto.ts`, y `UsuariosController` con `@Roles('PROPIETARIO')` para `GET/POST /usuarios`, `GET/PATCH /usuarios/:id` (`ParseUUIDPipe`) y `POST /usuarios/:id/activacion` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/presentation/usuarios.controller.ts`
- [ ] T107 [US4] Añadir `POST /auth/activar` (`@Publica()`, límite de solicitudes por IP) a `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/presentation/auth.controller.ts` y registrar `UsuariosController` y los nuevos casos de uso en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/acceso-barberias.module.ts`
- [ ] T108 [US4] Crear la página `/app/usuarios` (solo PROPIETARIO) en `tecnologia/plataforma-barberias/frontend/src/pages/Usuarios.tsx`: lista paginada con filtro por estado, formulario "Nuevo barbero" (nombre y correo; el rol se envía fijo como `BARBERO`), diálogo con el enlace de activación y botón copiar, acciones desactivar/reactivar/regenerar enlace, mensaje del límite del plan; añadir la ruta y el enlace de menú visible solo para PROPIETARIO en `tecnologia/plataforma-barberias/frontend/src/routes.tsx` y `tecnologia/plataforma-barberias/frontend/src/components/BarraSuperior.tsx`
- [ ] T109 [US4] Crear la página pública `/activar` en `tecnologia/plataforma-barberias/frontend/src/pages/Activar.tsx` que lee `token` de la URL, pide la contraseña dos veces con las reglas de `Contrasena` y, tras 204, lleva a `/ingresar`

**Checkpoint**: Las cuatro historias funcionan y se prueban de forma independiente.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentación exigida por la constitución, revisión de seguridad y validación final.

- [ ] T110 [P] Añadir a "Casos especiales" de `docs/02-arquitectura-software/multi-tenancy-y-datos.md` las tres funciones `SECURITY DEFINER` de autenticación (qué devuelven, por qué no reciben tenant y cómo se prueban), según R05 (principio XI)
- [ ] T111 [P] Registrar en `docs/02-arquitectura-software/tecnologias.md` las librerías elegidas (Kysely, `argon2`, `jose`, `class-validator`, React Router, TanStack Query, react-hook-form, zod, Vitest, MSW, Testcontainers, dependency-cruiser) con su justificación, como pide ADR-014
- [ ] T112 [P] Actualizar `docs/trazabilidad.md` con la cadena HU02/HU04/HU05 → RF01/RF04/RF06/RF18 → EQ-07/08/09/10/12/13 → ADR-003/010 → componentes de M01, M03 y M06 → pruebas PR07, PR08, PR09, PR10, PR12, PR13, PR14, y marcar esos componentes como **implementado**
- [ ] T113 [P] Prueba PR10 de entradas en `tecnologia/plataforma-barberias/backend/test/integration/host/entradas.spec.ts`: cargas con `<script>`, `' OR 1=1 --`, caracteres de control, campos de 10 000 caracteres y cuerpos de más de 16 KB en `POST /barberias`, `POST /auth/login` y `POST /usuarios` → 400 o 413 con mensaje controlado y sin filas creadas
- [ ] T114 Revisión de seguridad de registros en `tecnologia/plataforma-barberias/backend/src/host/app.module.ts` y en el logger: ningún registro contiene contraseñas, tokens, cookies ni el encabezado `Authorization`; añadir una prueba en `tecnologia/plataforma-barberias/backend/test/integration/host/registros.spec.ts` que capture la salida del logger durante registro, login y creación de usuario y verifique que no aparecen esos valores
- [ ] T115 Medir el tiempo de `POST /auth/login` con 50 inicios de sesión secuenciales en `tecnologia/plataforma-barberias/backend/test/integration/identidad/rendimiento-login.spec.ts` y comprobar p95 < 2 s (SC-008); si no se cumple, ajustar los parámetros Argon2 dentro del mínimo de OWASP
- [ ] T116 Ejecutar los 14 escenarios de [quickstart.md](quickstart.md) con `docker compose up` y anotar el resultado de cada uno en `specs/001-registro-acceso-barberia/quickstart.md` (columna o lista de verificación al final)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias.
- **Foundational (Phase 2)**: depende de Setup; BLOQUEA todas las historias.
- **US1 (Phase 3)** y **US2 (Phase 4)**: dependen solo de Foundational; pueden hacerse en paralelo.
- **US3 (Phase 5)**: depende de Foundational y de US2 (necesita al menos un endpoint autenticado, `GET /auth/yo`, para la suite HTTP); sus pruebas de base cubren también las tablas de US1 si ya existen, porque recorren `pg_class`.
- **US4 (Phase 6)**: depende de Foundational y de US2 (el barbero activado debe iniciar sesión). Extiende las suites de US3 (T096, T098), así que conviene hacerla después de US3.
- **Polish (Phase 7)**: después de todas las historias.

### User Story Dependencies

```text
Setup → Foundational ─┬─ US1 (registro) ──────────────┐
                      └─ US2 (sesión) ─┬─ US3 (aislamiento) ─┬─ US4 (barberos) → Polish
                                       └─────────────────────┘
```

### Within Each User Story

- Las pruebas se escriben primero y deben FALLAR antes de implementar.
- Migración → dominio → repositorios → casos de uso → controladores → frontend.
- Cerrar cada historia en su checkpoint antes de la siguiente prioridad.

### Parallel Opportunities

- Setup: T003, T004, T005, T006, T008 y T009 en paralelo tras T002.
- Foundational: T014–T019, T025–T034 y T047–T050 en paralelo; T020 → T021 → T036–T039 en secuencia.
- US1 y US2 en paralelo por dos personas tras Foundational.
- Dentro de cada historia, todas las pruebas marcadas [P] en paralelo, y migración, dominio y repositorios [P] en paralelo.

---

## Parallel Example: User Story 1

```bash
# Pruebas de US1 juntas:
Task: "T051 Pruebas unitarias de NombreBarberia, Slug y Suscripcion.iniciarPrueba"
Task: "T052 Prueba de contrato de POST /api/v1/barberias"
Task: "T053 Prueba de integración del registro"
Task: "T054 Prueba de la página de registro"

# Piezas independientes de US1 juntas:
Task: "T055 Migración 0003_suscripciones"
Task: "T056 Migración 0004_aceptacion_terminos"
Task: "T057 Entidades Plan y Suscripcion"
Task: "T060 Barberia, NombreBarberia, Slug, AceptacionTerminos"
Task: "T061 TenantRepository y TermsAcceptanceRepository"
Task: "T062 UsuarioRepository"
```

## Parallel Example: User Story 2

```bash
Task: "T068 Prueba unitaria de PoliticaIntentos"
Task: "T069 Prueba de contrato de /auth/*"
Task: "T070 Prueba de integración PR07"
Task: "T071 Prueba de integración PR12"
Task: "T072 Prueba del flujo de sesión del frontend"

Task: "T073 Migración 0005_inicio_sesion"
Task: "T074 PoliticaIntentos"
Task: "T075 IntentosRepository"
Task: "T082 SesionProvider"
Task: "T083 RutaProtegida"
```

## Parallel Example: User Story 4

```bash
Task: "T092 Pruebas unitarias de Activacion y LimiteUsuarios"
Task: "T093 Prueba de contrato de /usuarios y /auth/activar"
Task: "T094 Prueba PR08 parametrizada"
Task: "T095 Prueba de integración de usuarios"
Task: "T097 Pruebas de las páginas de usuarios y activación"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Phase 1: Setup.
2. Completar Phase 2: Foundational (incluye PR14 y el guard de autenticación).
3. Completar Phase 3: US1.
4. **DETENERSE Y VALIDAR**: quickstart escenarios 1 y 2; CI en verde.
5. Demostrar: una barbería se registra y entra a su espacio con prueba gratuita.

### Incremental Delivery

1. Setup + Foundational → base lista.
2. US1 → registro con prueba gratuita (MVP).
3. US2 → inicio y cierre de sesión con límite de intentos.
4. US3 → suite PR09 completa sobre lo construido.
5. US4 → personal barbero con activación, que amplía PR08 y PR09.
6. Polish → documentos de `docs/`, PR10, revisión de registros y quickstart.

### Parallel Team Strategy

1. Todo el equipo completa Setup + Foundational.
2. Luego: persona A con US1, persona B con US2.
3. Al terminar US2: persona B con US3; persona A con US4 tras US3.

---

## Notes

- [P] = archivos distintos, sin dependencias pendientes.
- La etiqueta [Story] vincula cada tarea con su historia para la trazabilidad (constitución, "Flujo de desarrollo").
- Comprobar que cada prueba falla antes de implementar.
- Commits convencionales (`feat`, `test`, `docs`, `chore`) por tarea o grupo lógico.
- Ninguna tarea acepta `tenant_id` del cliente ni usa Redis.
