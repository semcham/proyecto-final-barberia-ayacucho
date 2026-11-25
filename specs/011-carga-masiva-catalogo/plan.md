# Implementation Plan: Carga masiva de servicios y barberos

**Branch**: `011-carga-masiva-catalogo` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-carga-masiva-catalogo/spec.md`

## Summary

El propietario crea de una vez hasta 50 servicios o 50 barberos desde dos pantallas nuevas del panel ("Agregar
varios"), con tabla editable, pegado desde una hoja de cálculo y servicios típicos. La vista previa la calcula el
servidor con las **mismas reglas del dominio** que la creación individual (se extrae de `Servicio` y `Barbero` una
función que lista todos los problemas, y la creación individual lanza el primero de esa misma lista). El guardado es
**todo o nada** en una transacción de M02, con el **mismo bloqueo de la suscripción** que `CrearBarbero` para el cupo de
barberos calculado para el lote entero, una `Idempotency-Key` guardada en una tabla técnica nueva (`catalog_batch`, con
RLS) para que un reintento no duplique, una entrada de auditoría por carga y la invalidación del catálogo público. Sin
límite de servicios (Q1), nombres de barbero repetidos como advertencia (Q2), solo el propietario.

## Technical Context

**Language/Version**: TypeScript 5 (Node.js 22) en backend y frontend

**Primary Dependencies**: NestJS + Kysely (backend), React + React Router + TanStack Query (frontend). Sin dependencias
nuevas.

**Storage**: PostgreSQL con RLS (tablas `service`, `barber`, `barber_service` sin cambios; tabla nueva
`catalog_batch`, migración `0037_carga_lote`)

**Testing**: Jest (unitarias, integración con Testcontainers `test:int`, arquitectura `test:arch`), Vitest + Testing
Library (frontend), Playwright + axe sobre el build de producción para capturas

**Target Platform**: Docker Compose (Nginx + 2 réplicas del backend), navegador web responsive

**Project Type**: aplicación web (backend modular + frontend SPA)

**Performance Goals**: guardar 50 filas y mostrar el resumen en menos de 3 s en local (SC-004); revisión en menos de 1 s

**Constraints**: todo o nada; cupo de barberos sin carreras; tenant solo del token; 360 px; axe 0; sin tocar `.env`

**Scale/Scope**: 1–50 filas por carga; 4 rutas nuevas, 2 pantallas nuevas, 1 tabla nueva

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Gates from `.specify/memory/constitution.md` (v1.8.0):

- [x] **I. Six modules**: todo en M02 (`catalogo-citas/catalogo`); usa `SuscripcionesApi` de M03 (dependencia M02→M03
      que ya existe para `CrearBarbero`) y `UnitOfWork`/`AuditLog` de M06. Sin módulo nuevo ni dependencias nuevas entre
      módulos.
- [x] **II. Four layers**: dominio puro (`problemasDeServicio`, `problemasDeBarbero`, `carga-lote.ts`, `LimiteBarberos`
      con `nuevos`); aplicación (`RevisarCargaServicios`, `CargarServicios`, `RevisarCargaBarberos`, `CargarBarberos`);
      infraestructura (repositorio de cargas e inserciones múltiples); presentación (controladores y DTO).
- [x] **III. Tenant isolation**: el tenant sale del token; la ruta y el cuerpo no llevan barbería; `catalog_batch` tiene
      `tenant_id`, RLS forzada y permisos mínimos; la comprobación de nombres corre con RLS. Ninguna excepción nueva. El
      administrador de la plataforma queda fuera (MUST NOT tocar el catálogo).
- [x] **IV. No duplicate appointments**: no toca citas.
- [x] **V. Payments**: no toca pagos.
- [x] **VI. AI**: no toca el asistente.
- [x] **VII. Notifications**: no envía avisos.
- [x] **VIII. Redis**: solo la invalidación de la caché del catálogo público que ya existe; la idempotencia y el cupo
      viven en PostgreSQL.
- [x] **IX. Web only**: pantallas web responsive.
- [x] **X. Mandatory tests**: unitarias, integración, aislamiento (PR09), concurrencia del cupo (como PR16), arquitectura
      (PR14), contrato y frontend con axe, planificadas para cada historia.
- [x] **XI. ADR**: no hay cambio de arquitectura: reutiliza la idempotencia por clave de 002 (R09), el bloqueo del cupo de
      002 (R13) y el patrón de tablas con RLS. Se anota en la trazabilidad; si el revisor lo pide, un ADR corto sobre la
      carga en lote.
- [x] **XII. Code location**: todo bajo `tecnologia/plataforma-barberias/`.

**Resultado**: pasa sin violaciones. Re-evaluado tras el diseño de la fase 1: sigue pasando (la tabla nueva es de
negocio, con `tenant_id` y RLS, y no necesita excepción).

## Project Structure

### Documentation (this feature)

```text
specs/011-carga-masiva-catalogo/
├── plan.md              # este archivo
├── research.md          # fase 0 (R01–R11 y riesgos)
├── data-model.md        # fase 1
├── quickstart.md        # fase 1
├── contracts/
│   ├── openapi.yaml     # 4 rutas nuevas
│   └── pantallas.md     # 2 pantallas, textos y pegado
├── checklists/requirements.md
└── tasks.md             # fase 2 (/speckit-tasks; no creado aquí)
```

### Source Code (repository root)

```text
tecnologia/plataforma-barberias/
├── backend/
│   ├── migrations/0037_carga_lote.ts                       # catalog_batch + RLS + permisos
│   ├── src/modules/catalogo-citas/catalogo/
│   │   ├── domain/servicio.ts                              # + problemasDeServicio (crear/editar la usan)
│   │   ├── domain/barbero.ts                               # + problemasDeBarbero
│   │   ├── domain/limite-barberos.ts                       # + parámetro nuevos = 1
│   │   ├── domain/carga-lote.ts                            # nuevo: MAX_FILAS_LOTE, revisarServicios, revisarBarberos
│   │   ├── domain/errores.ts                               # + CargaInvalida; LimiteBarberosAlcanzado con activos/solicitados
│   │   ├── application/carga-lote.ts                       # nuevo: Revisar/Cargar Servicios y Barberos
│   │   ├── application/ports/catalogo-repositorios.ts      # + crearVarios, nombresExistentes, activosDe; CargaLoteRepository
│   │   ├── infrastructure/kysely-catalogo-repositorios.ts  # inserciones múltiples
│   │   ├── infrastructure/kysely-carga-lote-repository.ts  # nuevo
│   │   ├── presentation/carga-lote.dto.ts                  # nuevo
│   │   └── presentation/{servicios,barberos}.controller.ts # + rutas lote y lote/revision
│   ├── src/shared/audit/audit-log.ts                       # + 2 acciones
│   ├── src/host/error.filter.ts                            # + CARGA_INVALIDA: 400
│   └── test/{unit,integration,contract,architecture}/...   # pruebas nuevas
└── frontend/
    ├── src/api/carga-lote.ts                               # llamadas y tipos
    ├── src/pages/panel/CargaServicios.tsx (+ .module.css)  # /app/servicios/agregar-varios
    ├── src/pages/panel/CargaBarberos.tsx                   # /app/barberos/agregar-varios
    ├── src/pages/panel/carga/TablaCarga.tsx                # tabla/fichas compartidas
    ├── src/pages/panel/carga/pegado-de-hoja.ts             # función pura del pegado
    ├── src/pages/panel/carga/servicios-tipicos.ts          # lista fija: nombre y duración, sin precio
    ├── src/pages/panel/{Servicios,Barberos}.tsx            # + botón "Agregar varios"
    ├── src/routes.tsx                                      # + 2 rutas del panel
    └── test/pages/carga-*.spec.tsx, test/pegado-de-hoja.spec.ts
```

**Structure Decision**: monolito modular existente; todo el backend nuevo vive en el submódulo `catalogo` de M02 con
sus cuatro capas, y el frontend en el panel del propietario.

## Fases de implementación (cortables por historia)

1. **Base** (bloquea todo): extraer `problemasDeServicio`/`problemasDeBarbero` sin cambiar la creación individual
   (pruebas actuales en verde + prueba de ambos caminos), `LimiteBarberos` con `nuevos`, migración `0037`, repositorio de
   cargas, acciones de auditoría, `CARGA_INVALIDA`.
2. **US1 servicios (P1, MVP)**: revisión + guardado + pantalla con pegado y típicos. Corte posible aquí.
3. **US2 barberos (P2)**: revisión con cupo y advertencias + guardado + pantalla.
4. **US3 concurrencia (P2)**: prueba de dos cargas simultáneas y de carga + creación individual.
5. **Cierre**: capturas y axe, docs (`api-rest.md`, `03-requisitos-funcionales.md` RF07/RF08 ampliados,
   `trazabilidad.md`, `multi-tenancy-y-datos.md` con la tabla nueva, `seguridad-y-privacidad.md` matriz RBAC), quickstart.

## Riesgos y decisiones (por importancia)

1. **Refactor del dominio de servicio y barbero**: si el primer error cambia, la creación individual responde distinto.
   Mitigación: la lista conserva el orden actual de las comprobaciones y las pruebas actuales no se tocan.
2. **Todo o nada con carreras de nombres**: lo garantiza el índice único `service_nombre_unico`; se revierte todo.
3. **Cupo**: mismo bloqueo de la fila de la suscripción que la creación individual; prueba de concurrencia × 50.
4. **Idempotencia**: tabla nueva con RLS en lugar de Redis o auditoría; un reintento devuelve el mismo resumen.
5. **Comprobación extra de servicios activos en barberos**: solo en la carga (R09); la creación individual no cambia.
6. **Servicios típicos sin precio** (ajuste del usuario): solo nombre y duración sugerida; el precio vacío se marca "Falta el precio" en la revisión (problema `falta`, solo en la carga, sin cambiar la regla individual).

## Complexity Tracking

Sin violaciones de la constitución: no aplica.
