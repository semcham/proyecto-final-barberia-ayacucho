# Implementation Plan: Suscripciones y pagos de las barberías

**Branch**: `003-suscripciones-pagos` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-suscripciones-pagos/spec.md`

## Summary

M03 pasa de "solo prueba gratuita y límites" a un módulo de cobro completo:

- **Pago con Yape** mediante una pasarela detrás del puerto `PaymentGateway`. Hay un **simulador**
  completo por HTTP y un adaptador del proveedor real, que se elige por configuración.
- **Transferencia con comprobante**, revisada por el administrador de la plataforma.
- **Notificaciones** firmadas e idempotentes, aplicadas en una sola transacción.
- **Historial de pagos y conciliación.**
- **Vencimiento automático** con dos réplicas sin duplicados.
- **Restricciones por estado**, integradas en las operaciones de 002 mediante la interfaz pública de
  M03.

Las garantías de dinero están en PostgreSQL, como las de las citas:

- los períodos pagados no se solapan (restricción de exclusión);
- un pago crea a lo sumo un período (`UNIQUE`);
- hay un solo pago abierto por suscripción (índice único parcial);
- un número de operación bancaria se aprueba una sola vez (índice único global);
- cada pago guarda su **período objetivo** (`covers_after`): una segunda aprobación del mismo
  período queda como duplicado y no crea otro período.

El **administrador de la plataforma** no pertenece a ninguna barbería, y eso exige una tercera
excepción acotada al principio III: **ADR-031**, aceptado el 2026-10-24 junto con la enmienda 1.3.0
de la constitución y su aclaración 1.3.1 (tablas de la plataforma), ya aplicadas (ver Complexity
Tracking).

## Technical Context

**Language/Version**: TypeScript 5 (`strict`) sobre Node.js 22 LTS, igual que 001, 002 y 006.

**Primary Dependencies**: las mismas de 006. **Ninguna dependencia nueva** (research R16):

| Necesidad                     | Cómo se cubre                                                     |
| ----------------------------- | ----------------------------------------------------------------- |
| Firma HMAC y TOTP             | `node:crypto`                                                     |
| HTTP al proveedor             | `fetch`                                                           |
| Subida de archivos            | `multer` 2.4.0 (MIT), que ya viene con `@nestjs/platform-express` |
| Detección del tipo de archivo | 3 firmas de bytes propias                                         |
| Simulador                     | `node:http`                                                       |

Opcionales, que no se instalan sin aprobación: `qrcode` (MIT), para el QR del TOTP.

**Storage**: PostgreSQL 16, con las migraciones `0014` a `0018`:

| Migración | Contenido                                                                                   |
| --------- | ------------------------------------------------------------------------------------------- |
| `0014`    | Planes y suscripción                                                                        |
| `0015`    | Pagos, períodos, comprobantes y eventos                                                     |
| `0016`    | Rol `barberias_plataforma`, identidad del administrador y tablas de la plataforma           |
| `0017`    | Ejecutor de tareas                                                                          |
| `0018`    | URL de la página del proveedor en el pago (al implementar US1: reutilizar el mismo intento) |

Los comprobantes se guardan en `bytea` con RLS detrás del puerto `AlmacenComprobantes` (ADR-023).
Redis no guarda nada de 003 (principio VIII).

**Testing**:

- **Jest**: unitarias (PR25, TOTP, firma y bytes).
- **Testcontainers con PostgreSQL real**: PR06, PR09, PR17, PR20, restricciones, vencimiento con dos
  instancias en proceso, conciliación y comprobantes.
- **Contrato**: OpenAPI de 003 y `rbac-003` (PR08).
- **PR14**: reglas nuevas.
- **Vitest con MSW**: interfaz.

El simulador se arranca dentro del proceso de las pruebas.

**Target Platform**: contenedores Linux en Docker Compose (entorno de 006 más el servicio
`pasarela-simulada`, de 64 MB). En la nube: lo documentado en ADR-006, sin despliegue.

**Project Type**: aplicación web (API REST NestJS y SPA React), con la misma estructura.

**Performance Goals**:

- Iniciar un pago, o recibir el mensaje alternativo, en 3 s o menos (SC-005), con un tiempo límite de
  2 s hacia el proveedor.
- La notificación se responde en 1 s o menos para el 95 % (FR-018); en las pruebas se mide el p95,
  con un objetivo de 300 ms (una transacción corta).
- La tarea de vencimiento procesa 50 suscripciones en menos de 10 s.

**Constraints**:

- Cero datos de tarjeta (principio V).
- Importes en céntimos enteros.
- Secretos solo en `.env`.
- Equipo de 8 GB: el simulador suma 64 MB.
- Nada se descarga en C:.

**Scale/Scope**: decenas de barberías y un pago al mes cada una. Unos 25 endpoints, 9 pantallas, 4
migraciones y 1 servicio de Compose.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Verificación antes de la investigación y otra vez tras el diseño, con la constitución 1.2.0. Se
repitió el 2026-10-24 con la 1.3.0, tras aprobarse la enmienda, y otra vez con la aclaración 1.3.1,
tras el análisis de consistencia:

- [x] **I. Seis módulos.** Todo queda en M03, con los submódulos nuevos `pagos` y `plataforma`, en M01
      (`identidad` para el administrador y `barberias` para suspender) y en M06 (`tareas` y
      `resiliencia`). M02 y M01 llaman a M03 solo por `index.ts`, como ya permite la matriz. M03 sigue sin
      llamar a nadie más que a M06. No hay efectos entre módulos que requieran eventos. El simulador está
      fuera del monolito: es una herramienta de desarrollo y pruebas, no un módulo.
- [x] **II. Cuatro capas.** Los puertos `PaymentGateway`, `AlmacenComprobantes` y los repositorios
      están en `application/ports`. Los adaptadores están en `infrastructure`. La máquina de estados, los
      períodos y la política de operación son dominio puro.
- [x] **III. Aislamiento.** ✅ con la tercera excepción acotada, "operaciones de la plataforma"
      (constitución 1.3.0 y 1.3.1, ADR-031, Aceptado el 2026-10-24). El administrador identifica la
      barbería en la ruta y lee entre barberías con el rol `barberias_plataforma` (`NOBYPASSRLS`, solo
      lectura por columna y **sin escritura en ninguna tabla**), exactamente dentro de lo que la
      excepción permite. Las tablas sin `tenant_id` son solo las seis tablas de la plataforma que
      nombra la 1.3.1, sin datos de negocio. El rol de la aplicación solo inserta en `provider_event`
      (sin leerlo), escribe las sesiones y desafíos del administrador y no tiene permiso sobre
      `platform_admin`. Con la 1.2.0 esta puerta no pasaba,
      porque ninguna de las dos excepciones de entonces lo cubría. Todo lo demás cumple:
  - toda tabla de negocio nueva tiene `tenant_id` y RLS con `FORCE`;
  - los repositorios filtran por tenant;
  - las tareas y la notificación procesan cada barbería en su propia transacción, con su tenant;
  - la auditoría incluye el tenant;
  - nada se guarda en caché.
- [x] **IV. Sin citas duplicadas.** No se toca la reserva. La restricción por estado se suma antes de
      insertar, dentro de la misma transacción.
- [x] **V. Pagos.** Solo suscripciones. Puerto `PaymentGateway`. Flujo alojado sin datos de tarjeta.
      Notificación firmada (HMAC, tiempo constante, ±5 min), idempotente por `evento_id` y aplicada de
      forma atómica. Conciliación periódica (`conciliar-pagos`, en P1 junto con el pago con Yape). La
      confirmación nunca viene del navegador.
- [x] **VI. IA.** No aplica.
- [x] **VII. Notificaciones.** No aplica: los avisos por correo quedan para 004, y los de 003 se ven
      en el panel.
- [x] **VIII. Redis.** No se usa para nada de 003: pagos, suscripciones, tareas y contadores de
      comprobantes viven en PostgreSQL.
- [x] **IX. Solo web.** Pantallas responsive en la SPA existente.
- [x] **X. Pruebas obligatorias.** PR09 se amplía a pagos y a la lectura de plataforma. Hay pruebas de
      idempotencia del webhook (PR17) y de fallo del proveedor con el simulador (PR06). PR14 suma reglas.
      PR16 no cambia y sigue en la suite.
- [x] **XI. ADR.** ADR-022, ADR-023, ADR-024 y ADR-031 están registrados en
      `07-decisiones-arquitectonicas.md` y **Aceptados** (2026-10-24), antes de implementar.
- [x] **XII. Ubicación.** Todo el código va en `tecnologia/plataforma-barberias/`, incluido el
      simulador (`backend/simulador-pagos/`).

**Resultado (2026-10-24, constitución 1.3.1):** **pasa**. Los cuatro ADR están Aceptados y la
enmienda está aplicada, así que la funcionalidad queda lista para `/speckit-tasks` y, después,
`/speckit-implement`. La excepción nueva solo puede usarse dentro de lo que describe ADR-031, y PR09
`lectura-plataforma` y PR08 `rbac-003` lo verifican.

## Project Structure

### Documentation (this feature)

```text
specs/003-suscripciones-pagos/
├── spec.md
├── plan.md                         # este archivo
├── research.md                     # R01–R16
├── data-model.md                   # tablas, máquinas de estado, RLS por rol
├── quickstart.md
├── contracts/
│   ├── openapi.yaml                # API de 003
│   ├── rbac.md                     # PR08
│   ├── restricciones-estado.md     # FR-006 (fuente de PoliticaDeOperacion)
│   └── pasarela-simulada.md        # puerto, simulador, notificación firmada
├── checklists/requirements.md
└── tasks.md                        # /speckit-tasks
```

### Source Code (repository root)

```text
tecnologia/plataforma-barberias/
├── docker-compose.yml                       # + servicio pasarela-simulada (IP fija, 64 MB), variables PAGOS_*
├── .env.example                             # + PAGOS_*, PLATAFORMA_LLAVE_TOTP, SIMULADOR_TOKEN_CONTROL, TAREAS_*
├── backend/
│   ├── migrations/0014_planes_y_suscripcion.ts … 0017_tareas.ts
│   ├── simulador-pagos/                     # servidor.ts, estado.ts, firma.ts (fuera de src/; R02)
│   ├── scripts/
│   │   ├── crear-admin-plataforma.ts        # npm run plataforma:crear-admin (TOTP y códigos)
│   │   ├── simulador-modo.ts                # npm run simulador:modo
│   │   └── demo-vencimiento.ts              # npm run demo:vencimiento
│   ├── src/
│   │   ├── host/
│   │   │   ├── auth.guard.ts                # token de plataforma solo en @Plataforma(); rutas de barbería exigen tid
│   │   │   ├── solicitud.ts                 # + decorador @Plataforma()
│   │   │   └── tareas.ts                    # registra las tareas de M03 en el ejecutor de M06
│   │   ├── shared/                          # M06
│   │   │   ├── resiliencia/interruptor.ts   # movido desde cache/ (R13)
│   │   │   ├── tareas/ejecutor-tareas.ts    # candado de PostgreSQL + scheduled_job_run (ADR-024)
│   │   │   ├── persistence/lectura-plataforma.ts
│   │   │   └── lectura-plataforma.ts        # entrada confinada (como lectura-publica.ts)
│   │   └── modules/
│   │       ├── suscripciones-pagos/         # M03
│   │       │   ├── suscripciones/           # estado, períodos, política, vencimiento (domain/application/…)
│   │       │   ├── pagos/                   # pagos, notificaciones, conciliación, comprobantes, PaymentGateway
│   │       │   │   └── infrastructure/
│   │       │   │       ├── pasarela-simulada.adapter.ts
│   │       │   │       ├── pasarela-culqi.adapter.ts      # solo si R15 se confirma (línea de corte)
│   │       │   │       ├── almacen-comprobantes-postgres.ts
│   │       │   │       └── plataforma/      # lecturas con barberias_plataforma
│   │       │   ├── plataforma/              # casos de uso del administrador sobre suscripciones y pagos
│   │       │   └── suscripciones-api.ts     # + exigirOperacion, estadoOperativo, resúmenes para la plataforma
│   │       ├── acceso-barberias/            # M01
│   │       │   ├── identidad/               # + administrador de la plataforma, segundo factor, sesión de plataforma
│   │       │   └── barberias/               # + suspender y reactivar (RF02 mínimo)
│   │       └── catalogo-citas/              # M02: + llamadas a exigirOperacion (contracts/restricciones-estado.md §2)
│   └── test/ (unit, integration/pagos, integration/tareas, integration/aislamiento, contract, architecture)
└── frontend/src/pages/
    ├── panel/suscripcion/                   # estado, planes, Yape, transferencia, historial
    ├── cliente/                             # aviso "no acepta reservas"
    └── plataforma/                          # ingreso con TOTP, barberías, comprobantes, pagos por revisar
```

**Structure Decision**: se mantiene la estructura de 001, 002 y 006 (principio XII). M03 gana los
submódulos `pagos` y `plataforma` (principio I: submódulos, no módulos nuevos). El simulador vive
dentro de `backend/` para usar el mismo `tsx` y la misma configuración de TypeScript, pero fuera de
`src/`, y una regla de PR14 impide que el monolito lo importe.

## Integración de las restricciones por estado con 002 (FR-006, pedido 3)

1. **Regla en el dominio de M03.** `PoliticaDeOperacion.permite(estado, accion)` es una función pura.
   Su tabla está en [contracts/restricciones-estado.md](contracts/restricciones-estado.md) §1 y se
   prueba sin infraestructura (PR25).
2. **Interfaz pública.** `SuscripcionesApi.exigirOperacion(tenantId, accion)`:
   - corre en la transacción del llamador y lee la suscripción con su tenant y RLS;
   - lanza `SuscripcionNoPermite` (403 `SUSCRIPCION_NO_PERMITE`, con el detalle `{ estado, accion }`);
   - va acompañada de `estadoOperativo(tenantId)` para la interfaz.

   `SuscripcionNoPermite` se exporta en `suscripciones-pagos/index.ts`, junto a `SuscripcionesApi`.

3. **Llamadas en los casos de uso.** Cada caso de uso de escritura de la lista (§2 del contrato) llama
   a `exigirOperacion` al empezar, dentro de su `uow.ejecutar`. Es la misma forma en que `ReglasBarbero`
   ya llama a `SuscripcionesApi.obtenerLimiteBarberos`. **No cambia la matriz de PR14:** M02 → M03 y
   M01 → M03 por `index.ts` ya están permitidos.
4. **Traducción del mensaje.** M02 traduce el error a su mensaje ("no acepta reservas por ahora") en
   su filtro de errores de dominio. El código HTTP sale del mapa existente
   (`SUSCRIPCION_NO_PERMITE` → 403 en `host/error.filter.ts`).
5. **Lo que no cambia.**
   - La vía pública (catálogo y horarios por enlace) y su caché siguen igual: no leen datos de M03.
   - El aviso al cliente se pide con su sesión a `GET /suscripcion/estado-operativo`.
   - El índice de exclusión y PR16 no cambian.
6. **Pruebas que lo sostienen.**
   - `restricciones-estado` (integración): lee las dos tablas del contrato y, por cada estado y cada
     caso de uso, comprueba 2xx o 403 por la API real.
   - Nueva prueba de arquitectura `operaciones-con-politica`: lista los casos de uso de §2 y falla si
     alguno no contiene la llamada a `exigirOperacion`.

## Flujo principal (diseño)

```mermaid
sequenceDiagram
    autonumber
    participant P as Propietario (navegador)
    participant N as Nginx
    participant B as Réplica (M03)
    participant DB as PostgreSQL
    participant G as Pasarela (simulador o proveedor)
    P->>N: POST /suscripcion/pagos {plan, YAPE}
    N->>B: (cualquier réplica)
    B->>DB: INSERT payment PENDIENTE (único abierto por suscripción)
    B->>G: crearSesionDePago (tiempo límite 2 s, interruptor)
    G-->>B: referencia, urlPago
    B-->>P: 201 {urlPago}
    P->>G: paga en el flujo alojado (Yape)
    G->>N: POST /pagos/notificaciones (X-Firma)
    N->>B: (cualquier réplica)
    B->>B: verificar firma (HMAC, ±5 min)
    B->>DB: plataforma: tenant del pago por referencia exacta
    B->>DB: TX con tenant: FOR UPDATE payment · INSERT provider_event con su efecto (evento único; si se repite, nada) · INSERT subscription_period (EXCLUDE) · UPDATE subscription
    B-->>G: 200
    P->>N: GET /suscripcion/pagos/{id} (al volver)
    N->>B: lee el estado confirmado
```

## Orden de entrega (pedido 5)

1. **Base (bloquea todo; requiere la enmienda aprobada):**
   - migraciones `0014` a `0017`;
   - rol `barberias_plataforma` y `LecturaPlataforma`, con PR09 de la lectura de plataforma;
   - interruptor movido a `shared/resiliencia/`;
   - ejecutor de tareas (ADR-024);
   - repositorios de suscripción, períodos y planes, que usan US1 y US2;
   - puerto `PaymentGateway`, simulador y su adaptador, con la suite de contrato PR20 contra el
     simulador;
   - `PoliticaDeOperacion` y `exigirOperacion` (sin las llamadas todavía);
   - token de plataforma y `@Plataforma()` en `AuthGuard`;
   - reglas de PR14.
2. **P1:**
   - **US1, pagar con Yape:** planes, estado, iniciar el pago, notificación (PR17), períodos, la
     tarea `conciliar-pagos` (principio V: P1 no se entrega sin conciliación) y la pantalla de
     suscripción.
   - **US2, vencimiento y restricciones:** tarea `vencer-suscripciones` con dos réplicas, llamadas a
     `exigirOperacion` en 002 y en M01, `restricciones-estado`, PR25 y el aviso al cliente.
   - PR06 (proveedor caído) al cerrar P1.
3. **P2:**
   - **Administrador mínimo:** cuenta por línea de comandos, ingreso con TOTP y sesión de plataforma
     (PR08 de las rutas de plataforma).
   - **US3, transferencia:** comprobante, almacenamiento (ADR-023), cola de revisión, aprobación única
     y número de operación único.
   - **US4, historial y conciliación:** historial del propietario y lista de pagos por revisar. La
     tarea `conciliar-pagos` ya se entregó en US1.
4. **P3, US5:** suspender y reactivar la barbería (M01) y la suscripción; activación manual; listado
   de barberías.
5. **Cierre:**
   - documentación: tecnologías, API REST, multi-tenancy, trazabilidad, README y despliegue (simulador
     y equivalencias);
   - suite completa y recorrido del quickstart;
   - demostración de vencimiento con dos réplicas.

**Dependencia entre prioridades:** el ingreso del administrador está en P2, porque P1 no lo necesita.
Pero el **rol de plataforma** está en la base, porque la tarea de vencimiento, la conciliación y la
notificación (P1) lo usan para encontrar el tenant. Los repositorios de suscripción y períodos también
están en la base, porque US1 y US2 los usan. La prueba de US2 del pago simultáneo con el vencimiento
usa `AplicarResultadoDelProveedor` de US1.

**Líneas de corte** (backlog §3.2), en este orden:

1. Simulador en lugar del ambiente de pruebas si al día 11 no hay credenciales (R15).
2. Panel del administrador como listas con aprobar y rechazar.
3. Lista de pagos por revisar sin pantalla (la tarea de conciliación no se recorta).
4. Cambio de plan sin prorrateo (ya aplicado).

**No se recortan nunca:** la notificación firmada e idempotente, la conciliación, la tarea sin
duplicados, ningún dato de tarjeta, PR09 y PR17.

## Documentos que se actualizan con este plan

| Documento                                                      | Cambio                                                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md` | ADR-022, ADR-023, ADR-024 y ADR-031, **Aceptados** el 2026-10-24, con sus filas en la tabla resumen                                 |
| `docs/05-gestion/06-mvp-y-evolucion.md`                        | Se corrige la frase que daba por existente el adaptador de `PaymentGateway` (pedido 4)                                              |
| `docs/05-gestion/02-backlog-y-sprints.md` §3.3                 | ADR-022 a ADR-024 y ADR-031, Aceptados                                                                                              |
| `docs/trazabilidad.md`                                         | Fila de 003: especificada y planificada, lista para tareas                                                                          |
| `docs/02-arquitectura-software/multi-tenancy-y-datos.md`       | Constitución 1.3.1; rol `barberias_plataforma` sin escrituras y permisos del rol de la aplicación sobre las tablas de la plataforma |

**Con la aprobación (2026-10-24)** se actualizaron además la constitución (1.3.0 y luego 1.3.1, con
sus Sync Impact Report), la puerta III de `.specify/templates/plan-template.md` y el control 1 de
`docs/02-arquitectura-software/multi-tenancy-y-datos.md`, con el rol de plataforma y los casos
especiales del administrador, del webhook y de las tareas.

**Con la implementación** se actualizan:

- `docs/02-arquitectura-software/multi-tenancy-y-datos.md`: tablas globales nuevas de §3;
- `tecnologias.md`: simulador y TOTP, sin dependencias nuevas;
- `api-rest.md`;
- `seguridad-y-privacidad.md`: segundo factor y comprobantes;
- el README de la aplicación.

## Trazabilidad

| Historia | RF                           | EQ           | ADR                    | Componente                                              | Pruebas                                                    |
| -------- | ---------------------------- | ------------ | ---------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| US1      | RF19, RF20, RF23, RF24, RF26 | EQ-06, EQ-17 | ADR-007, 012, 022, 024 | M03 `suscripciones`, `pagos`; simulador                 | PR17, PR20, PR06, `conciliacion`                           |
| US2      | RF21, RF22                   | EQ-08        | ADR-024, 031           | M03 `suscripciones`; M06 `tareas`; M02 y M01 (llamadas) | PR25, `restricciones-estado`, vencimiento con dos réplicas |
| US3      | RF20, RF25                   | EQ-09, EQ-13 | ADR-022, 023, 031      | M03 `pagos`, `plataforma`                               | PR09, PR13, `comprobantes`                                 |
| US4      | RF25                         | EQ-17        | ADR-022                | M03 `pagos`, `plataforma`                               | `historial`, `pagos-por-revisar`, PR13                     |
| US5      | RF02 (mínimo), RF22          | EQ-08, EQ-13 | ADR-031                | M01 `identidad`, `barberias`; M03 `plataforma`          | PR08, PR13, PR09                                           |

## Complexity Tracking

| Violación                                                                                                                                                                                                                                                                                                                                                     | Por qué hace falta                                                                                                                                                                                                                                                                     | Alternativa más simple descartada                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principio III:** el administrador identifica la barbería en la ruta y lee entre barberías con el rol `barberias_plataforma` (ADR-031, la enmienda 1.3.0 y la aclaración 1.3.1, **aprobados y aplicados** el 2026-10-24: queda amparado por la tercera excepción del principio III; las tablas de la plataforma sin `tenant_id` son las que nombra la 1.3.1) | El administrador revisa comprobantes y pagos de todas las barberías y actúa sobre una a la vez, sin pertenecer a ninguna (FR-022, FR-034 a FR-038). La notificación del proveedor y la tarea de vencimiento llegan sin sesión y deben encontrar el tenant del pago o de la suscripción | **Membresía del administrador en cada barbería:** multiplica cuentas y no da una vista entre barberías. **Rol `BYPASSRLS`:** omite RLS también en citas y clientes, y su creación en RDS está por validar. **Funciones `SECURITY DEFINER` por listado:** sirven para claves exactas, no para colas paginadas, y cada una sería otra omisión de RLS. **Copiar los pagos a una tabla global:** saca datos de dinero de RLS. La solución elegida conserva `NOBYPASSRLS`, limita la lectura por columna a metadatos de pago, deja **todas** las escrituras con el tenant fijado y RLS, y se confina con PR14 y PR09, igual que ADR-021 |
