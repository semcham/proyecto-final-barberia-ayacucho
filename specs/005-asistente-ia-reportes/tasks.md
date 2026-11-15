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
- **Ninguna tarea cambia el comportamiento de otra funcionalidad** (FR-030). Lo que se toca fuera de M04 solo suma:
  - M02 suma una interfaz de lectura y un método nuevo en `CatalogQuery` (`serviciosActivosPublicos`), sin tocar los existentes;
  - el `RolesGuard` suma la matriz de M04 como una rama más de `rolPermiteOperacion`, sin cambiar su lógica (una operación por ruta);
  - el filtro de errores suma dos códigos con su estado; los datos extra van en `detalles[0]`, con el formato de siempre;
  - la auditoría y la configuración suman entradas nuevas, y `docker-compose.yml` suma variables;
  - `MisCitas.tsx` y `CatalogoPublico.tsx` suman un enlace visible solo con sesión de CLIENTE, con una prueba de que lo demás de esas pantallas no cambia;
  - el enlace a Reservar usa los parámetros que `Reservar.tsx` ya acepta.
- **Recortes:** si se recorta algo de la tabla "Qué es indispensable", se registra como **desviación** en `spec.md` (sección "Desviaciones") y en `docs/trazabilidad.md` (fila de 005), con el requisito afectado.

| Fase | Contenido | Historia | Tareas |
| ---- | --------- | -------- | ------ |
| 1 | Base: migración 0031, `CatalogoCitasApi`, M04, puerto de IA con el falso, variables de Compose, PR14 | — | T001–T013 |
| 2 | Reportes del propietario | US2 | T014–T025 |
| 3 | Asistente del cliente | US1 | T026–T047 |
| 4 | Asistente del propietario (lo primero que se recorta) | US3 | T048–T056 |
| 5 | Cierre de documentación | — | T057–T064 |

---

## Fase 1: Base (Blocking Prerequisites)

**Purpose**: las dos tablas con RLS, la interfaz de solo lectura de M02, la carpeta de M04 con su matriz de permisos y el puerto del proveedor de IA con el falso, para que las historias solo agreguen casos de uso. Ninguna ruta nueva todavía.

### Pruebas de la base (escribir primero, deben fallar) ⚠️

- [X] T001 [P] Crear `backend/test/integration/aislamiento/aislamiento-005.spec.ts` con el patrón de `aislamiento-008.spec.ts` (PR09; FR-004, FR-025):
  - para `assistant_quota` y `assistant_question`, con el tenant de A no se lee, no se modifica ni se inserta (`WITH CHECK`) una fila de B;
  - las dos tablas se agregan a la lista de `backend/test/integration/aislamiento/rls.spec.ts`.
- [X] T002 [P] Crear `backend/test/integration/asistente/esquema-asistente.spec.ts` (FR-010; SC-007; data-model):
  - las columnas de `assistant_question` son exactamente las de [data-model](data-model.md), y ninguna guarda la pregunta, la respuesta ni los argumentos;
  - los `CHECK` de [data-model](data-model.md): `scope` en `USUARIO`/`BARBERIA`, `subject_id = tenant_id` cuando `scope = 'BARBERIA'`, `used >= 0`, y la lista cerrada de `role`, `intent` y `result`;
  - la clave primaria de `assistant_quota` es `(tenant_id, scope, subject_id, day)`;
  - los permisos de `barberias_app` son exactamente los del data-model (sin `DELETE`);
  - ningún rol usado por la aplicación tiene `BYPASSRLS`;
  - `barberias_plataforma` no lee ninguna de las dos tablas.
- [X] T003 [P] Ampliar `backend/test/architecture/reglas.spec.ts` y sus fixtures en `backend/test/architecture/fixture/src/modules/asistente-reportes/` con las reglas de [plan.md](plan.md) (PR14; FR-002, FR-026):
  - `matriz-m04`: M04 no importa M01, M05 ni archivos internos de M02 o M03;
  - `nadie-llama-a-m04`: ningún módulo importa `asistente-reportes/`;
  - `ia-solo-por-puerto`: el dominio y la aplicación de `asistente` no importan `infrastructure/proveedor-ia-*`;
  - `reportes-sin-ia`: `reportes/` no importa `asistente/`;
  - `kysely-solo-en-infraestructura` alcanza a M04.
- [X] T004 [P] Crear `backend/test/architecture/catalogo-citas-api-solo-lectura.spec.ts` (FR-005; research R01). Comprueba que los métodos de `CatalogoCitasApi` son **exactamente** los siete de research R01:
  - `contextoDeLaBarberia`, `serviciosActivos`, `barberosQueOfrecen`, `horariosLibres`;
  - `conteosDeCitas`, `serviciosMasSolicitados`, `actividad`.

  Ningún otro método, por ejemplo uno de escritura, pasa la prueba.
- [X] T005 [P] Crear la suite de contrato del puerto `backend/test/contract/ai-provider.contract.ts`, con el patrón de `payment-gateway.contract.ts`, y `backend/test/contract/ai-provider-falso.contract.spec.ts`, que la corre contra `ProveedorIAFalso` (PR20; FR-015; contracts/asistente.md §6). La suite comprueba:
  - `interpretar` devuelve una intención del esquema o lanza `ProveedorIANoDisponible`, nunca otra cosa;
  - respeta el `AbortSignal` del tiempo límite.

  Además, `backend/test/unit/asistente/proveedor-ia-falso.spec.ts` prueba:
  - el modo normal por palabras clave ("hoy", "mañana" y los días de la semana con la fecha y la zona horaria recibidas);
  - los modos `guion`, `caido`, `lento(ms)`, `error(429|500)` e `invalido`, fijados desde la prueba;
  - el modo de demostración tomado de `IA_FALSO_MODO` al crearse (`normal`, `caido` o `lento`);
  - el registro de cada llamada recibida.
- [X] T006 [P] Crear `backend/test/unit/shared/configuracion-ia.spec.ts` (FR-015; ADR-027):
  - `IA_PROVEEDOR` vale `ninguno` por defecto y solo acepta `falso`, `openrouter` o `ninguno`;
  - `IA_TIEMPO_LIMITE_MS` vale 2500 por defecto, con rango 500–2800 (fuera de él, no arranca), para que la respuesta quepa siempre en 3 s;
  - `IA_CUOTA_USUARIO_DIA` vale 20 y `IA_CUOTA_BARBERIA_DIA` 200 por defecto;
  - `IA_FALSO_MODO` vale `normal` por defecto, solo acepta `normal`, `caido` o `lento`, y solo se usa con `IA_PROVEEDOR=falso`;
  - `openrouter` sin `IA_OPENROUTER_LLAVE` no arranca;
  - `openrouter` con `NODE_ENV=production` **no arranca**;
  - la llave nunca aparece en el mensaje de error ni en el registro de arranque.
- [X] T007 [P] Crear `backend/test/integration/catalogo/catalogo-citas-api.spec.ts`. Con el tenant de la barbería A (FR-002, FR-030; SC-001):
  - `serviciosActivos` (nombre, precio, duración y descripción pública) y `barberosQueOfrecen` devuelven lo mismo que el catálogo público de 002, solo columnas públicas, y nunca datos de B;
  - `horariosLibres` devuelve lo mismo que `ConsultarHorarios` para el mismo servicio, fecha y barbero;
  - `contextoDeLaBarberia` trae la zona horaria y el slug;
  - las tres lecturas de agregados devuelven cero en un período sin citas;
  - el conteo de filas de `appointment`, `service` y `user_account` es igual antes y después.

### Implementación de la base

- [X] T008 Crear `backend/migrations/0031_asistente.ts` con [data-model](data-model.md) y actualizar `backend/src/shared/persistence/db-types.ts`. La migración crea:
  - `assistant_quota` (clave `tenant_id, scope, subject_id, day`);
  - `assistant_question`, sin columnas de texto;
  - `rlsPorTenant` en las dos, los `CHECK` y los permisos de `barberias_app`, sin `BYPASSRLS`.

  Registrar `0031_asistente` en `backend/migrations/index.ts`. Con eso cambia `ULTIMA_MIGRACION`, que comprueba `GET /salud/listo`, igual que con cada migración anterior.
- [X] T009 [P] Crear la interfaz pública de M02 (research R01). Sin cambiar ninguna ruta ni caso de uso existente:
  - `m02/catalogo-citas-api.ts`: clase abstracta con los siete métodos de T004;
  - `m02/catalogo/application/catalogo-citas-api-impl.ts`:
    - inyecta `FuenteDisponibilidad` (la fuente autenticada que ya provee el módulo) y llama a `ConsultarHorarios.ejecutar(fuente, zona, consulta)`;
    - la zona sale de `BarberiasApi.configuracionAgenda()` y el slug de `BarberiasApi.datosPublicos(tenant)`;
    - **solo devuelve datos públicos** y no pasa por la autorización de M02: el permiso lo da la matriz de M04 (research R01);
  - un método nuevo `serviciosActivosPublicos()` en el puerto `CatalogQuery` y en `KyselyCatalogQuery`: servicios activos con nombre, precio, duración y descripción. No se toca ningún método existente;
  - `m02/citas/infrastructure/reportes-de-citas-query.ts`: agregados por `starts_at` sobre el índice `appointment(tenant_id, starts_at)`;
  - el proveedor se registra en `m02/catalogo-citas.module.ts`, se agrega a sus `exports` y la interfaz se exporta en `m02/index.ts`.
- [X] T010 [P] Crear el esqueleto de M04:
  - `m04/asistente-reportes.module.ts` y `m04/index.ts`, que exporta `AsistenteReportesModule` y `PermisosAsistenteReportes`;
  - `m04/asistente/domain/permisos.ts` (contracts/rbac.md):
    - `USAR_ASISTENTE`, la operación de la ruta, para CLIENTE y PROPIETARIO;
    - `USAR_ASISTENTE_CLIENTE` para CLIENTE y `USAR_ASISTENTE_PROPIETARIO` para PROPIETARIO, que exige el caso de uso;
    - `VER_REPORTES` para PROPIETARIO;
  - en `backend/src/host/roles.guard.ts`, sumar la matriz como una rama más de `rolPermiteOperacion`, igual que las de M01, M02 y M03. La lógica del guardia no cambia: una operación por ruta;
  - los controladores de M04 usan `RequiereOperacion` y `ActorActual` de `shared`, como M03, sin importar M01;
  - importar el módulo en `backend/src/host/app.module.ts`;
  - agregar las reglas de T003 a `backend/.dependency-cruiser.cjs`.
- [X] T011 [P] Crear el puerto y los adaptadores sin red:
  - `asistente/application/ports/ai-provider.ts`: `AIProvider` con `interpretar` y el error `ProveedorIANoDisponible`;
  - `asistente/infrastructure/proveedor-ia-falso.ts`: los modos de prueba se fijan desde la prueba, y el de demostración sale de `IA_FALSO_MODO` al arrancar. No hay ruta HTTP ni archivo para cambiarlo;
  - `asistente/infrastructure/proveedor-ia-ninguno.ts`, que siempre lanza `ProveedorIANoDisponible`;
  - las variables `IA_*` en `backend/src/shared/config/configuracion.ts`, con la validación de T006;
  - `backend/.env.example` con `IA_OPENROUTER_LLAVE=` vacía y un comentario de que la llave nunca entra al repositorio;
  - comprobar con `git check-ignore` que `.env` sigue fuera del repositorio;
  - las acciones `ASISTENTE_CONSULTADO` y `REPORTES_CONSULTADOS` en `backend/src/shared/audit/audit-log.ts` (research R13).
- [X] T012 [P] Sumar a `x-backend` de `docker-compose.yml`, solo variables nuevas (quickstart §2; ADR-027):
  - `IA_PROVEEDOR: ${IA_PROVEEDOR:-falso}`;
  - `IA_CUOTA_USUARIO_DIA: ${IA_CUOTA_USUARIO_DIA:-20}` e `IA_CUOTA_BARBERIA_DIA: ${IA_CUOTA_BARBERIA_DIA:-200}`;
  - `IA_FALSO_MODO: ${IA_FALSO_MODO:-normal}`;
  - un comentario: OpenRouter no se usa en Compose, porque las réplicas corren con `NODE_ENV: production` y la guardia de ADR-027 lo impide. La prueba real se hace con `npm run start:dev` y el `.env` local.

  Comprobar que `docker compose config` es válido y que el resto de los servicios no cambia.
- [ ] T013 Cierre de fase 1: suite completa del backend (incluido `npm run test:arch`), del frontend y CI en verde (`.github/workflows/plataforma-barberias.yml`). Commit: `feat(005): base del asistente y reportes (fase 1)`

**Checkpoint**: tablas con RLS probadas, `CatalogoCitasApi` de solo lectura, M04 enlazado con su matriz de permisos y el proveedor falso en verde; ninguna ruta nueva todavía.

---

## Fase 2: User Story 2 - El propietario ve sus reportes (Priority: P1)

**Goal**: el propietario elige un período en la zona horaria de su barbería y ve tres tablas: citas por estado, servicios más solicitados y actividad. Todo sin depender del proveedor de IA.

**Independent Test**: spec.md US2 ("Independent Test").

### Pruebas de US2 (escribir primero, deben fallar) ⚠️

- [X] T014 [P] [US2] Crear `backend/test/unit/reportes/periodo.spec.ts` (FR-020; data-model):
  - `desde` y `hasta` son fechas locales inclusivas;
  - hasta 366 días se acepta y 367 se rechaza;
  - `desde > hasta` y las fechas inválidas se rechazan con el campo a corregir;
  - el período se convierte a instantes con `ZonaHoraria` de M06: desde el inicio del día `desde` hasta el inicio del día siguiente a `hasta`, en America/Lima.
- [X] T015 [P] [US2] Crear `backend/test/integration/reportes/reportes.spec.ts` sobre un conjunto de citas sembradas (US2-1 a US2-5; FR-020–FR-024, FR-026; SC-005):
  - citas: el total y el desglose por estado, con cuántas canceladas fueron tardías;
  - servicios más solicitados: ordenados de más a menos citas no canceladas, hasta 10, con el nombre que tenía la cita al reservarse (`service_name`, FR-022), aunque el servicio se haya renombrado después, y desempate por nombre;
  - actividad: citas por barbero y por día de la semana, cancelaciones tardías y no asistencias;
  - bordes: una cita a las 00:00 y otra a las 23:59 de Lima entran, y una a las 00:00 del día siguiente no;
  - 367 días → 422 `VALIDACION` con el campo;
  - la respuesta no tiene nombres, teléfonos ni correos de clientes;
  - un período sin citas → 200 con las tablas en cero, no un error (US2-6);
  - con la suscripción VENCIDA responde igual, porque las lecturas no se restringen en ningún estado (contracts/restricciones-estado.md de 003; caso de borde de spec.md);
  - con `IA_PROVEEDOR=ninguno` responde igual.
- [X] T016 [P] [US2] Crear `backend/test/integration/reportes/aislamiento-reportes.spec.ts` con dos barberías sembradas. Con el token de A, aunque la solicitud traiga un `tenant`, un slug o una cabecera de B, las cifras son solo las de A (PR09; FR-025; SC-006).
- [X] T017 [P] [US2] Crear `backend/test/contract/rbac-005.spec.ts` con las filas de `GET /reportes` de [contracts/rbac.md](contracts/rbac.md) y `backend/test/contract/reportes.contract.spec.ts` contra [contracts/openapi.yaml](contracts/openapi.yaml) (PR08; FR-019):
  - PROPIETARIO → 200;
  - BARBERO y CLIENTE → 403;
  - sin sesión → 401;
  - el token de plataforma → 401 (rbac.md, ADR-031).
- [X] T018 [P] [US2] Crear `backend/test/integration/reportes/reportes-auditoria.spec.ts`. Cada consulta deja `REPORTES_CONSULTADOS` con el actor y `reportes:<desde>..<hasta>`, y nada más (FR-029).
- [X] T019 [P] [US2] Crear `backend/test/integration/escalado/reportes-periodo.spec.ts`. El reporte de un mes con el volumen sembrado de research responde en ≤ 2 s, y el de 366 días también responde (SC-005). Si solo falla por tiempo, se repite sola, como las demás de `escalado`.
- [X] T020 [P] [US2] Crear `frontend/test/reportes.spec.tsx` (US2; FR-020, FR-024; constitución, accesibilidad):
  - el período se elige con dos fechas etiquetadas, y por defecto es el mes en curso;
  - se ven las tres tablas, con encabezados y sin gráficos;
  - el error de período muestra el mensaje junto al campo, anunciado con `aria-live`;
  - un período sin citas muestra el estado vacío;
  - la ruta `/app/reportes` solo aparece para PROPIETARIO.

### Implementación de US2

- [X] T021 [US2] Crear el dominio y la aplicación de los reportes (FR-020–FR-026):
  - `reportes/domain/periodo.ts` y `reportes/domain/reportes.ts` (la forma de las tres tablas);
  - `reportes/application/consultar-reportes.ts`, que lee solo por `CatalogoCitasApi`, dentro de `UnitOfWork.ejecutar(tenant, …)`, y deja `REPORTES_CONSULTADOS`.
- [X] T022 [US2] Crear `reportes/presentation/reportes.controller.ts` con `GET /reportes?desde=&hasta=` y el permiso `VER_REPORTES`, según contracts/openapi.yaml, y registrarlo en `m04/asistente-reportes.module.ts`.
- [X] T023 [P] [US2] Crear la pantalla de reportes:
  - `frontend/src/api/reportes.ts`;
  - `frontend/src/pages/panel/Reportes.tsx` (con su `.module.css` y tokens de tema);
  - la ruta `/app/reportes` en `frontend/src/routes.tsx`;
  - la entrada "Reportes" para PROPIETARIO en `frontend/src/components/app/DisenoApp.tsx`.
- [ ] T024 [US2] **Del responsable:**
  - revisar `/app/reportes` a 360 px y en escritorio, en los temas claro y oscuro, solo con teclado y con axe DevTools (0 errores graves);
  - medir en Docker Compose el tiempo del reporte de un mes (SC-005).
- [ ] T025 [US2] Cierre de fase 2: suite completa del backend (incluido `npm run test:arch`), del frontend y CI en verde. Commit: `feat(005): reportes del propietario (fase 2, US2)`

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

- [X] T026 [P] [US1] Crear `backend/test/unit/asistente/intencion.spec.ts` (FR-001, FR-003, FR-006; contracts/asistente.md §2):
  - el esquema es cerrado: una intención fuera de la lista → `fuera_de_alcance`;
  - los argumentos que no están en el esquema se descartan y llevan a `fuera_de_alcance`;
  - un campo de texto del modelo se ignora;
  - cada rol tiene su lista de herramientas: el cliente solo `servicios`, `barberos` y `horarios_libres`;
  - una intención de otro rol → `fuera_de_alcance`.
- [X] T027 [P] [US1] Crear `backend/test/unit/asistente/resolver-argumentos.spec.ts` (FR-014, FR-017):
  - "hoy", "mañana" y los días de la semana se resuelven en la zona horaria de la barbería, también cerca de la medianoche de Lima;
  - una fecha inválida, como `2026-13-45`, → `SIN_DATOS` con la explicación;
  - el servicio y el barbero se buscan solo en el catálogo de la barbería, por nombre sin tildes ni mayúsculas;
  - si hay más de uno, se piden las opciones;
  - una fecha pasada → mensaje claro.
- [X] T028 [P] [US1] Crear `backend/test/unit/asistente/plantillas.spec.ts` (FR-001, FR-014, FR-018; contracts/asistente.md §3):
  - cada plantilla muestra solo los datos que recibe y dice la fecha exacta usada;
  - el enlace es `/b/{slug}/reservar?servicio=&barbero=&inicio=`, y no aparece si la barbería no acepta reservas (`SuscripcionesApi.estadoOperativo`);
  - sin datos, la respuesta es "no tengo ese dato" y ofrece el flujo manual.
- [X] T029 [P] [US1] Crear `backend/test/unit/asistente/politica-cuota.spec.ts` (FR-007; research R08):
  - `day` es la fecha local de la barbería;
  - `reiniciaEn` es la próxima medianoche local;
  - `Retry-After` va en segundos;
  - los límites salen de la configuración.
- [X] T030 [P] [US1] Crear `backend/test/unit/asistente/entrada.spec.ts` para `asistente/domain/entrada.ts`, la validación que corre **dentro del caso de uso** (FR-012, FR-013; contracts/asistente.md §1):
  - una pregunta vacía, solo con espacios o de más de 500 caracteres → `VALIDACION`;
  - un contexto de más de 6 intervenciones → `VALIDACION` (no se recorta en silencio);
  - cada intervención tiene `de` en `USUARIO` o `ASISTENTE` y `texto` de hasta 500 caracteres; otro valor → `VALIDACION`.
- [X] T031 [P] [US1] Crear `backend/test/integration/asistente/asistente-cliente.spec.ts` con el proveedor falso en modo normal (US1-1 a US1-5; FR-001, FR-013, FR-017, FR-018; SC-001, SC-008):
  - los precios, duraciones, barberos y horas de las respuestas son el **100 %** iguales a los de `CatalogoCitasApi` y `ConsultarHorarios` para esa consulta;
  - los horarios salen con **una sola pregunta**;
  - aparece el enlace a Reservar con los datos elegidos;
  - con la suscripción VENCIDA, el asistente sigue respondiendo con los datos del catálogo y los horarios (lecturas sin restricción en 003), pero **no** ofrece el enlace a Reservar (`aceptaReservas = false`, FR-018; caso de borde de spec.md);
  - una pregunta vacía, de 501 caracteres o con 7 intervenciones de contexto → 422 `VALIDACION` sin consumir cuota;
  - el conteo de citas es igual antes y después.
- [X] T032 [P] [US1] Crear `backend/test/integration/asistente/pr19-adversarial.spec.ts` con los **12 casos** de [contracts/asistente.md §5](contracts/asistente.md), cada uno en los modos **normal** y **`guion`**: 24 corridas (PR19; FR-001, FR-003–FR-006, FR-009, FR-011; SC-002). En cada corrida se comprueban:
  - el resultado esperado;
  - 0 datos de otra barbería o de otros clientes;
  - 0 escrituras: los conteos de citas, adelantos, usuarios y catálogo no cambian;
  - 0 texto del modelo en la respuesta;
  - lo que recibió el falso no contiene el catálogo, nombres de clientes ni datos de otra barbería;
  - `assistant_question` sin texto.

  En esta fase, el caso 9 (propietario) espera 403, porque US3 todavía no existe. La fase 4 lo cambia por su resultado final.
- [X] T033 [P] [US1] Crear `backend/test/integration/asistente/cuotas-asistente.spec.ts`, con los límites bajados por configuración (FR-007; SC-004):
  - al llegar al límite por usuario, la siguiente → 429 `CUOTA_ASISTENTE_AGOTADA` con `Retry-After`, y `alcance`, `reiniciaEn` y `reintentarEnSegundos` en `detalles[0]`;
  - lo mismo con el límite por barbería y dos clientes;
  - **dos instancias de la aplicación** reciben a la vez más preguntas que la cuota: nunca se pasa del límite y 0 × 5xx;
  - las dos cuotas se suman en una transacción corta que confirma **antes** de llamar al proveedor: si una falla, ninguna sube;
  - la pregunta rechazada por cuota queda registrada (`CUOTA_AGOTADA`) en una transacción propia, aunque la de la cuota se revierta;
  - la unidad se devuelve si el proveedor falla;
  - cerrar sesión no reinicia la cuota;
  - a la medianoche local, con el reloj controlado, se reinicia.
- [X] T034 [P] [US1] Crear `backend/test/integration/asistente/degradacion-asistente.spec.ts` (PR06; FR-008, FR-026; SC-003; research R11). Casos:
  - con el falso en `caido`, `lento` (mayor que el tiempo límite), `error(500)`, `error(429)` (un reintento dentro del presupuesto) e `invalido`;
  - con el interruptor de M06 abierto tras 5 fallas en 60 s;
  - **10 preguntas simultáneas de la misma barbería** con el falso en `lento`: ninguna espera a otra (la llamada al proveedor va fuera de toda transacción y no retiene la fila de la cuota), cada una responde en ≤ 3 s y al final el `used` de la barbería vuelve al valor inicial.

  En cada caso:
  - 503 `ASISTENTE_NO_DISPONIBLE`, con `alternativa` en `detalles[0]`, en **≤ 3 s** medidos desde la solicitud;
  - la unidad de cuota se devuelve en su propia transacción corta;
  - durante la falla, `GET /reportes` y el catálogo público responden igual.
- [X] T035 [P] [US1] Crear `backend/test/integration/asistente/registro-asistente.spec.ts` (FR-010, FR-029; SC-007):
  - cada pregunta deja una fila en `assistant_question` con el usuario, el rol, la intención, el resultado, la duración y los tokens. Se prueba cada uno de los siete resultados de data-model §2: `RESPONDIDA`, `SIN_DATOS`, `FUERA_DE_ALCANCE`, `ACCION_NO_PERMITIDA`, `CUOTA_AGOTADA`, `PROVEEDOR_NO_DISPONIBLE` e `INVALIDA`;
  - una pregunta de 501 caracteres queda como `INVALIDA`, sin consumir cuota (la valida el caso de uso, no el DTO);
  - la auditoría tiene `ASISTENTE_CONSULTADO` con `asistente:<rol>;<resultado>`;
  - una pregunta con un texto marcador no deja ese texto en la tabla, la auditoría ni los registros capturados de la aplicación;
  - la llave de prueba tampoco aparece en ninguno de ellos.
- [X] T036 [P] [US1] Crear `backend/test/integration/asistente/aislamiento-asistente.spec.ts` con dos barberías sembradas, con nombres de servicio y de barbero distintos (PR09; FR-004; SC-006). Con el token de un cliente de A:
  - ninguna respuesta trae datos de B, aunque el mensaje nombre a B o el cuerpo traiga un `tenant`;
  - la cuota de A no cambia la de B.
- [X] T037 [P] [US1] Ampliar `backend/test/contract/rbac-005.spec.ts` con `POST /asistente/mensajes` (PR08, PR20; FR-003, FR-015, FR-016; contracts/rbac.md):
  - la ruta exige `USAR_ASISTENTE`: CLIENTE de la barbería → 200; BARBERO → 403 en el guardia;
  - PROPIETARIO → pasa el guardia, y el caso de uso responde 403 hasta la fase 4;
  - sin sesión y con el token de plataforma → 401.

  Además:
  - crear `backend/test/contract/asistente.contract.spec.ts` contra contracts/openapi.yaml, con 200, 422, 429 (`ErrorCuota`, datos en `detalles[0]`) y 503 (`ErrorNoDisponible`, `alternativa` en `detalles[0]`). Los cuerpos tienen solo `codigo`, `mensaje` y `detalles`, como todos los errores;
  - crear `backend/test/contract/ai-provider-openrouter.contract.spec.ts`, que corre la suite de T005 contra OpenRouter y **se omite sin `IA_OPENROUTER_LLAVE`**, como `gateway-sandbox` en 003.
- [X] T038 [P] [US1] Crear `frontend/test/asistente.spec.tsx` (US1; FR-007, FR-008, FR-012, FR-013, FR-018; constitución, accesibilidad):
  - enviar una pregunta y ver la respuesta en una región `aria-live`;
  - un contador de 500 caracteres;
  - una pregunta vacía no se envía;
  - la cuota agotada muestra la hora de reinicio (`detalles[0].reiniciaEn`) y el enlace a Reservar;
  - "no disponible" muestra la alternativa manual (`detalles[0].alternativa`);
  - el enlace de horarios lleva a Reservar con los parámetros;
  - al recargar, la conversación empieza de nuevo;
  - solo el CLIENTE con sesión ve `/asistente`.
- [X] T039 [P] [US1] Crear `frontend/test/enlace-asistente.spec.tsx` (FR-016, FR-030):
  - "Preguntar al asistente" aparece en `MisCitas.tsx` y en `CatalogoPublico.tsx` solo con sesión de CLIENTE en esa barbería;
  - no aparece para un visitante sin sesión, un PROPIETARIO ni un BARBERO;
  - el resto de esas dos pantallas no cambia: sus pruebas existentes (`frontend/test/`) pasan sin tocarlas, y la prueba nueva comprueba que, sin sesión de cliente, el contenido es el mismo que antes del enlace.

### Implementación de US1

- [X] T040 [US1] Crear el dominio de `asistente/domain/`: `intencion.ts`, `herramientas.ts`, `plantillas.ts`, `politica-cuota.ts`, `entrada.ts` y `errores.ts`.
  - `intencion.ts`: el esquema cerrado de contracts/asistente.md §2;
  - `herramientas.ts`: la lista por rol;
  - `plantillas.ts`: las plantillas de §3;
  - `entrada.ts`: la validación de T030;
  - `errores.ts`:
    - `CuotaAsistenteAgotada` (429): `detalles[0]` con `alcance`, `reiniciaEn` y `reintentarEnSegundos`, que el filtro ya convierte en `Retry-After`;
    - `AsistenteNoDisponible` (503): `detalles[0]` con `alternativa`.

  En `backend/src/host/error.filter.ts` solo se suman `CUOTA_ASISTENTE_AGOTADA: 429` y `ASISTENTE_NO_DISPONIBLE: 503` en `ESTADO_POR_CODIGO`. El cuerpo sigue siendo `{codigo, mensaje, detalles}`.
- [X] T041 [P] [US1] Crear los puertos `asistente/application/ports/cuotas.ts` y `ports/registro.ts`, y sus adaptadores (research R08):
  - `asistente/infrastructure/kysely-cuotas.ts`: `INSERT … ON CONFLICT DO UPDATE SET used = used + 1 WHERE used < limite RETURNING` para los dos ámbitos en la misma transacción, y `devolver`;
  - `asistente/infrastructure/kysely-registro.ts`: inserta sin texto.
- [X] T042 [US1] Crear `asistente/application/preguntar-al-asistente.ts` con el flujo de contracts/asistente.md §1 y sus **tres tramos** (FR-001–FR-014; research R08):
  1. exigir la operación del rol (`USAR_ASISTENTE_CLIENTE` o `USAR_ASISTENTE_PROPIETARIO`) y validar la entrada con `entrada.ts`. Si no es válida → registro `INVALIDA` en una transacción propia y 422, sin cuota;
  2. **tramo 1:** una transacción corta con el tenant del token que lee la zona horaria y suma las dos cuotas, y **confirma**. Si alguna está agotada, se revierte, se registra `CUOTA_AGOTADA` en una transacción propia (`ejecutarAparte`) y se responde 429;
  3. **tramo 2, fuera de toda transacción:** `AIProvider.interpretar` con el tiempo límite, un reintento ante 429 o 5xx dentro del presupuesto de 3 s y el `Interruptor` de M06;
  4. **tramo 3:** otra transacción con el tenant del token:
     - si el proveedor respondió: validar la intención contra la lista del rol, resolver los argumentos, llamar a la herramienta por `CatalogoCitasApi`, los reportes o `SuscripcionesApi`, componer con la plantilla, y registrar y auditar;
     - si falló: devolver la unidad de cuota, registrar `PROVEEDOR_NO_DISPONIBLE`, auditar y responder 503.

  Al proveedor solo le envía la pregunta, el contexto mínimo, la fecha y la zona horaria, nunca el catálogo ni los resultados de las herramientas.
- [X] T043 [US1] Crear `asistente/presentation/asistente.controller.ts` con `POST /asistente/mensajes`, según contracts/openapi.yaml:
  - la ruta lleva `@RequiereOperacion('USAR_ASISTENTE')`; el permiso por rol lo exige el caso de uso (T042);
  - el DTO no valida el largo ni la cantidad de intervenciones, para que la pregunta inválida llegue al caso de uso y quede registrada como `INVALIDA`;
  - en `m04/asistente-reportes.module.ts`, enlazar el `AIProvider` según `IA_PROVEEDOR` (`falso`, `openrouter` o `ninguno`);
  - el caso de uso responde 403 al PROPIETARIO hasta la fase 4.
- [X] T044 [P] [US1] Crear `asistente/infrastructure/proveedor-ia-openrouter.ts`, **solo para desarrollo** (ADR-027; FR-015):
  - usa `fetch` nativo con `AbortSignal.timeout`, una sola llamada con esquema JSON y las instrucciones de contracts/asistente.md §4;
  - la llave sale de `IA_OPENROUTER_LLAVE` y nunca va a un registro;
  - la guardia de T006 impide arrancar con `NODE_ENV=production`, así que solo se usa fuera de Compose (`npm run start:dev` con el `.env` local);
  - no se agrega ninguna dependencia a `package.json`.
- [X] T045 [P] [US1] Crear la pantalla del asistente:
  - `frontend/src/api/asistente.ts`;
  - `frontend/src/pages/cliente/Asistente.tsx` (con su `.module.css` y tokens de tema), con la conversación solo en memoria y como máximo 6 intervenciones enviadas;
  - la ruta `/asistente` para CLIENTE en `frontend/src/routes.tsx`;
  - el cliente no tiene un menú global: el enlace "Preguntar al asistente" se suma en `frontend/src/pages/cliente/MisCitas.tsx` y en `frontend/src/pages/publico/CatalogoPublico.tsx`, visible solo con sesión de CLIENTE en esa barbería. No se cambia nada más de esas pantallas (T039).
- [ ] T046 [US1] **Del responsable:**
  - revisar `/asistente` y el enlace en Mis citas y en el catálogo a 360 px y en escritorio, en los temas claro y oscuro, solo con teclado, con lector de pantalla en la región de respuestas y con axe DevTools (0 errores graves);
  - hacer la **prueba con OpenRouter real fuera de Compose** (quickstart §2, paso 10): `npm run start:dev` en `backend/`, con `IA_PROVEEDOR=openrouter` y la llave solo en el `.env` local. Anotar la latencia medida y si las intenciones salieron bien;
  - medir en Compose el tiempo de "no disponible" con `IA_FALSO_MODO=caido` (SC-003).
- [ ] T047 [US1] Cierre de fase 3: suite completa del backend (incluido `npm run test:arch`), del frontend y CI en verde. La CI corre con `IA_PROVEEDOR=falso` y sin llave. Commit: `feat(005): asistente del cliente (fase 3, US1)`

**Checkpoint**: RF27 de punta a punta con el proveedor falso, PR19 en verde en los dos modos, las cuotas resisten dos instancias y la degradación queda en ≤ 3 s.

---

## Fase 4: User Story 3 - El propietario pregunta al asistente (Priority: P3)

**Goal**: el propietario pregunta "¿cuántas citas tuve este mes?" o "¿qué servicios piden más?" y recibe las mismas cifras que los reportes, sin datos de clientes. **Es lo primero que se recorta entero.**

**Independent Test**: spec.md US3 ("Independent Test").

### Pruebas de US3 (escribir primero, deben fallar) ⚠️

- [X] T048 [P] [US3] Crear `backend/test/integration/asistente/asistente-propietario.spec.ts` con el falso en modo normal (US3-1 a US3-4; FR-027, FR-028; SC-008):
  - `resumen_citas` y `servicios_mas_pedidos` dan **exactamente** las cifras de `GET /reportes` para el mismo período, con una sola pregunta;
  - "este mes" y "la semana pasada" se resuelven en la zona horaria y la respuesta dice el período usado;
  - más de 366 días → mensaje claro;
  - ninguna respuesta trae nombres, teléfonos ni correos de clientes;
  - las intenciones del cliente pedidas por el propietario → `fuera_de_alcance`.
- [X] T049 [P] [US3] Ampliar `backend/test/integration/asistente/pr19-adversarial.spec.ts` (PR19; FR-009, FR-028):
  - el caso 9 pasa de 403 a su resultado final de contracts/asistente.md §5: argumento descartado, `FUERA_DE_ALCANCE`, ningún nombre ni correo, en los dos modos;
  - los casos 1, 8 y 12 siguen dando `FUERA_DE_ALCANCE` para el CLIENTE.
  - Hecho: además, cada uno de los 12 casos se corre con los dos roles en los dos modos (48 corridas).
- [X] T050 [P] [US3] Ampliar `backend/test/contract/rbac-005.spec.ts` y `backend/test/integration/asistente/cuotas-asistente.spec.ts` (PR08; FR-003, FR-007, FR-027):
  - el PROPIETARIO → 200 en `POST /asistente/mensajes`, y el BARBERO sigue en 403;
  - las preguntas del propietario cuentan en su cuota de usuario y en la de la barbería.
  - Hecho: además, casos del propietario en `degradacion-asistente.spec.ts` (503 con las tablas en ≤ 3 s), `registro-asistente.spec.ts` (los siete resultados, sin texto) y `aislamiento-asistente.spec.ts` (solo las citas de su barbería).
- [X] T051 [P] [US3] Crear `frontend/test/reportes-preguntar.spec.tsx`. La pestaña "Preguntar" de `/app/reportes`:
  - envía la pregunta y muestra la respuesta en `aria-live`;
  - muestra los mensajes de cuota y de "no disponible", con la alternativa de las tablas;
  - las tablas siguen funcionando si el asistente falla.
  - Hecho en `frontend/test/pages/reportes-preguntar.spec.tsx`, junto a las demás pruebas de pantallas.

### Implementación de US3

- [X] T052 [US3] Agregar `resumen_citas` y `servicios_mas_pedidos` (FR-027, FR-028):
  - al esquema de `asistente/domain/intencion.ts`, a la lista del PROPIETARIO en `herramientas.ts` y a sus plantillas en `plantillas.ts`;
  - las herramientas llaman a `ConsultarReportes`, el mismo caso de uso de la fase 2, a través de la interfaz que exponga el submódulo `reportes` dentro de M04;
  - quitar el 403 del PROPIETARIO en `asistente/application/preguntar-al-asistente.ts`. El controlador y el guardia no cambian.
  - Hecho: el cálculo de `ConsultarReportes` pasó a `reportes/application/cifras-del-periodo.ts` (`CifrasDelPeriodo`), que usan los dos, expuesto en `reportes/index.ts`. El asistente no llama a `ConsultarReportes` entero porque abre su propia transacción, lee la barbería (lo que no se puede dentro del tramo 3) y audita `REPORTES_CONSULTADOS`.
- [X] T053 [P] [US3] Agregar la pestaña "Preguntar" a `frontend/src/pages/panel/Reportes.tsx`, reutilizando la conversación de `Asistente.tsx` como componente compartido en `frontend/src/components/app/`.
- [X] T054 [US3] Comprobar que `reportes-sin-ia` sigue en verde: el asistente usa `reportes/`, pero `reportes/` no importa nada de `asistente/`.
- [ ] T055 [US3] **Del responsable:** revisar la pestaña "Preguntar" a 360 px y en escritorio, en los temas claro y oscuro, solo con teclado y con axe DevTools (0 errores graves). Pendiente:
  - la pestaña "Preguntar" de `/app/reportes` a 360 px y en escritorio;
  - los temas claro y oscuro;
  - solo con teclado (flechas entre pestañas, enviar, "Ver las tablas");
  - axe DevTools con 0 errores graves;
  - de paso, que `/asistente` del cliente se vea igual que antes (usa el mismo componente de conversación).
- [ ] T056 [US3] Cierre de fase 4: suite completa del backend (incluido `npm run test:arch`), del frontend y CI en verde. Commit: `feat(005): asistente del propietario (fase 4, US3)`

**Checkpoint**: RF28 con las mismas cifras que RF29 y PR19 completo con el caso 9 final.

---

## Fase 5: Cierre (documentación, suite completa y quickstart)

**Purpose**: dejar la documentación con el estado real de 005. **Solo lo construido pasa de "planificado" a "implementado"**, como en la fase 7 de 008. Si la fase 4 se recortó, RF28 y HU23 quedan como "planificado" y se dice por qué. Cada recorte se registra como desviación en `spec.md` y en la fila de 005 de `docs/trazabilidad.md`.

- [ ] T057 Recorrer `specs/005-asistente-ia-reportes/quickstart.md` §1 a §3 con Docker Compose y el proveedor falso, y anotar cada resultado medido. El paso 10 (OpenRouter, fuera de Compose) y los de §4 quedan como "pendiente del responsable" si no los hizo.
- [ ] T058 [P] Actualizar `docs/trazabilidad.md`:
  - en §4, la fila de 005: estado, pruebas PR06, PR08, PR09, PR14, PR19 y PR20, los totales medidos y las desviaciones por recorte, si las hubo;
  - HU22, HU23 y HU24 en §1;
  - una tabla §4.7 de componentes de 005 con su evidencia;
  - §5 si se tocó algún diagrama.
- [ ] T059 [P] Actualizar `docs/05-gestion/04-pruebas.md` y `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md`:
  - en `04-pruebas.md`: PR19 con los 12 casos × 2 modos y su resultado, PR06 de la IA con el tiempo medido, PR20 del puerto de IA (OpenRouter omitida en CI), §2.4 con los totales de la última corrida y una §2.7 de 005;
  - en `08-escenarios-atributos-calidad.md`: los escenarios del asistente y los reportes (EQ-06, EQ-12 y EQ-19), con la evidencia.
- [ ] T060 [P] Cambiar "planificado" por "implementado" **solo en lo construido** en:
  - `docs/01-analisis-de-sistema/03-requisitos-funcionales.md`: RF27, RF28, RF29 y el resumen;
  - `docs/01-analisis-de-sistema/02-historias-del-usuario.md`: HU22, HU23 y HU24;
  - `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`:
    - ADR-027 y ADR-028 implementados en lo construido;
    - **ADR-008 y ADR-012 pasan a "Aceptado" solo en lo construido por 005** (decisión del responsable del 2026-11-14), y se dice en ese mismo texto;
    - en ADR-012, las **métricas por proveedor** se declaran "no implementadas";
  - `docs/05-gestion/02-backlog-y-sprints.md`: la fila de 005, con la cuota por plan como evolución futura;
  - `docs/02-arquitectura-software/componentes-arquitectonicos.md`: M04 y la interfaz `CatalogoCitasApi` de M02;
  - `docs/02-arquitectura-software/multi-tenancy-y-datos.md`: `assistant_quota` y `assistant_question`;
  - `docs/03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md`: M04.
- [ ] T061 [P] Actualizar tres documentos de arquitectura:
  - `docs/02-arquitectura-software/api-rest.md`:
    - **reemplazar `GET /reportes/citas` por `GET /reportes`**, con sus tres tablas;
    - agregar `POST /asistente/mensajes` con 422, 429 y 503;
    - corregir la nota de M04: las herramientas son lecturas de `CatalogoCitasApi` y de los reportes con la barbería y el rol del usuario, no "las mismas operaciones de arriba";
  - `docs/02-arquitectura-software/seguridad-y-privacidad.md`: las filas RBAC de M04, la llave solo en el `.env` local, lo que se envía al proveedor, el registro sin texto y PR19;
  - `docs/02-arquitectura-software/tecnologias.md`: OpenRouter solo en desarrollo y ninguna dependencia nueva.
- [ ] T062 [P] Actualizar `tecnologia/plataforma-barberias/README.md` (funcionalidad 005, migración `0031`, pantallas `/asistente` y `/app/reportes`, variables `IA_*` con la llave fuera del repositorio, `IA_FALSO_MODO` en Compose y la prueba con OpenRouter solo con `npm run start:dev`) y el `README.md` raíz si cambia algún total.
- [ ] T063 **Del responsable:** confirmar las revisiones manuales y las mediciones de T024, T046 y T055 antes de marcarlas:
  - 360 px, escritorio, temas claro y oscuro, teclado y axe DevTools;
  - la prueba con OpenRouter real, fuera de Compose;
  - SC-003 y SC-005 en Compose.
- [ ] T064 Cierre de fase 5: suite completa del backend (incluido `npm run test:arch`) y del frontend, Prettier y CI en verde. Commit: `docs(005): cierre del asistente y reportes (fase 5)`

---

## Dependencies & Execution Order

- **Fase 1** no depende de nada y bloquea a todas.
- **Fase 2 (US2)** depende de la 1.
- **Fase 3 (US1)** depende de la 1. T034 usa `GET /reportes` para comprobar que la plataforma sigue respondiendo; si la fase 2 no existe, esa comprobación se hace con el catálogo público.
- **Fase 4 (US3)** depende de la 2 (usa `ConsultarReportes`) y de la 3 (usa el flujo del asistente).
- **Fase 5** al final.

Orden: 1 → 2 → 3 → 4 → 5. Si el plazo obliga a elegir entre US1 y US2, va primero **US1** (RF27 es _Must_; plan.md). Dentro de cada fase: pruebas (en paralelo, deben fallar) → dominio y puertos → casos de uso → rutas → interfaz → revisión manual → cierre.

### Paralelismo

- Fase 1: T001–T007 en paralelo; T009, T010, T011 y T012 en paralelo después de T008.
- Fase 2: T014–T020 en paralelo; T023 (frontend) en paralelo con T021–T022.
- Fase 3: T026–T039 en paralelo; T041 en paralelo con T040; T044 y T045 en paralelo con T042–T043.
- Fase 4: T048–T051 en paralelo; T053 (frontend) en paralelo con T052.
- Fase 5: T058–T062 en paralelo después de T057.

**Ejemplo (fase 3):**
1. T026 a T039 se escriben a la vez.
2. Luego T040 → T042 → T043, con T041 en paralelo a T040.
3. En paralelo con T042, T044 (OpenRouter) y T045 (frontend).

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
- PR19 con los 12 casos en los modos normal y `guion` (T032, T049);
- el aislamiento entre barberías (T001, T016, T036);
- la matriz de permisos por rol (T017, T037, T050);
- las cuotas atómicas con dos réplicas (T033);
- el registro sin texto y la auditoría sin contenido (T002, T018, T035);
- la degradación en ≤ 3 s (T034);
- las reglas de arquitectura y la prueba de solo lectura de `CatalogoCitasApi` (T003, T004);
- la guardia que impide OpenRouter en producción (T006).

| Fase | Indispensable | Línea de corte (lo primero que se recorta) |
| ---- | ------------- | ------------------------------------------ |
| 1 | Todo | — |
| 2 | `GET /reportes` con citas y servicios más solicitados, aislamiento, permisos y una pantalla mínima en tablas | La tabla de **actividad por día de la semana** (quedan por barbero, cancelaciones tardías y no asistencias). **Desviación de FR-023** |
| 3 | `POST /asistente/mensajes` con `servicios` y `horarios_libres`, cuotas, degradación, registro, PR19 y la pantalla | En orden:<br>1. el contexto de 6 intervenciones: cada pregunta va sola, y la validación de T030 sigue (más de 0 intervenciones → 422). **Desviación de la aclaración de FR-012**;<br>2. la intención `barberos`: los horarios ya dicen qué barberos atienden, y PR19 no cambia. **Desviación de FR-017**;<br>3. la prueba con OpenRouter real queda manual: T044 se construye, pero la suite de T037 se omite sin llave, como ya está previsto. |
| 4 | — (toda la fase es cortable) | **Se recorta entera**: el PROPIETARIO sigue con 403 del caso de uso, el caso 9 de PR19 queda con 403 (0 fugas igual), y RF28 y HU23 quedan "planificado". **Desviación de FR-027 y FR-028** |
| 5 | Trazabilidad, pruebas, `api-rest.md` con `GET /reportes` y los estados de RF27, RF29, HU22 y HU24 | El recorrido completo del quickstart con Compose (se hacen al menos §1 y §3) y la sección de `diseño-interno-de-modulos.md` |

**Orden de recorte si quedan menos de 2 días tras la fase 2:**
1. la fase 4 entera;
2. la tabla por día de la semana;
3. el contexto de 6 intervenciones;
4. la intención `barberos`.

Cada recorte aplicado se registra como **desviación** en `spec.md` (sección "Desviaciones", con el requisito afectado y el motivo) y en la fila de 005 de `docs/trazabilidad.md`.

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
| FR-001 | US1, US3 | T026, T028, T031, T032, T042 |
| FR-002 | US1, US3 | T003, T007, T009, T042, T052 |
| FR-003 | US1, US3 | T026, T032, T037, T048, T050 |
| FR-004 | US1 | T001, T032, T036, T042 |
| FR-005 | US1 | T004, T031, T032 |
| FR-006 | US1 | T026, T032 |
| FR-007 | US1, US3 | T029, T033, T041, T050 |
| FR-008 | US1 | T034, T042 |
| FR-009 | US1, US3 | T032, T048, T049 |
| FR-010 | US1 | T002, T030, T035, T041, T042 |
| FR-011 | US1 | T032, T042, T044 |
| FR-012, FR-013 | US1 | T030, T031, T038, T045 |
| FR-014 | US1 | T027, T028 |
| FR-015 | — | T005, T006, T011, T012, T037, T043, T044 |
| FR-016 | US1 | T037, T038, T039, T045 |
| FR-017, FR-018 | US1 | T009, T027, T028, T031, T038, T045 |
| FR-019 | US2 | T017, T022 |
| FR-020–FR-024 | US2 | T014, T015, T020, T021, T023 |
| FR-025 | US2 | T001, T016 |
| FR-026 | US2 | T003, T015, T034, T054 |
| FR-027, FR-028 | US3 | T048, T049, T052, T053 |
| FR-029 | US1, US2 | T011, T018, T035 |
| FR-030 | — | T004, T007, T009 (solo lecturas), T012 (solo variables nuevas), T039 (pantallas de 002 sin cambios), T013 (suite completa de 001–008 en verde) |
| SC-001 | US1 | T007, T031 |
| SC-002 | US1, US3 | T032, T049 |
| SC-003 | US1 | T034, T046 (medición en Compose) |
| SC-004 | US1 | T033 |
| SC-005 | US2 | T015, T019, T024 (medición en Compose) |
| SC-006 | US1, US2 | T016, T036 |
| SC-007 | US1 | T002, T035 |
| SC-008 | US1, US3 | T031, T048 |
| PR06 | US1 | T034 |
| PR08 | — | T017, T037, T050 |
| PR09 | — | T001, T002, T016, T036 |
| PR14 | — | T003, T004, T010, T054 |
| PR19 | US1, US3 | T032, T049 |
| PR20 | US1 | T005, T037 |
