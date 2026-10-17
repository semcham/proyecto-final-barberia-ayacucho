# Implementation Plan: Catálogo, citas y cuenta de cliente

**Branch**: `002-catalogo-citas-cliente` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-catalogo-citas-cliente/spec.md`

## Summary

Segunda funcionalidad, sobre la base implementada de 001.

- **El propietario configura su barbería:** datos, enlace y horario de atención (M01); servicios,
  barberos con servicios y vínculo opcional a un usuario, disponibilidad semanal y bloqueos (M02).
- **Cualquier persona** ve el catálogo y los horarios libres por el enlace, mediante un rol de base
  de datos de solo lectura, sin `BYPASSRLS` y con permisos solo sobre columnas públicas (ADR-021).
- **El cliente:**
  - se registra con consentimiento desde ese enlace y obtiene una membresía `CLIENTE` y un perfil en
    esa barbería;
  - inicia sesión con un token de una sola barbería y cambia de barbería con otra sesión (ADR-020);
  - reserva, cancela y ve su historial.
- **Las reservas** nacen `CONFIRMADA`. Nunca se duplican, gracias a dos restricciones de exclusión de
  PostgreSQL (barbero y cliente) sobre un `tstzrange` de citas activas, y son idempotentes con
  `Idempotency-Key`.
- **La barbería** ve la agenda por fecha y barbero, con marcas de cancelación tardía y de conflicto
  calculadas al leer, y cambia estados solo por transiciones válidas con historial.
- **Hora local:** todo se calcula en la hora de la barbería (`America/Lima`) con `Intl`, sin
  dependencias nuevas.

**Selección de membresía por enlace (resuelto el 2026-10-17):** el registro, el ingreso con enlace, la
unión y el cambio de barbería usan el `slug` para elegir la barbería **antes** de que exista su
sesión. El responsable aprobó la enmienda **1.2.0** de la constitución, que agrega esa segunda
excepción acotada al principio III, y aceptó ADR-020 y ADR-021 ([research.md](research.md) R04).

## Technical Context

**Language/Version**: TypeScript 5 (`strict`) sobre Node.js 22 LTS (igual que 001)

**Primary Dependencies**: las de 001, sin dependencias nuevas:

- Backend: NestJS 11, Kysely + `pg`, `argon2`, `jose`, `class-validator`, `@nestjs/throttler`.
- Frontend: React 19, Vite 6, React Router, TanStack Query, `react-hook-form` + `zod`, Radix UI.
- La zona horaria se resuelve con `Intl` (R07).

**Storage**: PostgreSQL 16.

- RLS `FORCE` en las 8 tablas nuevas y, por primera vez, en `tenant` (solo restringe `UPDATE`).
- Extensión `btree_gist` y restricciones `EXCLUDE USING gist`.
- Rol nuevo `barberias_publico` (`LOGIN NOBYPASSRLS`, solo `SELECT` por columna) con pool propio.
- Una función de ADR-015 cambiada (`auth_resolver_cuenta`, `LEFT JOIN`).
- Sin Redis (la caché del catálogo llega con la funcionalidad 006, ADR-029).

**Testing**: como en 001. Backend: Jest, `supertest`, Testcontainers y `dependency-cruiser`.
Frontend: Vitest, Testing Library, MSW y axe-core. PR16 levanta 2 instancias de la aplicación sobre
la misma base.

**Target Platform**: contenedores Linux (Docker Compose; AWS documentado, no ejecutado) y
navegadores móviles y de escritorio actuales.

**Project Type**: aplicación web, con API REST (NestJS) y SPA responsive (React).

**Performance Goals**:

- Horarios libres p95 ≤ 800 ms con 50 consultas simultáneas (SC-004, EQ-01).
- Reserva p95 ≤ 1,5 s a 20 por segundo (SC-005, EQ-02). Ambas se miden en 006; en 002, el cálculo de
  un día con 5 barberos y 60 citas tarda menos de 200 ms en la integración.
- Catálogo público con 1 solicitud y horarios con 1 solicitud por fecha.
- JavaScript inicial ≤ 400 KB y pantallas nuevas con `React.lazy` (ADR-018).

**Constraints**:

- **Sin duplicados:** 0 duplicados con 200 reservas simultáneas (SC-001, principio IV).
- **Aislamiento:** 0 fugas entre barberías y 0 datos privados por la vía pública (SC-002, SC-003).
- **Tenant:** sale del token en toda operación con sesión.
- **Instantes:** en UTC y presentados en la hora local de la barbería.
- **Reutilizado de 001:** cuerpo ≤ 16 KB, CORS y límite de solicitudes por IP, también en la vía
  pública y en el registro.

**Scale/Scope**:

- Decenas de barberías, hasta unos 10 barberos y unas 100 citas diarias por barbería.
- 8 tablas nuevas, 4 migraciones y unas 25 operaciones REST.
- 11 pantallas nuevas (catálogo público, registro, ingreso con enlace, reserva, mis citas,
  barbería, servicios, barberos, disponibilidad, agenda, clientes).
- 6 días de implementación (plan de entrega, días 1–6).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Gates from `.specify/memory/constitution.md` (v1.2.0; el plan se redactó con la 1.1.0 y se
reevaluó tras la enmienda del 2026-10-17).

| #    | Puerta                   | Antes de Fase 0 | Tras el diseño | Evidencia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------ | --------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I    | Seis módulos             | ✅              | ✅             | M01 (`barberias`, `identidad`, `clientes`, submódulo nuevo), M02 (`catalogo`, `citas`, módulo nuevo en el código, pero es uno de los seis), M03 (límite de barberos) y M06 (`ZonaHoraria`). La matriz se amplía con **M02 → M01** por `index.ts` (ADR-020, R05); M01 no llama a M02; sin ciclos. Sin módulos nuevos                                                                                                                                                                                                                                                                                                                                            |
| II   | Cuatro capas             | ✅              | ✅             | Cada submódulo con sus 4 capas. Dominio puro: `CalculadoraHorarios`, `Cita`, `HorarioSemanal`, `RangoHorario`, `Servicio`, `Barbero`, `PerfilCliente`, `Consentimiento`. Puertos: repositorios, `CatalogoPublicoRepository`, `ClientesApi`/`PersonalApi` (M01), `SuscripcionesApi` (M03). PR14 con reglas nuevas                                                                                                                                                                                                                                                                                                                                               |
| III  | Aislamiento por barbería | ⚠️ (con 1.1.0)  | ✅ (con 1.2.0) | Toda operación con sesión toma el tenant del token. RLS en las tablas nuevas y en el `UPDATE` de `tenant`; FK compuestas con tenant; filtro en repositorios. **Lecturas públicas:** primera excepción, con `barberias_publico` sin `BYPASSRLS`, permisos por columna y `READ ONLY` (ADR-021, Aceptado). **Selector `slug` previo a la sesión** (registro, ingreso con enlace, unión, cambio de barbería): segunda excepción, "selección de membresía por enlace", agregada por la enmienda 1.2.0. Solo tras comprobar la identidad o al crear la cuenta, solo filas de la propia persona y nunca en operaciones de negocio con sesión (ADR-020, Aceptado; R04) |
| IV   | Citas sin duplicados     | ✅              | ✅             | `appointment_no_overlap_barber` (`EXCLUDE USING gist` sobre tenant, barbero y `tstzrange` `[)`, citas activas), en transacción; `23P01` → 409 `HORARIO_NO_DISPONIBLE`. Además, `appointment_no_overlap_customer`. Ninguna comprobación previa se toma como garantía (R06)                                                                                                                                                                                                                                                                                                                                                                                      |
| V    | Pagos                    | N/A             | N/A            | No se tocan pagos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| VI   | IA                       | N/A             | N/A            | No se toca M04                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| VII  | Notificaciones           | ✅              | ✅             | No se envían mensajes en 002 (RF30 en 004). M02 no llama a M05. El aviso de cancelación de HU13 llegará en 004 escuchando eventos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| VIII | Redis                    | ✅              | ✅             | No se usa Redis. Disponibilidad, idempotencia y límites en PostgreSQL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| IX   | Solo web responsive      | ✅              | ✅             | Pantallas React móvil primero; catálogo público liviano                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| X    | Pruebas obligatorias     | ✅              | ✅             | **PR16** (200 simultáneas, 2 instancias, variantes), **PR09** (cliente en dos barberías, selector, vía pública con 6 pruebas, RLS nueva, `auth_resolver_cuenta`), **PR14** (matriz nueva, pool público confinado), PR08, PR13, dominio sin infraestructura, contrato y frontend (R18). CI bloquea la fusión                                                                                                                                                                                                                                                                                                                                                    |
| XI   | ADR                      | ✅              | ✅             | ADR-020 y ADR-021 registrados antes de implementar y **Aceptados** por el responsable el 2026-10-17. En este mismo cambio se actualizan la matriz de dependencias (`estilo-arquitectonico.md`), el control 1 de `multi-tenancy-y-datos.md` y `trazabilidad.md`. Se actualizan con el código: rutas en `api-rest.md`, códigos de estado en `diseño-interno-de-modulos.md`, matriz RBAC de `seguridad-y-privacidad.md` y el modelo de datos de referencia. El cambio de `auth_resolver_cuenta` exige la revisión de ADR-015                                                                                                                                      |
| XII  | Ubicación del código     | ✅              | ✅             | Todo bajo `tecnologia/plataforma-barberias/`; CI sin cambios de lógica                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Resultado:** pasa. Con la constitución 1.1.0, el selector `slug` quedaba fuera de la excepción del
principio III. El responsable aprobó la enmienda 1.2.0 el 2026-10-17 y con ella todas las puertas
quedan en verde. Complexity Tracking conserva la justificación de las decisiones que exigen
excepción o mecanismo propio.

## Project Structure

### Documentation (this feature)

```text
specs/002-catalogo-citas-cliente/
├── plan.md              # Este archivo
├── research.md          # Fase 0: decisiones R01–R20
├── data-model.md        # Fase 1: tablas, RLS, restricciones de exclusión, migraciones 0009–0012
├── quickstart.md        # Fase 1: guía de validación de punta a punta
├── contracts/
│   ├── openapi.yaml     # Fase 1: contrato REST /api/v1 (amplía el de 001)
│   └── rbac.md          # Fase 1: matriz rol × operación ampliada (fuente de PR08)
├── checklists/
│   └── requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks; no lo crea este comando)
```

### Source Code (repository root)

Solo se listan las carpetas nuevas y los archivos de 001 que cambian.

```text
tecnologia/plataforma-barberias/
├── .env.example                          # + DATABASE_URL_PUBLICO
├── docker-compose.yml                    # backend recibe DATABASE_URL_PUBLICO
├── db/init/01-roles.sql                  # + barberias_publico (LOGIN NOBYPASSRLS), CONNECT, USAGE
├── backend/
│   ├── .dependency-cruiser.cjs           # + matriz-m01, matriz-m02, pool-publico-solo-en-catalogo
│   ├── migrations/
│   │   ├── 0009_cuenta_cliente.ts        # CLIENTE, customer_profile, consent_record, auth_resolver_cuenta LEFT JOIN
│   │   ├── 0010_catalogo.ts              # tenant (columnas + RLS), business_hours, service, barber, barber_service, working_hours, time_off
│   │   ├── 0011_citas.ts                 # btree_gist, appointment (EXCLUDE ×2, idempotencia), appointment_status_history
│   │   └── 0012_lectura_publica.ts       # GRANT SELECT por columna a barberias_publico
│   ├── src/
│   │   ├── host/                         # + rutas públicas sin token; @Roles nuevos
│   │   ├── modules/
│   │   │   ├── acceso-barberias/         # M01
│   │   │   │   ├── index.ts              # + ClientesApi, PersonalApi, BarberiasApi
│   │   │   │   ├── barberias/            # + ObtenerBarberia, ActualizarBarberia; Slug ampliado; BarberiasApi
│   │   │   │   ├── identidad/            # IniciarSesion con enlace y unión; CambiarBarberia; Rol CLIENTE; LimiteUsuarios y ListarUsuarios sin clientes
│   │   │   │   └── clientes/             # nuevo: RegistrarCliente, UnirseABarberia, RegistrarClientePresencial, BuscarClientes;
│   │   │   │                             # PerfilCliente, Consentimiento; repositorios Kysely
│   │   │   ├── catalogo-citas/           # M02 (nuevo en el código)
│   │   │   │   ├── index.ts              # interfaz pública (para M04 en 005)
│   │   │   │   ├── catalogo/
│   │   │   │   │   ├── presentation/     # ServiciosController, BarberosController, DisponibilidadController, PublicoController
│   │   │   │   │   ├── application/      # casos de uso de servicios, barberos, disponibilidad, bloqueos; ConsultarHorarios; puertos
│   │   │   │   │   ├── domain/           # Servicio, Barbero, HorarioSemanal, Bloqueo, CalculadoraHorarios, RangoHorario, PermisosCatalogoCitas
│   │   │   │   │   └── infrastructure/   # repositorios Kysely
│   │   │   │   │       └── publico/      # ÚNICO lugar con el pool barberias_publico (ADR-021)
│   │   │   │   └── citas/
│   │   │   │       ├── presentation/     # CitasController, AgendaController, HistorialController
│   │   │   │       ├── application/      # ReservarCita, CancelarCita, CambiarEstadoCita, ConsultarAgenda, ConsultarHistorial
│   │   │   │       ├── domain/           # Cita, EstadoCita, MarcaConflicto, errores
│   │   │   │       └── infrastructure/   # CitaRepositoryPostgres (23P01 → HorarioNoDisponible; idempotencia)
│   │   │   └── suscripciones-pagos/      # + obtenerLimiteBarberos en index.ts
│   │   └── shared/
│   │       ├── persistence/              # + pool público (DatabasePublica) y transacción READ ONLY
│   │       ├── tiempo/                   # nuevo: ZonaHoraria, FechaLocal (Intl)
│   │       └── config/                   # + HORARIOS_PASO_MINUTOS, RESERVA_HORIZONTE_DIAS, DATABASE_URL_PUBLICO
│   └── test/
│       ├── unit/catalogo/, unit/citas/, unit/clientes/, unit/shared/zona-horaria.spec.ts
│       ├── integration/
│       │   ├── aislamiento/              # + lectura-publica, cliente-dos-barberias, rls (tablas nuevas), endpoints-protegidos ampliado
│       │   ├── citas/concurrencia-reservas.spec.ts   # PR16 (2 instancias, 200 simultáneas, variantes)
│       │   ├── citas/, catalogo/, clientes/
│       ├── contract/                     # + catálogo, citas, clientes; rbac.spec.ts ampliado (PR08)
│       └── architecture/                 # fixture con violaciones nuevas (M01→M02, pool público fuera de su carpeta)
└── frontend/
    └── src/
        ├── pages/publico/                # CatalogoPublico, RegistroCliente, IngresarBarberia, Reservar
        ├── pages/cliente/                # MisCitas
        ├── pages/panel/                  # Barberia, Servicios, Barberos, Disponibilidad, Agenda, Clientes
        ├── auth/                         # + cambio de barbería; rol CLIENTE en RutaProtegida
        └── routes.tsx                    # rutas nuevas con React.lazy
```

**Structure Decision**: se mantiene la estructura de 001 (principio XII, ADR-014). M02 aparece por
primera vez en el código como `modules/catalogo-citas/`, con los submódulos `catalogo` y `citas`. La
cuenta de cliente vive en M01 (submódulo nuevo `clientes`, RF05). La vía pública queda confinada en
una carpeta de infraestructura de M02 con su propio pool.

## Flujo principal (diseño)

```mermaid
sequenceDiagram
    autonumber
    participant W as Web (React)
    participant P as PublicoController (M02)
    participant DBP as PostgreSQL (barberias_publico, READ ONLY)
    participant C as CitasController (M02)
    participant R as ReservarCita (M02)
    participant M1 as ClientesApi (M01)
    participant DB as PostgreSQL (barberias_app, RLS)
    W->>P: GET /publico/{slug}/horarios?servicio&fecha
    P->>P: BarberiasApi.resolverSlugPublico(slug) → tenantId (M01)
    P->>DBP: BEGIN READ ONLY; set_config(tenantId); tramos, bloqueos y citas del día (columnas públicas)
    P-->>W: horas libres + calculadoEn + zonaHoraria
    W->>C: POST /citas (token con tid; Idempotency-Key)
    C->>R: comando + actor (tenant del token)
    R->>DB: BEGIN; set_config(tid)
    R->>M1: perfilDeSesion(sub)
    R->>DB: ¿clave ya usada? → si sí, devolver la cita
    R->>DB: validar servicio, barbero, disponibilidad y bloqueos (mensajes)
    R->>DB: INSERT appointment (EXCLUDE barbero y cliente) + historial + auditoría
    alt libre
        DB-->>R: OK → COMMIT
        R-->>W: 201 cita CONFIRMADA
    else 23P01
        DB-->>R: exclusión → ROLLBACK
        R-->>W: 409 HORARIO_NO_DISPONIBLE
    end
```

## Trazabilidad

| HU         | RF         | Escenario    | ADR                       | Componente                                                                                                              | Prueba                                                             |
| ---------- | ---------- | ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| HU03       | RF03       | EQ-09        | ADR-003                   | M01 `barberias` · `ActualizarBarberia`; M02 `catalogo` · `ReemplazarHorarioAtencion`; RLS en `tenant`                   | Integración, PR09                                                  |
| HU06       | RF05       | EQ-18, EQ-09 | ADR-020, ADR-015          | M01 `clientes`, `identidad` · `RegistrarCliente`, `IniciarSesion` con enlace, `CambiarBarberia`; `auth_resolver_cuenta` | Integración, PR09 `cliente-dos-barberias`, `funciones-definer`     |
| HU07, HU08 | RF07, RF08 | EQ-08        | ADR-020 (M02 → M01)       | M02 `catalogo` · servicios y barberos; M03 `obtenerLimiteBarberos`                                                      | Integración, PR08                                                  |
| HU09       | RF09       | —            | ADR-009                   | M02 `catalogo` · disponibilidad y bloqueos con confirmación de conflictos                                               | Unitarias `HorarioSemanal`, integración                            |
| HU10       | RF10, RF11 | EQ-01, EQ-09 | ADR-021                   | M02 `catalogo/infrastructure/publico`; `CalculadoraHorarios`; M06 `ZonaHoraria`                                         | PR09 `lectura-publica`, unitarias del cálculo, humo de rendimiento |
| HU11, HU15 | RF12       | EQ-02, EQ-16 | ADR-009                   | M02 `citas` · `ReservarCita` (exclusión, idempotencia), cita presencial                                                 | **PR16**, integración                                              |
| HU13       | RF14       | —            | —                         | M02 `citas` · `CancelarCita`                                                                                            | Unitarias `Cita`, integración                                      |
| HU14, HU15 | RF15, RF16 | EQ-08, EQ-13 | ADR-010                   | M02 `citas` · `CambiarEstadoCita`, `ConsultarAgenda`; historial                                                         | PR08, PR13, integración                                            |
| HU16       | RF17       | EQ-09        | —                         | M02 `citas` · `ConsultarHistorial`                                                                                      | Integración, PR09                                                  |
| —          | (todas)    | EQ-09, EQ-14 | ADR-002, ADR-011, ADR-020 | Matriz de módulos con M02 → M01                                                                                         | PR14                                                               |

## Complexity Tracking

| Violation                                                                                                                                                                                                                                                                                                      | Why Needed                                                                                                                                                                                                                                                                                                                                                                         | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selector `slug` previo a la sesión** (principio III: el tenant sale del token; la excepción 1.1.0 solo cubre lecturas). Lo usan `POST /clientes/registro`, `POST /auth/login` con `barberia` y `POST /auth/barberia` para decidir en qué barbería se crea o se elige la membresía del cliente (ADR-020, R04) | El cliente es quien dice en qué barbería quiere reservar, y eso ocurre antes de que exista la sesión de esa barbería. Solo se usa tras comprobar la identidad (contraseña o sesión vigente) o al crear la cuenta, y solo escribe filas de la propia persona (cuenta, membresía, perfil, consentimiento, sesión). Ninguna operación de negocio con sesión lo acepta; PR09 lo prueba | Un token con varias barberías haría que cada solicitud eligiera el tenant. Una lista de barberías tras ingresar sigue siendo una elección del cliente y exige una función que liste membresías fuera de RLS. Pedir al propietario que dé de alta a cada cliente contradice RF05 (registro propio con consentimiento). **Resuelto:** la enmienda 1.2.0 (2026-10-17) agrega esta segunda excepción acotada al principio III; la fila se conserva como justificación |
| **Rol `barberias_publico` con pool propio** (segunda credencial de aplicación)                                                                                                                                                                                                                                 | La constitución exige que la vía pública no dé al rol de la aplicación la capacidad de omitir RLS y que exponga solo columnas públicas. Con permisos por columna, PostgreSQL rechaza una columna privada aunque el código falle                                                                                                                                                    | `SECURITY DEFINER` con un dueño `BYPASSRLS` (ADR-015) sería otro rol con bypass, por validar en RDS, con el tenant filtrado a mano. Usar `barberias_app` dejaría la protección de columnas solo en el código (ADR-021)                                                                                                                                                                                                                                            |
| **Cambio en una función de ADR-015** (`auth_resolver_cuenta` con `LEFT JOIN`)                                                                                                                                                                                                                                  | Un cliente no tiene membresía de personal y hoy la función no lo encuentra: no podría iniciar sesión. La firma, la ausencia de tenant y el máximo de una fila se mantienen                                                                                                                                                                                                         | Una función nueva solo para clientes duplicaría el camino de verificación de contraseña de tiempo constante; buscar la cuenta con RLS es imposible antes de conocer el tenant                                                                                                                                                                                                                                                                                     |
