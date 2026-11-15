# Implementation Plan: Indicadores y datos personales (007)

**Branch**: `main` (carpeta `007-indicadores-datos-personales`) | **Date**: 2026-11-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-indicadores-datos-personales/spec.md` (aclarada el 2026-11-15)

## Summary

Versión mínima de RF31 y RF32, más la mejora de `login_attempt` de la constitución 1.4.1. Son tres historias
**independientes**, cada una con su fase, su migración y su cierre:

- **US1 · Solicitudes sobre datos personales (RF32, P1):**
  - submódulo nuevo `solicitudes-datos` en M01 y la tabla `data_subject_request` con RLS;
  - estados `RECIBIDA → EN_ATENCION → ATENDIDA | RECHAZADA` y plazo de 10 días hábiles;
  - el cliente y el barbero registran sobre sus propios datos; el propietario las atiende **a mano**;
  - auditoría de cada paso **sin texto**;
  - el propietario sobre su propia cuenta queda **fuera** (FR-005).
- **US2 · Indicadores de la plataforma (RF31, P1):**
  - registro de indicadores en **M06**, con fuentes aportadas por M01, M02 y M03 y conectadas por el host; ruta
    `@Plataforma()` en M01, que audita en `platform_audit_log`;
  - barberías por estado con lo que el rol de la plataforma ya lee;
  - citas por mes y usuarios por tipo con **dos vistas de solo conteo**. Sus dueños son un rol nuevo sin inicio
    de sesión (`barberias_conteos`), así que el rol de la plataforma no recibe ningún permiso sobre las tablas;
  - **primera fase:** la enmienda MINOR 1.7.0 del principio III, la revisión de ADR-031 y la prueba de permisos
    exactos;
  - **punto de corte:** solo barberías por estado.
- **US3 · `login_attempt` sin IP legible (P3, la primera que se recorta):**
  - `ip` pasa a `ip_hash = SHA-256(INTENTOS_SAL_IP ‖ ip)` en el adaptador, y la migración borra las filas de
    24 h;
  - el límite de intentos se comporta igual;
  - aclaración PATCH del principio III.

Decisiones y alternativas en [research.md](research.md); modelo en [data-model.md](data-model.md); contratos en
[contracts/](contracts/); borradores de la enmienda y del ADR en
[contracts/enmienda-y-adr.md](contracts/enmienda-y-adr.md).

## Technical Context

- **Language/Version:** TypeScript 5 en Node.js 22 (backend NestJS 11) y React 19 con Vite 6 (frontend), como
  001 a 008.
- **Primary Dependencies:** las existentes (Kysely, pg, jose, Radix UI, TanStack Query). **Ninguna dependencia
  nueva:** el SHA-256 de US3 usa `node:crypto`, como `action_link_attempt`.
- **Storage:** PostgreSQL 16 con RLS forzada.
  - Tabla nueva `data_subject_request` (US1).
  - Dos vistas y un rol de base nuevo, `barberias_conteos` (US2).
  - Cambio de `login_attempt` (US3).
  - Redis no se usa: el límite de intentos sigue en PostgreSQL (principio VIII).
- **Testing:** Jest 29 con Testcontainers 12 (unitarias, integración, contrato y arquitectura con
  dependency-cruiser), y Vitest con MSW en el frontend. Pruebas nuevas:
  - `solicitudes-datos`, `aislamiento-007` y `rbac-007`;
  - la ampliación de `lectura-plataforma` (PR09) e `indicadores-plataforma`;
  - la ampliación de `limite-intentos` y `segundo-factor` para US3;
  - las reglas nuevas de PR14.
- **Target Platform:** servidor Linux en contenedores, con Docker Compose en local (dos réplicas detrás de
  Nginx); navegador web responsive.
- **Project Type:** aplicación web (backend y frontend) en `tecnologia/plataforma-barberias/`.
- **Performance Goals:**
  - SC-005: indicadores en ≤ 3 s con el volumen de las pruebas de escalado (dos vistas agregadas y una consulta
    de suscripciones);
  - SC-003: registrar o atender una solicitud en menos de 1 minuto, medido con cronómetro por el responsable.
- **Constraints:**
  - sin `BYPASSRLS` en ningún rol nuevo;
  - el rol de la plataforma sin permisos sobre las tablas de citas, clientes ni usuarios;
  - sin texto de las solicitudes en la auditoría ni en los registros;
  - el límite de intentos idéntico;
  - ningún cambio de comportamiento de 001 a 008.
- **Scale/Scope:** el de la demostración (decenas de barberías, miles de citas). Pantallas nuevas:
  - "Mis datos" del cliente (`/mis-datos`);
  - "Mis datos" del barbero (`/app/mis-datos`);
  - la bandeja del propietario (`/app/solicitudes-datos`);
  - los indicadores (`/plataforma/indicadores`).

  Sin **NEEDS CLARIFICATION**: las tres decisiones de alcance y permisos se tomaron en la aclaración.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Gates de `.specify/memory/constitution.md` (v1.6.0):

- [x] **I. Seis módulos:** no hay módulo nuevo.
  - US1 es el submódulo `solicitudes-datos` de M01.
  - US2 usa un registro en M06, sin reglas de negocio, con fuentes de M01, M02 y M03; cada una cuenta **solo
    sus propios datos** y el host las conecta, como las tareas programadas.
  - La matriz de dependencias **no cambia**.
- [x] **II. Cuatro capas:**
  - el submódulo nuevo tiene `presentation`, `application`, `domain` e `infrastructure`;
  - el dominio (estados, plazo en días hábiles) no importa frameworks;
  - las fuentes de indicadores están en `infrastructure/plataforma/`.
- [x] **III. Aislamiento**, con una condición:
  - **US1:** el tenant sale solo del token; `data_subject_request` tiene RLS; el repositorio filtra por tenant;
    el cuerpo no acepta barbería.
  - **US3:** cumple la excepción "tablas técnicas de intentos" y la deja como dice la mejora de 1.4.1.
  - **US2 completa necesita la enmienda MINOR 1.7.0:** hoy el texto dice que el administrador "MUST NOT ver ni
    modificar citas, clientes, catálogo ni usuarios", y el rol de la plataforma solo tiene permisos por columna
    sobre tablas.
    - Las vistas de solo conteo **no se construyen** hasta que el responsable apruebe la enmienda y la revisión de
      ADR-031 (fase 2a, borradores en [contracts/enmienda-y-adr.md](contracts/enmienda-y-adr.md)).
    - **Sin la aprobación, se aplica el corte** (solo barberías por estado). El corte cumple la constitución
      actual sin cambios.
- [x] **IV. Citas sin duplicados:** no se toca.
- [x] **V. Pagos:** no se toca.
- [x] **VI. IA:** no hay IA en 007.
- [x] **VII. Notificaciones:** no se envían avisos en esta versión (asunción de la spec).
- [x] **VIII. Redis:** no se usa. El contador de intentos sigue en PostgreSQL.
- [x] **IX. Solo web:** cuatro pantallas web responsive.
- [x] **X. Pruebas:**
  - PR09: `aislamiento-007`, `rls` y la ampliación de `lectura-plataforma`;
  - PR08: `rbac-007`;
  - PR14: las reglas nuevas;
  - PR13: la auditoría de cada paso;
  - PR12: el límite de intentos igual con el origen derivado;
  - PR16 no aplica, porque no hay reservas.
- [x] **XI. ADR:**
  - la revisión de ADR-031 (vistas y rol de conteo) se escribe y se aprueba **antes** de implementar las vistas;
  - US1 y US3 no son cambios de arquitectura: US3 es la mejora ya registrada en 1.4.1, con su aclaración PATCH.
- [x] **XII. Ubicación del código:** todo en `tecnologia/plataforma-barberias/`. El rol nuevo va en
  `db/init/01-roles.sql`, dentro de esa carpeta.

**Resultado:** pasa, con una condición en III para la parte de US2 que usa las vistas. **No hay ninguna
contradicción con la constitución en lo que se construye sin la enmienda.**

**Re-check después del diseño (Fase 1):** igual. Además:

- el diseño no da permisos de tabla al rol de la plataforma;
- el rol dueño de las vistas no puede conectarse ni omitir RLS, y ningún rol con inicio de sesión hereda sus
  políticas (se concede a `barberias_owner` sin herencia);
- el administrador no llega a las solicitudes (regla `solicitudes-datos-sin-plataforma`).

## Fases (una fase = un commit; cada historia se cierra sola)

| Fase | Contenido | Depende de | Se puede recortar |
| ---- | --------- | ---------- | ----------------- |
| **1 · US1** | Pruebas primero; migración `data_subject_request` con RLS; dominio (estados y días hábiles); casos de uso (registrar, registrar en nombre, mis solicitudes, bandeja, iniciar, cerrar); rutas y operaciones de M01; auditoría sin texto; pantallas "Mis datos" (cliente y barbero) y bandeja del propietario; reglas de PR14; **sus documentos** | nada | No (P1) |
| **2a · US2, enmienda** | Revisión por el responsable de los borradores; si se aprueban, aplicarlos a la constitución, al plan-template y al documento de ADR, y actualizar en el mismo commit `seguridad-y-privacidad.md`, `multi-tenancy-y-datos.md` y la trazabilidad, con las vistas como **"aprobadas, por construir en 2c"**. **Punto de corte:** si no se aprueban a tiempo o se complican, se salta 2c, US2 se cierra con 2b y la desviación se registra en esos mismos documentos | nada | — (es una decisión) |
| **2b · US2, barberías por estado** | Registro de indicadores en M06; fuente de M03 con columnas ya concedidas; caso de uso y ruta `@Plataforma()` en M01; acción `ADMIN_INDICADORES_CONSULTADOS`; pantalla "Indicadores"; **nota de ADR-031 sobre el registro** (no depende de la enmienda); **sus documentos** | nada (no necesita la enmienda) | No: es el mínimo de US2 |
| **2c · US2, citas y usuarios** | Rol `barberias_conteos` (concedido a `barberias_owner` sin herencia); dos vistas; fuentes de M02 y M01; ampliación de `lectura-plataforma` (permisos exactos) y de la regla `lectura-plataforma-confinada`; **sus documentos**, que pasan las vistas de "por construir" a "construidas" | 2a aprobada y 2b | **Sí: es el corte** |
| **3 · US3** | Pruebas primero; `INTENTOS_SAL_IP`; adaptador con `ip_hash`; migración que borra las filas y cambia la columna; aclaración PATCH del principio III; ampliación de `limite-intentos` y `segundo-factor`; **sus documentos** | nada | **Sí: primera en recortarse** |
| **4 · Cierre** | Solo **estados y totales** en los documentos (lista abajo), guía rápida y suite completa | las fases construidas | No |

Si se recorta algo, se registra como desviación en `spec.md` y en la fila de 007 de `docs/trazabilidad.md`
(FR-023).

**Documentos en el mismo cambio (principio XI, análisis C1):** cada fase actualiza en su propio commit los
documentos que su cambio afecta: la constitución, el ADR, `seguridad-y-privacidad.md`, `multi-tenancy-y-datos.md`,
`api-rest.md`, los componentes y su parte de la trazabilidad. Así, si una fase se corta, ninguna anterior deja
documentos a medias. La fase 4 solo cambia estados ("planificado" → "implementado" o "parcial"), los totales de
pruebas y tareas, y el recorrido de la guía rápida.

**Migraciones sin número fijo (análisis H2):** cada una toma el número siguiente libre al implementarla, porque
el migrador no admite migraciones fuera de orden y 2c y 3 pueden hacerse en cualquier orden.

## Project Structure

### Documentation (this feature)

```text
specs/007-indicadores-datos-personales/
├── spec.md
├── plan.md              # este archivo
├── research.md          # R01–R10
├── data-model.md        # data_subject_request, vistas de conteo, login_attempt
├── quickstart.md        # validación por historia
├── contracts/
│   ├── openapi.yaml     # rutas de solicitudes e indicadores
│   ├── rbac.md          # matriz rol × ruta y operaciones nuevas de M01
│   └── enmienda-y-adr.md  # BORRADORES: enmienda 1.7.0, revisión de ADR-031, nota del registro y PATCH de US3
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
tecnologia/plataforma-barberias/
├── db/init/01-roles.sql                         # US2 (2c): rol barberias_conteos (NOLOGIN NOBYPASSRLS NOINHERIT),
│                                                #   concedido a barberias_owner WITH INHERIT FALSE, SET TRUE
├── docker-compose.yml, .env.example             # US3: INTENTOS_SAL_IP (valor solo de desarrollo en los dos)
├── backend/
│   ├── migrations/                              # sin número fijo: cada una toma el siguiente libre al implementarla
│   │   ├── NNNN_solicitudes_datos.ts            # US1
│   │   ├── NNNN_auditoria_indicadores.ts        # US2 (2b): acción ADMIN_INDICADORES_CONSULTADOS
│   │   ├── NNNN_vistas_de_conteo.ts             # US2 (2c, se recorta con el corte): vistas, propiedad y permisos
│   │   └── NNNN_intentos_con_hash.ts            # US3
│   ├── src/
│   │   ├── host/indicadores.ts                  # US2: registra las fuentes en el registro de M06
│   │   ├── shared/indicadores/                  # US2: RegistroDeIndicadores y FuenteDeIndicador (M06, sin reglas)
│   │   ├── shared/config/configuracion.ts       # US3: INTENTOS_SAL_IP (≥ 16, distinta de ENLACES_SAL_IP)
│   │   └── modules/
│   │       ├── acceso-barberias/                # M01
│   │       │   ├── solicitudes-datos/           # US1: domain/ application/ infrastructure/ presentation/
│   │       │   ├── identidad/application/plataforma/consultar-indicadores.ts   # US2
│   │       │   ├── identidad/presentation/indicadores-plataforma.controller.ts # US2: @Plataforma()
│   │       │   ├── identidad/infrastructure/plataforma/usuarios-por-tipo-indicador.ts  # US2 (2c)
│   │       │   ├── identidad/infrastructure/kysely-intentos-repository.ts     # US3: ip_hash
│   │       │   └── identidad/domain/permisos.ts                               # US1: 4 operaciones nuevas
│   │       ├── catalogo-citas/citas/infrastructure/plataforma/citas-por-mes-indicador.ts  # US2 (2c)
│   │       └── suscripciones-pagos/suscripciones/infrastructure/plataforma/barberias-por-estado-indicador.ts  # US2 (2b)
│   │       # Convención de las fuentes: infrastructure/plataforma/*-indicador.ts (regla indicadores-solo-por-registro)
│   ├── .dependency-cruiser.cjs                  # reglas nuevas y ampliada (abajo)
│   └── test/
│       ├── unit/solicitudes-datos/              # estados, días hábiles, validación
│       ├── integration/solicitudes-datos/       # flujo, auditoría sin texto, unicidad, estados de suscripción
│       ├── integration/aislamiento/             # aislamiento-007, rls (tabla nueva), lectura-plataforma (vistas)
│       ├── integration/plataforma/indicadores-plataforma.spec.ts
│       ├── integration/identidad/limite-intentos.spec.ts y segundo-factor.spec.ts   # US3
│       └── contract/rbac-007.spec.ts, solicitudes-datos.contract.spec.ts, indicadores.contract.spec.ts
└── frontend/
    ├── src/api/solicitudes-datos.ts, src/api/indicadores.ts (tipos de contracts/openapi.yaml con gen:api)
    ├── src/pages/cliente/MisDatos.tsx            # /mis-datos (enlace desde Mis citas)
    ├── src/pages/panel/MisDatos.tsx              # /app/mis-datos (barbero)
    ├── src/pages/panel/SolicitudesDatos.tsx      # /app/solicitudes-datos (propietario)
    └── src/pages/plataforma/Indicadores.tsx      # /plataforma/indicadores
```

**Structure Decision:** la de siempre (constitución XII). Lo que se toca fuera de los archivos nuevos **solo
suma**:

- entradas en las matrices de permisos;
- una acción en el `CHECK` de `platform_audit_log`;
- un enlace en Mis citas y entradas de menú;
- la variable `INTENTOS_SAL_IP`;
- el registro de fuentes en el host;
- una carpeta permitida en la regla `lectura-plataforma-confinada`.

El único cambio de comportamiento previsto es el de US3, que mantiene iguales el límite y sus respuestas.

### Reglas de dependency-cruiser (PR14)

| Regla | Qué comprueba | Fase |
| ----- | ------------- | ---- |
| `lectura-plataforma-confinada` (**ampliada**) | Suma `catalogo-citas/citas/infrastructure/plataforma/` a las carpetas que pueden importar `shared/lectura-plataforma.ts` | 2c |
| `indicadores-solo-por-registro` (**nueva**) | Los archivos `src/modules/**/infrastructure/plataforma/*-indicador.ts` solo los importa `host/indicadores.ts` (y el `index.ts` de su propio módulo); M06 `shared/indicadores/` no importa módulos | 2b |
| `solicitudes-datos-sin-plataforma` (**nueva**) | `acceso-barberias/solicitudes-datos/` no importa `shared/lectura-plataforma.ts`; ningún `*-plataforma.controller.ts` ni carpeta `plataforma/` importa `solicitudes-datos/` | 1 |

## Pruebas por historia (primero, deben fallar)

- **US1:**
  - unitarias: transiciones, finales, días hábiles (fin de semana, fin de mes), validación de largos y del
    detalle obligatorio;
  - integración `solicitudes-datos`:
    - registro, en nombre, mis solicitudes y bandeja;
    - en atención, atendida y rechazada;
    - 409 por abierta repetida y por cerrada;
    - vencida al leer;
    - funciona con la suscripción `EXPIRED` y `SUSPENDED`;
  - `auditoria`: las cuatro acciones, sin el texto (con un texto marcador que no debe aparecer en `audit_log` ni
    en los registros capturados);
  - `aislamiento-007` y `rls`;
  - `rbac-007` (7 rutas × 5 columnas), con una lista de filas implementadas, como `rbac-005`;
  - contrato contra `openapi.yaml` (400 de validación del DTO y 422 de las reglas del dominio);
  - frontend: las tres pantallas, mensajes en `aria-live` y estado vacío.
- **US2:**
  - `indicadores-plataforma`: conteos exactos sobre lo sembrado; ningún id, nombre, correo ni teléfono en el
    cuerpo; 401 con un token de barbería; una fila `ADMIN_INDICADORES_CONSULTADOS`; meses en cero; ≤ 3 s en 2b
    **y en 2c**, con el volumen de `escalado`; el borde del mes con `created_at` sembrado a propósito;
  - `lectura-plataforma` (2c):
    - la lista exacta suma solo las dos vistas;
    - `SELECT id FROM appointment` y `FROM membership` siguen denegados;
    - `barberias_conteos` es `NOLOGIN NOBYPASSRLS`, no es dueño de tablas y no tiene permisos de escritura;
    - `barberias_app` y `barberias_publico` no leen las vistas;
    - `barberias_owner`, con tenant fijado, solo ve su barbería, y ningún rol con inicio de sesión hereda
      `barberias_conteos`;
  - contrato;
  - frontend.
- **US3:**
  - `limite-intentos`:
    - mismos umbrales y mensaje;
    - un acierto borra los fallos;
    - ninguna fila con una IP legible (`ip` ya no existe y `ip_hash` no es la IP);
  - `segundo-factor`: el administrador, igual;
  - prueba de la migración: las filas viejas no quedan;
  - `Configuracion`: rechaza la sal corta o igual a la de los enlaces;
  - la sal no aparece en los registros capturados ni en la auditoría (marcador, como en `registro-asistente`).

## Documentos de `docs/` y en qué fase se actualizan

Cada fase actualiza **en su commit** lo que su cambio afecta (principio XI). La fase 4 solo cambia estados y
totales. Solo lo construido pasa a "implementado"; lo recortado o fuera de alcance se dice como no construido.

| Documento | Fase 1 (US1) | Fase 2a | Fase 2b | Fase 2c | Fase 3 (US3) | Fase 4 (estados y totales) |
| --------- | ------------ | ------- | ------- | ------- | ------------ | -------------------------- |
| `docs/trazabilidad.md` | Fila de 007 y §4.8 (componentes de US1) | Enmienda y revisión de ADR-031 en la fila de 007 ("aprobadas, por construir"), o el corte como desviación | §4.8 (registro y barberías por estado) | §4.8 (vistas) y la fila, "construidas" | §4.8 (intentos) | Estado de la fila, HU26 y HU27 en §1, PR18 y PR21 en §3, totales |
| `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md` | — | Revisión de ADR-031 (o nada, si hay corte) | Nota de ADR-031 sobre el registro de indicadores | Estado de la revisión: implementada | — | — |
| `.specify/memory/constitution.md` y `plan-template.md` | — | Enmienda 1.7.0 (si se aprobó) | — | — | Aclaración PATCH | — |
| `docs/02-arquitectura-software/multi-tenancy-y-datos.md` | `data_subject_request` y §7 (eliminación a mano; anonimización como evolución) | La excepción de la plataforma con los conteos ("aprobada, por construir"), o nada | — | El rol `barberias_conteos` y las vistas, "construidas" | `login_attempt` con `ip_hash` | — |
| `docs/02-arquitectura-software/seguridad-y-privacidad.md` | Matriz rol × operación y §5 (derechos ARCO "implementado en parte") | Amenazas y excepción de la plataforma ("aprobada, por construir"), o nada | Matriz (indicadores) | Amenazas, "construidas" | Amenazas (origen derivado) | — |
| `docs/02-arquitectura-software/api-rest.md` | Rutas de solicitudes | — | Ruta de indicadores | — | — | — |
| `docs/02-arquitectura-software/componentes-arquitectonicos.md` y `estilo-arquitectonico.md` | M01 `solicitudes-datos` | — | M06 registro de indicadores y la regla 6 del host | — | — | Estados |
| `docs/01-analisis-de-sistema/03-requisitos-funcionales.md`, `02-historias-del-usuario.md` y `01-actores.md` | — | — | — | — | — | RF31 y RF32 (RF32 "parcial"), HU26 y HU27, actores, el resumen |
| `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md` | — | — | — | — | — | EQ-18, EQ-13 y EQ-12 con su evidencia |
| `docs/04-modelo-c4/` (niveles 1 a 3) | — | — | — | — | — | Estados en el texto; imágenes por regenerar |
| `docs/05-gestion/02-backlog-y-sprints.md`, `04-pruebas.md` y `06-mvp-y-evolucion.md` | — | — | — | — | — | Fila de 007, cortes aplicados, §2.4 y §2.8 de pruebas, evoluciones |
| `README.md` y `tecnologia/plataforma-barberias/README.md` | Pantallas de US1 | — | Pantalla de indicadores | El rol y su paso manual | `INTENTOS_SAL_IP` y su efecto en los scripts | Totales |
| `specs/003-suscripciones-pagos/contracts/restricciones-estado.md` | Nota en §1: las solicitudes valen en todos los estados | — | — | — | — | — |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| Rol de base nuevo `barberias_conteos` (dueño de las vistas), solo en 2c, concedido a `barberias_owner` con `WITH INHERIT FALSE, SET TRUE` | Con `FORCE ROW LEVEL SECURITY`, una vista corre con las políticas de su dueño: la de `barberias_owner` vería cero filas, y con `security_invoker` el rol de la plataforma necesitaría permisos sobre las tablas, lo que la aclaración prohíbe. Sin herencia, el dueño de las tablas (que inicia sesión) no recibe las políticas del rol | Permisos por columna sobre las tablas (prohibido por la aclaración); función de `barberias_auth` (tiene `BYPASSRLS`); contar barbería por barbería (no es la opción elegida) |
| Enmienda MINOR 1.7.0 del principio III, solo en 2c | El texto actual impide que el administrador vea citas y usuarios; los conteos agregados de RF31 necesitan una excepción acotada | El corte "solo barberías por estado" no la necesita y queda como plan B |
| Registro de indicadores en M06 conectado por el host | La matriz no deja que un módulo llame a M01, M02 y M03 a la vez | Ampliar la matriz (cambio mayor), o poner la lógica en el host |
