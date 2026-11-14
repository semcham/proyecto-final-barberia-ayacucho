---
description: "Tareas de la funcionalidad 005: asistente de IA y reportes"
---

# Tasks: Asistente de IA y reportes (005)

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/) y [quickstart.md](quickstart.md)

**Prerequisites**: plan con el Constitution Check en verde; ADR-027 y ADR-028 Aceptados por el responsable el 2026-11-14. Funcionalidades 002, 003, 004 y 008 implementadas.

**Tests**: obligatorias (principio X). En cada fase, **primero las pruebas, que deben fallar**, y después la implementación. **Nunca se recortan**:
- PR19, con sus 12 casos en los dos modos del proveedor falso;
- el aislamiento entre barberías (PR09);
- la matriz de permisos por rol (PR08);
- las cuotas atómicas con dos réplicas;
- el registro sin texto;
- la degradación en 3 s (PR06).

**Organization**:
- Cinco fases y **una fase = un commit**, como en 004 y 008.
- La última tarea de cada fase es su cierre: suite completa, `test:arch` y CI en verde, con su mensaje de commit.
- Las revisiones manuales de interfaz, la prueba con OpenRouter real y las mediciones son tareas aparte, **del responsable**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (otro archivo, sin dependencias pendientes).
- **[Story]**: US1 a US3 de la [especificación](spec.md). Las fases 1 y 5 no llevan historia.
- Las rutas son relativas a `tecnologia/plataforma-barberias/`, salvo `specs/`, `docs/` y `.github/`. En el backend, `src/` y `test/` cuelgan de `backend/`; en el frontend, de `frontend/`.
- Abreviaturas:
  - **`m04/`** es `backend/src/modules/asistente-reportes/` (M04, nuevo);
  - **`asistente/`** y **`reportes/`** son sus dos submódulos, cada uno con `{domain,application,infrastructure,presentation}/`;
  - **`m02/`** es `backend/src/modules/catalogo-citas/`.
- **Ninguna tarea cambia el comportamiento de otra funcionalidad** (FR-030):
  - M02 solo suma una interfaz de lectura;
  - el `RolesGuard` del host, el filtro de errores, la auditoría y la configuración solo suman entradas nuevas;
  - el enlace a Reservar usa los parámetros que `Reservar.tsx` ya acepta.

| Fase | Contenido | Historia | Tareas |
| ---- | --------- | -------- | ------ |
| 1 | Base: migración 0031, `CatalogoCitasApi`, M04, puerto de IA con el falso, PR14 | — | T001–T012 |
| 2 | Reportes del propietario | US2 | T013–T024 |
| 3 | Asistente del cliente | US1 | T025–T047 |
| 4 | Asistente del propietario (lo primero que se recorta) | US3 | T048–T056 |
| 5 | Cierre de documentación | — | T057–T064 |

---

## Fase 1: Base (Blocking Prerequisites)

**Purpose**: las dos tablas con RLS, la interfaz de solo lectura de M02, la carpeta de M04 con su matriz de permisos y el puerto del proveedor de IA con el falso, para que las historias solo agreguen casos de uso. Ninguna ruta nueva todavía.

### Pruebas de la base (escribir primero, deben fallar) ⚠️

- [ ] T001 [P] Crear `backend/test/integration/aislamiento/aislamiento-005.spec.ts` con el patrón de `aislamiento-008.spec.ts` (PR09; FR-004, FR-025):
  - para `assistant_quota` y `assistant_question`, con el tenant de A no se lee, no se modifica ni se inserta (`WITH CHECK`) una fila de B;
  - las dos tablas se agregan a la lista de `backend/test/integration/aislamiento/rls.spec.ts`.
- [ ] T002 [P] Crear `backend/test/integration/asistente/esquema-asistente.spec.ts` (FR-010; SC-007; data-model):
  - las columnas de `assistant_question` son exactamente las de [data-model](data-model.md), y ninguna guarda la pregunta, la respuesta ni los argumentos;
  - los `CHECK` de `result`, `scope` y `used <= limite`;
  - los permisos de `barberias_app` son exactamente los del data-model (sin `DELETE`);
  - ningún rol usado por la aplicación tiene `BYPASSRLS`;
  - `barberias_plataforma` no lee ninguna de las dos tablas.
- [ ] T003 [P] Ampliar `backend/test/architecture/reglas.spec.ts` y sus fixtures en `backend/test/architecture/fixture/src/modules/asistente-reportes/` con las reglas de [plan.md](plan.md) (PR14; FR-002, FR-026):
  - `matriz-m04`: M04 no importa M01, M05 ni archivos internos de M02 o M03;
  - `nadie-llama-a-m04`: ningún módulo importa `asistente-reportes/`;
  - `ia-solo-por-puerto`: el dominio y la aplicación de `asistente` no importan `infrastructure/proveedor-ia-*`;
  - `reportes-sin-ia`: `reportes/` no importa `asistente/`;
  - `kysely-solo-en-infraestructura` alcanza a M04.
- [ ] T004 [P] Crear `backend/test/architecture/catalogo-citas-api-solo-lectura.spec.ts` (FR-005; research R01). Comprueba que los métodos de `CatalogoCitasApi` son **exactamente** los siete de research R01:
  - `contextoDeLaBarberia`, `serviciosActivos`, `barberosQueOfrecen`, `horariosLibres`;
  - `conteosDeCitas`, `serviciosMasSolicitados`, `actividad`.

  Ningún otro método, por ejemplo uno de escritura, pasa la prueba.
- [ ] T005 [P] Crear la suite de contrato del puerto `backend/test/contract/ai-provider.contract.ts`, con el patrón de `payment-gateway.contract.ts`, y `backend/test/contract/ai-provider-falso.contract.spec.ts`, que la corre contra `ProveedorIAFalso` (PR20; FR-015; contracts/asistente.md §6). La suite comprueba:
  - `interpretar` devuelve una intención del esquema o lanza `ProveedorIANoDisponible`, nunca otra cosa;
  - respeta el `AbortSignal` del tiempo límite.

  Además, `backend/test/unit/asistente/proveedor-ia-falso.spec.ts` prueba:
  - el modo normal por palabras clave ("hoy", "mañana" y los días de la semana con la fecha y la zona horaria recibidas);
  - los modos `guion`, `caido`, `lento(ms)`, `error(429|500)` e `invalido`;
  - el registro de cada llamada recibida.
- [ ] T006 [P] Crear `backend/test/unit/shared/configuracion-ia.spec.ts` (FR-015; ADR-027):
  - `IA_PROVEEDOR` vale `ninguno` por defecto y solo acepta `falso`, `openrouter` o `ninguno`;
  - `IA_TIEMPO_LIMITE_MS` vale 2500 por defecto, con rango 500–10000;
  - `IA_CUOTA_USUARIO_DIA` vale 20 y `IA_CUOTA_BARBERIA_DIA` 200 por defecto;
  - `openrouter` sin `IA_OPENROUTER_LLAVE` no arranca;
  - `openrouter` con `NODE_ENV=production` **no arranca**;
  - la llave nunca aparece en el mensaje de error ni en el registro de arranque.
- [ ] T007 [P] Crear `backend/test/integration/catalogo/catalogo-citas-api.spec.ts`. Con el tenant de la barbería A (FR-002, FR-030; SC-001):
  - `serviciosActivos` y `barberosQueOfrecen` devuelven lo mismo que el catálogo público de 002 y nunca datos de B;
  - `horariosLibres` devuelve lo mismo que `ConsultarHorarios` para el mismo servicio, fecha y barbero;
  - `contextoDeLaBarberia` trae la zona horaria y el slug;
  - las tres lecturas de agregados devuelven cero en un período sin citas;
  - el conteo de filas de `appointment`, `service` y `user_account` es igual antes y después.

### Implementación de la base

- [ ] T008 Crear `backend/migrations/0031_asistente.ts` con [data-model](data-model.md) y actualizar `backend/src/shared/persistence/db-types.ts`. La migración crea:
  - `assistant_quota` (clave `tenant_id, scope, subject, day`);
  - `assistant_question`, sin columnas de texto;
  - `rlsPorTenant` en las dos, los `CHECK` y los permisos de `barberias_app`, sin `BYPASSRLS`.
- [ ] T009 [P] Crear la interfaz pública de M02 (research R01). Sin cambiar ninguna ruta ni caso de uso existente:
  - `m02/catalogo-citas-api.ts`: clase abstracta con los siete métodos de T004;
  - `m02/catalogo/application/catalogo-citas-api-impl.ts`: reutiliza `CatalogQuery` y `ConsultarHorarios.ejecutar` con `fuenteConSesion`;
  - `m02/citas/infrastructure/reportes-de-citas-query.ts`: agregados por `starts_at` sobre el índice `appointment(tenant_id, starts_at)`;
  - el proveedor se registra en el módulo de M02 y la interfaz se exporta en `m02/index.ts`.
- [ ] T010 [P] Crear el esqueleto de M04:
  - `m04/asistente-reportes.module.ts` y `m04/index.ts`, que exporta `AsistenteReportesModule` y `PermisosAsistenteReportes`;
  - `m04/asistente/domain/permisos.ts`: `USAR_ASISTENTE_CLIENTE` para CLIENTE, `USAR_ASISTENTE_PROPIETARIO` y `VER_REPORTES` para PROPIETARIO (contracts/rbac.md);
  - sumar esa matriz a `backend/src/host/roles.guard.ts`;
  - importar el módulo en `backend/src/host/app.module.ts`;
  - agregar las reglas de T003 a `backend/.dependency-cruiser.cjs`.
- [ ] T011 [P] Crear el puerto y los adaptadores sin red:
  - `asistente/application/ports/ai-provider.ts`: `AIProvider` con `interpretar` y el error `ProveedorIANoDisponible`;
  - `asistente/infrastructure/proveedor-ia-falso.ts` y `asistente/infrastructure/proveedor-ia-ninguno.ts`, que siempre lanza `ProveedorIANoDisponible`;
  - las variables `IA_*` en `backend/src/shared/config/configuracion.ts`, con la validación de T006;
  - `backend/.env.example` con `IA_OPENROUTER_LLAVE=` vacía y un comentario de que la llave nunca entra al repositorio;
  - las acciones `ASISTENTE_CONSULTADO` y `REPORTES_CONSULTADOS` en `backend/src/shared/audit/audit-log.ts` (research R13).
- [ ] T012 Cierre de fase 1: suite completa del backend (incluido `npm run test:arch`), del frontend y CI en verde (`.github/workflows/plataforma-barberias.yml`). Commit: `feat(005): base del asistente y reportes (fase 1)`

**Checkpoint**: tablas con RLS probadas, `CatalogoCitasApi` de solo lectura, M04 enlazado con su matriz de permisos y el proveedor falso en verde; ninguna ruta nueva todavía.

---

## Fase 2: User Story 2 - El propietario ve sus reportes (Priority: P1)

**Goal**: el propietario elige un período en la zona horaria de su barbería y ve tres tablas: citas por estado, servicios más solicitados y actividad. Todo sin depender del proveedor de IA.

**Independent Test**: spec.md US2 ("Independent Test").

### Pruebas de US2 (escribir primero, deben fallar) ⚠️

- [ ] T013 [P] [US2] Crear `backend/test/unit/reportes/periodo.spec.ts` (FR-020; data-model):
  - `desde` y `hasta` son fechas locales inclusivas;
  - hasta 366 días se acepta y 367 se rechaza;
  - `desde > hasta` y las fechas inválidas se rechazan con el campo a corregir;
  - el período se convierte a instantes con `ZonaHoraria` de M06: desde el inicio del día `desde` hasta el inicio del día siguiente a `hasta`, en America/Lima.
- [ ] T014 [P] [US2] Crear `backend/test/integration/reportes/reportes.spec.ts` sobre un conjunto de citas sembradas (US2-1 a US2-5; FR-020–FR-024, FR-026; SC-005):
  - citas: el total y el desglose por estado, con cuántas canceladas fueron tardías;
  - servicios más solicitados: ordenados de más a menos citas no canceladas, hasta 10, con el nombre actual y un desempate estable;
  - actividad: citas por barbero y por día de la semana, cancelaciones tardías y no asistencias;
  - bordes: una cita a las 00:00 y otra a las 23:59 de Lima entran, y una a las 00:00 del día siguiente no;
  - 367 días → 422 `VALIDACION` con el campo;
  - la respuesta no tiene nombres, teléfonos ni correos de clientes;
  - con `IA_PROVEEDOR=ninguno` responde igual.
- [ ] T015 [P] [US2] Crear `backend/test/integration/reportes/aislamiento-reportes.spec.ts` con dos barberías sembradas. Con el token de A, aunque la solicitud traiga un `tenant`, un slug o una cabecera de B, las cifras son solo las de A (PR09; FR-025; SC-006).
- [ ] T016 [P] [US2] Crear `backend/test/contract/rbac-005.spec.ts` con las filas de `GET /reportes` de [contracts/rbac.md](contracts/rbac.md) y `backend/test/contract/reportes.contract.spec.ts` contra [contracts/openapi.yaml](contracts/openapi.yaml) (PR08; FR-019):
  - PROPIETARIO → 200;
  - BARBERO y CLIENTE → 403;
  - sin sesión → 401;
  - el token de plataforma → 403.
- [ ] T017 [P] [US2] Crear `backend/test/integration/reportes/reportes-auditoria.spec.ts`. Cada consulta deja `REPORTES_CONSULTADOS` con el actor y `reportes:<desde>..<hasta>`, y nada más (FR-029).
- [ ] T018 [P] [US2] Crear `backend/test/integration/escalado/reportes-periodo.spec.ts`. El reporte de un mes con el volumen sembrado de research responde en ≤ 2 s, y el de 366 días también responde (SC-005). Si solo falla por tiempo, se repite sola, como las demás de `escalado`.
- [ ] T019 [P] [US2] Crear `frontend/test/reportes.spec.tsx` (US2; FR-020, FR-024; constitución, accesibilidad):
  - el período se elige con dos fechas etiquetadas, y por defecto es el mes en curso;
  - se ven las tres tablas, con encabezados y sin gráficos;
  - el error de período muestra el mensaje junto al campo, anunciado con `aria-live`;
  - un período sin citas muestra el estado vacío;
  - la ruta `/app/reportes` solo aparece para PROPIETARIO.

### Implementación de US2

- [ ] T020 [US2] Crear el dominio y la aplicación de los reportes (FR-020–FR-026):
  - `reportes/domain/periodo.ts` y `reportes/domain/reportes.ts` (la forma de las tres tablas);
  - `reportes/application/consultar-reportes.ts`, que lee solo por `CatalogoCitasApi`, dentro de `UnitOfWork.ejecutar(tenant, …)`, y deja `REPORTES_CONSULTADOS`.
- [ ] T021 [US2] Crear `reportes/presentation/reportes.controller.ts` con `GET /reportes?desde=&hasta=` y el permiso `VER_REPORTES`, según contracts/openapi.yaml, y registrarlo en `m04/asistente-reportes.module.ts`.
- [ ] T022 [P] [US2] Crear la pantalla de reportes:
  - `frontend/src/api/reportes.ts`;
  - `frontend/src/pages/panel/Reportes.tsx` (con su `.module.css` y tokens de tema);
  - la ruta `/app/reportes` en `frontend/src/routes.tsx`;
  - la entrada "Reportes" para PROPIETARIO en `frontend/src/components/app/DisenoApp.tsx`.
- [ ] T023 [US2] **Del responsable:**
  - revisar `/app/reportes` a 360 px y en escritorio, en los temas claro y oscuro, solo con teclado y con axe DevTools (0 errores graves);
  - medir en Docker Compose el tiempo del reporte de un mes (SC-005).
- [ ] T024 [US2] Cierre de fase 2: suite completa del backend (incluido `npm run test:arch`), del frontend y CI en verde. Commit: `feat(005): reportes del propietario (fase 2, US2)`

**Checkpoint**: el propietario ve sus tres tablas por la API y en la pantalla, con aislamiento probado y sin el proveedor de IA.

---

## Fase 3: User Story 1 - El cliente pregunta al asistente (Priority: P1, _Must_) 🎯 MVP

**Goal**: el cliente con sesión pregunta en lenguaje natural y el asistente responde con datos de las herramientas de solo lectura. Las respuestas cubren los servicios, los barberos y los horarios libres, y ofrecen ir a Reservar con los datos elegidos.
- Cuotas atómicas por usuario y por barbería.
- Degradación en ≤ 3 s si el proveedor falla.
- Registro sin texto.
- PR19 en dos modos.

**Independent Test**: spec.md US1 ("Independent Test").

### Pruebas de US1 (escribir primero, deben fallar) ⚠️

- [ ] T025 [P] [US1] Crear `backend/test/unit/asistente/intencion.spec.ts` (FR-001, FR-003, FR-006; contracts/asistente.md §2):
  - el esquema es cerrado: una intención fuera de la lista → `fuera_de_alcance`;
  - los argumentos que no están en el esquema se descartan y llevan a `fuera_de_alcance`;
  - un campo de texto del modelo se ignora;
  - cada rol tiene su lista de herramientas: el cliente solo `servicios`, `barberos` y `horarios_libres`;
  - una intención de otro rol → `fuera_de_alcance`.
- [ ] T026 [P] [US1] Crear `backend/test/unit/asistente/resolver-argumentos.spec.ts` (FR-014, FR-017):
  - "hoy", "mañana" y los días de la semana se resuelven en la zona horaria de la barbería, también cerca de la medianoche de Lima;
  - una fecha inválida, como `2026-13-45`, → `SIN_DATOS` con la explicación;
  - el servicio y el barbero se buscan solo en el catálogo de la barbería, por nombre sin tildes ni mayúsculas;
  - si hay más de uno, se piden las opciones;
  - una fecha pasada → mensaje claro.
- [ ] T027 [P] [US1] Crear `backend/test/unit/asistente/plantillas.spec.ts` (FR-001, FR-014, FR-018; contracts/asistente.md §3):
  - cada plantilla muestra solo los datos que recibe y dice la fecha exacta usada;
  - el enlace es `/b/{slug}/reservar?servicio=&barbero=&inicio=`, y no aparece si la barbería no acepta reservas (`SuscripcionesApi.estadoOperativo`);
  - sin datos, la respuesta es "no tengo ese dato" y ofrece el flujo manual.
- [ ] T028 [P] [US1] Crear `backend/test/unit/asistente/politica-cuota.spec.ts` (FR-007; research R08):
  - `day` es la fecha local de la barbería;
  - `reiniciaEn` es la próxima medianoche local;
  - `Retry-After` va en segundos;
  - los límites salen de la configuración.
- [ ] T029 [P] [US1] Crear `backend/test/unit/asistente/entrada.spec.ts` (FR-012, FR-013):
  - una pregunta vacía o de más de 500 caracteres se rechaza;
  - el contexto tiene como máximo 6 intervenciones y solo los roles `CLIENTE` y `ASISTENTE`;
  - lo que exceda se descarta sin error.
- [ ] T030 [P] [US1] Crear `backend/test/integration/asistente/asistente-cliente.spec.ts` con el proveedor falso en modo normal (US1-1 a US1-5; FR-001, FR-013, FR-017, FR-018; SC-001, SC-008):
  - los precios, duraciones, barberos y horas de las respuestas son el **100 %** iguales a los de `CatalogoCitasApi` y `ConsultarHorarios` para esa consulta;
  - los horarios salen con **una sola pregunta**;
  - aparece el enlace a Reservar con los datos elegidos;
  - una pregunta vacía o de 501 caracteres → 422 sin consumir cuota;
  - el conteo de citas es igual antes y después.
- [ ] T031 [P] [US1] Crear `backend/test/integration/asistente/pr19-adversarial.spec.ts` con los **12 casos** de [contracts/asistente.md §5](contracts/asistente.md), cada uno en los modos **normal** y **`guion`**: 24 corridas (PR19; FR-001, FR-003–FR-006, FR-009, FR-011; SC-002). En cada corrida se comprueban:
  - el resultado esperado;
  - 0 datos de otra barbería o de otros clientes;
  - 0 escrituras: los conteos de citas, adelantos, usuarios y catálogo no cambian;
  - 0 texto del modelo en la respuesta;
  - lo que recibió el falso no contiene el catálogo, nombres de clientes ni datos de otra barbería;
  - `assistant_question` sin texto.

  En esta fase, el caso 9 (propietario) espera 403, porque US3 todavía no existe. La fase 4 lo cambia por su resultado final.
- [ ] T032 [P] [US1] Crear `backend/test/integration/asistente/cuotas-asistente.spec.ts`, con los límites bajados por configuración (FR-007; SC-004):
  - al llegar al límite por usuario, la siguiente → 429 `CUOTA_ASISTENTE_AGOTADA` con `Retry-After` y `reiniciaEn`, y el flujo manual;
  - lo mismo con el límite por barbería y dos clientes;
  - **dos instancias de la aplicación** reciben a la vez más preguntas que la cuota: nunca se pasa del límite y 0 × 5xx;
  - las dos cuotas se consumen en una transacción: si una falla, ninguna sube;
  - la unidad se devuelve si el proveedor falla;
  - cerrar sesión no reinicia la cuota;
  - a la medianoche local, con el reloj controlado, se reinicia.
- [ ] T033 [P] [US1] Crear `backend/test/integration/asistente/degradacion-asistente.spec.ts` (PR06; FR-008, FR-026; SC-003; research R11). Casos:
  - con el falso en `caido`, `lento` (mayor que el tiempo límite), `error(500)`, `error(429)` (un reintento dentro del presupuesto) e `invalido`;
  - con el interruptor de M06 abierto tras 5 fallas en 60 s.

  En cada caso:
  - 503 `ASISTENTE_NO_DISPONIBLE`, con el flujo manual, en **≤ 3 s** medidos desde la solicitud;
  - la unidad de cuota se devuelve;
  - durante la falla, `GET /reportes` y el catálogo público responden igual.
- [ ] T034 [P] [US1] Crear `backend/test/integration/asistente/registro-asistente.spec.ts` (FR-010, FR-029; SC-007):
  - cada pregunta deja una fila en `assistant_question` con el usuario, el rol, la intención, las herramientas, el resultado (`OK`, `FUERA_DE_ALCANCE`, `CUOTA`, `PROVEEDOR_NO_DISPONIBLE`, …), la duración y el consumo;
  - la auditoría tiene `ASISTENTE_CONSULTADO` con `asistente:<rol>;<resultado>`;
  - una pregunta con un texto marcador no deja ese texto en la tabla, la auditoría ni los registros capturados de la aplicación;
  - la llave de prueba tampoco aparece en ninguno de ellos.
- [ ] T035 [P] [US1] Crear `backend/test/integration/asistente/aislamiento-asistente.spec.ts` con dos barberías sembradas, con nombres de servicio y de barbero distintos (PR09; FR-004; SC-006). Con el token de un cliente de A:
  - ninguna respuesta trae datos de B, aunque el mensaje nombre a B o el cuerpo traiga un `tenant`;
  - la cuota de A no cambia la de B.
- [ ] T036 [P] [US1] Ampliar `backend/test/contract/rbac-005.spec.ts` con `POST /asistente/mensajes` (PR08, PR20; FR-003, FR-015, FR-016):
  - CLIENTE de la barbería → 200;
  - BARBERO → 403;
  - PROPIETARIO → 403 hasta la fase 4;
  - sin sesión → 401.

  Además:
  - crear `backend/test/contract/asistente.contract.spec.ts` contra contracts/openapi.yaml, con 200, 422, 429 y 503;
  - crear `backend/test/contract/ai-provider-openrouter.contract.spec.ts`, que corre la suite de T005 contra OpenRouter y **se omite sin `IA_OPENROUTER_LLAVE`**, como `gateway-sandbox` en 003.
- [ ] T037 [P] [US1] Crear `frontend/test/asistente.spec.tsx` (US1; FR-007, FR-008, FR-012, FR-013, FR-018; constitución, accesibilidad):
  - enviar una pregunta y ver la respuesta en una región `aria-live`;
  - un contador de 500 caracteres;
  - una pregunta vacía no se envía;
  - la cuota agotada muestra la hora de reinicio y el enlace a Reservar;
  - "no disponible" muestra la alternativa manual;
  - el enlace de horarios lleva a Reservar con los parámetros;
  - al recargar, la conversación empieza de nuevo;
  - solo el CLIENTE con sesión ve `/asistente`.

### Implementación de US1

- [ ] T038 [US1] Crear el dominio de `asistente/domain/`: `intencion.ts`, `herramientas.ts`, `plantillas.ts`, `politica-cuota.ts`, `entrada.ts` y `errores.ts`.
  - `intencion.ts`: el esquema cerrado de contracts/asistente.md §2;
  - `herramientas.ts`: la lista por rol;
  - `plantillas.ts`: las plantillas de §3;
  - `errores.ts`: `CuotaAsistenteAgotada` (429, con `Retry-After`) y `AsistenteNoDisponible` (503).

  Los dos errores se mapean en `backend/src/host/error.filter.ts`, solo sumando entradas.
- [ ] T039 [P] [US1] Crear los puertos `asistente/application/ports/cuotas.ts` y `ports/registro.ts`, y sus adaptadores (research R08):
  - `asistente/infrastructure/kysely-cuotas.ts`: `INSERT … ON CONFLICT DO UPDATE SET used = used + 1 WHERE used < limite RETURNING` para los dos ámbitos en la misma transacción, y `devolver`;
  - `asistente/infrastructure/kysely-registro.ts`: inserta sin texto.
- [ ] T040 [US1] Crear `asistente/application/preguntar-al-asistente.ts` con el flujo de contracts/asistente.md §1 (FR-001–FR-014):
  1. validar la entrada;
  2. consumir la cuota;
  3. llamar a `AIProvider.interpretar` con el tiempo límite, un reintento ante 429 o 5xx dentro del presupuesto de 3 s y el `Interruptor` de M06;
  4. validar la intención contra la lista del rol;
  5. resolver los argumentos en la barbería del token;
  6. llamar a la herramienta por `CatalogoCitasApi` o `SuscripcionesApi`;
  7. componer con la plantilla.

  Si el proveedor falla, devuelve la cuota. Siempre registra la pregunta y deja la auditoría. Al proveedor solo le envía la pregunta, el contexto mínimo, la fecha y la zona horaria, nunca el catálogo.
- [ ] T041 [US1] Crear `asistente/presentation/asistente.controller.ts` con `POST /asistente/mensajes` y el permiso por rol del token, según contracts/openapi.yaml.
  - En `m04/asistente-reportes.module.ts`, enlazar el `AIProvider` según `IA_PROVEEDOR` (`falso`, `openrouter` o `ninguno`).
  - El PROPIETARIO recibe 403 hasta la fase 4.
- [ ] T042 [P] [US1] Crear `asistente/infrastructure/proveedor-ia-openrouter.ts`, **solo para desarrollo** (ADR-027; FR-015):
  - usa `fetch` nativo con `AbortSignal.timeout`, una sola llamada con esquema JSON y las instrucciones de contracts/asistente.md §4;
  - la llave sale de `IA_OPENROUTER_LLAVE` y nunca va a un registro;
  - la guardia de T006 impide arrancar con `NODE_ENV=production`;
  - no se agrega ninguna dependencia a `package.json`.
- [ ] T043 [P] [US1] Crear `backend/scripts/ia-modo.ts` y el script `ia:modo` en `backend/package.json`. El script cambia el modo de demostración del proveedor falso (`normal`, `caido` o `lento`) escribiendo un archivo local ignorado por git, que el falso lee en cada llamada solo con `IA_PROVEEDOR=falso`. Nunca hay una ruta HTTP para cambiarlo. En Compose se usa con `docker compose exec backend npm run ia:modo -- caido` (quickstart §2, paso 8).
- [ ] T044 [P] [US1] Crear la pantalla del asistente:
  - `frontend/src/api/asistente.ts`;
  - `frontend/src/pages/cliente/Asistente.tsx` (con su `.module.css` y tokens de tema), con la conversación solo en memoria y como máximo 6 intervenciones enviadas;
  - la ruta `/asistente` para CLIENTE en `frontend/src/routes.tsx`;
  - la entrada "Asistente" en el menú del cliente (`frontend/src/components/app/DisenoApp.tsx` o `MenuUsuario.tsx`, donde ya están Mis citas).
- [ ] T045 [US1] Agregar `.ia-modo` al `.gitignore` del backend y comprobar con `git check-ignore` que ni ese archivo ni `.env` entran al repositorio.
- [ ] T046 [US1] **Del responsable:**
  - revisar `/asistente` a 360 px y en escritorio, en los temas claro y oscuro, solo con teclado, con lector de pantalla en la región de respuestas y con axe DevTools (0 errores graves);
  - hacer la **prueba con OpenRouter real** en desarrollo (quickstart §2, paso 10), con la llave solo en el `.env` local, y anotar la latencia medida y si las intenciones salieron bien;
  - medir en Compose el tiempo de "no disponible" con `ia:modo caido` (SC-003).
- [ ] T047 [US1] Cierre de fase 3: suite completa del backend (incluido `npm run test:arch`), del frontend y CI en verde. La CI corre con `IA_PROVEEDOR=falso` y sin llave. Commit: `feat(005): asistente del cliente (fase 3, US1)`

**Checkpoint**: RF27 de punta a punta con el proveedor falso, PR19 en verde en los dos modos, las cuotas resisten dos instancias y la degradación queda en ≤ 3 s.

---

## Fase 4: User Story 3 - El propietario pregunta al asistente (Priority: P3)

**Goal**: el propietario pregunta "¿cuántas citas tuve este mes?" o "¿qué servicios piden más?" y recibe las mismas cifras que los reportes, sin datos de clientes. **Es lo primero que se recorta entero.**

**Independent Test**: spec.md US3 ("Independent Test").

### Pruebas de US3 (escribir primero, deben fallar) ⚠️

- [ ] T048 [P] [US3] Crear `backend/test/integration/asistente/asistente-propietario.spec.ts` con el falso en modo normal (US3-1 a US3-4; FR-027, FR-028; SC-008):
  - `resumen_citas` y `servicios_mas_pedidos` dan **exactamente** las cifras de `GET /reportes` para el mismo período, con una sola pregunta;
  - "este mes" y "la semana pasada" se resuelven en la zona horaria y la respuesta dice el período usado;
  - más de 366 días → mensaje claro;
  - ninguna respuesta trae nombres, teléfonos ni correos de clientes;
  - las intenciones del cliente pedidas por el propietario → `fuera_de_alcance`.
- [ ] T049 [P] [US3] Ampliar `backend/test/integration/asistente/pr19-adversarial.spec.ts` (PR19; FR-009, FR-028):
  - el caso 9 pasa de 403 a su resultado final de contracts/asistente.md §5: argumento descartado, `FUERA_DE_ALCANCE`, ningún nombre ni correo, en los dos modos;
  - los casos 1, 8 y 12 siguen dando `FUERA_DE_ALCANCE` para el CLIENTE.
- [ ] T050 [P] [US3] Ampliar `backend/test/contract/rbac-005.spec.ts` y `backend/test/integration/asistente/cuotas-asistente.spec.ts` (PR08; FR-003, FR-007, FR-027):
  - el PROPIETARIO → 200 en `POST /asistente/mensajes`, y el BARBERO sigue en 403;
  - las preguntas del propietario cuentan en su cuota de usuario y en la de la barbería.
- [ ] T051 [P] [US3] Crear `frontend/test/reportes-preguntar.spec.tsx`. La pestaña "Preguntar" de `/app/reportes`:
  - envía la pregunta y muestra la respuesta en `aria-live`;
  - muestra los mensajes de cuota y de "no disponible", con la alternativa de las tablas;
  - las tablas siguen funcionando si el asistente falla.

### Implementación de US3

- [ ] T052 [US3] Agregar `resumen_citas` y `servicios_mas_pedidos` (FR-027, FR-028):
  - al esquema de `asistente/domain/intencion.ts`, a la lista del PROPIETARIO en `herramientas.ts` y a sus plantillas en `plantillas.ts`;
  - las herramientas llaman a `ConsultarReportes`, el mismo caso de uso de la fase 2, a través de la interfaz que exponga el submódulo `reportes` dentro de M04;
  - quitar el 403 del PROPIETARIO en `asistente/presentation/asistente.controller.ts`.
- [ ] T053 [P] [US3] Agregar la pestaña "Preguntar" a `frontend/src/pages/panel/Reportes.tsx`, reutilizando la conversación de `Asistente.tsx` como componente compartido en `frontend/src/components/app/`.
- [ ] T054 [US3] Comprobar que `reportes-sin-ia` sigue en verde: el asistente usa `reportes/`, pero `reportes/` no importa nada de `asistente/`.
- [ ] T055 [US3] **Del responsable:** revisar la pestaña "Preguntar" a 360 px y en escritorio, en los temas claro y oscuro, solo con teclado y con axe DevTools (0 errores graves).
- [ ] T056 [US3] Cierre de fase 4: suite completa del backend (incluido `npm run test:arch`), del frontend y CI en verde. Commit: `feat(005): asistente del propietario (fase 4, US3)`

**Checkpoint**: RF28 con las mismas cifras que RF29 y PR19 completo con el caso 9 final.

---

## Fase 5: Cierre (documentación, suite completa y quickstart)

**Purpose**: dejar la documentación con el estado real de 005. **Solo lo construido pasa de "planificado" a "implementado"**, como en la fase 7 de 008. Si la fase 4 se recortó, RF28 y HU23 quedan como "planificado" y se dice por qué.

- [ ] T057 Recorrer `specs/005-asistente-ia-reportes/quickstart.md` §1 a §3 con Docker Compose y el proveedor falso, y anotar cada resultado medido. El paso 10 (OpenRouter) y los de §4 quedan como "pendiente del responsable" si no los hizo.
- [ ] T058 [P] Actualizar `docs/trazabilidad.md`:
  - en §4, la fila de 005: estado, pruebas PR06, PR08, PR09, PR14, PR19 y PR20, y los totales medidos;
  - HU22, HU23 y HU24 en §1;
  - una tabla §4.7 de componentes de 005 con su evidencia;
  - §5 si se tocó algún diagrama.
- [ ] T059 [P] Actualizar `docs/05-gestion/04-pruebas.md` y `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md`:
  - en `04-pruebas.md`: PR19 con los 12 casos × 2 modos y su resultado, PR06 de la IA con el tiempo medido, PR20 del puerto de IA (OpenRouter omitida en CI), §2.4 con los totales de la última corrida y una §2.7 de 005;
  - en `08-escenarios-atributos-calidad.md`: los escenarios del asistente y los reportes (EQ-06, EQ-12 y EQ-19), con la evidencia.
- [ ] T060 [P] Cambiar "planificado" por "implementado" **solo en lo construido** en:
  - `docs/01-analisis-de-sistema/03-requisitos-funcionales.md`: RF27, RF28, RF29 y el resumen;
  - `docs/01-analisis-de-sistema/02-historias-del-usuario.md`: HU22, HU23 y HU24;
  - `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`: ADR-027 y ADR-028 implementados en lo construido;
  - `docs/05-gestion/02-backlog-y-sprints.md`: la fila de 005, con la cuota por plan como evolución futura;
  - `docs/02-arquitectura-software/componentes-arquitectonicos.md`: M04 y la interfaz `CatalogoCitasApi` de M02;
  - `docs/02-arquitectura-software/multi-tenancy-y-datos.md`: `assistant_quota` y `assistant_question`;
  - `docs/03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md`: M04.
- [ ] T061 [P] Actualizar tres documentos de arquitectura:
  - `docs/02-arquitectura-software/api-rest.md`: **reemplazar `GET /reportes/citas` por `GET /reportes`**, con sus tres tablas, y agregar `POST /asistente/mensajes` con 422, 429 y 503;
  - `docs/02-arquitectura-software/seguridad-y-privacidad.md`: las filas RBAC de M04, la llave solo en el `.env` local, lo que se envía al proveedor, el registro sin texto y PR19;
  - `docs/02-arquitectura-software/tecnologias.md`: OpenRouter solo en desarrollo y ninguna dependencia nueva.
- [ ] T062 [P] Actualizar `tecnologia/plataforma-barberias/README.md` (funcionalidad 005, migración `0031`, pantallas `/asistente` y `/app/reportes`, variables `IA_*` con la llave fuera del repositorio y `npm run ia:modo`) y el `README.md` raíz si cambia algún total.
- [ ] T063 **Del responsable:** confirmar las revisiones manuales y las mediciones de T023, T046 y T055 antes de marcarlas:
  - 360 px, escritorio, temas claro y oscuro, teclado y axe DevTools;
  - la prueba con OpenRouter real;
  - SC-003 y SC-005 en Compose.
- [ ] T064 Cierre de fase 5: suite completa del backend (incluido `npm run test:arch`) y del frontend, Prettier y CI en verde. Commit: `docs(005): cierre del asistente y reportes (fase 5)`

---

## Dependencies & Execution Order

- **Fase 1** no depende de nada y bloquea a todas.
- **Fase 2 (US2)** depende de la 1.
- **Fase 3 (US1)** depende de la 1. T033 usa `GET /reportes` para comprobar que la plataforma sigue respondiendo; si la fase 2 no existe, esa comprobación se hace con el catálogo público.
- **Fase 4 (US3)** depende de la 2 (usa `ConsultarReportes`) y de la 3 (usa el flujo del asistente).
- **Fase 5** al final.

Orden: 1 → 2 → 3 → 4 → 5. Si el plazo obliga a elegir entre US1 y US2, va primero **US1** (RF27 es _Must_; plan.md). Dentro de cada fase: pruebas (en paralelo, deben fallar) → dominio y puertos → casos de uso → rutas → interfaz → revisión manual → cierre.

### Paralelismo

- Fase 1: T001–T007 en paralelo; T009, T010 y T011 en paralelo después de T008.
- Fase 2: T013–T019 en paralelo; T022 (frontend) en paralelo con T020–T021.
- Fase 3: T025–T037 en paralelo; T039 en paralelo con T038; T042, T043 y T044 en paralelo con T040–T041.
- Fase 4: T048–T051 en paralelo; T053 (frontend) en paralelo con T052.
- Fase 5: T058–T062 en paralelo después de T057.

**Ejemplo (fase 3):**
1. T025 a T037 se escriben a la vez.
2. Luego T038 → T040 → T041, con T039 en paralelo a T038.
3. En paralelo con T040, T042 (OpenRouter), T043 (`ia:modo`) y T044 (frontend).

---

## Estimación de horas por fase

Calendario: del sábado 14 al miércoles 18 de noviembre de 2026 (entrega el 18). Son horas de trabajo efectivo estimadas para una persona con asistencia de IA, como en 004 y 008.

| Fase | Contenido | Horas | Día objetivo |
| ---- | --------- | ----- | ------------ |
| 1 | Base | 5 | sáb 14 – dom 15 |
| 2 | US2 Reportes | 4 | dom 15 |
| 3 | US1 Asistente del cliente | 10 | lun 16 – mar 17 |
| 4 | US3 Asistente del propietario | 3 | mar 17 |
| 5 | Cierre de documentación | 3 | mié 18 |
| | **Total** | **25** | |

Cada cierre de fase incluye la corrida completa de integración, que tarda unos 50 minutos en este equipo (cierres de 004 y 008).

---

## Qué es indispensable si vas atrasado

**Nunca se recortan**, en ninguna fase:
- PR19 con los 12 casos en los modos normal y `guion` (T031, T049);
- el aislamiento entre barberías (T001, T015, T035);
- la matriz de permisos por rol (T016, T036, T050);
- las cuotas atómicas con dos réplicas (T032);
- el registro sin texto y la auditoría sin contenido (T002, T017, T034);
- la degradación en ≤ 3 s (T033);
- las reglas de arquitectura y la prueba de solo lectura de `CatalogoCitasApi` (T003, T004);
- la guardia que impide OpenRouter en producción (T006).

| Fase | Indispensable | Línea de corte (lo primero que se recorta) |
| ---- | ------------- | ------------------------------------------ |
| 1 | Todo | — |
| 2 | `GET /reportes` con citas y servicios más solicitados, aislamiento, permisos y una pantalla mínima en tablas | La tabla de **actividad por día de la semana** (quedan por barbero, cancelaciones tardías y no asistencias) |
| 3 | `POST /asistente/mensajes` con `servicios` y `horarios_libres`, cuotas, degradación, registro, PR19 y la pantalla | En orden:<br>1. el contexto de 6 intervenciones: cada pregunta va sola y T029 se reduce a la validación del largo;<br>2. la intención `barberos`: los horarios ya dicen qué barberos atienden, y PR19 no cambia;<br>3. `ia:modo` (T043): la demostración de la caída se hace deteniendo el proveedor o con `IA_PROVEEDOR=ninguno`;<br>4. la prueba con OpenRouter real queda manual: T042 se construye, pero la suite de T036 se omite sin llave, como ya está previsto. |
| 4 | — (toda la fase es cortable) | **Se recorta entera**: el PROPIETARIO sigue con 403 en el asistente, el caso 9 de PR19 queda con 403 (0 fugas igual), y RF28 y HU23 quedan "planificado" |
| 5 | Trazabilidad, pruebas, `api-rest.md` con `GET /reportes` y los estados de RF27, RF29, HU22 y HU24 | El recorrido completo del quickstart con Compose (se hacen al menos §1 y §3) y la sección de `diseño-interno-de-modulos.md` |

**Orden de recorte si quedan menos de 2 días tras la fase 2:**
1. la fase 4 entera;
2. la tabla por día de la semana;
3. el contexto de 6 intervenciones;
4. la intención `barberos`;
5. `ia:modo`.

US2 + US1 (fases 1 a 3) son el **mínimo demostrable** de 005: RF27 (_Must_) y RF29.

---

## Implementation Strategy

1. **Base (fase 1):** tablas, la interfaz de lectura y el puerto, sin rutas nuevas.
2. **US2 (fase 2):** los reportes, sin riesgo del proveedor. Quedan listas las lecturas que usa US3.
3. **MVP (fase 3):** el asistente del cliente con el proveedor falso, PR19, las cuotas y la degradación. OpenRouter real, solo en desarrollo y a cargo del responsable.
4. **US3 (fase 4):** el asistente del propietario sobre los reportes, si queda tiempo.
5. **Cierre (fase 5):** documentación con el estado real.

Cada fase es un commit con CI en verde. Si el calendario se corta, lo entregado hasta la última fase cerrada funciona y está probado.

## Trazabilidad (requisito → tareas)

| Requisito | Historia | Tareas |
| --------- | -------- | ------ |
| FR-001 | US1, US3 | T025, T027, T030, T031, T040 |
| FR-002 | US1, US3 | T003, T007, T009, T040, T052 |
| FR-003 | US1, US3 | T025, T031, T036, T048, T050 |
| FR-004 | US1 | T001, T031, T035, T040 |
| FR-005 | US1 | T004, T030, T031 |
| FR-006 | US1 | T025, T031 |
| FR-007 | US1, US3 | T028, T032, T039, T050 |
| FR-008 | US1 | T033, T040 |
| FR-009 | US1, US3 | T031, T048, T049 |
| FR-010 | US1 | T002, T034, T039 |
| FR-011 | US1 | T031, T040, T042 |
| FR-012, FR-013 | US1 | T029, T030, T037, T044 |
| FR-014 | US1 | T026, T027 |
| FR-015 | — | T005, T006, T011, T036, T041, T042 |
| FR-016 | US1 | T036, T037 |
| FR-017, FR-018 | US1 | T026, T027, T030, T037, T044 |
| FR-019 | US2 | T016, T021 |
| FR-020–FR-024 | US2 | T013, T014, T019, T020, T022 |
| FR-025 | US2 | T001, T015 |
| FR-026 | US2 | T003, T014, T033, T054 |
| FR-027, FR-028 | US3 | T048, T049, T052, T053 |
| FR-029 | US1, US2 | T011, T017, T034 |
| FR-030 | — | T004, T007, T009 (solo lecturas), T012 (suite completa de 001–008 en verde) |
| SC-001 | US1 | T007, T030 |
| SC-002 | US1, US3 | T031, T049 |
| SC-003 | US1 | T033, T046 (medición en Compose) |
| SC-004 | US1 | T032 |
| SC-005 | US2 | T014, T018, T023 (medición en Compose) |
| SC-006 | US1, US2 | T015, T035 |
| SC-007 | US1 | T002, T034 |
| SC-008 | US1, US3 | T030, T048 |
| PR06 | US1 | T033 |
| PR08 | — | T016, T036, T050 |
| PR09 | — | T001, T002, T015, T035 |
| PR14 | — | T003, T004, T010, T054 |
| PR19 | US1, US3 | T031, T049 |
| PR20 | US1 | T005, T036 |
