---
description: "Tareas de la funcionalidad 007: indicadores y datos personales"
---

# Tasks: Indicadores y datos personales (007)

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/) y [quickstart.md](quickstart.md)

**Prerequisites**: spec aclarada (2026-11-15); plan con el Constitution Check en verde, con la condición del principio III para la fase 2c; correcciones del análisis de consistencia aplicadas (C1, H1 a H3, M1 a M9, L1, L2, L4 y L5; L3 queda como procedimiento en T067).

**Tests**: obligatorias (principio X). En cada fase, **primero las pruebas, que deben fallar**, y después la implementación. Todas las pruebas toman sus variables de `backend/test/helpers/entorno.ts` y de los entornos de cada prueba: **ninguna lee el `.env` del responsable**. No hay IA en 007; si una prueba levanta la aplicación completa, usa el proveedor de IA falso, como siempre (`entorno.ts`). Las pruebas existentes **se amplían sin quitar ninguna aserción**, salvo la de permisos de tabla de `lectura-plataforma` en la fase 2c (FR-021).

**Organization**:
- Seis fases y **una fase = un commit**: 1 (US1), 2a (enmienda y ADR), 2b (US2, barberías por estado), 2c (US2, citas y usuarios), 3 (US3) y 4 (cierre).
- **Cada fase actualiza en su commit los documentos que su cambio afecta** (principio XI): la constitución, el ADR, la seguridad, los datos, la API, los componentes y su parte de la trazabilidad. La fase 4 solo cambia **estados y totales**. Así, si se corta una fase, ninguna anterior deja documentos a medias.
- Cada fase termina con una tarea de **verificación** (suite y CI en verde) y una de **commit y push del responsable**.
- Las tareas marcadas **Del responsable** las hace el usuario: aprobar la enmienda y el ADR, hacer el commit y el push, las revisiones manuales, el paso manual del rol en un volumen existente y la variable de su `.env`. Las demás las hace el agente, sin commit ni push.
- **Fases recortables:** **2c** (si la enmienda no se aprueba o se complica, US2 se cierra con 2b) y **3** (la primera que se recorta). Cada recorte se registra como desviación en `spec.md` y en la fila de 007 de `docs/trazabilidad.md`.
- **Migraciones sin número fijo:** cada una toma el **número siguiente libre al implementarla** (`NNNN_…`). El migrador no admite migraciones fuera de orden, y 2c y 3 pueden hacerse en cualquier orden. La última antes de 007 es `0031_asistente`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (otro archivo, sin dependencias pendientes).
- **[Story]**: US1 a US3 de la [especificación](spec.md). Las fases 2a y 4 no llevan historia.
- Las rutas son relativas a `tecnologia/plataforma-barberias/`, salvo `specs/`, `docs/` y `.specify/`. En el backend, `src/`, `test/` y `migrations/` cuelgan de `backend/`; en el frontend, de `frontend/`.
- Abreviaturas:
  - **`m01/`** es `backend/src/modules/acceso-barberias/`;
  - **`sd/`** es `m01/solicitudes-datos/` (submódulo nuevo, con `{domain,application,infrastructure,presentation}/`).
- **Convención de las fuentes de indicadores:** `src/modules/**/infrastructure/plataforma/*-indicador.ts` (regla `indicadores-solo-por-registro`).
- **Ninguna tarea cambia el comportamiento de otra funcionalidad** (FR-021). US3 cambia cómo se guarda el origen, no el límite ni sus respuestas.

| Fase | Contenido | Historia | Tareas | Total | ¿Se recorta? |
| ---- | --------- | -------- | ------ | ----- | ------------ |
| 1 | Solicitudes sobre datos personales | US1 | T001–T019 | 19 | No |
| 2a | Revisión y aplicación de la enmienda y de ADR-031 | — | T020–T026 | 7 | — (decide si hay 2c) |
| 2b | Indicadores: barberías por estado | US2 | T027–T042 | 16 | No |
| 2c | Indicadores: citas por mes y usuarios (vistas de conteo) | US2 | T043–T056 | 14 | **Sí** |
| 3 | `login_attempt` sin IP legible | US3 | T057–T069 | 13 | **Sí (la primera)** |
| 4 | Cierre: estados, totales y guía rápida | — | T070–T079 | 10 | No |
| | | | | **79** | |

---

## Fase 1: User Story 1 - Solicitudes sobre datos personales (Priority: P1) 🎯 MVP

**Goal**: el cliente y el barbero registran solicitudes de acceso, rectificación o eliminación sobre sus propios datos; el propietario de su barbería las atiende a mano, con estado, plazo de 10 días hábiles y respuesta; cada paso queda auditado sin texto. El propietario sobre su propia cuenta queda fuera (FR-005).

**Independent Test**: spec.md US1 ("Independent Test").

### Pruebas de US1 (escribir primero, deben fallar) ⚠️

- [ ] T001 [P] [US1] Crear `backend/test/unit/solicitudes-datos/solicitud-datos.spec.ts` (FR-004, FR-011; data-model §1):
  - transiciones `RECIBIDA → EN_ATENCION → ATENDIDA | RECHAZADA` y las directas desde `RECIBIDA`; desde un estado final → `SOLICITUD_CERRADA`;
  - plazo de 10 días hábiles (lunes a viernes) desde la fecha local: registrada un lunes, un viernes, un sábado, a fin de mes y a fin de año;
  - "vencida" cuando está abierta y `venceEl` es anterior a hoy;
  - reglas del dominio (422): rectificación sin detalle; `ATENDIDA` sin respuesta; `RECHAZADA` sin motivo.
- [ ] T002 [P] [US1] Crear `backend/test/integration/solicitudes-datos/solicitudes-datos.spec.ts` (US1-1 a US1-9; FR-001 a FR-008, FR-010, FR-011; SC-001):
  - el cliente con sesión y el barbero registran sobre sus propios datos (201, `RECIBIDA`, `venceEl` correcto);
  - el propietario registra una en nombre de un cliente presencial (`enNombre = true`); con un cliente de otra barbería → 404;
  - "mías" devuelve solo las del titular; la de otra persona por id → 404;
  - la bandeja del propietario muestra el titular (tipo y nombre), el plazo y si está vencida;
  - iniciar, atender con respuesta y rechazar con motivo; el titular ve el estado y la respuesta;
  - otra abierta del mismo tipo → 409 `SOLICITUD_ABIERTA` con el id de la existente, también con **dos solicitudes simultáneas** (una sola se crea);
  - sobre una cerrada → 409 `SOLICITUD_CERRADA`;
  - el propietario registrando sobre su propia cuenta → 403;
  - **400** `VALIDACION` del DTO: un cuerpo con `tenant` o `barberia`, un tipo desconocido, un detalle de más de 500 caracteres, una respuesta de más de 1 000 o un motivo fuera de 5 a 300;
  - **422** `VALIDACION` del dominio: rectificación sin detalle, `ATENDIDA` sin respuesta y `RECHAZADA` sin motivo;
  - con la suscripción `EXPIRED` y `SUSPENDED`, todo responde igual (es un derecho del titular);
  - el sistema no borra ni exporta nada al atender una eliminación: los conteos de clientes, citas y usuarios no cambian.

  El borde "barbero que deja de ser personal" es una **asunción sin prueba propia** (spec, casos de borde): sale de la desactivación de usuarios de 001.
- [ ] T003 [P] [US1] Crear `backend/test/integration/solicitudes-datos/solicitudes-datos-auditoria.spec.ts` (FR-009; SC-001):
  - las cuatro acciones (`SOLICITUD_DATOS_REGISTRADA`, `_EN_ATENCION`, `_ATENDIDA`, `_RECHAZADA`), cada una con el actor y el recurso `solicitud_datos:<id>;<tipo>`;
  - un texto marcador en el detalle, la respuesta y el motivo **no** aparece en `audit_log` ni en los registros capturados de la aplicación (patrón de `registro-asistente` de 005).
- [ ] T004 [P] [US1] Crear `backend/test/integration/aislamiento/aislamiento-007.spec.ts` con el patrón de `aislamiento-005.spec.ts` (PR09; FR-010; SC-002):
  - con el tenant de A no se lee, cambia ni inserta (`WITH CHECK`) una fila de B en `data_subject_request`;
  - agregar `data_subject_request` a la lista de `backend/test/integration/aislamiento/rls.spec.ts`;
  - en `backend/test/integration/aislamiento/lectura-plataforma.spec.ts`: `barberias_plataforma` y `barberias_auth` no tienen ningún permiso sobre `data_subject_request` (solo se suman aserciones).
- [ ] T005 [P] [US1] Crear `backend/test/contract/rbac-007.spec.ts`, que lee [contracts/rbac.md](contracts/rbac.md) y ejecuta cada celda (PR08; FR-006):
  - usa una **lista de filas implementadas**, como `rbac-005`: en la fase 1, las seis filas de solicitudes × 5 columnas; la fila de indicadores se suma en la fase 2b (T029);
  - comprueba que cada fila implementada existe en el contrato.

  Crear también `backend/test/contract/solicitudes-datos.contract.spec.ts` contra [contracts/openapi.yaml](contracts/openapi.yaml): 201, 200, 400, 409 (con `detalles[0].solicitudId`) y 422, con el formato `{codigo, mensaje, detalles}`.
- [ ] T006 [P] [US1] Prueba de la regla nueva **`solicitudes-datos-sin-plataforma`** de PR14:
  - en `backend/test/architecture/fixture/src/modules/acceso-barberias/`, dos archivos que la violan: uno en `solicitudes-datos/` que importa `shared/lectura-plataforma.ts`, y un `*-plataforma.controller.ts` que importa `solicitudes-datos/`;
  - en `backend/test/architecture/reglas.spec.ts`: la regla detecta las dos violaciones del fixture y el código real no tiene ninguna.
- [ ] T007 [P] [US1] Crear `frontend/test/pages/mis-datos.spec.tsx` y `frontend/test/pages/solicitudes-datos.spec.tsx` (Vitest + MSW; constitución, accesibilidad):
  - el cliente (`/mis-datos`) y el barbero (`/app/mis-datos`) registran una solicitud y ven su lista con el estado, el plazo y la respuesta; la rectificación sin detalle muestra el error junto al campo; el 409 muestra la existente; estado vacío;
  - el propietario (`/app/solicitudes-datos`) ve la bandeja, filtra por estado, inicia, atiende con respuesta o rechaza con motivo; los mensajes se anuncian en `aria-live`;
  - el propietario no ve "Mis datos", y el barbero y el cliente no ven la bandeja;
  - el enlace "Mis datos" aparece en Mis citas solo para el cliente, y el resto de Mis citas no cambia (sus pruebas existentes pasan sin tocarlas).

### Implementación de US1

- [ ] T008 [US1] Crear la migración `backend/migrations/NNNN_solicitudes_datos.ts`, con el número siguiente libre, según data-model §1:
  - `data_subject_request` con sus `CHECK`, sus FK compuestas `(tenant_id, …)` y `rlsPorTenant()`;
  - el índice único parcial de una abierta por titular y tipo, y el índice de la bandeja;
  - para `barberias_app`: `SELECT`, `INSERT` y `UPDATE` solo de las columnas de la transición, sin `DELETE`;
  - sumar la tabla a `backend/src/shared/persistence/db-types.ts`.
- [ ] T009 [US1] Crear el dominio en `sd/domain/`:
  - `solicitud-datos.ts` (entidad y transiciones);
  - `dias-habiles.ts` (10 días hábiles con `FechaLocal`, sin feriados);
  - `errores.ts` (`SolicitudAbierta` 409, `SolicitudCerrada` 409, `SolicitudNoEncontrada` 404, `ValidacionSolicitud` 422 con `estadoHttp = 422` y el campo en `detalles[0]`).
- [ ] T010 [US1] Sumar las cuatro operaciones de [contracts/rbac.md](contracts/rbac.md) a la matriz de `m01/identidad/domain/permisos.ts` (`OPERACIONES` y `MATRIZ`) y las cuatro acciones de auditoría a `backend/src/shared/audit/audit-log.ts` (`AccionAuditada`). Sumar los códigos `SOLICITUD_ABIERTA`, `SOLICITUD_CERRADA` y `SOLICITUD_NO_ENCONTRADA` a `backend/src/host/error.filter.ts` (`ESTADO_POR_CODIGO`).
- [ ] T011 [US1] Crear el puerto `sd/application/ports/solicitudes-repository.ts` y su adaptador `sd/infrastructure/kysely-solicitudes-repository.ts`:
  - consultas siempre en la transacción con el tenant del token;
  - transiciones con `FOR UPDATE`;
  - el 409 de unicidad se traduce desde la violación del índice parcial (`23505`).
- [ ] T012 [US1] Crear los casos de uso en `sd/application/`:
  - `registrar-solicitud.ts` (cliente o barbero sobre sí mismo);
  - `registrar-en-nombre.ts` (propietario, por un cliente de su barbería);
  - `mis-solicitudes.ts`, `bandeja-solicitudes.ts`, `iniciar-atencion.ts` y `cerrar-solicitud.ts`.

  Cada uno exige su operación y audita en la misma transacción, sin texto. **Ninguno** llama a `SuscripcionesApi.exigirOperacion`, porque valen en todos los estados. La zona horaria sale de `BarberiasApi`, y el titular y su nombre, de `clientes` y de `identidad` (llamadas internas de M01).
- [ ] T013 [US1] Crear `sd/presentation/solicitudes-datos.controller.ts` con las seis rutas de [contracts/openapi.yaml](contracts/openapi.yaml):
  - DTO que **rechaza con 400** `VALIDACION` los campos desconocidos (como `tenant` o `barberia`), el tipo o resultado desconocido y los largos excedidos (detalle de más de 500, respuesta de más de 1 000, motivo fuera de 5 a 300), igual que dice el contrato;
  - las reglas del dominio responden 422 (T009);
  - registrar el submódulo en `m01/acceso-barberias.module.ts`.
- [ ] T014 [US1] Sumar la regla **`solicitudes-datos-sin-plataforma`** a `backend/.dependency-cruiser.cjs`, con el comentario de su origen (FR-006, research R10).
- [ ] T015 [P] [US1] Crear las pantallas:
  - `frontend/src/api/solicitudes-datos.ts` (tipos generados con `gen:api`, que suma `specs/007-indicadores-datos-personales/contracts/openapi.yaml` → `src/api/schema-007.d.ts`);
  - `frontend/src/pages/cliente/MisDatos.tsx` y `frontend/src/pages/panel/MisDatos.tsx`;
  - `frontend/src/pages/panel/SolicitudesDatos.tsx`;
  - las rutas en `frontend/src/routes.tsx` y las entradas "Mis datos" (barbero) y "Solicitudes de datos" (propietario) en `frontend/src/components/app/DisenoApp.tsx`;
  - el enlace "Mis datos" en `frontend/src/pages/cliente/MisCitas.tsx`, solo con sesión de cliente.

  Todo con sus `.module.css` y los tokens de tema.
- [ ] T016 [US1] Actualizar **en este commit** los documentos de US1 (principio XI), sin cambiar todavía los estados de RF ni de HU (fase 4):
  - `docs/02-arquitectura-software/multi-tenancy-y-datos.md`: `data_subject_request` y §7 (eliminación a mano; anonimización como evolución, no construida);
  - `docs/02-arquitectura-software/seguridad-y-privacidad.md`: la matriz rol × operación con las cuatro operaciones y §5 (derechos ARCO "implementado en parte": sin el propietario ni la oposición);
  - `docs/02-arquitectura-software/api-rest.md`: las seis rutas;
  - `docs/02-arquitectura-software/componentes-arquitectonicos.md`: M01 `solicitudes-datos`;
  - `docs/trazabilidad.md`: la fila de 007 (fase 1) y una tabla §4.8 de componentes de 007 con los de US1;
  - `tecnologia/plataforma-barberias/README.md`: la funcionalidad 007 y las pantallas de US1;
  - `specs/003-suscripciones-pagos/contracts/restricciones-estado.md` §1: una nota de que las solicitudes de datos valen en todos los estados, sin cambiar ninguna regla.
- [ ] T017 [US1] **Del responsable:** revisar `/mis-datos`, `/app/mis-datos` y `/app/solicitudes-datos` a 360 px y en escritorio, en los temas claro y oscuro, solo con teclado y con axe DevTools (0 errores graves), y medir con cronómetro SC-003: registrar en < 1 min y atender en < 1 min.
- [ ] T018 [US1] Verificación de fase 1:
  - backend: Prettier, lint, build, `npm test`, `npm run test:int` y `npm run test:arch`;
  - frontend: Prettier, lint, build y `npm test`, nunca a la vez que `test:int`;
  - todo en verde, enlaces de los documentos cambiados resueltos y CI en verde (`.github/workflows/plataforma-barberias.yml`) tras el push;
  - informar si cambió algún `package-lock.json`.
- [ ] T019 [US1] **Del responsable:** commit y push de la fase 1: `feat(007): solicitudes sobre datos personales (fase 1, US1)`.

**Checkpoint**: RF32 sin las solicitudes del propietario, con aislamiento, permisos y auditoría sin texto probados, y sus documentos al día.

---

## Fase 2a: Enmienda del principio III y revisión de ADR-031

**Purpose**: decidir si se construye la fase 2c. Los borradores están en [contracts/enmienda-y-adr.md](contracts/enmienda-y-adr.md). **Nada se aplica sin la aprobación del responsable.** Las fases 2b y 3 no dependen de esta fase. **Ningún documento queda a medias:** si hay aprobación, todo dice "aprobado, por construir en la fase 2c"; si hay corte, todo dice "no construido".

- [ ] T020 **Del responsable:** revisar los cuatro borradores de [contracts/enmienda-y-adr.md](contracts/enmienda-y-adr.md) y decidir, con fecha:
  - (1) la enmienda MINOR 1.7.0;
  - (2) la revisión de ADR-031;
  - (2b) la nota de ADR-031 sobre el registro de indicadores: se aplica en la fase 2b sin depender de (1) ni de (2);
  - (3) el texto de la aclaración PATCH de US3: se aplica en T065.

  Por cada uno: **aprobado**, aprobado con cambios o rechazado. Si (1) o (2) no se aprueban a tiempo, o la discusión se complica, se aplica el **corte**: no se hace la fase 2c.
- [ ] T021 Si (1) se aprobó: aplicar la enmienda 1.7.0 en `.specify/memory/constitution.md`:
  - el texto del principio III y su razón;
  - el Sync Impact Report, con la versión anterior al historial;
  - la puerta III de `.specify/templates/plan-template.md`;
  - la versión de la constitución en `docs/05-gestion/03-sdd-spec-kit.md`.

  Si se aprobó con cambios, aplicar el texto final del responsable.
- [ ] T022 Si (2) se aprobó: agregar la revisión al final de ADR-031 en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`, con el estado **"aprobada; las vistas se construyen en la fase 2c de 007"**, y en su fila de la tabla resumen.
- [ ] T023 Si se aprobaron (1) y (2): actualizar en este mismo commit los documentos afectados por la enmienda (principio XI), con las vistas como **"aprobadas, por construir en la fase 2c"**:
  - `docs/02-arquitectura-software/multi-tenancy-y-datos.md`: la excepción de la plataforma con los conteos de uso;
  - `docs/02-arquitectura-software/seguridad-y-privacidad.md`: la excepción y las amenazas;
  - `docs/trazabilidad.md`: la enmienda y la revisión de ADR-031 en la fila de 007.
- [ ] T024 Si se aplicó el corte (aquí, o más tarde durante la fase 2c): registrar la desviación "US2 sin citas por mes ni usuarios (enmienda no aprobada o fase 2c cortada), fecha y motivo":
  - en `specs/007-indicadores-datos-personales/spec.md` (§ Desviaciones) y en la fila de 007 de `docs/trazabilidad.md`;
  - si T021 a T023 ya se aplicaron, dejar en esos documentos las vistas como **"aprobadas, no construidas"**, sin texto a medias;
  - marcar T043–T056 como **no se hacen** en este archivo.
- [ ] T025 Verificación de fase 2a:
  - la versión de la constitución coincide en el Sync Impact Report, el plan-template y `docs/05-gestion/03-sdd-spec-kit.md`;
  - ningún documento dice "construido" sobre las vistas;
  - los enlaces de los documentos cambiados resuelven;
  - CI en verde.
- [ ] T026 **Del responsable:** commit y push de la fase 2a: `docs(007): enmienda 1.7.0 y revisión de ADR-031` (o `docs(007): corte de US2` si se aplicó el corte).

---

## Fase 2b: User Story 2 - Indicadores: barberías por estado (Priority: P1)

**Goal**: el administrador de la plataforma ve las barberías activas y por estado, con la hora del cálculo, sin ningún dato de personas, leyendo solo columnas que su rol ya tiene (0016). No necesita la enmienda. Es el **mínimo de US2**.

**Independent Test**: spec.md US2, escenarios 1, 4, 5 y 6.

### Pruebas (escribir primero, deben fallar) ⚠️

- [ ] T027 [P] [US2] Crear `backend/test/integration/plataforma/indicadores-plataforma.spec.ts` (US2-1, US2-4 a US2-6; FR-012 a FR-016; SC-004, SC-005):
  - barberías sembradas en `TRIAL`, `ACTIVE`, `PAST_DUE`, `EXPIRED` y suspendidas: `barberias.activas`, `suspendidas` y `porEstadoDeSuscripcion` exactos;
  - el cuerpo no contiene ningún uuid, nombre ni slug de las barberías sembradas, ni correos o teléfonos;
  - `calculadoEn` presente;
  - sin las vistas (2b sola), `citasPorMes` y `usuarios` **no** aparecen;
  - con un token de barbería → 401; sin token → 401;
  - cada consulta deja una fila `ADMIN_INDICADORES_CONSULTADOS` en `platform_audit_log`;
  - responde en ≤ 3 s con el volumen sembrado de `escalado`.
- [ ] T028 [P] [US2] Crear `backend/test/unit/shared/registro-indicadores.spec.ts`:
  - el registro junta las fuentes registradas, sin reglas;
  - una fuente repetida al registrar → error al arrancar;
  - si una fuente falla, la consulta falla entera (sin resultados parciales que parezcan ceros).
- [ ] T029 [P] [US2] Sumar la fila `GET /plataforma/indicadores` a la lista de filas implementadas de `backend/test/contract/rbac-007.spec.ts` (✓ solo con el token de la plataforma; 401 en las demás columnas) y crear `backend/test/contract/indicadores.contract.spec.ts` contra [contracts/openapi.yaml](contracts/openapi.yaml) (esquema `Indicadores`, con y sin `citasPorMes` y `usuarios`).
- [ ] T030 [P] [US2] Prueba de la regla nueva **`indicadores-solo-por-registro`**, con la convención `src/modules/**/infrastructure/plataforma/*-indicador.ts`:
  - en `backend/test/architecture/fixture/`, dos violaciones: un archivo de otro módulo (por ejemplo, de M04) que importa un `*-indicador.ts` de M02, y `shared/indicadores/` importando un módulo;
  - y un caso permitido: el `index.ts` del propio módulo exporta su `*-indicador.ts`, y `host/indicadores.ts` lo importa;
  - en `backend/test/architecture/reglas.spec.ts`: la regla detecta las dos violaciones, deja pasar el caso permitido y el código real no tiene ninguna.
- [ ] T031 [P] [US2] Crear `frontend/test/pages/plataforma-indicadores.spec.tsx`:
  - la pantalla de indicadores del administrador muestra las barberías activas, suspendidas y por estado, en tablas con encabezados, y la hora del cálculo;
  - sin `citasPorMes` ni `usuarios`, esas secciones no aparecen (ni como cero);
  - solo con sesión de la plataforma.

### Implementación

- [ ] T032 [US2] Crear la migración `backend/migrations/NNNN_auditoria_indicadores.ts`, con el número siguiente libre, que amplía el `CHECK` de `platform_audit_log.action` con `ADMIN_INDICADORES_CONSULTADOS` (y la deja como estaba en `down`). Sumar la acción a `ACCIONES_ACCESO_ADMIN` y a `AccionAccesoAdmin` en `m01/identidad/application/ports/plataforma.ts`.
- [ ] T033 [US2] Crear `backend/src/shared/indicadores/` (M06, sin reglas de negocio):
  - `fuente-de-indicador.ts` (interfaz con su nombre y `calcular()`);
  - `registro-de-indicadores.ts` (registra, rechaza repetidas y junta);
  - exportarlo en `backend/src/shared/index.ts`.
- [ ] T034 [US2] Crear la fuente de M03 `backend/src/modules/suscripciones-pagos/suscripciones/infrastructure/plataforma/barberias-por-estado-indicador.ts`:
  - con `LecturaPlataforma`, `tenant.status` × `subscription.status`;
  - "activa" según research R04;
  - solo números;
  - exportarla en el `index.ts` de M03.
- [ ] T035 [US2] Crear `backend/src/host/indicadores.ts`, que registra en el `RegistroDeIndicadores` las fuentes `*-indicador.ts` de los módulos al arrancar (patrón de `host/tareas.ts`), y conectarlo en `backend/src/host/app.module.ts`.
- [ ] T036 [US2] Crear `m01/identidad/application/plataforma/consultar-indicadores.ts` (usa el registro de M06 y audita en `platform_audit_log`) y `m01/identidad/presentation/indicadores-plataforma.controller.ts` (`GET /plataforma/indicadores` con `@Plataforma()`), y registrarlos en `m01/acceso-barberias.module.ts`.
- [ ] T037 [US2] Sumar la regla **`indicadores-solo-por-registro`** a `backend/.dependency-cruiser.cjs`: `from` es cualquier archivo de `src/` salvo `host/indicadores.ts` y el `index.ts` del mismo módulo; `to` es `src/modules/[^/]+/.*infrastructure/plataforma/[^/]+-indicador\.ts$`. Y `shared/indicadores/` no importa `src/modules/`.
- [ ] T038 [P] [US2] Crear la pantalla:
  - `frontend/src/api/indicadores.ts`;
  - `frontend/src/pages/plataforma/Indicadores.tsx` (tablas sin gráficos; las secciones de citas y usuarios solo si vienen);
  - la ruta `/plataforma/indicadores` y su entrada en `frontend/src/components/plataforma/DisenoPlataforma.tsx`.
- [ ] T039 [US2] Aplicar la **nota de ADR-031 sobre el registro de indicadores** (borrador 2b de [contracts/enmienda-y-adr.md](contracts/enmienda-y-adr.md), aprobada en T020) en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`. No depende de la enmienda ni del corte de 2c. Actualizar en este mismo commit:
  - `docs/02-arquitectura-software/componentes-arquitectonicos.md` y `estilo-arquitectonico.md`: el registro de M06 y la regla 6 (el host registra las fuentes);
  - `docs/02-arquitectura-software/api-rest.md`: la ruta de indicadores;
  - `docs/02-arquitectura-software/seguridad-y-privacidad.md`: la fila de indicadores en la matriz;
  - `docs/trazabilidad.md`: §4.8 con el registro y las barberías por estado;
  - `tecnologia/plataforma-barberias/README.md`: la pantalla de indicadores.
- [ ] T040 [US2] **Del responsable:** revisar `/plataforma/indicadores` a 360 px y en escritorio, en los temas claro y oscuro, solo con teclado y con axe DevTools.
- [ ] T041 [US2] Verificación de fase 2b: suite completa del backend (incluido `test:arch`), del frontend y Prettier, todo en verde; enlaces de los documentos cambiados resueltos; CI en verde tras el push.
- [ ] T042 [US2] **Del responsable:** commit y push de la fase 2b: `feat(007): indicadores de la plataforma, barberías por estado (fase 2b, US2)`.

**Checkpoint**: RF31 en su mínimo (barberías por estado), sin cambiar ningún permiso de base de datos, con el registro escrito en su nota de ADR.

---

## Fase 2c: User Story 2 - Indicadores: citas por mes y usuarios (Priority: P1) ✂️ RECORTABLE

**Goal**: sumar las citas por mes de los últimos 12 meses y los usuarios por tipo, desde dos vistas de solo conteo. Su dueño es el rol `barberias_conteos`, y el rol de la plataforma no recibe ningún permiso sobre las tablas.

**Requisito**: T020 con la enmienda **y** la revisión de ADR-031 aprobadas, y T021 a T023 aplicadas. **Si no, esta fase no se hace** (T024). Si se corta a mitad de la fase, se aplica T024 y no queda ninguna parte de esta fase en el código ni en los documentos.

**Independent Test**: spec.md US2, escenarios 2, 3 y 5.

### Rol, pruebas y paso manual (pruebas primero, deben fallar) ⚠️

- [ ] T043 [US2] En `db/init/01-roles.sql`:
  - crear de forma idempotente el rol `barberias_conteos` `NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE`, con un comentario de su origen;
  - concederlo con **`GRANT barberias_conteos TO barberias_owner WITH INHERIT FALSE, SET TRUE`** (PostgreSQL 16): `SET TRUE`, para asignar la propiedad de las vistas; `INHERIT FALSE`, para que el dueño de las tablas no herede sus políticas (research R02).

  Así un **volumen nuevo** de Docker Compose y la base de las pruebas (`backend/test/helpers/test-db.ts`, que ejecuta ese script) lo crean solos. Comprobar que `backend/test/integration/escalado/salud-listo.spec.ts`, que lee el script, sigue en verde.
- [ ] T044 [US2] Ampliar `backend/test/integration/aislamiento/lectura-plataforma.spec.ts` con la **prueba de permisos exactos** (PR09; enmienda 1.7.0). Es la única aserción existente que cambia (FR-021):
  - `barberias_plataforma` tiene `SELECT` sobre **exactamente** `platform_appointment_counts` y `platform_membership_counts` en `information_schema.table_privileges`, y nada más de tabla. Hoy la prueba exige cero permisos de tabla y debe aceptar exactamente esas dos vistas;
  - `SELECT id FROM appointment`, `FROM membership`, `FROM customer_profile` y `FROM user_account` siguen denegados;
  - las dos vistas se leen y devuelven solo sus columnas de conteo, sin ningún id;
  - **`barberias_app` y `barberias_publico` no pueden leer las vistas** (permiso denegado);
  - `barberias_conteos`: `rolcanlogin = false`, `NOBYPASSRLS`, `NOINHERIT`, dueño solo de las dos vistas, `SELECT` solo sobre `appointment (created_at, status)` y `membership (role_code, status)`, ningún `INSERT`, `UPDATE`, `DELETE` ni `TRUNCATE`, y conectarse con él falla;
  - **`barberias_owner`, con el tenant de A fijado, solo ve las citas y las membresías de A** (no hereda la política `FOR SELECT TO barberias_conteos USING (true)`);
  - **ningún rol con inicio de sesión hereda `barberias_conteos`**: en `pg_auth_members`, el único miembro es `barberias_owner`, con `inherit_option = false` y `set_option = true`;
  - la sección 4, "Ninguna escritura", sigue en verde con las vistas.
- [ ] T045 [P] [US2] Ampliar `backend/test/integration/plataforma/indicadores-plataforma.spec.ts`:
  - citas sembradas con **`created_at` puesto a propósito** en varios meses y estados: `citasPorMes` de los últimos 12 meses exacto, con ceros y con el borde del mes en Lima (una cita registrada a las 23:59 del último día del mes y otra a las 00:00 del día 1, hora de Lima);
  - `usuarios.personal` y `usuarios.clientes` exactos (membresías activas);
  - el cuerpo sigue sin ids, nombres, correos ni teléfonos;
  - responde en **≤ 3 s** con el volumen sembrado de `escalado`, ya con las vistas (SC-005).
- [ ] T046 [P] [US2] Ampliar la prueba de la regla `lectura-plataforma-confinada` en `backend/test/architecture/reglas.spec.ts` con fixtures: `catalogo-citas/citas/infrastructure/plataforma/` **sí** puede importar `shared/lectura-plataforma.ts`, y `catalogo-citas/catalogo/infrastructure/` **no**.
- [ ] T047 [US2] Documentar el **paso manual para un volumen que ya existe**, con el mismo patrón que los roles de 002 y 003:
  - en `tecnologia/plataforma-barberias/README.md`, el bloque SQL idempotente (`DO $$ … IF NOT EXISTS … CREATE ROLE barberias_conteos NOLOGIN …; GRANT barberias_conteos TO barberias_owner WITH INHERIT FALSE, SET TRUE;`) para pegar en `docker compose exec db psql -U postgres -d barberias` **antes** de aplicar la migración `vistas_de_conteo`;
  - en `specs/007-indicadores-datos-personales/quickstart.md` §0, las dos comprobaciones: que el rol existe sin inicio de sesión ni `BYPASSRLS`, y que su único miembro es `barberias_owner`, sin herencia;
  - qué pasa si se olvida: la migración `vistas_de_conteo` falla con un error claro y las réplicas no arrancan, como con cualquier migración fallida.

### Implementación

- [ ] T048 [US2] Crear la migración `backend/migrations/NNNN_vistas_de_conteo.ts`, con el número siguiente libre, según data-model §2. En `up`, en este orden:
  1. comprobar que existe `barberias_conteos`, y si no, fallar con el mensaje "falta el rol barberias_conteos: ver README";
  2. conceder sus `SELECT` por columna y las políticas `FOR SELECT TO barberias_conteos USING (true)` sobre `appointment` y `membership`;
  3. crear las dos vistas ya agregadas, sin `tenant_id`;
  4. `ALTER VIEW … OWNER TO barberias_conteos`;
  5. `GRANT SELECT` de las vistas solo a `barberias_plataforma`.

  `down` deshace todo en orden inverso. Exportar la lista de vistas para la prueba de T044.
- [ ] T049 [US2] Crear las fuentes:
  - `backend/src/modules/catalogo-citas/citas/infrastructure/plataforma/citas-por-mes-indicador.ts` (completa los meses en cero);
  - `m01/identidad/infrastructure/plataforma/usuarios-por-tipo-indicador.ts`.

  Exportarlas en sus `index.ts` y registrarlas en `backend/src/host/indicadores.ts`.
- [ ] T050 [US2] Ampliar `lectura-plataforma-confinada` en `backend/.dependency-cruiser.cjs` con `catalogo-citas/citas/infrastructure/plataforma/`, y su comentario.
- [ ] T051 [P] [US2] En `frontend/src/pages/plataforma/Indicadores.tsx`, mostrar las tablas de citas por mes (con su total y por estado) y de usuarios por tipo, y ampliar `frontend/test/pages/plataforma-indicadores.spec.tsx` con esas secciones.
- [ ] T052 [US2] Actualizar **en este commit** los documentos afectados, que pasan las vistas de "por construir" a "construidas" (principio XI):
  - `docs/02-arquitectura-software/multi-tenancy-y-datos.md` (§2.1, roles de base de datos): el rol y las vistas, con su concesión sin herencia;
  - `docs/02-arquitectura-software/seguridad-y-privacidad.md`: la excepción y las amenazas;
  - `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`: la revisión de ADR-031, "implementada";
  - `docs/trazabilidad.md`: §4.8 con las vistas y su evidencia.
- [ ] T053 [US2] **Del responsable:** en su volumen de Docker Compose, que ya existe:
  1. aplicar el paso manual de T047;
  2. ejecutar las comprobaciones del quickstart;
  3. recrear las réplicas con `docker compose up -d --force-recreate preparar-backend backend-1 backend-2`;
  4. confirmar que la migración `vistas_de_conteo` se aplicó y que `/plataforma/indicadores` muestra las citas y los usuarios.

  Anotar el resultado en la tabla del quickstart.
- [ ] T054 [US2] **Del responsable:** revisar otra vez `/plataforma/indicadores`, ya con las tablas nuevas, a 360 px y en escritorio, en los temas claro y oscuro, con teclado y con axe DevTools.
- [ ] T055 [US2] Verificación de fase 2c: suite completa del backend (incluido `test:arch`), del frontend y Prettier, todo en verde; enlaces de los documentos cambiados resueltos; CI en verde tras el push.
- [ ] T056 [US2] **Del responsable:** commit y push de la fase 2c: `feat(007): indicadores de citas y usuarios con vistas de conteo (fase 2c, US2)`.

**Checkpoint**: RF31 completo, con el rol de la plataforma sin permisos sobre las tablas de citas y usuarios y ningún rol con inicio de sesión heredando las políticas de conteo, demostrado por la prueba de permisos exactos.

---

## Fase 3: User Story 3 - `login_attempt` sin IP legible (Priority: P3) ✂️ RECORTABLE (la primera)

**Goal**: los intentos fallidos de inicio de sesión (personal, clientes y administrador) guardan el origen solo como `SHA-256(INTENTOS_SAL_IP ‖ ip)`; el límite se comporta igual.

**Independent Test**: spec.md US3 ("Independent Test").

### Pruebas (escribir primero, deben fallar) ⚠️

- [ ] T057 [P] [US3] Ampliar `backend/test/unit/shared/configuracion.spec.ts`:
  - `INTENTOS_SAL_IP` es obligatoria, de al menos 16 caracteres y distinta de `ENLACES_SAL_IP`;
  - los mensajes de error no muestran el valor;
  - sumar la variable al entorno base de esa prueba y al de `backend/test/unit/shared/configuracion-ia.spec.ts`, con valores **de prueba** escritos en la propia prueba.
- [ ] T058 [P] [US3] Ampliar `backend/test/integration/identidad/limite-intentos.spec.ts` (FR-017, FR-018, FR-020; SC-006):
  - tras los fallos, `login_attempt` no tiene la columna `ip`, y cada `ip_hash` es igual a `SHA-256(sal ‖ ip)`, calculado en la prueba con `process.env.INTENTOS_SAL_IP` (de `entorno.ts`, nunca del `.env`), y distinto de la IP;
  - los mismos umbrales, el mismo bloqueo, el mismo mensaje y el mismo `Retry-After` que antes;
  - otro origen no queda bloqueado;
  - un ingreso correcto borra los fallos de ese par;
  - la purga oportunista de las filas de más de 24 h sigue;
  - **la sal no aparece en ningún registro ni auditoría:** con una sal marcador en el entorno de la prueba, el marcador no aparece en los registros capturados de la aplicación (patrón de `registro-asistente` de 005), ni en `audit_log`, ni en `platform_audit_log`, ni en los cuerpos de error.

  Ampliar también `backend/test/integration/identidad/segundo-factor.spec.ts`: el bloqueo del administrador es igual, también con la IP desconocida (`0.0.0.0` derivada).
- [ ] T059 [P] [US3] Crear `backend/test/integration/identidad/migracion-intentos.spec.ts` (FR-019):
  - en una base migrada hasta la anterior, sembrar filas de `login_attempt` con IP y aplicar la migración `intentos_con_hash`;
  - después no queda ninguna fila vieja ni la columna `ip`, y existe el índice `(email_hash, ip_hash, attempted_at)`;
  - `down` vuelve a la columna `ip` sin datos.
- [ ] T060 [US3] Sumar `INTENTOS_SAL_IP` con un valor de pruebas, distinto de `ENLACES_SAL_IP`, en `backend/test/helpers/entorno.ts`. Ninguna prueba lee el `.env`.

### Implementación

- [ ] T061 [US3] Sumar `intentos: { salIp }` a `backend/src/shared/config/configuracion.ts` (`secreto('INTENTOS_SAL_IP', 16)`, distinta de `ENLACES_SAL_IP`, sin mostrarla en errores).
- [ ] T062 [US3] Crear la migración `backend/migrations/NNNN_intentos_con_hash.ts`, con el número siguiente libre (data-model §4):
  - borrar las filas, quitar `ip`, agregar `ip_hash char(64) NOT NULL` y rehacer el índice, sin tocar los permisos;
  - `down`: borrar las filas y volver a `ip inet NOT NULL`;
  - actualizar `backend/src/shared/persistence/db-types.ts`.
- [ ] T063 [US3] Cambiar `m01/identidad/infrastructure/kysely-intentos-repository.ts` para que derive `ip_hash` con la sal (patrón de `KyselyIntentosEnlaceRepository`) en `fallosDesde`, `registrarFallo` y `borrarFallos`. El puerto `IntentosRepository`, el ingreso e `IntentosAdmin` no cambian. Actualizar los comentarios del puerto y del repositorio (la IP ya no se guarda).
- [ ] T064 [US3] Dar valor **solo de desarrollo** a `INTENTOS_SAL_IP`, sin tocar el `.env` del responsable (FR-020: el valor de cualquier otro entorno va fuera del repositorio):
  - en `docker-compose.yml`: `${INTENTOS_SAL_IP:-<valor de desarrollo>}`, junto a `ENLACES_SAL_IP`;
  - en `.env.example`: un valor de desarrollo con un comentario como el de `ENLACES_SAL_IP` ("distinta de ENLACES_SAL_IP; en otros entornos, un secreto propio fuera del repositorio");
  - en `tecnologia/plataforma-barberias/README.md`: en la lista de variables, y que **sin `INTENTOS_SAL_IP` tampoco arrancan los scripts que construyen `Configuracion`** (por ejemplo, `npm run plataforma:crear-admin`) fuera de Compose;
  - en `specs/007-indicadores-datos-personales/quickstart.md` §0: **el responsable la añade a mano a su `.env`** si arranca sin Compose (con Compose, el valor de desarrollo cubre la falta).
- [ ] T065 [US3] Con las pruebas de US3 en verde y el texto (3) aprobado en T020:
  - aplicar la aclaración PATCH del principio III en `.specify/memory/constitution.md` (1.7.1, o 1.6.1 si no hubo enmienda), con su Sync Impact Report;
  - actualizar la puerta III de `.specify/templates/plan-template.md` y la versión en `docs/05-gestion/03-sdd-spec-kit.md`.

  Actualizar **en este mismo commit** (principio XI):
  - `docs/02-arquitectura-software/multi-tenancy-y-datos.md`: las tablas técnicas de intentos, con `login_attempt` y su `ip_hash`;
  - `docs/02-arquitectura-software/seguridad-y-privacidad.md`: las amenazas, con el origen derivado;
  - `docs/trazabilidad.md`: §4.8, con la evidencia de US3.
- [ ] T066 [US3] **Del responsable:** añadir `INTENTOS_SAL_IP` a mano a su `.env` local (el agente no lo lee ni lo cambia) y comprobar que arrancan, fuera de Compose, el backend **y los scripts que construyen `Configuracion`** (por ejemplo, `npm run plataforma:crear-admin -- --help`).
- [ ] T067 [US3] Verificación de fase 3:
  - suite completa del backend (incluido `test:arch`), del frontend y Prettier, todo en verde;
  - enlaces de los documentos cambiados resueltos;
  - CI en verde tras el push;
  - en Compose, la migración se aplica con las réplicas recreadas a la vez (research R09). El "falla cerrada" de una réplica vieja durante la migración queda como **procedimiento**, sin prueba automática (análisis L3).
- [ ] T068 [US3] **Del responsable:** confirmar en su Compose, con las réplicas recreadas, que un inicio de sesión fallido deja `ip_hash` y ninguna IP en `login_attempt`.
- [ ] T069 [US3] **Del responsable:** commit y push de la fase 3: `feat(007): login_attempt con el origen derivado (fase 3, US3)`.

**Checkpoint**: ninguna IP legible en `login_attempt`, con el límite de intentos igual y la sal fuera de registros y auditoría.

---

## Fase 4: Cierre (estados, totales y guía rápida)

**Purpose**: dejar los **estados y los totales** de 007 en la documentación, como la fase 5 de 005. El contenido de cada cambio ya se documentó en su fase (principio XI). **Solo lo construido pasa a "implementado".** Lo recortado (2c o 3) y lo que quedó fuera de alcance se dice como no construido:
- las solicitudes del propietario;
- la anonimización;
- la oposición;
- los avisos al solicitante;
- la vista de la auditoría para el administrador.

- [ ] T070 Recorrer `specs/007-indicadores-datos-personales/quickstart.md` §1 a §3 con Docker Compose (solo las historias construidas) y anotar cada resultado. Los pasos de §4 y los del responsable quedan como "pendiente del responsable" si no los hizo.
- [ ] T071 [P] `docs/trazabilidad.md`, **solo estados y totales**: el estado de la fila de 007 (tareas, pruebas, totales de la última corrida, desviaciones), HU26 y HU27 en §1, §2 (estados de M01 `solicitudes-datos` y M06 indicadores) y §3 (estado de PR18 y PR21).
- [ ] T072 [P] Estados de requisitos e historias:
  - `docs/01-analisis-de-sistema/03-requisitos-funcionales.md`: RF31 y RF32 (RF32 "parcial": sin las solicitudes del propietario) y el resumen;
  - `docs/01-analisis-de-sistema/02-historias-del-usuario.md`: HU26 sigue parcial (sin la vista de la auditoría) y HU27 queda parcial (sin el propietario);
  - `docs/01-analisis-de-sistema/01-actores.md`: estados de las solicitudes por actor y de los indicadores.
- [ ] T073 [P] Estados de los escenarios en `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md`: EQ-18 con las solicitudes; EQ-13 y EQ-12, con la evidencia de US3 si se hizo.
- [ ] T074 [P] Estados de los componentes en `docs/02-arquitectura-software/componentes-arquitectonicos.md` (§4) y en el texto de `docs/04-modelo-c4/` (niveles 1 a 3), y anotar las imágenes por regenerar en la §5 de la trazabilidad.
- [ ] T075 [P] Gestión:
  - `docs/05-gestion/02-backlog-y-sprints.md`: el estado de la fila de 007 y las líneas de corte aplicadas;
  - `docs/05-gestion/04-pruebas.md`: los estados de PR18 y PR13, PR21 sigue planificada, §2.4 con los totales de la última corrida y una §2.8 de 007;
  - `docs/05-gestion/06-mvp-y-evolucion.md`: las evoluciones (solicitudes del propietario, anonimización, oposición y vista de la auditoría).
- [ ] T076 [P] Totales y estado de 007 en el `README.md` raíz y en `tecnologia/plataforma-barberias/README.md`.
- [ ] T077 **Del responsable:** confirmar las revisiones manuales y las mediciones de T017, T040, T053, T054 y T068 (y SC-003 con cronómetro) antes de marcarlas.
- [ ] T078 Verificación de fase 4: suite completa del backend (incluido `test:arch`) una vez, del frontend y Prettier, todo en verde; enlaces de los documentos cambiados resueltos; CI en verde tras el push.
- [ ] T079 **Del responsable:** commit y push de la fase 4: `docs(007): cierre de indicadores y datos personales (fase 4)`.

---

## Dependencies & Execution Order

- **Fase 1 (US1):** no depende de nada.
- **Fase 2a:** no depende de nada; **bloquea solo la 2c**. Su borrador (2b), la nota del registro, lo aplica la fase 2b, y su borrador (3), la fase 3.
- **Fase 2b (US2):** no depende de la enmienda, pero la nota de ADR (T039) usa el texto (2b) aprobado en T020.
- **Fase 2c (US2):** depende de 2a aprobada y de 2b.
- **Fase 3 (US3):** no depende de nada. Su aclaración PATCH (T065) usa el texto (3) de T020.
- **Fase 4:** al final, con lo construido.

Orden sugerido: 1 → 2a (en paralelo con el trabajo de 2b, porque 2a es del responsable) → 2b → 2c → 3 → 4. **2c y 3 pueden invertirse**: las migraciones toman el número siguiente libre al implementarlas. Si el plazo obliga a elegir, se recorta primero la **3** y después la **2c**. Dentro de cada fase: pruebas (en paralelo, deben fallar) → migración → dominio → casos de uso → rutas → reglas de PR14 → interfaz → documentos de la fase → revisión del responsable → verificación → commit del responsable.

### Paralelismo

- Fase 1: T001–T007 en paralelo; T015 (frontend) en paralelo con T011–T014.
- Fase 2b: T027–T031 en paralelo; T038 en paralelo con T033–T037.
- Fase 2c: T045 y T046 en paralelo después de T043 y T044; T051 en paralelo con T048–T050.
- Fase 3: T057–T059 en paralelo.
- Fase 4: T071–T076 en paralelo después de T070.

**Ejemplo (fase 1):**
1. T001 a T007 se escriben a la vez.
2. Luego T008 → T009 → T010 → T011 → T012 → T013 → T014.
3. T015 en paralelo desde T011, y T016 (documentos) al final.

## Implementation Strategy

- **MVP:** la fase 1 (US1, RF32 sin el propietario).
- **Entrega incremental:**
  1. 1, que es el MVP;
  2. 2b, el mínimo de RF31;
  3. 2c, si la enmienda se aprobó;
  4. 3, si queda tiempo;
  5. 4.
- **Qué nunca se recorta:**
  - el aislamiento de las solicitudes (PR09);
  - la matriz de permisos (PR08);
  - la auditoría sin texto;
  - que el rol de la plataforma no tenga permisos sobre las tablas de citas y usuarios y que ningún rol con inicio de sesión herede las políticas de conteo. Si eso no se puede probar, no hay 2c.
