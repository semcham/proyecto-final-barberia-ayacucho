# Implementation Plan: Asistente de IA y reportes (versión mínima)

**Branch**: `005-asistente-ia-reportes` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-asistente-ia-reportes/spec.md` (con la sesión de aclaraciones del 2026-11-14)

**Note**: plan de diseño (fase 0 y fase 1 de Spec Kit). Sin código, sin migraciones escritas y sin commit.

## Summary

M04 (`asistente-reportes`) nace con dos submódulos.

- **`reportes`** (US2), sin IA: el propietario elige un período en la zona horaria de su barbería y ve tres
  tablas: citas por estado, servicios más solicitados y actividad. Los datos son agregados que M02 calcula sobre
  sus citas y entrega por una interfaz nueva de solo lectura.
- **`asistente`** (US1 y US3): el modelo de IA **solo traduce la pregunta a una intención estructurada**. El
  backend:
  1. valida la intención contra un esquema cerrado y la lista del rol;
  2. ejecuta la herramienta de solo lectura;
  3. compone la respuesta con plantillas a partir de los datos.

  Ninguna cifra ni horario puede venir del modelo (research R03). El cliente consulta servicios, barberos y
  horarios libres de su barbería y se le ofrece ir a Reservar con todo elegido. El propietario consulta el
  resumen de citas y los servicios más pedidos, con las **mismas** cifras de los reportes.

Proveedor de IA detrás del puerto `AIProvider`:
- un **falso** determinista en las pruebas y la CI;
- **OpenRouter** solo en desarrollo, con la llave en la configuración del servidor;
- tiempo límite, un reintento y el interruptor de M06;
- si falla, mensaje claro y alternativa manual en ≤ 3 s.

Cuotas fijas por usuario (20) y por barbería (200) al día, atómicas en PostgreSQL. Registro de preguntas **sin el
texto**. Auditoría.

Enfoque técnico, sin módulos nuevos:
- **M04** `asistente-reportes/`: carpeta nueva del módulo ya previsto por la constitución (principio I). Los dos
  submódulos tienen sus cuatro capas.
- **M02** `catalogo-citas/`: interfaz pública nueva **`CatalogoCitasApi`** (clase abstracta exportada en
  `index.ts`), **solo lecturas**, que reutiliza `CatalogQuery` y `ConsultarHorarios` y suma una consulta de
  agregados (`ReportesDeCitasQuery`). No cambia ningún caso de uso ni ruta existente.
- **M03**: sin cambios; se usa `SuscripcionesApi.estadoOperativo`.
- **M06**: dos acciones nuevas de auditoría y las variables nuevas de `Configuracion`. Se reutilizan
  `Interruptor`, `UnitOfWork`, `TenantContext`, `ZonaHoraria` y `FechaLocal`.
- **Host:** el `RolesGuard` suma la matriz de M04; `AppModule` importa `AsistenteReportesModule`.

## Technical Context

**Language/Version**: TypeScript 5 en Node.js 22 (backend NestJS 11; frontend React 19 + Vite 6), igual que 001–008.

**Primary Dependencies**: las ya instaladas. **Ninguna dependencia nueva**:
- el adaptador de OpenRouter usa el `fetch` nativo de Node 22 con `AbortSignal.timeout` (research R05);
- el esquema de intenciones se valida con `class-validator`, ya usado en los DTO, o con una función propia del
  dominio, sin librerías de esquemas.

**Storage**: PostgreSQL 16 con RLS. Dos tablas nuevas, `assistant_quota` y `assistant_question`, con `tenant_id`
y `rlsPorTenant` ([data-model](data-model.md)), en la migración `0031`. Los reportes no guardan nada: leen
`appointment` por `CatalogoCitasApi`, con el índice `(tenant_id, starts_at)` de 002. **Redis no interviene**:
la cuota de IA va en PostgreSQL (principio VIII).

**Testing**: Jest 29 en las unitarias: período, esquema de intenciones, resolución de argumentos, plantillas,
política de cuotas y proveedor falso. Jest + Testcontainers en integración:
- PR19 con el proveedor falso en sus dos modos;
- PR09;
- cuotas con dos instancias;
- PR06 con el proveedor caído o lento;
- reportes con bordes de zona horaria y SC-005.

Además: contrato contra `contracts/openapi.yaml` y `contracts/rbac.md` (`rbac-005`); PR20 del puerto (el falso
siempre; OpenRouter omitido sin llave); dependency-cruiser (PR14); y Vitest + MSW en el frontend.

**Target Platform**: servidor Linux en contenedores (local: Docker Compose con dos réplicas detrás de Nginx);
navegador web responsive.

**Project Type**: aplicación web (backend modular + frontend), código en `tecnologia/plataforma-barberias/`.

**Performance Goals**:
- con el proveedor caído, lento o con el circuito abierto, la respuesta "no disponible" llega en ≤ 3 s
  (SC-003): tiempo límite de 2,5 s por llamada y un presupuesto total de 3 s;
- los reportes de un mes llegan en ≤ 2 s (SC-005);
- con el proveedor falso, una pregunta tarda lo que tardan sus lecturas (p95 < 1 s en local).

**Constraints**:
- el asistente **solo lee** y nunca reserva (principio VI);
- la barbería sale del token (principio III);
- no se envía al proveedor el catálogo, datos de clientes ni de otras barberías;
- OpenRouter **no** puede usarse en producción: el servidor no arranca con esa combinación (ADR-027);
- las cuotas son iguales para todos los planes y no cambian el modelo de 003 (aclaración del 2026-11-14);
- no cambia el comportamiento de 001–004, 006 ni 008 (FR-030).

**Scale/Scope**: hasta 200 preguntas por barbería al día; períodos de hasta 366 días con cientos o pocos miles
de citas por barbería; dos pantallas nuevas (`/asistente` y `/app/reportes`, con su pestaña del asistente del
propietario si se hace US3).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Gates from `.specify/memory/constitution.md` (v1.6.0):

- [x] **I. Seis módulos**: se usa **M04**, previsto por la constitución; no hay módulo nuevo. Llamadas solo por
      `index`: M04 → M02 (`CatalogoCitasApi`, nueva y solo de lectura), M04 → M03 (`SuscripcionesApi`, ya
      existe) y M04 → M06. **M04 no llama a M01** (la matriz no lo permite): la zona horaria y el slug llegan por
      M02. Nadie llama a M04. Sin efectos entre módulos: no publica eventos.
- [x] **II. Cuatro capas**: `asistente/` y `reportes/` con `presentation`, `application`, `domain` e
      `infrastructure`. El esquema de intenciones, las plantillas, el período y la política de cuotas son
      dominio puro; el adaptador de OpenRouter y los repositorios están en `infrastructure`.
- [x] **III. Aislamiento**: el tenant sale del token y la transacción de M04 se abre con él. El esquema de
      intenciones no admite barbería ni identificadores (research R04). Las dos tablas nuevas tienen RLS y los
      repositorios filtran por tenant. No se usa ninguna de las cuatro excepciones.
- [x] **IV. Sin citas duplicadas**: no reserva ni toca la disponibilidad; el cálculo es el de 002.
- [x] **V. Pagos**: no aplica (no hay pagos ni montos en los reportes).
- [x] **VI. IA**: el puerto `AIProvider` y las herramientas cerradas por rol, que llaman a casos de uso de M02 y
      de `reportes`. Sin SQL libre ni acceso a repositorios ajenos. No reserva. Límites (cuotas), registro
      (`assistant_question` y auditoría) y degradación al flujo manual. La disponibilidad la calcula M02.
- [x] **VII. Notificaciones**: no aplica (no envía avisos).
- [x] **VIII. Redis**: no se usa; la cuota de IA está en PostgreSQL, como exige la puerta.
- [x] **IX. Solo web**: dos pantallas web responsive.
- [x] **X. Pruebas**: por historia, con:
      - PR09 (reportes, asistente y las dos tablas);
      - PR14 (reglas nuevas de M04);
      - PR19 (12 casos);
      - PR06 de IA;
      - PR20 del puerto;
      - PR08 (`rbac-005`);
      - cuotas concurrentes con dos instancias.

      PR16 no se toca: no hay reservas.
- [x] **XI. ADR**: se registran **ADR-027** (proveedor de IA y política de datos) y **ADR-028** (contrato del
      asistente) antes de implementar: **Aceptados** por el responsable el 2026-11-14. ADR-008
      sigue vigente y estos dos lo concretan.
- [x] **XII. Código**: todo en `tecnologia/plataforma-barberias/`.

**Re-check post-diseño (tras la fase 1):** ✅ sin violaciones.
- Ningún contrato recibe `tenant_id` ni barbería.
- Las dos tablas tienen RLS y ninguna guarda texto de las preguntas.
- `CatalogoCitasApi` solo tiene lecturas.
- La matriz de M04 sigue la de estilo §3.

**No hace falta una enmienda de la constitución** (research R13). Queda propuesta, **sin aplicar**, una enmienda
MINOR a VI ("el proveedor de IA de producción MUST tener aprobada su política de datos") si el responsable quiere
elevarla a principio.

## Project Structure

### Documentation (this feature)

```text
specs/005-asistente-ia-reportes/
├── spec.md
├── plan.md              # este archivo
├── research.md          # fase 0: decisiones R01–R13
├── data-model.md        # fase 1: tablas, migración y lecturas de los reportes
├── quickstart.md        # fase 1: guía de validación
├── contracts/
│   ├── openapi.yaml     # POST /asistente/mensajes y GET /reportes
│   ├── rbac.md          # matriz rol × ruta y herramientas por rol
│   └── asistente.md     # flujo, intenciones, plantillas, instrucciones y PR19
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks (no lo crea este comando)
```

### Source Code (repository root)

```text
tecnologia/plataforma-barberias/
├── backend/
│   ├── migrations/
│   │   └── 0031_asistente.ts                  # assistant_quota + assistant_question, con RLS
│   ├── src/
│   │   ├── host/
│   │   │   ├── roles.guard.ts                 # suma PermisosAsistenteReportes
│   │   │   └── app.module.ts                  # importa AsistenteReportesModule
│   │   ├── shared/
│   │   │   ├── audit/audit-log.ts             # ASISTENTE_CONSULTADO, REPORTES_CONSULTADOS
│   │   │   └── config/configuracion.ts        # IA_PROVEEDOR, IA_OPENROUTER_*, IA_TIEMPO_LIMITE_MS, IA_CUOTA_*
│   │   └── modules/
│   │       ├── catalogo-citas/                # M02: solo lecturas nuevas
│   │       │   ├── catalogo-citas-api.ts      # CatalogoCitasApi (abstracta, pública)
│   │       │   ├── index.ts                   # la exporta
│   │       │   ├── catalogo/application/catalogo-citas-api-impl.ts
│   │       │   └── citas/infrastructure/reportes-de-citas-query.ts
│   │       └── asistente-reportes/            # M04 (nuevo)
│   │           ├── index.ts                   # AsistenteReportesModule y PermisosAsistenteReportes
│   │           ├── asistente-reportes.module.ts
│   │           ├── reportes/
│   │           │   ├── domain/                # Periodo (366 días), forma de los reportes
│   │           │   ├── application/           # ConsultarReportes
│   │           │   ├── infrastructure/        # (ninguna: lee por CatalogoCitasApi)
│   │           │   └── presentation/          # GET /reportes
│   │           └── asistente/
│   │               ├── domain/                # Intencion (esquema), Herramientas por rol, Plantillas, PoliticaCuota, Permisos
│   │               ├── application/           # PreguntarAlAsistente, ports/ai-provider.ts, ports/cuotas, ports/registro
│   │               ├── infrastructure/        # proveedor-ia-falso, proveedor-ia-openrouter, proveedor-ia-ninguno, kysely-cuotas, kysely-registro
│   │               └── presentation/          # POST /asistente/mensajes
│   ├── scripts/ia-modo.ts                     # cambia el modo del proveedor falso en la demostración (npm run ia:modo)
│   └── test/                                  # unit/asistente, unit/reportes, integration/asistente, integration/reportes, contract/rbac-005, architecture
└── frontend/
    ├── src/api/asistente.ts, src/api/reportes.ts
    ├── src/pages/cliente/Asistente.tsx        # /asistente
    └── src/pages/panel/Reportes.tsx           # /app/reportes (+ pestaña "Preguntar", US3)
```

**Reglas nuevas de PR14** (`backend/.dependency-cruiser.cjs`):

| Regla                        | Qué prohíbe                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `matriz-m04`                 | M04 importa algo fuera de `catalogo-citas/index.ts`, `suscripciones-pagos/index.ts`, `shared/` y su carpeta; también, que importe M01 o M05 |
| `nadie-llama-a-m04`          | Otro módulo importa `asistente-reportes/`; solo el host puede                                            |
| `ia-solo-por-puerto`         | El dominio o la aplicación de `asistente` importan los adaptadores (`infrastructure/proveedor-ia-*`); solo el módulo los enlaza |
| `reportes-sin-ia`            | `reportes/` importa algo de `asistente/` (los reportes no dependen de la IA, FR-026)                     |
| `asistente-reportes-sin-kysely` | Ya lo cubre `kysely-solo-en-infraestructura`; se comprueba que alcanza a M04                          |

Además, una prueba de arquitectura comprueba que `CatalogoCitasApi` **no tiene métodos de escritura**: la lista
exacta de sus métodos es la de research R01.

**Structure Decision**: una aplicación web con el backend modular y el frontend que ya existen. M04 es una carpeta
nueva dentro de `backend/src/modules/` (el módulo ya estaba previsto). M02 solo suma una interfaz de lectura y su
implementación.

## Orden de implementación (para poder cortar)

Una fase = un commit, como en 004 y 008. Primero lo común mínimo; después **US2**, el riesgo más bajo y la base de
US3; después **US1**, que es _Must_ pero tiene el riesgo del proveedor; al final **US3**.

| Fase | Contenido | Riesgo | Si hay que cortar |
| ---- | --------- | ------ | ----------------- |
| 1 | **Base:** carpeta de M04, matriz de permisos, `RolesGuard`, migración 0031, `CatalogoCitasApi` con sus lecturas y la prueba de que no escribe, reglas de PR14, configuración `IA_*` y aislamiento de las dos tablas (PR09) | Bajo | No se corta |
| 2 | **US2 Reportes (P1):** `Periodo`, `ConsultarReportes`, `GET /reportes`, `/app/reportes` en tablas, bordes de zona horaria, SC-005 y `rbac-005` (reportes) | Bajo: SQL de agregados sobre un índice que ya existe | Primero se recorta la tabla de **actividad por día de la semana**; nunca el aislamiento |
| 3 | **US1 Asistente del cliente (P1, _Must_):** puerto `AIProvider`, proveedor falso con sus modos, OpenRouter (desarrollo), interruptor y tiempo límite, esquema de intenciones, resolución de argumentos, plantillas, cuotas atómicas (dos instancias), registro sin texto, auditoría, PR19 (12 casos), PR06 y PR20, y `/asistente` | **Medio-alto**: clasificación con un modelo real, latencia de OpenRouter y la carga de PR19 | En orden: (1) el contexto de 6 intervenciones (queda en 0: cada pregunta sola); (2) la intención `barberos` (los horarios ya dicen qué barberos atienden); (3) la prueba con OpenRouter queda manual. **Nunca** se recortan PR19, PR09, las cuotas ni la degradación |
| 4 | **US3 Asistente del propietario (P3):** dos intenciones sobre los casos de uso de la fase 2, y la pestaña "Preguntar" de `/app/reportes` | Bajo, si existen las fases 2 y 3 | **Es lo primero que se recorta entero**: el propietario tiene los reportes |
| 5 | **Cierre:** documentación (trazabilidad, pruebas, estados a "implementado" solo en lo construido), ADR-027 y ADR-028 (Aceptados) marcados como implementados solo en lo construido, quickstart | Bajo | No se corta |

**Por qué US2 antes que US1:** US2 es pequeña, no depende del proveedor y deja listas las lecturas de
`CatalogoCitasApi` y los casos de uso que US3 reutiliza. US1 es _Must_; si la fase 3 se atrasa, se recorta según
la tabla, pero no se salta. Si el plazo obliga a elegir entre US1 y US2, va primero **US1**, porque RF27 es
_Must_.

## Riesgos

| Riesgo | Mitigación |
| ------ | ---------- |
| El modelo real clasifica mal o tarda (R10, R11) | Una sola llamada con esquema JSON; el falso en todas las pruebas; si el modelo se equivoca, la respuesta sigue saliendo de la herramienta o dice "no tengo ese dato"; tiempo límite de 2,5 s |
| Inyección de instrucciones (R10) | El modelo no tiene datos ni herramientas; el esquema cerrado y la lista por rol; el tenant del token; el catálogo no va al modelo; PR19 en dos modos |
| Costo del proveedor (R11) | Cuotas fijas en PostgreSQL (20 por usuario y 200 por barbería al día); OpenRouter solo en desarrollo |
| Datos personales hacia OpenRouter | Solo datos de prueba en desarrollo; no se envía el catálogo ni datos de clientes; el servidor no arranca con OpenRouter en producción (ADR-027) |
| Plazo del 18 de noviembre | Fases cortables (tabla de arriba); US3 es lo primero que se recorta |
| Cifras distintas entre el asistente y los reportes | Las dos usan el mismo caso de uso de `reportes`; una prueba compara las dos salidas |
| Bordes del período por la zona horaria | Conversión con `ZonaHoraria` de M06 y pruebas en las 00:00 y las 23:59 de Lima |

## Complexity Tracking

> Sin violaciones de la constitución: no hay excepciones que justificar.

| Decisión que agrega piezas | Por qué | Alternativa más simple descartada |
| -------------------------- | ------- | --------------------------------- |
| `CatalogoCitasApi` nueva en M02 | M04 necesita datos de citas y catálogo, y no puede leer las tablas de M02 (principio I) | Exportar `CatalogQuery` y la consulta de citas tal cual: expondría clases internas y métodos que M04 no debe usar |
| Respuestas compuestas con plantillas en lugar del texto del modelo | Garantiza FR-001 sin verificar texto libre y cabe en una llamada (≤ 3 s) | Respuesta redactada por el modelo + verificación: frágil y más lenta (research R03) |
