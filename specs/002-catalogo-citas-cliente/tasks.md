---
description: 'Lista de tareas de la funcionalidad 002: catálogo, citas y cuenta de cliente'
---

# Tasks: Catálogo, citas y cuenta de cliente

**Input**: Documentos de diseño en `specs/002-catalogo-citas-cliente/`

**Prerequisites**:

- Diseño: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
  [data-model.md](data-model.md), [quickstart.md](quickstart.md).
- Contratos: [contracts/openapi.yaml](contracts/openapi.yaml), [contracts/rbac.md](contracts/rbac.md).
- ADR (Aceptados el 2026-10-17):
  [ADR-020](../../docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-020-cuenta-de-cliente-con-membresía-y-sesión-por-barbería)
  y [ADR-021](../../docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-021-lecturas-públicas-por-enlace-slug).
- Constitución 1.2.0.

**Tests**: OBLIGATORIAS (constitución, principio X). Cada historia incluye sus pruebas. Esta
funcionalidad toca:

- aislamiento entre barberías (**PR09**), incluida la vía pública y el cliente con membresía en dos
  barberías;
- reservas simultáneas (**PR16**: 200 solicitudes, 2 instancias);
- arquitectura de capas y módulos (**PR14**: M02 → M01, pool público confinado).

No toca webhooks de pago ni proveedores externos.

**Organization**: tareas agrupadas por historia de usuario.

- **Prioridad:** US1, US2 y US3 (P1) → US4 y US5 (P2) → US6 (P3).
- **Independencia:** la fase 2 deja el esquema completo y los ayudantes de siembra, así que cada
  historia se prueba sola sembrando sus datos.
- **Orden de trabajo del plan de entrega** (R20): primero PR16 y la exclusión (T075–T077), luego la
  vía pública (US2), la cuenta de cliente y la reserva (US3), y al final agenda, cancelación e
  historial.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: historia a la que pertenece (US1 a US6).
- Cada tarea indica la ruta exacta del archivo.

## Path Conventions

- **Ubicación (principio XII):** todo el código vive en `tecnologia/plataforma-barberias/`.
  - Backend: `tecnologia/plataforma-barberias/backend/src/`, con pruebas en
    `tecnologia/plataforma-barberias/backend/test/` y migraciones en
    `tecnologia/plataforma-barberias/backend/migrations/`.
  - Frontend: `tecnologia/plataforma-barberias/frontend/src/`, con pruebas en
    `tecnologia/plataforma-barberias/frontend/test/`.
- **Módulos nuevos o ampliados:** M02 aparece en el código como `modules/catalogo-citas/`, con los
  submódulos `catalogo` y `citas`. M01 gana el submódulo `clientes`. Cada submódulo tiene
  `presentation/`, `application/`, `domain/` e `infrastructure/`.
- **Matriz de módulos (ADR-020):** M02 importa solo `acceso-barberias/index.ts` (`ClientesApi`,
  `PersonalApi`, `BarberiasApi`, `Actor`), `suscripciones-pagos/index.ts` y `shared/index.ts`. M01
  nunca importa M02.
- **Regla para todo repositorio** (principio III, igual que en 001): filtra por
  `TenantContext.actual()` además de RLS. Las tablas nuevas tienen FK compuestas con `tenant_id`.
- **Regla para todo caso de uso protegido** (R22 de 001): su primera instrucción es la autorización
  del módulo:
  - M02: `AutorizacionCatalogoCitas.exigir(actor, operacion)`, con la matriz de
    [contracts/rbac.md](contracts/rbac.md).
  - M01: `Autorizacion.exigir` de 001.
- **Vía pública (ADR-021):** solo `modules/catalogo-citas/catalogo/infrastructure/publico/` usa
  `shared/lectura-publica.ts` (pool `barberias_publico`). PR14 lo verifica.
- **Selector `slug` (constitución 1.2.0, ADR-020):** solo lo aceptan `POST /clientes/registro`,
  `POST /auth/login` y `POST /auth/barberia`. Ninguna operación de negocio con sesión.
- Los identificadores R01–R20 remiten a [research.md](research.md); los FR y SC, a [spec.md](spec.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: rol de base de datos nuevo, configuración y estructura de carpetas.

- [X] T001 Agregar el rol `barberias_publico` en `tecnologia/plataforma-barberias/db/init/01-roles.sql` (idempotente):
  - `CREATE ROLE barberias_publico LOGIN PASSWORD 'barberias_publico_dev' NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE`.
  - `GRANT CONNECT` sobre la base y `GRANT USAGE ON SCHEMA public`.
  - Comentario: la contraseña es solo para desarrollo, y el rol no tiene `BYPASSRLS` (ADR-021).
- [X] T002 [P] Agregar `DATABASE_URL_PUBLICO`, `HORARIOS_PASO_MINUTOS=15` y `RESERVA_HORIZONTE_DIAS=30`:
  - con comentarios en `tecnologia/plataforma-barberias/.env.example`;
  - `DATABASE_URL_PUBLICO` como variable de entorno del servicio `backend` en `tecnologia/plataforma-barberias/docker-compose.yml` (host `db`).
- [X] T003 [P] Ampliar `Configuracion` en `tecnologia/plataforma-barberias/backend/src/shared/config/configuracion.ts` con `databaseUrlPublico`, `horariosPasoMinutos` (5–60, divisor de 60) y `reservaHorizonteDias` (1–90), validados al arrancar, y sus casos en `tecnologia/plataforma-barberias/backend/test/unit/shared/configuracion.spec.ts`
- [X] T004 [P] Ampliar el entorno de pruebas en `tecnologia/plataforma-barberias/backend/test/helpers/test-db.ts` y `tecnologia/plataforma-barberias/backend/test/helpers/entorno.ts`:
  - fijar `DATABASE_URL_PUBLICO` del contenedor;
  - exponer un cuarto pool `publico` (rol `barberias_publico`) para las pruebas de ADR-021.
- [X] T005 Crear la estructura de carpetas, con `.gitkeep` donde quede vacía:
  - `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/{catalogo,citas}/{presentation,application,domain,infrastructure}`;
  - `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/infrastructure/publico`;
  - `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/{presentation,application,domain,infrastructure}`;
  - `tecnologia/plataforma-barberias/backend/src/shared/tiempo`;
  - `tecnologia/plataforma-barberias/frontend/src/pages/{publico,cliente,panel}`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema completo con RLS y restricciones de exclusión, rol público, hora local, matrices
de permisos, interfaces entre módulos y reglas de arquitectura.

**⚠️ CRITICAL**: ninguna historia puede empezar hasta terminar esta fase.

### Base de datos

- [X] T006 Crear la migración `tecnologia/plataforma-barberias/backend/migrations/0009_cuenta_cliente.ts` según [data-model.md](data-model.md):
  - `membership.role_code` admite `CLIENTE`.
  - Tablas `customer_profile` (índice único parcial `customer_profile_cuenta`, índices de búsqueda) y `consent_record` (`CHECK` de `method`/`recorded_by`), ambas con `rlsPorTenant`, `UNIQUE (tenant_id, id)`, FK compuestas y permisos de la sección 2.
  - `CREATE OR REPLACE FUNCTION auth_resolver_cuenta(varchar)` con `LEFT JOIN` a la membresía de personal y al tenant (misma firma, misma salida, `LIMIT 1`, mismo dueño `barberias_auth`, `REVOKE`/`GRANT` repetidos).
  - Función `down` que restaura la versión con `JOIN`.
- [X] T007 Crear la migración `tecnologia/plataforma-barberias/backend/migrations/0010_catalogo.ts`:
  - **`tenant`:** columnas `address`, `phone`, `description`, `timezone` y `cancel_min_notice_minutes` con sus `CHECK`; `ENABLE` + `FORCE ROW LEVEL SECURITY` con las políticas `tenant_lectura` (SELECT `true`), `tenant_alta` (INSERT `true`) y `tenant_edicion` (UPDATE `id = TENANT_ACTUAL`); `GRANT UPDATE (name, slug, address, phone, description, cancel_min_notice_minutes)` a `barberias_app`.
  - **Tablas nuevas:** `business_hours`, `service` (índice único `(tenant_id, lower(name))`), `barber` (índice único parcial `(tenant_id, user_id)`), `barber_service`, `working_hours` y `time_off` (índice GiST por rango).
  - **En todas las tablas nuevas:** `rlsPorTenant`, `UNIQUE (tenant_id, id)`, FK compuestas, `CHECK` y permisos de `barberias_app` de [data-model.md](data-model.md).
  - Función `down`.
- [X] T008 Crear la migración `tecnologia/plataforma-barberias/backend/migrations/0011_citas.ts`:
  - `CREATE EXTENSION IF NOT EXISTS btree_gist`.
  - Tabla `appointment`:
    - columna generada `period tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED`;
    - restricciones `appointment_no_overlap_barber` y `appointment_no_overlap_customer` (`EXCLUDE USING gist ... WHERE (status IN ('PENDIENTE','CONFIRMADA'))`) y `appointment_cancelacion_coherente`;
    - índices `appointment_idempotencia`, `appointment_agenda` y `appointment_cliente`.
  - Tabla `appointment_status_history`.
  - RLS, FK compuestas y permisos de [data-model.md](data-model.md); `barberias_app` sin `DELETE`.
  - Función `down`.
- [X] T009 Crear la migración `tecnologia/plataforma-barberias/backend/migrations/0012_lectura_publica.ts`:
  - `GRANT SELECT` por columna a `barberias_publico`, con la lista cerrada de ADR-021 (decisión 2; desde la precisión del 2026-10-17 **sin** `tenant`, que resuelve M01): `business_hours`, `service`, `barber` (sin `user_id`), `barber_service`, `working_hours`, `time_off` (sin `reason`) y `appointment` (solo `tenant_id, barber_id, starts_at, ends_at, status`).
  - Función `down` con `REVOKE`.
- [X] T010 Ampliar los tipos de Kysely en `tecnologia/plataforma-barberias/backend/src/shared/persistence/db-types.ts`:
  - tablas nuevas y columnas nuevas de `tenant`;
  - `membership.role_code` con `CLIENTE`;
  - `period` solo de lectura.
- [X] T011 [P] Ampliar los ayudantes de siembra en `tecnologia/plataforma-barberias/backend/test/helpers/fixtures.ts` con el pool `seed`:
  - `sembrarHorarioAtencion`, `sembrarServicio`, `sembrarBarbero({usuarioId?, servicios})`, `sembrarDisponibilidad` y `sembrarBloqueo`;
  - `sembrarCliente({tenantId, conCuenta, correo, telefono})`: cuenta, membresía `CLIENTE`, perfil y consentimiento;
  - `sembrarCita({estado, inicio, ...})`.
- [X] T012 [P] Ampliar `tecnologia/plataforma-barberias/backend/test/helpers/sesiones.ts`:
  - `sesionCliente(tenantId, cuenta)`, que emite el token de un cliente con su `tid`;
  - `sesionBarberoVinculado(tenantId)`.
- [X] T013 Ampliar la prueba de RLS (PR09) en `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/rls.spec.ts`:
  - **Tablas nuevas:** con `barberias_app`, sin contexto ven 0 filas y con el contexto de A no ven ni modifican filas de B; insertar con el `tenant_id` de otra barbería falla por `WITH CHECK`; las FK compuestas impiden apuntar a filas de otra barbería.
  - **`tenant`:** `SELECT` libre, pero `UPDATE` de otra barbería afecta 0 filas.

### M06 núcleo compartido

- [X] T014 [P] Crear la hora local en `tecnologia/plataforma-barberias/backend/src/shared/tiempo/zona-horaria.ts` (R07):
  - `FechaLocal` (`YYYY-MM-DD`) y `ZonaHoraria` (`inicioDelDia`, `aInstante(fecha, minutos)`, `aLocal(instante)`, `diaSemana(fecha)`), con `Intl.DateTimeFormat` y sin dependencias;
  - exportar desde `tecnologia/plataforma-barberias/backend/src/shared/index.ts`.
- [X] T015 [P] Crear `HorarioSemanal` en `tecnologia/plataforma-barberias/backend/src/shared/tiempo/horario-semanal.ts` y exportarlo desde `tecnologia/plataforma-barberias/backend/src/shared/nucleo.ts`, para que lo use el dominio:
  - tramos `{diaSemana, inicioMin, finMin}` con `inicio < fin`, sin solapes por día;
  - operaciones `contiene(otro)`, `tramosDe(dia)` e `interseccion(otro, dia)`.
- [X] T016 [P] Pruebas unitarias de hora local en `tecnologia/plataforma-barberias/backend/test/unit/shared/zona-horaria.spec.ts` y `tecnologia/plataforma-barberias/backend/test/unit/shared/horario-semanal.spec.ts`:
  - `ZonaHoraria`: conversiones de `America/Lima` (−05:00), cortes de día a medianoche local, fin de mes y de año, día de la semana;
  - `HorarioSemanal`: solapes, tramos inválidos, `contiene` e intersección.
- [X] T017 Crear la lectura pública en `tecnologia/plataforma-barberias/backend/src/shared/lectura-publica.ts` (entrada propia de M06, solo para la vía pública, ADR-021):
  - pool Kysely con `DATABASE_URL_PUBLICO`;
  - `LecturaPublica.ejecutar(tenantId, fn(tx))`: **solo** abre `BEGIN READ ONLY`, fija `app.tenant_id` con `set_config(..., true)` y ejecuta `fn`;
  - no lee ninguna tabla por sí misma: la resolución del `slug` la hace M01 con `BarberiasApi.resolverSlugPublico` (principio I, ADR-021 decisión 3).
- [X] T018 Prueba de integración de `LecturaPublica` en `tecnologia/plataforma-barberias/backend/test/integration/shared/lectura-publica.spec.ts`:
  - una escritura dentro de `fn` falla (solo lectura);
  - con el tenant de A fijado no se ven filas de B;
  - `app.tenant_id` no sobrevive a la transacción ni pasa a la siguiente que usa la conexión.

### M01: cliente en la identidad e interfaces para M02

- [X] T019 Ampliar `Rol` y `Permisos` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/rol.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/domain/permisos.ts` con `CLIENTE` y las operaciones de M01 de [contracts/rbac.md](contracts/rbac.md):
  - `CAMBIAR_BARBERIA`, `VER_BARBERIA`, `ACTUALIZAR_BARBERIA`, `BUSCAR_CLIENTES`, `REGISTRAR_CLIENTE_PRESENCIAL`;
  - `CLIENTE` sin acceso a las operaciones de usuarios de 001.
- [X] T020 Excluir a los clientes de las reglas de personal de 001:
  - **Límite del plan y lista de usuarios:** el conteo y la lista filtran `role_code IN ('PROPIETARIO','BARBERO')` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/infrastructure/kysely-usuario-repository.ts`.
  - **Usuarios de 001:** `ActualizarUsuario` y `ObtenerUsuario` responden 404 para una membresía `CLIENTE`.
  - **Pruebas:** en `tecnologia/plataforma-barberias/backend/test/integration/identidad/usuarios.spec.ts`, 3 clientes sembrados no consumen cupo de `max_users` ni aparecen en `GET /usuarios`.
- [X] T021 Declarar en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/index.ts` las interfaces públicas para M02 (ADR-020, R05), cada una con su token de inyección:
  - `PersonalApi` (`esPersonalActivo(usuarioId)`);
  - `ClientesApi` (`perfilDeSesion(usuarioId)`, `datosDeContacto(ids)`, `perfilDeBarberia(clienteId)`);
  - `BarberiasApi` (`configuracionAgenda()`, `datosPublicos(tenantId)`, `resolverSlugPublico(slug)`).

  Se implementan en las historias que las usan.

- [X] T022 [P] Implementar `BarberiasApi`:
  - `configuracionAgenda()` lee `timezone` y `cancel_min_notice_minutes` del tenant del contexto;
  - `datosPublicos(tenantId)` devuelve nombre, `slug`, dirección, teléfono, descripción y zona;
  - `resolverSlugPublico(slug)` devuelve el `tenantId` si la barbería existe y está `ACTIVA`, y si no, lanza `BarberiaNoDisponible`, el mismo error para un enlace inexistente, cambiado o suspendido (FR-022). Lee la tabla global `tenant` con el pool de la aplicación.

  Archivos: `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/application/barberias-api.ts` y el repositorio en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/infrastructure/kysely-tenant-repository.ts`.

- [X] T023 Prueba de integración de `BarberiasApi` en `tecnologia/plataforma-barberias/backend/test/integration/barberias/barberias-api.spec.ts`:
  - `resolverSlugPublico` da el mismo error con un `slug` inexistente, uno anterior a un cambio y uno suspendido, y el `tenantId` correcto con uno activo;
  - `configuracionAgenda` devuelve los valores del tenant del contexto;
  - `datosPublicos` no expone `status` ni identificadores de cuentas.

### M03: límite de barberos

- [X] T024 [P] Agregar `obtenerLimiteBarberos(tenantId)`:
  - caso de uso en `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/suscripciones/application/obtener-limite-barberos.ts`;
  - consulta a `plan.max_barbers` con la fila de `subscription` bloqueada (`FOR UPDATE`) en `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/suscripciones/infrastructure/kysely-suscripcion-repository.ts`;
  - exportar desde `tecnologia/plataforma-barberias/backend/src/modules/suscripciones-pagos/index.ts` (R13).

### M02: base del módulo

- [X] T025 [P] Crear `RangoHorario` (`[inicio, fin)`, `seSolapaCon`, `contieneEnteramente`, `duracionMinutos`) en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/domain/rango-horario.ts`
- [X] T026 [P] Crear los errores de dominio de M02 en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/domain/errores.ts`:
  - `NoEncontrado`, `AccesoDenegado`, `NombreDuplicado`, `ConflictoConCitas` (con la lista de citas afectadas), `FueraDelHorarioDeAtencion` y `LimiteBarberosAlcanzado`;
  - `HorarioNoDisponible`, `CitaSolapadaDelCliente`, `ReservaInvalida`, `IdempotenciaConflicto` y `TransicionInvalida`.
- [X] T027 [P] Crear `PermisosCatalogoCitas` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/domain/permisos.ts`:
  - operaciones de M02 de [contracts/rbac.md](contracts/rbac.md) → roles permitidos;
  - marca "solo propios" para BARBERO y CLIENTE.
- [X] T028 Crear `AutorizacionCatalogoCitas.exigir(actor, operacion)` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/autorizacion.ts`:
  - usa `Actor` de `acceso-barberias/index.ts` y la matriz de T027;
  - si el rol no está permitido, registra `ACCESO_DENEGADO_ROL` con `AuditLog.registrarEnTransaccionPropia` y lanza `AccesoDenegado` antes de tocar cualquier repositorio.
- [X] T029 [P] Pruebas unitarias en `tecnologia/plataforma-barberias/backend/test/unit/catalogo/permisos-rango.spec.ts`:
  - `RangoHorario`: rangos contiguos no se solapan;
  - `AutorizacionCatalogoCitas`: denegaciones por rol con registro;
  - consistencia de `PermisosCatalogoCitas` y de `Permisos` (M01) con la tabla de [contracts/rbac.md](contracts/rbac.md), leída y parseada en la prueba.
- [X] T030 Crear la interfaz pública de M02 en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/index.ts` y el módulo Nest en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo-citas.module.ts`:
  - importar M01, M03 y M06 solo por sus `index.ts`;
  - registrarlo en `tecnologia/plataforma-barberias/backend/src/host/app.module.ts`.
- [X] T031 Crear el puerto `CatalogQuery` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/ports/catalog-query.ts` y su implementación Kysely, con la transacción del tenant del contexto, en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/infrastructure/kysely-catalog-query.ts`. Operaciones de lectura del catálogo para la reserva (FR-030), el cálculo de horarios y las marcas de la agenda:
  - `servicioActivo(servicioId)`: nombre, precio y duración, o `null`;
  - `barberoOfrece(barberoId, servicioId)`: barbero activo con el servicio asignado;
  - `tramosDelDia(barberoId, fecha)`: disponibilidad ∩ horario de atención del día de la semana;
  - `bloqueosEnRango(barberoId, desde, hasta)`;
  - `barberosQueOfrecen(servicioId)`.

  Se exporta a `citas` por la interfaz interna del módulo.

- [X] T032 Prueba de integración de `CatalogQuery` en `tecnologia/plataforma-barberias/backend/test/integration/catalogo/catalog-query.spec.ts`:
  - con datos sembrados (T011): un servicio inactivo da `null`, un barbero inactivo o sin el servicio da falso, los tramos son la intersección correcta y los bloqueos se filtran por rango;
  - con el tenant de A no devuelve nada de B.

### Host y arquitectura

- [X] T033 Ampliar `RolesGuard` y `@Operacion` en `tecnologia/plataforma-barberias/backend/src/host/roles.guard.ts` para aceptar también las operaciones de `PermisosCatalogoCitas`, exportadas por `catalogo-citas/index.ts`, y el rol `CLIENTE`. Las rutas `@Publica()` siguen sin leer el token.
- [X] T034 [P] Mapear los códigos nuevos de [contracts/openapi.yaml](contracts/openapi.yaml) a sus estados HTTP en `tecnologia/plataforma-barberias/backend/src/host/error.filter.ts`:
  - `BARBERIA_NO_DISPONIBLE` 404;
  - `CONFLICTO_CON_CITAS` 409, con `detalles` = citas afectadas;
  - `HORARIO_NO_DISPONIBLE` y `CITA_SOLAPADA_DEL_CLIENTE` 409;
  - `RESERVA_INVALIDA`, `IDEMPOTENCIA_CONFLICTO` y `TRANSICION_INVALIDA` 422;
  - `INGRESA_DESDE_TU_BARBERIA`, `UNIRSE_REQUIERE_CONSENTIMIENTO`, `CUENTA_DE_PERSONAL`, `ENLACE_NO_DISPONIBLE`, `NOMBRE_DUPLICADO` y `USUARIO_YA_VINCULADO` 409;
  - `FUERA_DEL_HORARIO_DE_ATENCION` 422.
- [X] T035 Ampliar PR14 en `tecnologia/plataforma-barberias/backend/.dependency-cruiser.cjs` con cuatro reglas:
  - `matriz-m01`: M01 no importa `catalogo-citas`.
  - `matriz-m02`: M02 solo importa `acceso-barberias/index.ts`, `suscripciones-pagos/index.ts` y `shared/{index,nucleo}.ts`.
  - `matriz-m03` ampliada: M03 tampoco importa M02.
  - `lectura-publica-confinada`: `shared/lectura-publica.ts` solo se importa desde `modules/catalogo-citas/catalogo/infrastructure/publico/`. Además, `m06-solo-por-interfaz-publica` admite esa entrada solo para esa carpeta.
- [X] T036 [P] Agregar violaciones de ejemplo en `tecnologia/plataforma-barberias/backend/test/architecture/fixture/src/` y comprobar en `tecnologia/plataforma-barberias/backend/test/architecture/reglas.spec.ts` que cada regla nueva las detecta:
  - M01 que importa M02;
  - M02 que importa una clase interna de M01;
  - un repositorio de `citas` que importa `shared/lectura-publica.ts`.

### Frontend base

- [X] T037 [P] Ampliar el script `gen:api` en `tecnologia/plataforma-barberias/frontend/package.json` para generar también los tipos de `specs/002-catalogo-citas-cliente/contracts/openapi.yaml` en `tecnologia/plataforma-barberias/frontend/src/api/schema-002.d.ts`
- [X] T038 Preparar la navegación en `tecnologia/plataforma-barberias/frontend/src/routes.tsx`, `tecnologia/plataforma-barberias/frontend/src/auth/RutaProtegida.tsx` y `tecnologia/plataforma-barberias/frontend/src/components/app/DisenoApp.tsx`:
  - rol `CLIENTE` en `RutaProtegida`;
  - esqueleto de rutas nuevas, todas con `React.lazy` (ADR-018);
  - entradas de navegación del panel según el rol: Barbería, Servicios, Barberos, Disponibilidad, Agenda y Clientes.
- [X] T039 [P] Crear `tecnologia/plataforma-barberias/frontend/src/hora-barberia.ts`: formatea instantes en la zona de la barbería (`Intl`, nunca la del dispositivo) con la etiqueta "hora de la barbería". Pruebas en `tecnologia/plataforma-barberias/frontend/test/hora-barberia.spec.ts`.

**Checkpoint**: esquema, roles, permisos y arquitectura listos; pueden empezar las historias.

---

## Phase 3: User Story 1 - El propietario prepara su barbería para recibir reservas (Priority: P1) 🎯 MVP

**Goal**: el propietario configura datos, enlace, horario de atención y antelación (RF03); servicios
(RF07); barberos con servicios y vínculo opcional (RF08); disponibilidad semanal y bloqueos con
confirmación de conflictos (RF09).

**Independent Test**: con la sesión del propietario de una barbería recién registrada, configurar
datos, horario, dos servicios, dos barberos, su disponibilidad y un bloqueo. Todo queda en su
barbería y los datos inválidos se rechazan (escenarios 1–8 de US1; quickstart §3.1).

### Tests for User Story 1 (MANDATORY - constitution Principle X) ⚠️

> **NOTE: escribir estas pruebas PRIMERO y comprobar que FALLAN antes de implementar**

- [X] T040 [P] [US1] Pruebas unitarias en `tecnologia/plataforma-barberias/backend/test/unit/catalogo/catalogo-dominio.spec.ts`:
  - `Servicio`: nombre 2–80; precio 0–99 999,99; duración 5–480, múltiplo de 5; `desactivar`.
  - `Barbero`: `asignar`, `quitar`, `ofrece`, `desactivar`, `reactivar`.
  - `Bloqueo`: `inicio < fin`, máximo 30 días.
  - `LimiteBarberos`.
- [X] T041 [P] [US1] Pruebas unitarias de `Slug` ampliado (3–60, formato, palabras reservadas) en `tecnologia/plataforma-barberias/backend/test/unit/barberias/registro-dominio.spec.ts`
- [X] T042 [P] [US1] Prueba de contrato contra [contracts/openapi.yaml](contracts/openapi.yaml) de `GET`/`PATCH /barberia`, `GET`/`PUT /barberia/horario`, `/servicios`, `/servicios/{id}`, `/barberos`, `/barberos/{id}`, `/barberos/{id}/disponibilidad` y `/barberos/{id}/bloqueos`, en `tecnologia/plataforma-barberias/backend/test/contract/catalogo.contract.spec.ts`
- [X] T043 [P] [US1] Integración de datos y horario de la barbería en `tecnologia/plataforma-barberias/backend/test/integration/catalogo/barberia.spec.ts`:
  - el horario con cierre ≤ apertura o con solapes → 400 indicando el día;
  - reducir el horario con citas activas fuera → 409 `CONFLICTO_CON_CITAS` sin guardar; con `confirmarConflictos` guarda y las citas siguen `CONFIRMADA`;
  - cambiar el `slug` → el anterior responde `BARBERIA_NO_DISPONIBLE`, se registra `ENLACE_CAMBIADO`, y un `slug` ocupado o reservado da 409;
  - la antelación fuera de 0–4320 → 400.
- [X] T044 [P] [US1] Integración de servicios en `tecnologia/plataforma-barberias/backend/test/integration/catalogo/servicios.spec.ts`:
  - nombre duplicado (sin distinguir mayúsculas) → 409;
  - precio negativo o duración 0 → 400;
  - desactivar con citas futuras → 409 con la cantidad, y con confirmación se desactiva, las citas se mantienen y se registra `SERVICIO_DESACTIVADO`;
  - editar el precio no cambia `appointment.price` de las citas existentes;
  - no existe operación para eliminar.
- [X] T045 [P] [US1] Integración de barberos en `tecnologia/plataforma-barberias/backend/test/integration/catalogo/barberos.spec.ts`:
  - vincular un usuario `BARBERO` o al propietario funciona;
  - un usuario de otra barbería o un cliente → 404;
  - el mismo usuario en dos barberos → 409 `USUARIO_YA_VINCULADO`;
  - el límite `max_barbers` → 403 `SUSCRIPCION_NO_PERMITE`, también con 10 creaciones simultáneas (nunca supera el límite);
  - desactivar con citas futuras sigue la confirmación en dos pasos y conserva el historial;
  - desactivar al usuario vinculado (operación de 001) no desactiva al barbero: sigue en el catálogo hasta que el propietario lo desactive.
- [X] T046 [P] [US1] Integración de disponibilidad y bloqueos en `tecnologia/plataforma-barberias/backend/test/integration/catalogo/disponibilidad.spec.ts`:
  - un tramo fuera del horario de atención → 422;
  - el barbero vinculado edita la suya; editar la de otro → 403;
  - el propietario edita cualquiera;
  - un bloqueo sin citas se crea;
  - un bloqueo con citas activas → 409 con la lista sin datos del cliente; con confirmación se crea, las citas no cambian y se registra `BLOQUEO_CON_CONFLICTO`;
  - eliminar un bloqueo funciona.
- [X] T047 [P] [US1] Agregar a la lista de operaciones protegidas de PR09, en `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/endpoints-protegidos.ts`, cada operación de US1 con identificadores de la barbería B y el token de A (→ 404, sin cambios en B)
- [X] T048 [P] [US1] Pruebas de las pantallas en `tecnologia/plataforma-barberias/frontend/test/pages/panel-catalogo.spec.tsx`:
  - Barbería: validación del horario y aviso al cambiar el enlace.
  - Servicios: alta y desactivación con modal de conflicto.
  - Barberos: vínculo y límite del plan.
  - Disponibilidad: semana y bloqueo con conflicto confirmado.

### Implementation for User Story 1

- [X] T049 [P] [US1] Ampliar `Slug` con la validación para edición (3–60 caracteres, palabras reservadas) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/domain/slug.ts`
- [X] T050 [US1] Crear los casos de uso `ObtenerBarberia` y `ActualizarBarberia` (nombre, enlace, dirección, teléfono, descripción, antelación) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/application/obtener-barberia.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/application/actualizar-barberia.ts`:
  - `UPDATE` filtrado por el tenant del contexto, sobre la política `tenant_edicion`;
  - violación de unicidad del `slug` → `ENLACE_NO_DISPONIBLE`;
  - auditoría de `ENLACE_CAMBIADO`;
  - repositorio en `kysely-tenant-repository.ts`.
- [X] T051 [US1] Crear los DTO y el controlador `GET`/`PATCH /barberia` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/presentation/barberia.controller.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/barberias/presentation/barberia.dto.ts`:
  - `@Operacion` `VER_BARBERIA` / `ACTUALIZAR_BARBERIA`;
  - registrarlos en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/acceso-barberias.module.ts`.
- [X] T052 [P] [US1] Implementar `PersonalApi.esPersonalActivo(usuarioId)` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/personal-api.ts`: membresía `PROPIETARIO` o `BARBERO` `ACTIVA` en el tenant del contexto, leída con RLS.
- [X] T053 [P] [US1] Crear las entidades del catálogo en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/domain/`:
  - `servicio.ts`, `barbero.ts`, `bloqueo.ts`;
  - `limite-barberos.ts` (`puedeAgregar(activos, max)`).
- [X] T054 [US1] Crear los puertos y repositorios Kysely del catálogo:
  - **Puertos**, en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/ports/`: `ServicioRepository`, `BarberoRepository` (con servicios asignados), `HorarioRepository` (atención y disponibilidad, reemplazo de semana completa), `BloqueoRepository` y `CitasActivasQuery` (citas activas de un barbero o servicio en un rango, o fuera de un horario semanal; lee `appointment` del mismo módulo).
  - **Implementaciones**, en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/infrastructure/`.
  - **Reglas:** todas filtran por el tenant del contexto; la violación del índice de nombre se traduce a `NombreDuplicado`.
- [X] T055 [US1] Crear los casos de uso de servicios en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/servicios.ts`:
  - `ListarServicios`, `CrearServicio` y `ActualizarServicio`;
  - la desactivación con citas futuras sigue la confirmación en dos pasos (R11) y registra `SERVICIO_DESACTIVADO`.
- [X] T056 [US1] Crear los casos de uso de barberos en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/barberos.ts`:
  - `ListarBarberos`, `CrearBarbero` y `ActualizarBarbero`;
  - el vínculo se valida con `PersonalApi`;
  - el límite se comprueba con `obtenerLimiteBarberos` de M03 dentro de la transacción;
  - la desactivación con citas futuras sigue la confirmación en dos pasos y registra `BARBERO_DESACTIVADO`;
  - los servicios asignados deben ser de la barbería.
- [X] T057 [US1] Crear los casos de uso de horarios en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/horarios.ts`:
  - `ObtenerHorarioAtencion` y `ReemplazarHorarioAtencion` (conflictos con citas fuera del nuevo horario → R11; `CAMBIO_CON_CONFLICTO`);
  - `ObtenerDisponibilidad` y `ReemplazarDisponibilidad` (dentro del horario de atención con `HorarioSemanal.contiene`; el barbero solo la del barbero vinculado a su usuario; conflictos → R11).
- [X] T058 [US1] Crear los casos de uso de bloqueos en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/bloqueos.ts`:
  - `ListarBloqueos`, `CrearBloqueo` y `EliminarBloqueo`;
  - el barbero vinculado solo opera los suyos;
  - las citas activas solapadas → `ConflictoConCitas` (lista sin datos del cliente) salvo `confirmarConflictos`; con confirmación registra `BLOQUEO_CON_CONFLICTO`.
- [X] T059 [US1] Crear los DTO y los controladores en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/presentation/`:
  - `servicios.controller.ts`, `barberos.controller.ts`, `disponibilidad.controller.ts` (disponibilidad y bloqueos) y `horario-atencion.controller.ts` (`/barberia/horario`);
  - `@Operacion` según [contracts/rbac.md](contracts/rbac.md);
  - registrarlos en `catalogo-citas.module.ts`.
- [X] T060 [P] [US1] Crear la pantalla `tecnologia/plataforma-barberias/frontend/src/pages/panel/Barberia.tsx`:
  - datos, enlace público con botón de copiar y aviso de que el anterior deja de funcionar, antelación;
  - editor del horario semanal (componente `EditorSemana` en `tecnologia/plataforma-barberias/frontend/src/components/app/EditorSemana.tsx`, reutilizado en Disponibilidad);
  - el 409 `CONFLICTO_CON_CITAS` abre `ModalConfirmacion` con las citas afectadas.
- [X] T061 [P] [US1] Crear las pantallas `tecnologia/plataforma-barberias/frontend/src/pages/panel/Servicios.tsx` y `tecnologia/plataforma-barberias/frontend/src/pages/panel/Barberos.tsx`:
  - listas con alta y edición;
  - desactivación con confirmación de conflictos;
  - vínculo de barbero con un usuario del personal (lista de `GET /usuarios`);
  - mensaje de límite del plan.
- [X] T062 [P] [US1] Crear la pantalla `tecnologia/plataforma-barberias/frontend/src/pages/panel/Disponibilidad.tsx`:
  - selector de barbero (el barbero ve solo el suyo);
  - semana con `EditorSemana`;
  - bloqueos por fecha y hora (sin repetición, segunda línea de corte) con confirmación de conflictos.

**Checkpoint**: la barbería queda configurada y probada (quickstart §3.1).

---

## Phase 4: User Story 2 - Cualquier persona ve el catálogo y los horarios libres por el enlace (Priority: P1)

**Goal**: catálogo público (RF10) y horarios libres (RF11) sin sesión, por el rol `barberias_publico`
con solo columnas públicas (ADR-021); el mismo cálculo para la vía autenticada (`GET /horarios`).

**Independent Test**: con una barbería sembrada (fixtures de T011), abrir `GET /publico/{slug}` y
`/horarios` sin token y verificar que los horarios coinciden con disponibilidad, bloqueos y citas.
Ninguna respuesta contiene datos privados (escenarios 1–6 de US2; quickstart §3.2).

### Tests for User Story 2 (MANDATORY - constitution Principle X) ⚠️

- [X] T063 [P] [US2] Pruebas unitarias de `CalculadoraHorarios` (R08) en `tecnologia/plataforma-barberias/backend/test/unit/catalogo/calculadora-horarios.spec.ts`:
  - intersección de disponibilidad y atención;
  - resta de bloqueos y citas activas (las canceladas no restan);
  - el servicio debe caber entero;
  - paso de 15 minutos alineado a la medianoche local;
  - "ahora" excluye horas pasadas;
  - fuera del horizonte → vacío;
  - "cualquier barbero" lista los barberos libres por hora;
  - barbero inactivo o sin el servicio → excluido;
  - día cerrado → vacío.
- [X] T064 [P] [US2] Pruebas de ADR-021 (PR09) en `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/lectura-publica.spec.ts`:
  1. Los permisos de `barberias_publico` en `information_schema.column_privileges` y `table_privileges` coinciden **exactamente** con la lista cerrada de ADR-021, que ya no incluye `tenant` (sin `INSERT`, `UPDATE` ni `DELETE`). `LecturaPublica` no lee ninguna tabla: el `slug` lo resuelve `BarberiasApi.resolverSlugPublico` (M01).
  2. `rolbypassrls = false`, no es dueño de nada y no puede ejecutar `auth_resolver_cuenta`, `auth_buscar_sesion` ni `auth_buscar_activacion`.
  3. Con el pool `publico`, `SELECT customer_id FROM appointment`, `SELECT reason FROM time_off` y `SELECT user_id FROM barber` fallan por permisos.
  4. Con el tenant de A fijado no aparece ninguna fila de B; sin tenant, ninguna.
  5. Una escritura en la transacción pública falla.
  6. HTTP: con datos canario sembrados en A y B (correos y teléfonos únicos de clientes y del personal, motivos de bloqueo), ninguna respuesta de `/publico/*` los contiene; un `slug` inexistente y uno suspendido dan respuestas idénticas; `POST`, `PUT`, `PATCH` y `DELETE` sobre `/publico/*` se rechazan; un token de B enviado a `/publico/{slug-de-A}` no cambia la respuesta.
- [X] T065 [P] [US2] Prueba de contrato de `GET /publico/{slug}`, `GET /publico/{slug}/horarios` y `GET /horarios` en `tecnologia/plataforma-barberias/backend/test/contract/publico.contract.spec.ts`:
  - `additionalProperties: false` en las respuestas públicas;
  - 404 `BARBERIA_NO_DISPONIBLE`;
  - 400 con fecha mal formada o `servicio` ausente.
- [X] T066 [P] [US2] Integración de horarios en `tecnologia/plataforma-barberias/backend/test/integration/catalogo/horarios.spec.ts`:
  - un bloqueo nuevo y una cita nueva desaparecen de los horarios en la consulta siguiente (FR-017);
  - la respuesta trae `calculadoEn` y `zonaHoraria`;
  - `GET /horarios` con el token de un cliente da el mismo resultado que la vía pública;
  - humo de rendimiento: un día con 5 barberos y 60 citas se calcula en menos de 200 ms.
- [X] T067 [P] [US2] Prueba de la pantalla pública en `tecnologia/plataforma-barberias/frontend/test/pages/catalogo-publico.spec.tsx`:
  - muestra servicios y barberos;
  - al elegir servicio y fecha pide horarios y los muestra con "hora de la barbería";
  - un 404 muestra "barbería no disponible";
  - sin sesión, el botón de reservar lleva a registro o ingreso con el `slug`.

### Implementation for User Story 2

- [X] T068 [P] [US2] Crear `CalculadoraHorarios` (función pura de R08; recibe tramos, ocupación en minutos locales, paso, "ahora" y horizonte) en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/domain/calculadora-horarios.ts`
- [X] T069 [US2] Crear el puerto `FuenteDisponibilidad` (catálogo del día y ocupación del día local por barbero) en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/ports/fuente-disponibilidad.ts` y el caso de uso `ConsultarHorarios`:
  - convierte la fecha local con `ZonaHoraria`;
  - aplica la configuración de paso y horizonte;
  - devuelve horas, `calculadoEn` y `zonaHoraria`.

  Archivo: `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/application/consultar-horarios.ts`.

- [X] T070 [US2] Crear el repositorio de la vía pública (ADR-021) en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/infrastructure/publico/catalogo-publico.repository.ts` (`CatalogoPublicoRepository`, que también implementa `FuenteDisponibilidad`):
  - recibe el `tenantId` que el controlador obtiene con `BarberiasApi.resolverSlugPublico(slug)` y usa `LecturaPublica.ejecutar(tenantId, ...)`;
  - selecciona solo columnas públicas en: horario de atención, servicios y barberos activos con sus servicios, disponibilidad, bloqueos (sin motivo) y citas activas del día (sin cliente);
  - devuelve DTO cerrados.
- [X] T071 [US2] Crear la fuente autenticada `FuenteDisponibilidadKysely`, con la transacción del tenant del token y apoyada en `CatalogQuery` (fase 2), en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/infrastructure/kysely-fuente-disponibilidad.ts`
- [X] T072 [US2] Crear `PublicoController` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/presentation/publico.controller.ts`:
  - rutas `GET /publico/:slug` y `GET /publico/:slug/horarios`, solo `GET` y con `@Publica()`;
  - resuelve el `slug` con `BarberiasApi.resolverSlugPublico` (404 `BARBERIA_NO_DISPONIBLE`) y pasa el `tenantId` al repositorio público;
  - no lee `Authorization`;
  - datos de la barbería vía `BarberiasApi.datosPublicos`;
  - límite de solicitudes por IP (429).
- [X] T073 [US2] Crear `GET /horarios` (CLIENTE, PROPIETARIO; fuente autenticada) en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/catalogo/presentation/horarios.controller.ts` y registrar ambos controladores en `catalogo-citas.module.ts`
- [X] T074 [US2] Crear la pantalla `tecnologia/plataforma-barberias/frontend/src/pages/publico/CatalogoPublico.tsx` y su ruta `/b/:slug` en `tecnologia/plataforma-barberias/frontend/src/routes.tsx`:
  - una solicitud para el catálogo y una por fecha;
  - selector de servicio, barbero ("cualquiera" por defecto) y fecha dentro del horizonte;
  - horas en botones;
  - sin dependencias nuevas.

**Checkpoint**: catálogo y horarios públicos funcionando, con PR09 de la vía pública en verde.

---

## Phase 5: User Story 3 - El cliente se registra con consentimiento y reserva sin duplicados (Priority: P1)

**Goal**: registro de cliente con consentimiento por barbería (RF05). Inicio de sesión con enlace,
unión y cambio de barbería (ADR-020). Reserva confirmada sin duplicados (RF12, principio IV), con
idempotencia (R09).

**Independent Test**:

- Registrar un cliente desde el `slug`, reservar una hora libre y comprobar que deja de estar libre.
- PR16: 200 reservas simultáneas → exactamente 1 cita (escenarios 1–8 de US3; quickstart §2 y §3.3–3.4).

### Tests for User Story 3 (MANDATORY - constitution Principle X) ⚠️

- [X] T075 [P] [US3] **PR16** (EQ-16, SC-001) en `tecnologia/plataforma-barberias/backend/test/integration/citas/concurrencia-reservas.spec.ts`:
  - **Montaje:** levantar **dos instancias** de la aplicación con `crearApp()`, cada una con su propio pool, sobre la misma base; sembrar un barbero, un servicio de 30 min y 200 clientes con sesión.
  - **Caso principal:** lanzar 200 `POST /citas` simultáneos (`Promise.all`, alternando instancias) al mismo barbero e inicio. Se esperan exactamente 1 respuesta 201, 199 respuestas 409 `HORARIO_NO_DISPONIBLE`, 0 respuestas 5xx, y en la base exactamente 1 cita activa para ese barbero y rango (consulta con el pool `seed`).
  - **Variantes:**
    - (a) solape parcial: 100 a las 10:00 y 100 a las 10:15 → 1 cita;
    - (b) el mismo cliente reserva con dos barberos a la misma hora → 1 cita, la otra 409 `CITA_SOLAPADA_DEL_CLIENTE`;
    - (c) 50 reintentos simultáneos con la misma `Idempotency-Key` → 1 cita, y todas las respuestas exitosas traen el mismo `id`.
- [X] T076 [P] [US3] Pruebas unitarias de la creación de `Cita` en `tecnologia/plataforma-barberias/backend/test/unit/citas/cita.spec.ts`:
  - nace `CONFIRMADA`;
  - `fin = inicio + duración`;
  - copia nombre, precio y duración del servicio;
  - rechaza el inicio pasado.
- [X] T077 [P] [US3] Integración de la reserva en `tecnologia/plataforma-barberias/backend/test/integration/citas/reservar.spec.ts`:
  - **Datos:** 201 con barbería, servicio, barbero, fecha, hora, precio y estado (FR-034).
  - **Rechazos:** 422 `RESERVA_INVALIDA` con hora pasada, fuera de disponibilidad o del horizonte, en un bloqueo, con servicio inactivo o con un barbero que no ofrece el servicio.
  - **Idempotencia:** misma `Idempotency-Key` y mismo cuerpo → 200 con la misma cita; misma clave con otro cuerpo → 422 `IDEMPOTENCIA_CONFLICTO`; sin `Idempotency-Key` → 400.
  - **Cliente:** un `clienteId` enviado por un cliente → 400.
  - **Registros:** se escriben `appointment_status_history` (`NULL` → `CONFIRMADA`) y la auditoría.
- [X] T078 [P] [US3] Integración de la cuenta de cliente en `tecnologia/plataforma-barberias/backend/test/integration/clientes/cuenta-cliente.spec.ts`:
  - **Registro:** desde el `slug` crea cuenta, membresía `CLIENTE`, perfil y `consent_record` `EN_LINEA` con versión, fecha, hora e IP, y devuelve una sesión con `rol = CLIENTE` y el `tid` de esa barbería; sin aceptación → 400 y 0 filas; correo existente → 409 `CORREO_NO_DISPONIBLE`.
  - **Ingreso sin enlace:** una cuenta de cliente → 409 `INGRESA_DESDE_TU_BARBERIA`, solo con la contraseña correcta; con una contraseña incorrecta → 401 idéntico al de 001.
  - **Ingreso con enlace** de una barbería sin membresía → 409 `UNIRSE_REQUIERE_CONSENTIMIENTO`; con aceptación → se une y queda un segundo perfil y consentimiento, sin otra cuenta.
  - **Personal como cliente:** una cuenta del personal no puede unirse → 409 `CUENTA_DE_PERSONAL`.
  - **Cambio de barbería** (`POST /auth/barberia`): con membresía, emite un token con el `tid` destino, cierra la sesión anterior y reemplaza la cookie; sin membresía ni aceptación → 409; el personal → 403.
  - **Auditoría:** se registran `CLIENTE_REGISTRADO`, `CLIENTE_UNIDO` y `BARBERIA_CAMBIADA`.
- [X] T079 [P] [US3] PR09 en `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/cliente-dos-barberias.spec.ts`:
  - un cliente con membresía en A y B no ve con el token de A citas, perfil ni horarios de B;
  - un `slug` o `barberia` de B enviado en `POST /citas`, `GET /horarios` o `GET /clientes/yo/citas` con el token de A → 400 o ignorado, operando solo sobre A;
  - el perfil de A no es visible desde la sesión de B.
- [X] T080 [P] [US3] Ampliar `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/funciones-definer.spec.ts`:
  - `auth_resolver_cuenta` devuelve 1 fila con columnas de membresía nulas para una cuenta de cliente con membresía en 3 barberías;
  - devuelve 0 filas con un correo inexistente;
  - sigue sin parámetro de tenant y con su dueño `barberias_auth`.
- [X] T081 [P] [US3] Prueba de contrato de `POST /clientes/registro`, `POST /auth/login` (con `barberia` y aceptación) y `POST /auth/barberia` en `tecnologia/plataforma-barberias/backend/test/contract/clientes.contract.spec.ts`, y de `POST /citas` en `tecnologia/plataforma-barberias/backend/test/contract/citas.contract.spec.ts`
- [X] T082 [P] [US3] Pruebas de las pantallas en `tecnologia/plataforma-barberias/frontend/test/pages/cliente-reserva.spec.tsx`:
  - registro con consentimiento obligatorio y solo datos mínimos;
  - ingreso desde el enlace con el flujo de unión;
  - la reserva conserva la `Idempotency-Key` entre reintentos y la cambia si cambia la selección;
  - un 409 `HORARIO_NO_DISPONIBLE` vuelve a pedir los horarios del día;
  - la confirmación muestra todos los datos.

### Implementation for User Story 3

- [X] T083 [P] [US3] Crear el dominio de clientes en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/domain/perfil-cliente.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/domain/consentimiento.ts`:
  - `PerfilCliente`: nombre 2–120, teléfono, correo normalizado si hay cuenta, origen;
  - `Consentimiento`: versión vigente; `PRESENCIAL` exige `registradoPor`.
- [X] T084 [US3] Crear los puertos y repositorios Kysely `PerfilClienteRepository` y `ConsentimientoRepository` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/application/ports/` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/infrastructure/`, filtrados por el tenant del contexto
- [X] T085 [US3] Crear `RegistrarCliente` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/application/registrar-cliente.ts`:
  - resuelve el `slug` a un tenant `ACTIVA` con `TenantRepository` (selector de la constitución 1.2.0);
  - en un `UnitOfWork` con ese tenant crea `user_account` (sin `RETURNING`; unicidad → `CorreoNoDisponible`), membresía `CLIENTE` `ACTIVA`, perfil `EN_LINEA` y consentimiento;
  - registra `CLIENTE_REGISTRADO` y llama a `EmitirSesion`.
- [X] T086 [US3] Crear `UnirseABarberia`, usado por el ingreso con enlace y por el cambio de barbería, en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/application/unirse-a-barberia.ts`:
  - rechaza cuentas con membresía de personal (`CUENTA_DE_PERSONAL`);
  - exige la aceptación con versión vigente;
  - crea membresía, perfil (con nombre y correo de la cuenta) y consentimiento;
  - registra `CLIENTE_UNIDO`.
- [X] T087 [US3] Ampliar `IniciarSesion` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/iniciar-sesion.ts`:
  - acepta `barberia` y la aceptación opcional;
  - mantiene el camino de tiempo constante con `auth_resolver_cuenta` (ahora con `LEFT JOIN`);
  - **sin `barberia`:** membresía de personal, o `INGRESA_DESDE_TU_BARBERIA` para clientes;
  - **con `barberia`:** resuelve el tenant y busca con RLS la membresía `ACTIVA` del usuario; si no la tiene, `UNIRSE_REQUIERE_CONSENTIMIENTO` o `UnirseABarberia`;
  - aplica igual el límite de intentos y el estado del tenant.

  Ampliar también el DTO en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/presentation/login.dto.ts`.

- [X] T088 [US3] Crear `CambiarBarberia` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/application/cambiar-barberia.ts`:
  - solo con rol `CLIENTE`;
  - resuelve el tenant destino y busca con RLS la membresía del `sub`, o se une si llega la aceptación;
  - emite la sesión en el destino y después cierra la actual en una transacción con el tenant del token;
  - registra `BARBERIA_CAMBIADA`.

  Ruta `POST /auth/barberia` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/identidad/presentation/auth.controller.ts`, con la cookie `rt` reemplazada.

- [X] T089 [US3] Crear `ClientesController` (`POST /clientes/registro`, con `@Publica()`, límite por IP y 201 con la cookie `rt`) y su DTO en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/presentation/clientes.controller.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/presentation/clientes.dto.ts`; registrar el submódulo en `acceso-barberias.module.ts`
- [X] T090 [US3] Implementar `ClientesApi.perfilDeSesion(usuarioId)` (perfil del cliente en el tenant del contexto) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/application/clientes-api.ts`
- [X] T091 [P] [US3] Crear la entidad `Cita` y `EstadoCita` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/domain/cita.ts` y `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/domain/estado-cita.ts`:
  - creación `CONFIRMADA` con copia del servicio y `RangoHorario`;
  - las transiciones completas se agregan en US4 y US5.
- [X] T092 [US3] Crear `CitaRepository` y `CitaRepositoryPostgres` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/application/ports/cita-repository.ts` y `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/infrastructure/cita-repository-postgres.ts`:
  - `guardar` inserta la cita y su historial en la transacción del caso de uso;
  - traduce `23P01` por nombre de restricción: `appointment_no_overlap_barber` → `HorarioNoDisponible` y `appointment_no_overlap_customer` → `CitaSolapadaDelCliente`;
  - `buscarPorIdempotencia(autor, clave)`;
  - la violación de `appointment_idempotencia` se vuelve a buscar (R09);
  - todas las consultas filtran por el tenant del contexto.
- [X] T093 [US3] Crear `ReservarCita` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/application/reservar-cita.ts`, en este orden:
  1. Autorización.
  2. Perfil del cliente con `ClientesApi.perfilDeSesion` para el rol `CLIENTE`.
  3. Idempotencia con hash SHA-256 del cuerpo normalizado.
  4. Validación de reglas (FR-030) con `CatalogQuery` (T031, fase 2) y `ZonaHoraria`.
  5. Inserción.
  6. Respuesta 201 o 200.

  El conflicto lo decide solo la restricción (principio IV).

- [X] T094 [US3] Crear `CitasController` (`POST /citas` con el encabezado `Idempotency-Key` obligatorio, en formato UUID) y su DTO en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/presentation/citas.controller.ts` y `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/presentation/citas.dto.ts`; registrarlos en `catalogo-citas.module.ts`
- [X] T095 [US3] Ampliar la sesión del navegador en `tecnologia/plataforma-barberias/frontend/src/auth/SesionProvider.tsx`:
  - conserva `barberia.slug` del token;
  - `asegurarBarberia(slug)` llama a `POST /auth/barberia` si la sesión es de otra barbería y propaga `UNIRSE_REQUIERE_CONSENTIMIENTO`;
  - mantiene la renovación serializada con Web Locks de 001.
- [X] T096 [P] [US3] Crear las pantallas `tecnologia/plataforma-barberias/frontend/src/pages/publico/RegistroCliente.tsx` (`/b/:slug/registro`) e `tecnologia/plataforma-barberias/frontend/src/pages/publico/IngresarBarberia.tsx` (`/b/:slug/ingresar`):
  - formularios con `react-hook-form` + `zod` y las reglas del contrato;
  - casilla de política de datos con versión;
  - flujo de unión cuando llega 409 `UNIRSE_REQUIERE_CONSENTIMIENTO`;
  - mensaje "ya tienes cuenta: inicia sesión" ante `CORREO_NO_DISPONIBLE`.
- [X] T097 [US3] Crear la pantalla `tecnologia/plataforma-barberias/frontend/src/pages/publico/Reservar.tsx` (`/b/:slug/reservar`, exige sesión de cliente en esa barbería vía `asegurarBarberia`):
  - resumen de la selección;
  - `Idempotency-Key` generada al abrir la confirmación y reutilizada en los reintentos;
  - pantalla de confirmación con todos los datos;
  - ante 409, vuelve al catálogo con los horarios actualizados.

**Checkpoint**: el cliente se registra, se une y reserva, con PR16 y PR09 en verde (quickstart §2, §3.3 y
§3.4).

---

## Phase 6: User Story 4 - La barbería ve su agenda y lleva el estado de las citas (Priority: P2)

**Goal**: agenda por fecha y barbero (RF16) con marcas calculadas; transiciones válidas con historial
(RF15); cita presencial con cliente con cuenta o presencial (FR-035, HU15).

**Independent Test**: con citas sembradas de dos barberos, el propietario ve ambas agendas y el
barbero solo la suya. Se marcan completada y no asistió y se rechazan las transiciones inválidas
(escenarios 1–7 de US4; quickstart §3.6).

### Tests for User Story 4 (MANDATORY - constitution Principle X) ⚠️

- [X] T098 [P] [US4] Pruebas unitarias en `tecnologia/plataforma-barberias/backend/test/unit/citas/transiciones.spec.ts`:
  - **Transiciones de `Cita`** (FR-041, FR-042):
    - `completar` y `marcarNoAsistio` solo desde `CONFIRMADA` y con `ahora ≥ inicio`;
    - `aprobar` solo desde `PENDIENTE`;
    - los estados finales no cambian;
    - cualquier otra transición lanza `TransicionInvalida`.
  - **`MarcaConflicto`:** cita dentro de un bloqueo, fuera de la disponibilidad, fuera del horario de atención o sin conflicto.
- [X] T099 [P] [US4] Integración de agenda y estados en `tecnologia/plataforma-barberias/backend/test/integration/citas/agenda-estados.spec.ts`:
  - **Agenda del propietario:** ve todas las citas del día local ordenadas, con nombre y teléfono del cliente (también presencial), `enConflicto` y `cancelacionTardia`, con filtro por barbero.
  - **Agenda del barbero vinculado:** ve solo las suyas; con otro `barbero` → 403; un barbero sin vínculo → 403.
  - **Cambio de estado:** queda en `appointment_status_history` con autor y se audita `CITA_ESTADO_CAMBIADO`.
  - **Concurrencia:** dos cambios simultáneos se serializan (uno gana y el otro recibe `TRANSICION_INVALIDA`).
  - **Marcas:** una cita futura no puede marcarse como completada; una cita en conflicto después de borrar el bloqueo deja de aparecer en conflicto.
  - **Carrera entre reserva y bloqueo** (caso límite de la especificación): tras la advertencia de un bloqueo sin conflictos entra una reserva en esa franja y luego se confirma el bloqueo. La agenda muestra esa cita activa y "en conflicto"; ninguna cita se pierde sin aviso.
- [X] T100 [P] [US4] Integración de cliente presencial y cita presencial en `tecnologia/plataforma-barberias/backend/test/integration/clientes/presencial.spec.ts`:
  - `POST /clientes` sin `consentimientoVerbal` → 400; con él crea el perfil `PRESENCIAL` y `consent_record` `PRESENCIAL` con `recorded_by` y se audita `CLIENTE_PRESENCIAL_REGISTRADO`;
  - `GET /clientes?buscar=` encuentra por nombre o teléfono solo en la barbería;
  - `POST /citas` del propietario con `clienteId` aplica las mismas reglas y la cita queda con `origin = PRESENCIAL`;
  - un `clienteId` de otra barbería → 404.
- [X] T101 [P] [US4] Prueba de contrato de `GET /agenda`, `POST /citas/{id}/estado`, `GET /clientes` y `POST /clientes` en `tecnologia/plataforma-barberias/backend/test/contract/agenda.contract.spec.ts`
- [X] T102 [P] [US4] Agregar las operaciones de US4 a `tecnologia/plataforma-barberias/backend/test/integration/aislamiento/endpoints-protegidos.ts` (PR09) y sus celdas a la prueba parametrizada `tecnologia/plataforma-barberias/backend/test/contract/rbac.spec.ts` (PR08)
- [X] T103 [P] [US4] Pruebas de las pantallas en `tecnologia/plataforma-barberias/frontend/test/pages/agenda.spec.tsx`:
  - la agenda como lista por fecha (primera línea de corte), con filtro y marcas;
  - acciones de estado solo cuando la hora llegó;
  - en Clientes, la búsqueda y el alta presencial con casilla de consentimiento obligatoria.

### Implementation for User Story 4

- [X] T104 [US4] Ampliar `Cita` con `completar(ahora)`, `marcarNoAsistio(ahora)` y `aprobar()` y crear `MarcaConflicto` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/domain/cita.ts` y `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/domain/marca-conflicto.ts`
- [X] T105 [US4] Crear `CambiarEstadoCita` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/application/cambiar-estado-cita.ts`:
  - bloquea la fila con `FOR UPDATE` vía `CitaRepository.buscarParaActualizar`;
  - el barbero solo opera citas de su barbero vinculado y si no, 404;
  - registra historial y auditoría.
- [X] T106 [US4] Implementar `ClientesApi.datosDeContacto(ids)` (en lote, una consulta) y `perfilDeBarberia(clienteId)` en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/application/clientes-api.ts`
- [X] T107 [US4] Crear `ConsultarAgenda` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/application/consultar-agenda.ts`:
  - día local con `ZonaHoraria` y `BarberiasApi.configuracionAgenda`;
  - citas del día, bloqueos y tramos para calcular `MarcaConflicto`;
  - datos de contacto con `ClientesApi.datosDeContacto`;
  - el barbero queda limitado al suyo.
- [X] T108 [US4] Crear `RegistrarClientePresencial` y `BuscarClientes` (hasta 20 resultados, sin acceso a otras barberías) en `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/application/registrar-cliente-presencial.ts` y `tecnologia/plataforma-barberias/backend/src/modules/acceso-barberias/clientes/application/buscar-clientes.ts`; agregar `GET /clientes` y `POST /clientes` a `clientes.controller.ts`
- [X] T109 [US4] Ampliar `ReservarCita` para la cita presencial:
  - el propietario envía `clienteId`, validado con `ClientesApi.perfilDeBarberia`;
  - la cita queda con `origin = PRESENCIAL`.

  Crear `AgendaController` (`GET /agenda`) y `POST /citas/:id/estado` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/presentation/agenda.controller.ts` y `citas.controller.ts`.

- [X] T110 [P] [US4] Crear la pantalla `tecnologia/plataforma-barberias/frontend/src/pages/panel/Agenda.tsx`:
  - lista por fecha con filtro de barbero;
  - `EtiquetaEstado` y marcas "en conflicto" y "cancelación tardía";
  - acciones de completar y no asistió;
  - botón "cita presencial" que abre la búsqueda o el alta de cliente y los horarios del día.
- [X] T111 [P] [US4] Crear la pantalla `tecnologia/plataforma-barberias/frontend/src/pages/panel/Clientes.tsx`: búsqueda y alta presencial con la casilla "la persona aceptó verbalmente el tratamiento de sus datos" y el texto de la política.

**Checkpoint**: agenda y estados funcionando y probados (quickstart §3.6).

---

## Phase 7: User Story 5 - El cliente cancela su cita (Priority: P2)

**Goal**: cancelar libera el horario de inmediato. La cancelación del cliente con menos antelación que
la mínima queda tardía; la del propietario nunca (RF14).

**Independent Test**: con dos citas sembradas, cancelar una con antelación suficiente y otra sin ella.
Ambas horas vuelven a estar libres y solo la segunda es tardía (escenarios 1–5 de US5;
quickstart §3.7).

### Tests for User Story 5 (MANDATORY - constitution Principle X) ⚠️

- [X] T112 [P] [US5] Pruebas unitarias de `Cita.cancelar(actor, ahora, antelacion)` en `tecnologia/plataforma-barberias/backend/test/unit/citas/cancelar.spec.ts`:
  - el cliente cancela hasta el inicio, y después recibe `TransicionInvalida`;
  - es tardía si `inicio − ahora < antelación` (límite exacto incluido);
  - el propietario nunca genera una cancelación tardía;
  - no se cancela dos veces.
- [X] T113 [P] [US5] Integración en `tecnologia/plataforma-barberias/backend/test/integration/citas/cancelar.spec.ts`:
  - la hora vuelve a estar libre en la consulta siguiente y se puede reservar de nuevo;
  - `late_cancellation` según la antelación de la barbería;
  - se registran `cancelled_by`, `cancelled_at` y el motivo;
  - la cita de otro cliente de la misma barbería → 404;
  - el barbero → 403;
  - se registran `CITA_CANCELADA` e historial.
- [X] T114 [P] [US5] Prueba de contrato de `POST /citas/{id}/cancelar` en `tecnologia/plataforma-barberias/backend/test/contract/citas.contract.spec.ts`, y agregar la operación a `endpoints-protegidos.ts` y `rbac.spec.ts`
- [X] T115 [P] [US5] Prueba de cancelación en la interfaz en `tecnologia/plataforma-barberias/frontend/test/pages/cancelar.spec.tsx`:
  - la confirmación avisa si será tardía según la antelación;
  - tras cancelar, la cita aparece cancelada.

### Implementation for User Story 5

- [X] T116 [US5] Ampliar `Cita` con `cancelar(actor, ahora, antelacionMinutos)` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/domain/cita.ts`
- [X] T117 [US5] Crear `CancelarCita` en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/application/cancelar-cita.ts`:
  - fila con `FOR UPDATE`;
  - el cliente solo sus citas (si no, 404);
  - antelación desde `BarberiasApi.configuracionAgenda`;
  - historial y auditoría.

  Ruta `POST /citas/:id/cancelar` en `citas.controller.ts`.

- [X] T118 [US5] Agregar la acción de cancelar:
  - en la confirmación de `tecnologia/plataforma-barberias/frontend/src/pages/publico/Reservar.tsx`;
  - en `tecnologia/plataforma-barberias/frontend/src/pages/panel/Agenda.tsx` (propietario);
  - con un componente compartido `ConfirmarCancelacion` en `tecnologia/plataforma-barberias/frontend/src/components/app/ConfirmarCancelacion.tsx` que avisa si será tardía.

**Checkpoint**: cancelación funcionando y probada (quickstart §3.7).

---

## Phase 8: User Story 6 - El cliente consulta su historial (Priority: P3)

**Goal**: el cliente ve sus citas de la barbería de su sesión, por fecha, con su estado final (RF17).

**Independent Test**: con dos clientes con citas en distintos estados en la misma barbería, cada uno
ve solo las suyas, ordenadas, con su estado (escenarios 1–2 de US6).

### Tests for User Story 6 (MANDATORY - constitution Principle X) ⚠️

- [X] T119 [P] [US6] Integración en `tecnologia/plataforma-barberias/backend/test/integration/citas/historial.spec.ts`:
  - solo las citas propias y de la barbería de la sesión;
  - orden por inicio descendente;
  - paginación simple (`pagina`, `tamano`, `total`);
  - un cliente con membresía en A y B ve con el token de A solo las de A (PR09);
  - el propietario o el barbero → 403.
- [X] T120 [P] [US6] Prueba de contrato de `GET /clientes/yo/citas` en `tecnologia/plataforma-barberias/backend/test/contract/citas.contract.spec.ts` y agregar la operación a `endpoints-protegidos.ts` y `rbac.spec.ts`
- [X] T121 [P] [US6] Prueba de la pantalla en `tecnologia/plataforma-barberias/frontend/test/pages/mis-citas.spec.tsx`: lista con estados, cancelar solo en citas activas futuras, y vacío con `EstadoVacio`.

### Implementation for User Story 6

- [X] T122 [US6] Crear `ConsultarHistorial` (perfil vía `ClientesApi.perfilDeSesion`; consulta por `appointment_cliente`) en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/application/consultar-historial.ts` y `HistorialController` (`GET /clientes/yo/citas`) en `tecnologia/plataforma-barberias/backend/src/modules/catalogo-citas/citas/presentation/historial.controller.ts`
- [X] T123 [US6] Crear la pantalla `tecnologia/plataforma-barberias/frontend/src/pages/cliente/MisCitas.tsx` (ruta `/mis-citas`, rol `CLIENTE`):
  - historial paginado sin filtros (tercera línea de corte);
  - cancelar con `ConfirmarCancelacion`;
  - nombre de la barbería de la sesión.

**Checkpoint**: todas las historias funcionan de forma independiente.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: documentación que el plan dejó para el cambio con código, revisión obligatoria de
ADR-015, validación de punta a punta y calidad.

- [X] T124 Revisión obligatoria de ADR-015 por el cambio de `auth_resolver_cuenta` (`LEFT JOIN`, ADR-020):
  - qué se revisa: el diff de la migración `0009`; que la firma, la ausencia de tenant y el `LIMIT 1` se mantienen; T080 en verde;
  - registrarla con fecha y revisor en la nota de consecuencias de ADR-015 en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`.
- [X] T125 [P] Actualizar `docs/02-arquitectura-software/api-rest.md`:
  - rutas de 002 según [contracts/openapi.yaml](contracts/openapi.yaml), entre ellas `/publico/{slug}/horarios`, `POST /citas/{id}/cancelar` y `/citas/{id}/estado` (ahora `POST`), `/agenda`, `/clientes`, `/auth/barberia` y `/barberia/horario`;
  - regla de `Idempotency-Key`.
- [X] T126 [P] Actualizar `docs/03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md`:
  - diagrama de estados con los códigos en español y la entrada `CONFIRMADA` (FR-035a);
  - mención de las dos restricciones de exclusión y de la marca de conflicto calculada.
- [X] T127 [P] Actualizar la matriz rol × operación de `docs/02-arquitectura-software/seguridad-y-privacidad.md` con las filas de [contracts/rbac.md](contracts/rbac.md) y la nota de la vía pública (ADR-021)
- [X] T128 [P] Actualizar el modelo de datos de referencia en `docs/02-arquitectura-software/multi-tenancy-y-datos.md`:
  - entidades nuevas, `period` y las dos restricciones `EXCLUDE`;
  - `consent_record`, `business_hours` en M02;
  - RLS de `tenant`;
  - rol `barberias_publico` en la sección de roles.
- [X] T129 [P] Actualizar `tecnologia/plataforma-barberias/README.md` con:
  - el rol nuevo y cómo crearlo en una base existente;
  - `DATABASE_URL_PUBLICO`;
  - las migraciones `0009`–`0012`;
  - las rutas públicas `/b/:slug`.
- [ ] T130 [P] Revisar con axe-core (0 incumplimientos WCAG A/AA) y Lighthouse en modo celular (≥ 90 en rendimiento, accesibilidad y buenas prácticas) las pantallas nuevas, en especial `/b/:slug`. Comprobar que el JavaScript inicial sigue ≤ 400 KB y registrar las mediciones en `docs/02-arquitectura-software/tecnologias.md`.
- [X] T131 [P] Ampliar la prueba de entradas (FR-051, EQ-10, PR10) en `tecnologia/plataforma-barberias/backend/test/integration/host/entradas.spec.ts` a todas las rutas nuevas de [contracts/openapi.yaml](contracts/openapi.yaml):
  - textos con `<script>`, caracteres de control y longitudes por encima del máximo;
  - fechas imposibles o mal formadas, montos negativos o con más de 2 decimales, duraciones fuera de rango, UUID inválidos;
  - campos `tenantId`, `tenant_id` o `barberiaId` en el cuerpo de rutas con sesión, y el encabezado `X-Tenant-Id`.

  Todo responde 400 `VALIDACION` con mensaje controlado y sin ejecutar ni reflejar el contenido.

- [X] T132 [P] Ampliar la suite de auditoría (PR13, FR-050) en `tecnologia/plataforma-barberias/backend/test/integration/auditoria.spec.ts` con las 12 acciones nuevas de R19:
  - `CLIENTE_REGISTRADO`, `CLIENTE_UNIDO`, `CLIENTE_PRESENCIAL_REGISTRADO`, `BARBERIA_CAMBIADA`;
  - `ENLACE_CAMBIADO`, `SERVICIO_DESACTIVADO`, `BARBERO_DESACTIVADO`, `BLOQUEO_CON_CONFLICTO`, `CAMBIO_CON_CONFLICTO`;
  - `CITA_RESERVADA`, `CITA_CANCELADA`, `CITA_ESTADO_CAMBIADO`.

  Cada una con actor, recurso solo por identificador, barbería, resultado y fecha, y sin datos personales en el texto.

- [X] T133 Medición preliminar de horarios libres (evidencia previa a la prueba de carga de 006 para SC-004, EQ-01). Crear el script `tecnologia/plataforma-barberias/backend/scripts/medir-horarios.ts`, ejecutable con un script nuevo `medir:horarios` en `tecnologia/plataforma-barberias/backend/package.json` que usa el `tsx` ya instalado (sin dependencias nuevas ni descargas), fuera de CI:
  - con una barbería sembrada de 5 barberos y 60 citas en el día, lanza 50 consultas simultáneas a `GET /api/v1/publico/{slug}/horarios` contra el backend de Docker Compose (una instancia), en 10 rondas;
  - informa p50, p95 y errores.

  Registrar el resultado como **evidencia preliminar** (no sustituye a 006) en la fila de 002 de `docs/trazabilidad.md` y en [quickstart.md](quickstart.md) §5. Meta de referencia: p95 ≤ 800 ms y 0 % de errores 5xx.

- [ ] T134 Recorrer completo [quickstart.md](quickstart.md):
  - pruebas §2 y recorrido manual §3 cronometrado desde un celular (SC-010 < 3 min, SC-011 < 15 min);
  - registrar los resultados y el estado "Implementada" en la fila de 002 de `docs/trazabilidad.md`.
- [X] T135 Ejecutar `npm run lint`, `npm test`, `npm run test:int` y `npm run test:arch` en `tecnologia/plataforma-barberias/backend` y `npm run lint` y `npm test` en `tecnologia/plataforma-barberias/frontend`, todo en verde, y `prettier --check` con el prettier local del proyecto sobre los archivos cambiados

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (fase 1):** sin dependencias.
- **Foundational (fase 2):** depende de Setup y bloquea todas las historias. Las migraciones van en
  orden: T006 → T007 → T008 → T009 → T010.
- **Historias (fases 3–8):** dependen de la fase 2. Con los fixtures de T011–T012, cada una se prueba
  sola.
- **Polish (fase 9):** al terminar las historias. T124 debe estar hecha antes de fusionar el cambio de
  `auth_resolver_cuenta` (T006).

### User Story Dependencies

- **US1 (P1):** solo la fase 2.
- **US2 (P1):** solo la fase 2. Sus pruebas siembran el catálogo con fixtures. La pantalla
  pública usa datos reales si US1 ya está.
- **US3 (P1):** solo la fase 2 para el backend. Las reglas de reserva (T093) leen el catálogo con
  `CatalogQuery` (T031) sobre datos sembrados, así que no dependen de US1 ni de US2. La pantalla
  `Reservar` parte de `CatalogoPublico` (T074, US2).
- **US4 (P2):** necesita `Cita` y `CitaRepository` de US3 (T091, T092). La cita presencial amplía
  `ReservarCita` (T093).
- **US5 (P2):** necesita `Cita` y `CitaRepository` de US3.
- **US6 (P3):** necesita `CitaRepository` y `ClientesApi.perfilDeSesion` de US3. La pantalla reutiliza
  `ConfirmarCancelacion` de US5.

### Within Each User Story

- Las pruebas se escriben primero y deben fallar.
- Después: dominio → puertos y repositorios → casos de uso → controladores → pantallas.
- Primero el backend de la historia; la pantalla cierra la historia.

### Parallel Opportunities

- Setup: T002–T004 en paralelo tras T001.
- Fase 2: T011–T012, T014–T016, T022–T027 y T034, T036, T037, T039 en paralelo (archivos distintos).
- Dentro de cada historia: todas las pruebas [P] juntas; las entidades de dominio [P] juntas; las
  pantallas [P] cuando su backend existe.
- US1 y US2 pueden avanzar en paralelo tras la fase 2. US5 y US6 también, después de US3.

---

## Parallel Example: User Story 1

```bash
# Pruebas de US1 juntas:
Task: "T040 Pruebas unitarias del dominio del catálogo en backend/test/unit/catalogo/catalogo-dominio.spec.ts"
Task: "T042 Contrato del catálogo en backend/test/contract/catalogo.contract.spec.ts"
Task: "T044 Integración de servicios en backend/test/integration/catalogo/servicios.spec.ts"
Task: "T045 Integración de barberos en backend/test/integration/catalogo/barberos.spec.ts"
Task: "T046 Integración de disponibilidad en backend/test/integration/catalogo/disponibilidad.spec.ts"

# Pantallas de US1 juntas (con el backend listo):
Task: "T060 Barberia.tsx"  Task: "T061 Servicios.tsx y Barberos.tsx"  Task: "T062 Disponibilidad.tsx"
```

## Parallel Example: User Story 3

```bash
# Pruebas primero, juntas (PR16 en primer lugar por el orden del plan de entrega):
Task: "T075 PR16 en backend/test/integration/citas/concurrencia-reservas.spec.ts"
Task: "T077 Integración de reserva en backend/test/integration/citas/reservar.spec.ts"
Task: "T078 Cuenta de cliente en backend/test/integration/clientes/cuenta-cliente.spec.ts"
Task: "T079 PR09 cliente en dos barberías en backend/test/integration/aislamiento/cliente-dos-barberias.spec.ts"

# Dominio en paralelo:
Task: "T083 PerfilCliente y Consentimiento"  Task: "T091 Cita y EstadoCita"
```

---

## Implementation Strategy

### Orden del plan de entrega (días 1–6, R20)

1. **Día 1:** fase 1 y fase 2 completas, incluidas las migraciones T006–T010, `CatalogQuery`
   (T031–T032), la lectura pública (T017–T018), las matrices de permisos y PR14. Todo lo que sigue
   depende de esta base.
2. **Día 2:** núcleo de la reserva de US3, primero lo que nunca se recorta:
   - pruebas PR16 (T075), `Cita` (T076) y reserva (T077);
   - `ClientesApi.perfilDeSesion` (T090), `Cita` (T091), `CitaRepositoryPostgres` (T092), `ReservarCita` (T093) y `CitasController` (T094) sobre datos sembrados.

   Se cierra con PR16 en verde.

3. **Día 3:** US2 (vía pública con sus pruebas de ADR-021) y el resto de US3: cuenta de cliente
   (T078–T089) y pantallas de registro, ingreso y reserva (T095–T097).
4. **Día 4:** US1, configuración del propietario (backend y pantallas).
5. **Día 5:** US4 y US5, agenda, estados, cita presencial y cancelación.
6. **Día 6:** US6 y fase 9, con la revisión de ADR-015, la medición preliminar, la documentación y el
   quickstart. Si hay atraso, se aplican las líneas de corte de R20, nunca sobre PR16, PR09, PR14 ni
   la vía pública.

### MVP First

MVP de la funcionalidad: US1 + US2 + US3 (las tres P1). Una barbería configurada recibe reservas
públicas sin duplicados. Validar con quickstart §2 y §3.1–3.4 antes de seguir.

### Incremental Delivery

Fase 2 → US1 → US2 → US3 (MVP, demostrable) → US4 → US5 → US6 → Polish. Cada historia agrega valor sin
romper las anteriores: las suites PR09, PR14 y PR16 se ejecutan en cada paso.

---

## Notes

- [P] = archivos distintos, sin dependencias pendientes.
- [Story] enlaza cada tarea con su historia para la trazabilidad.
- Verificar que las pruebas fallan antes de implementar.
- Confirmar los cambios por tarea o grupo lógico, con commits convencionales y solo cuando el
  responsable lo pida.
- Evitar consultas de M02 a tablas de M01: siempre por `ClientesApi`, `PersonalApi` o `BarberiasApi`.
  La única excepción es la FK de esquema `appointment.customer_id`.
- Ninguna operación con sesión acepta `slug`, `barberia`, `tenantId` ni `X-Tenant-Id` (principio III).
