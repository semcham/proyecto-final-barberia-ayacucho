# Tasks: Carga masiva de servicios y barberos

**Input**: documentos de diseño de `specs/011-carga-masiva-catalogo/` (plan.md, spec.md, research.md, data-model.md,
contracts/openapi.yaml, contracts/pantallas.md, quickstart.md)

**Prerequisites**: plan.md y spec.md (obligatorios); research.md, data-model.md, contracts/ y quickstart.md.

**Tests**: OBLIGATORIAS (principio X). En cada historia, las pruebas van primero y deben fallar por la razón correcta antes
de implementar. Incluyen aislamiento (PR09), arquitectura (PR14), concurrencia del cupo (como PR16) y auditoría (PR13).
Sin IA ni correo en esta funcionalidad. Docker solo con Testcontainers o en la copia `barberias-verificacion`; nunca
leer ni mostrar el `.env`.

**Organization**: por historia. **Ajuste del usuario (2026-11-25)**: los servicios típicos traen solo nombre y duración
sugerida; el precio queda vacío y la revisión marca "Falta el precio" (problema `falta`) hasta que se escriba.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: historia a la que pertenece (US1 a US3).
- **Del responsable**: tareas que solo hace el responsable humano (commits, revisiones). El agente no las marca.

## Path Conventions

Todas las rutas de código son relativas a `tecnologia/plataforma-barberias/` (principio XII): `backend/` y `frontend/`.
Las de documentación son relativas a la raíz del repositorio.

---

## Phase 1: Setup

**Purpose**: dejar listo el punto de partida sin cambiar comportamiento.

- [X] T001 Correr y anotar en verde la línea base antes de tocar nada: `npm run lint`, `npx tsc --noEmit`, `npm test`,
  `npm run test:int -- test/integration/catalogo` y `npm run test:arch` en `backend/`, y `npm run lint`,
  `npx tsc -b --noEmit` y `npx vitest run` en `frontend/`. Si alguna prueba es intermitente, correrla sola antes de tocar
  nada y anotarlo en `specs/011-carga-masiva-catalogo/tasks.md` (sección Notas).

---

## Phase 2: Foundational (bloquea las fases 3 a 5)

**Purpose**: reglas del dominio en un solo lugar, cupo para varios, tabla de cargas, auditoría y error nuevo. La creación
individual de servicios y barberos debe responder exactamente igual que antes.

### Pruebas de la base

- [X] T002 [P] Prueba unitaria de `problemasDeServicio` y `problemasDeBarbero` en
  `backend/test/unit/catalogo/problemas-por-campo.spec.ts`: devuelven **todos** los problemas de unos datos (nombre
  `longitud`, duración `rango` y `multiplo_de_5`, precio `formato`, descripción `longitud`) en el orden actual de las
  comprobaciones; datos válidos → lista vacía.
- [X] T003 [P] Prueba "ambos caminos iguales" (SC-005) en `backend/test/unit/catalogo/carga-igual-que-individual.spec.ts`:
  una tabla de casos (nombres de 1, 2, 80 y 81 caracteres con y sin espacios; duraciones 0, 4, 5, 7, 480, 485, 30.5;
  precios "25", "25.5", "25.50", "25.555", "-1", "100000", "abc"; descripción de 300 y 301) da en `Servicio.crear` el
  `DatoInvalido` igual al **primer** problema de `problemasDeServicio`, y lo mismo para `Barbero.crear`.
- [X] T004 [P] Prueba de `LimiteBarberos` con `nuevos` en `backend/test/unit/catalogo/catalogo-dominio.spec.ts` (bloque
  nuevo): con `nuevos` omitido se comporta como hoy (`activos < maximo`); con `nuevos = 3`, `activos + 3 <= maximo`;
  `exigir` lanza `LimiteBarberosAlcanzado` con `maximo`, `activos` y `solicitados` en los detalles.
- [X] T005 [P] Prueba de la migración en `backend/test/integration/aislamiento/rls.spec.ts` (agregar `catalog_batch` a la
  lista de tablas con RLS forzada) y prueba de permisos de `catalog_batch` en
  `backend/test/integration/catalogo/carga-lote-tabla.spec.ts`: `barberias_app` solo `SELECT` e `INSERT`; sin permisos
  para `barberias_publico`, `barberias_plataforma` ni el rol de conteos; el índice único
  `(tenant_id, author_user_id, idempotency_key)` rechaza la segunda fila; una barbería no ve las filas de otra.

### Implementación de la base

- [X] T006 Extraer `problemasDeServicio(datos)` en `backend/src/modules/catalogo-citas/catalogo/domain/servicio.ts`
  (lista de `{ campo, problema }` con todas las reglas actuales, en su orden) y hacer que `Servicio.crear` y `editar`
  lancen `DatoInvalido` con el primero de esa lista. Sin cambiar ninguna regla ni mensaje (T002, T003).
- [X] T007 Extraer `problemasDeBarbero({ nombre })` en `backend/src/modules/catalogo-citas/catalogo/domain/barbero.ts` y
  usarla en `Barbero.crear` y `renombrar` (T002, T003).
- [X] T008 [P] Agregar el parámetro `nuevos = 1` a `LimiteBarberos.puedeAgregar` y `exigir` en
  `backend/src/modules/catalogo-citas/catalogo/domain/limite-barberos.ts` (`activos + nuevos <= maximo`), y `activos` y
  `solicitados` opcionales en los detalles de `LimiteBarberosAlcanzado` en
  `backend/src/modules/catalogo-citas/catalogo/domain/errores.ts` (T004). `ReglasBarbero.exigirCupo` sigue igual.
- [X] T009 [P] Agregar `CargaInvalida` (`codigo = 'CARGA_INVALIDA'`, mensaje "Hay filas con errores. Corrígelas y vuelve a
  intentar.", detalles = `{ fila, campo, problema }[]`) en
  `backend/src/modules/catalogo-citas/catalogo/domain/errores.ts` y su estado 400 en `backend/src/host/error.filter.ts`.
- [X] T010 [P] Crear `backend/src/modules/catalogo-citas/catalogo/domain/carga-lote.ts` (puro): `MAX_FILAS_LOTE = 50`,
  tipos `FilaServicio`, `FilaBarbero`, `ProblemaDeFila`, `RevisionDeCarga`, y `revisarServicios(filas,
  nombresExistentes)` que, por fila, marca `precio: falta` si el precio está vacío o solo con espacios (y entonces no
  agrega `formato` para el precio), agrega los problemas de `problemasDeServicio` y los errores `nombre:
  repetido_en_carga` y `nombre: ya_existe` (comparación con `trim` y minúsculas). Las filas completamente vacías se
  descartan antes (data-model §2, research R02 y R03).
- [X] T011 [P] Prueba unitaria de `revisarServicios` en `backend/test/unit/catalogo/carga-lote.spec.ts`: precio vacío →
  solo `falta` (sin `formato`); precio "abc" → `formato`; repetidos dentro de la carga marcan las dos filas; nombre igual
  a uno existente (también inactivo y con otras mayúsculas) → `ya_existe`; filas vacías no cuentan; numeración de filas
  desde 1 según el orden enviado.
- [X] T012 Crear la migración `backend/migrations/0037_carga_lote.ts` con la tabla `catalog_batch` de
  `specs/011-carga-masiva-catalogo/data-model.md` §1 (columnas, `CHECK`, índice único `catalog_batch_idempotencia`, RLS
  habilitada y forzada con la política de tenant de `backend/migrations/sql-comun.ts`, `GRANT SELECT, INSERT` solo a
  `barberias_app`) y registrarla en `backend/migrations/index.ts`; actualizar los tipos en
  `backend/src/shared/persistence/db-types.ts` (T005).
- [X] T013 Puerto `CargaLoteRepository` (`buscar(autorId, clave)`, `guardar(carga)` que traduce la violación del índice
  único a `ClaveDeCargaEnUso`) en `backend/src/modules/catalogo-citas/catalogo/application/ports/catalogo-repositorios.ts`
  y su implementación en `backend/src/modules/catalogo-citas/catalogo/infrastructure/kysely-carga-lote-repository.ts`,
  registrada en el módulo de M02.
- [X] T014 [P] Agregar `SERVICIOS_CARGADOS_EN_LOTE` y `BARBEROS_CARGADOS_EN_LOTE` a `AccionAuditada` en
  `backend/src/shared/audit/audit-log.ts` (recurso `lote:<id>;cantidad=<n>`, sin nombres).
- [X] T015 Correr las pruebas actuales sin tocarlas: `backend/test/integration/catalogo/servicios.spec.ts`,
  `backend/test/integration/catalogo/barberos.spec.ts`, `backend/test/integration/suscripciones/limite-barberos.spec.ts` y
  `backend/test/contract/catalogo.contract.spec.ts` deben seguir en verde (la creación individual no cambió).

**Checkpoint**: base lista; las historias pueden empezar.

---

## Phase 3: User Story 1 - Cargar varios servicios a la vez (Priority: P1) 🎯 MVP

**Goal**: el propietario revisa y guarda de una vez hasta 50 servicios escritos, pegados o "típicos" (sin precio).

**Independent Test**: con una barbería sin servicios, pegar 10 filas, corregir los errores de la revisión y guardar:
aparecen los 10 en la lista y en el catálogo público, y el resumen dice "Se crearon 10 servicios". Con los típicos y sin
escribir precios, la revisión marca "Falta el precio" en cada fila y no deja guardar.

### Pruebas de US1

- [X] T016 [P] [US1] Prueba de contrato de `POST /servicios/lote/revision` y `POST /servicios/lote` contra
  `specs/011-carga-masiva-catalogo/contracts/openapi.yaml` en `backend/test/contract/carga-lote.contract.spec.ts`
  (formas de `Revision`, `ResumenCarga`, `CARGA_INVALIDA`; `Idempotency-Key` obligatoria; 0 y 51 filas → 400
  `VALIDACION`).
- [X] T017 [P] [US1] Prueba RBAC en `backend/test/contract/rbac-011.spec.ts`: las 2 rutas de servicios solo para
  `PROPIETARIO` (`GESTIONAR_SERVICIOS`); `BARBERO` y `CLIENTE` → 403 `ACCESO_DENEGADO` con `ACCESO_DENEGADO_ROL` en la
  auditoría; el token de la plataforma no sirve.
- [X] T018 [P] [US1] Integración en `backend/test/integration/catalogo/carga-lote-servicios.spec.ts`: (a) revisión sin
  guardar nada (la tabla `service` no cambia); (b) guardado de 10 filas válidas → 201 con `creados: 10` y los 10 en
  `GET /servicios` y en `GET /publico/{slug}`; (c) **todo o nada**: 49 válidas + 1 inválida → 400 `CARGA_INVALIDA` y 0
  creados; (d) nombre existente creado entre la revisión y el guardado → 409 `NOMBRE_DUPLICADO` y 0 creados; (e) 6 filas
  con precio vacío → 400 con 6 problemas `precio: falta`; (f) reintento con la misma `Idempotency-Key` → 200 con el
  mismo resumen y sin filas nuevas; misma clave con otras filas → 422 `IDEMPOTENCIA_CONFLICTO`; (g) suscripción vencida →
  403 `SUSCRIPCION_NO_PERMITE` y 0 creados; (h) auditoría `SERVICIOS_CARGADOS_EN_LOTE` con `cantidad=10`, y nada auditado
  en (c), (d) y (e).
- [X] T019 [P] [US1] Aislamiento (PR09) en `backend/test/integration/aislamiento/aislamiento-011.spec.ts`: con la sesión de
  la barbería A, una carga crea solo en A; un nombre que existe solo en B no da `ya_existe`; una `Idempotency-Key` usada
  en B no afecta a A; el cuerpo no acepta un campo de barbería (se rechaza o se ignora y el tenant sale del token).

### Implementación de US1 (backend)

- [X] T020 [US1] Agregar `nombresExistentes(nombres)` (minúsculas, activos e inactivos) y `crearVarios(servicios)`
  (inserción múltiple; la violación de `service_nombre_unico` sigue siendo `NombreDuplicado`) a `ServicioRepository` en
  `backend/src/modules/catalogo-citas/catalogo/application/ports/catalogo-repositorios.ts` y en
  `backend/src/modules/catalogo-citas/catalogo/infrastructure/kysely-catalogo-repositorios.ts`.
- [X] T021 [US1] Casos de uso `RevisarCargaServicios` y `CargarServicios` en
  `backend/src/modules/catalogo-citas/catalogo/application/carga-lote.ts`: `autorizacion.exigir(actor,
  'GESTIONAR_SERVICIOS')` → `uow.ejecutar(tenant)` → `suscripciones.exigirOperacion(tenant, 'CONFIGURAR_CATALOGO')` →
  `revisarServicios` con `nombresExistentes`. `CargarServicios` además: busca la clave en `CargaLoteRepository` (mismo tipo
  y misma huella → devuelve el resumen guardado; distinta → `IdempotenciaConflicto`), lanza `CargaInvalida` si hay
  errores, crea con `Servicio.crear` y `crearVarios`, guarda la carga (huella SHA-256 de las filas normalizadas), audita
  `SERVICIOS_CARGADOS_EN_LOTE` e invalida el catálogo público una vez. Si dos reintentos chocan en el índice
  (`ClaveDeCargaEnUso`), en una transacción nueva devuelve el resumen del primero (research R06).
- [X] T022 [US1] DTO en `backend/src/modules/catalogo-citas/catalogo/presentation/carga-lote.dto.ts` (`filas` con
  `ArrayMinSize(1)`, `ArrayMaxSize(50)`, `ValidateNested`; `precio` como texto que **puede venir vacío** para que la
  revisión lo marque como `falta`; `duracionMinutos` entero) y rutas `POST /servicios/lote/revision` (200) y
  `POST /servicios/lote` (201/200, cabecera `Idempotency-Key` UUID obligatoria) con `@OperacionM02('GESTIONAR_SERVICIOS')`
  en `backend/src/modules/catalogo-citas/catalogo/presentation/servicios.controller.ts` (rutas `lote` antes de `:id`).
- [X] T023 [US1] Pasar T016 a T019 y las pruebas de la base; ajustar sin debilitar ninguna aserción.

### Pruebas de US1 (frontend)

- [X] T024 [P] [US1] Prueba unitaria del pegado en `frontend/test/pegado-de-hoja.spec.ts`: tabulaciones y saltos `\r\n`;
  celdas entre comillas de Excel con tabulación o salto dentro; encabezado descartado; líneas vacías ignoradas;
  "S/ 25,50" → "25.50"; "30 min" → 30; columnas de más ignoradas y de menos vacías; tope de 50 con el número de filas que
  quedaron fuera; en barberos solo la primera columna.
- [X] T025 [P] [US1] Prueba de pantalla en `frontend/test/pages/carga-servicios.spec.tsx`: (a) "Agregar servicios típicos"
  agrega Corte, Barba, Corte y barba, Cejas, Corte para niños y Lavado con su duración y **el precio vacío**, sin
  llamadas de guardado; (b) "Revisar" sin precios muestra "Falta el precio" en cada una de esas filas y "Guardar"
  deshabilitado; (c) errores de la API junto a su campo (`aria-invalid`, `aria-describedby`) y el resumen con enlaces que
  llevan el foco al campo; (d) cambiar una celda invalida la revisión; (e) guardar envía la misma `Idempotency-Key` en el
  reintento tras un error de red y muestra "Se crearon N servicios"; (f) `NOMBRE_DUPLICADO` al guardar vuelve a revisar y
  marca la fila; (g) todo con el teclado; (h) un barbero no ve la ruta.

### Implementación de US1 (frontend)

- [X] T026 [P] [US1] Función pura `frontend/src/pages/panel/carga/pegado-de-hoja.ts` según
  `specs/011-carga-masiva-catalogo/contracts/pantallas.md` ("Pegado desde una hoja") (T024).
- [X] T027 [P] [US1] Lista fija `frontend/src/pages/panel/carga/servicios-tipicos.ts`: Corte 30, Barba 20, Corte y barba
  50, Cejas 10, Corte para niños 30, Lavado 10 (solo nombre y duración; **sin precio**).
- [X] T028 [P] [US1] Llamadas y tipos en `frontend/src/api/carga-lote.ts` (`revisarServicios`, `cargarServicios` con
  `Idempotency-Key`; textos de cada problema de `contracts/pantallas.md`, incluido `falta` → "Falta el precio: escríbelo
  en soles (por ejemplo 25 o 25.50).").
- [X] T029 [US1] Componente compartido `frontend/src/pages/panel/carga/TablaCarga.tsx` (+ `TablaCarga.module.css`):
  fichas con campos etiquetados a 360 px y tabla desde 48rem; agregar, quitar y editar filas; contador "N de 50";
  errores en rojo y advertencias en ámbar con ícono y texto; resumen de errores con enlaces; tokens de `tokens.css`, claro
  y oscuro.
- [X] T030 [US1] Pantalla `frontend/src/pages/panel/CargaServicios.tsx` (+ `.module.css`): "Agregar fila", "Agregar
  servicios típicos" (no repite nombres ya presentes; foco en el precio de la primera fila agregada), "Pegar desde una
  hoja", "Revisar", "Guardar" con la clave creada tras una revisión sin errores, confirmación al salir con filas escritas,
  resumen final y vuelta a `/app/servicios` con la lista invalidada.
- [X] T031 [US1] Ruta `servicios/agregar-varios` (solo `PROPIETARIO`) en `frontend/src/routes.tsx` y botón secundario
  "Agregar varios" en `frontend/src/pages/panel/Servicios.tsx` (oculto con la suscripción vencida, como "Nuevo servicio").
- [X] T032 [US1] Pasar T024 y T025 y toda la suite del frontend.

**Checkpoint**: US1 funciona sola (MVP). Corte posible aquí.

---

## Phase 4: User Story 2 - Cargar varios barberos a la vez (Priority: P2)

**Goal**: el propietario carga hasta 50 barberos (nombre y servicios activos), dentro del cupo del plan, con advertencias
por nombre repetido.

**Independent Test**: con cupo para 3 barberos más, cargar 3 con sus servicios y guardar: aparecen activos, sin usuario,
en la lista y en el catálogo público; con 4 filas la revisión dice "Quita 1 fila o cambia de plan" y el guardado no crea
ninguno.

### Pruebas de US2

- [ ] T033 [P] [US2] Prueba unitaria de `revisarBarberos` en `backend/test/unit/catalogo/carga-lote.spec.ts` (bloque
  nuevo): nombre corto → error `longitud`; servicio inexistente → `no_existe`; inactivo → `inactivo`; nombre repetido en
  la carga o con uno existente → **advertencia** (no error); más filas que `disponibles` → error de carga `fila: null`,
  `campo: 'filas'`, `problema: 'supera_cupo'`.
- [ ] T034 [P] [US2] Contrato y RBAC de `POST /barberos/lote/revision` y `POST /barberos/lote` en
  `backend/test/contract/carga-lote.contract.spec.ts` y `backend/test/contract/rbac-011.spec.ts` (solo `PROPIETARIO` con
  `GESTIONAR_BARBEROS`; `cupo` en la revisión).
- [ ] T035 [P] [US2] Integración en `backend/test/integration/catalogo/carga-lote-barberos.spec.ts`: (a) guardado dentro
  del cupo → barberos activos, `usuarioId` nulo y con sus servicios; (b) cupo superado → 403 `SUSCRIPCION_NO_PERMITE` con
  `LIMITE_BARBEROS`, `maximo`, `activos`, `solicitados` y 0 creados; (c) nombre repetido → se guarda (advertencia solo en
  la revisión); (d) servicio inactivo → 400 `CARGA_INVALIDA`; (e) idempotencia como en T018 (f); (f) suscripción vencida
  → 403 y 0 creados; (g) auditoría `BARBEROS_CARGADOS_EN_LOTE`; (h) aislamiento en
  `backend/test/integration/aislamiento/aislamiento-011.spec.ts` (servicios de otra barbería → `no_existe`).

### Implementación de US2 (backend)

- [ ] T036 [US2] `revisarBarberos(filas, nombresExistentes, serviciosActivos, cupo)` en
  `backend/src/modules/catalogo-citas/catalogo/domain/carga-lote.ts` usando `problemasDeBarbero` y
  `LimiteBarberos.puedeAgregar(activos, maximo, n)` (T033).
- [ ] T037 [US2] Agregar a `BarberoRepository` `nombres()` (minúsculas) y `crearVarios(barberos)` (inserciones de `barber`
  y `barber_service` en la misma transacción), y a `ServicioRepository` `activosDe(ids)`, en
  `backend/src/modules/catalogo-citas/catalogo/application/ports/catalogo-repositorios.ts` y
  `backend/src/modules/catalogo-citas/catalogo/infrastructure/kysely-catalogo-repositorios.ts`.
- [ ] T038 [US2] Casos de uso `RevisarCargaBarberos` y `CargarBarberos` en
  `backend/src/modules/catalogo-citas/catalogo/application/carga-lote.ts`, con `GESTIONAR_BARBEROS`, `exigirOperacion`,
  `SuscripcionesApi.obtenerLimiteBarberos(tenant)` (bloquea la fila de la suscripción hasta el final, **el mismo
  bloqueo** que `ReglasBarbero.exigirCupo`), `contarActivos`, `LimiteBarberos.exigir(activos, maximo, n)`,
  `Barbero.crear` sin usuario, `crearVarios`, carga guardada, auditoría e invalidación; idempotencia igual que T021.
  En la revisión, el cupo se lee sin bloquear.
- [ ] T039 [US2] Rutas `POST /barberos/lote/revision` y `POST /barberos/lote` con `@OperacionM02('GESTIONAR_BARBEROS')` en
  `backend/src/modules/catalogo-citas/catalogo/presentation/barberos.controller.ts` y DTO de `FilaBarbero` en
  `backend/src/modules/catalogo-citas/catalogo/presentation/carga-lote.dto.ts` (`servicioIds` UUID únicos, por defecto
  vacío).
- [ ] T040 [US2] Pasar T033 a T035.

### Frontend de US2

- [ ] T041 [P] [US2] Prueba de pantalla en `frontend/test/pages/carga-barberos.spec.tsx`: cupo visible ("Puedes agregar
  D"); pegar nombres; casillas de servicios activos y "Marcar todos los servicios"; advertencia ámbar de nombre repetido
  que deja guardar; error `supera_cupo` con "Quita X filas o cambia de plan"; sin servicios activos se puede guardar con
  el aviso; resumen "Se crearon N barberos"; teclado.
- [ ] T042 [US2] Pantalla `frontend/src/pages/panel/CargaBarberos.tsx` (+ `.module.css`) sobre `TablaCarga`, llamadas
  `revisarBarberos` y `cargarBarberos` en `frontend/src/api/carga-lote.ts`, ruta `barberos/agregar-varios` en
  `frontend/src/routes.tsx` y botón "Agregar varios" en `frontend/src/pages/panel/Barberos.tsx` (T041).

**Checkpoint**: US1 y US2 funcionan cada una por su lado.

---

## Phase 5: User Story 3 - Dos cargas a la vez no pasan el cupo (Priority: P2)

**Goal**: probar que el bloqueo compartido impide superar el cupo con cargas simultáneas.

**Independent Test**: con cupo para 3, dos cargas de 2 a la vez: exactamente una se guarda completa, 50 veces seguidas.

- [ ] T043 [US3] Prueba de concurrencia en `backend/test/integration/catalogo/carga-lote-concurrencia.spec.ts` (como
  `backend/test/integration/citas/concurrencia-reservas.spec.ts`): con cupo 3, dos `POST /barberos/lote` de 2 filas
  lanzados a la vez, repetido 50 veces (SC-003): siempre una 201 y una 403 `LIMITE_BARBEROS`, y `contarActivos` nunca
  pasa el máximo.
- [ ] T044 [US3] En el mismo archivo: una carga de 2 y una creación individual (`POST /barberos`) a la vez con cupo 2 → el
  total de activos nunca supera el máximo; y dos cargas de servicios con un nombre en común a la vez → una se guarda y la
  otra 409 `NOMBRE_DUPLICADO` sin crear nada.
- [ ] T045 [US3] Si T043 o T044 fallan, corregir el orden de los pasos en `CargarBarberos` (el bloqueo antes de contar)
  en `backend/src/modules/catalogo-citas/catalogo/application/carga-lote.ts`, sin agregar un bloqueo distinto.

**Checkpoint**: las tres historias funcionan.

---

## Phase 6: Polish & Cross-Cutting Concerns (cierre)

- [ ] T046 [P] Medición SC-004 en `backend/test/integration/catalogo/carga-lote-servicios.spec.ts` (bloque aparte): 50
  filas válidas guardadas en menos de 3 s en local; anotar el valor medido en `specs/011-carga-masiva-catalogo/quickstart.md`.
- [ ] T047 [P] Arquitectura: `npm run test:arch` en `backend/` sin reglas nuevas ni violaciones (M02 solo usa
  `SuscripcionesApi` de M03, como hoy).
- [ ] T048 Capturas con axe sobre el build de producción (no Vite) a 360 y 1440 px, claro y oscuro: carga vacía, típicos
  sin precio, revisión con "Falta el precio", errores, advertencias de barberos, cupo superado, lista para guardar y
  resumen; guardarlas en `evidencia/interfaz-carga-masiva/`, mirarlas, corregir y recapturar hasta axe 0 y sin desborde.
- [ ] T049 [P] Documentación: RF07 y RF08 ampliados con la carga en lote en
  `docs/01-analisis-de-sistema/03-requisitos-funcionales.md`; rutas nuevas en `docs/02-arquitectura-software/api-rest.md`;
  tabla `catalog_batch` en `docs/02-arquitectura-software/multi-tenancy-y-datos.md`; operaciones en la matriz RBAC de
  `docs/02-arquitectura-software/seguridad-y-privacidad.md`; filas nuevas en `docs/trazabilidad.md`.
- [ ] T050 Correr el quickstart completo (`specs/011-carga-masiva-catalogo/quickstart.md`) y, en `backend/` y
  `frontend/`, Prettier, lint, typecheck y todas las pruebas; anotar los resultados.
- [ ] T051 **Del responsable:** revisar a mano las pantallas a 360 px con datos reales (pegar desde su propia hoja de
  cálculo) y las duraciones sugeridas de los servicios típicos.
- [ ] T052 **Del responsable:** commit y push de la funcionalidad.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T015)** → historias.
- **US1 (T016–T032)**: solo depende de la base. Es el MVP.
- **US2 (T033–T042)**: depende de la base; reutiliza `TablaCarga`, `pegado-de-hoja` y `carga-lote.ts` del frontend de
  US1 (T026–T029). El backend de US2 no depende del de US1 salvo el archivo compartido `application/carga-lote.ts`.
- **US3 (T043–T045)**: depende del backend de US2 (T038–T039).
- **Polish (T046–T052)**: al final.

Dentro de cada historia: pruebas → dominio → repositorio → caso de uso → ruta → frontend.

## Parallel Opportunities

- Base: T002, T003, T004 y T005 juntas; luego T008, T009, T010, T011 y T014 juntas (archivos distintos); T006 y T007
  antes de T010.
- US1: T016, T017, T018 y T019 juntas; en el frontend, T024, T025, T026, T027 y T028 juntas.
- US2: T033, T034, T035 y T041 juntas.
- Cierre: T046, T047 y T049 juntas.

### Ejemplo (US1)

```text
Juntas: T016 contrato · T017 RBAC · T018 integración · T019 aislamiento
Luego: T020 repositorio → T021 casos de uso → T022 rutas
Juntas en el frontend: T026 pegado · T027 típicos sin precio · T028 API
Luego: T029 TablaCarga → T030 pantalla → T031 ruta y botón
```

## Implementation Strategy

1. **MVP**: Setup + base + US1 → validar el Independent Test de US1 (incluido "Falta el precio" con los típicos) →
   punto de corte posible.
2. **Incremento 2**: US2 (barberos con cupo y advertencias).
3. **Incremento 3**: US3 (prueba de concurrencia; casi sin código nuevo).
4. **Cierre**: medición, capturas, docs y quickstart.

## Notas

- **Implementación de las fases 1 a 3 (2026-11-25):** T001 en verde antes de empezar. En T018 (d), un nombre creado entre la
  revisión y el guardado responde **400 `CARGA_INVALIDA` con `ya_existe` en su fila** (el guardado repite la revisión dentro
  de la transacción); el 409 `NOMBRE_DUPLICADO` queda solo para la carrera real entre dos cargas simultáneas (índice único),
  que se prueba en US3. Se agregó el problema `vacia` (carga sin ninguna fila con datos) al contrato. En el frontend,
  `historial-pagos.spec.tsx` (prueba de tiempo frágil, ya listada en 009) falló una vez con la máquina cargada y pasó sola
  sin tocar nada. En el backend, `conciliacion.spec.ts` (también de la lista frágil de 009) falló una vez en la suite completa
  (2334 pasan) y pasó sola (8 de 8).

- La creación individual no cambia: si una prueba existente de servicios o barberos falla tras T006–T008, se corrige el
  código, no la prueba.
- Los servicios típicos **nunca** traen precio (ajuste del usuario del 2026-11-25).
- No leer ni mostrar el `.env`; sin commit, push ni `git stash` por parte del agente.
