---
description: "Lista de tareas de la funcionalidad 003: suscripciones y pagos de las barberías"
---

# Tasks: Suscripciones y pagos de las barberías

**Input**: Documentos de diseño en `specs/003-suscripciones-pagos/`

**Prerequisites**:

- Diseño: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
  [data-model.md](data-model.md), [quickstart.md](quickstart.md).
- Contratos: [contracts/openapi.yaml](contracts/openapi.yaml), [contracts/rbac.md](contracts/rbac.md),
  [contracts/restricciones-estado.md](contracts/restricciones-estado.md),
  [contracts/pasarela-simulada.md](contracts/pasarela-simulada.md).
- ADR-022, ADR-023, ADR-024 y ADR-031, Aceptados el 2026-10-24. Constitución 1.3.1.

**Tests**: OBLIGATORIAS (constitución, principio X). Cada fase escribe primero sus pruebas, que deben
fallar antes de implementar. Cada prueba obligatoria va en la fase de lo que prueba:

| Prueba                         | Fase                                        |
| ------------------------------ | ------------------------------------------- |
| PR14 (reglas de arquitectura)  | Base, y US2 para `operaciones-con-politica` |
| PR09 (lectura de plataforma)   | Base                                        |
| PR09 (pagos)                   | US1, ampliada en US3                        |
| PR20 (contrato de la pasarela) | Base                                        |
| PR25 (estados y períodos)      | Base                                        |
| PR17 (notificaciones)          | US1                                         |
| PR06 (proveedor caído)         | US1                                         |
| Conciliación (principio V)     | US1                                         |
| Datos canario (SC-010)         | US1, ampliada en el administrador y en US3  |
| Vencimiento con dos réplicas   | US2                                         |
| PR13 (auditoría)               | US2, administrador, US3 y US5               |
| PR08 (`rbac-003`)              | Crece en cada fase con sus filas            |

**Sin librerías nuevas** (research R16): `node:crypto`, `fetch`, `node:http`, y `multer` 2.4.0, que
ya viene con `@nestjs/platform-express`. Nada se descarga en C:; se usa siempre `npx --no-install`.

**Organization**: fases según el plan.

1. Preparación.
2. Base, que bloquea todo.
3. P1: US1 y US2.
4. P2: ingreso del administrador, US3 y US4.
5. P3: US5.
6. Cierre: documentación y suite completa.

Cada fase termina en un **punto de control** que se confirma con los mismos comandos que la CI
(`.github/workflows/plataforma-barberias.yml`):

- **Backend:** `npx --no-install prettier --check .`, `npm run lint`, `npm run build`, `npm test`,
  `npm run test:int` y `npm run test:arch`.
- **Frontend:** `npx --no-install prettier --check .`, `npm run lint`, `npm run build` y
  `npx --no-install vitest run --maxWorkers=1 --minWorkers=1`.

El backend y el frontend se ejecutan por separado, nunca a la vez.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: historia de la especificación (US1 a US5). El ingreso del administrador lleva `[US3]`
  porque US3 es la primera historia que lo usa; US5 también lo usa.
- **Backend:** o **Frontend:** al inicio de cada descripción indica la parte de la aplicación.
- Las rutas son relativas a `tecnologia/plataforma-barberias/`, salvo las de `specs/` y `docs/`.

---

## Phase 1: Setup (preparación)

**Purpose**: configuración y entorno, sin lógica todavía.

- [x] T001 [P] Backend: agregar a `.env.example` las variables de 003, con sus comentarios. No tocar el `.env` del usuario.
  - **Pagos:** `PAGOS_PROVEEDOR=simulado`, `PAGOS_URL_BASE`, `PAGOS_LLAVE_PUBLICA`, `PAGOS_LLAVE_SECRETA`, `PAGOS_SECRETO_FIRMA`, `PAGOS_URL_RETORNO`, `PAGOS_URL_NOTIFICACIONES`, `PAGOS_TIEMPO_LIMITE_MS=2000`, `PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO=600` y `PAGOS_CUENTA_BANCO`, `PAGOS_CUENTA_TITULAR`, `PAGOS_CUENTA_NUMERO`, `PAGOS_CUENTA_CCI`.
  - **Plataforma:** `PLATAFORMA_LLAVE_TOTP` (32 bytes en base64) y `DATABASE_URL_PLATAFORMA`.
  - **Simulador:** `SIMULADOR_TOKEN_CONTROL`.
  - **Tareas:** `TAREAS_ACTIVAS=true` y `TAREAS_INTERVALO_MS=300000`.
- [x] T002 Backend: ampliar `backend/src/shared/config/configuracion.ts` con las secciones `pagos` (proveedor `simulado` o `culqi`, URL, llaves, tiempo límite, límite de notificaciones por minuto y cuenta bancaria), `plataforma` (llave TOTP de 32 bytes decodificada y URL de base) y `tareas` (activas e intervalo, mínimo 10 000 ms).
  - Si un valor es inválido, el arranque falla con un mensaje claro.
  - Ningún secreto aparece en los mensajes.
  - Casos nuevos en `backend/test/unit/shared/configuracion.spec.ts`.
- [x] T003 [P] Backend: crear el rol `barberias_plataforma` (`LOGIN NOBYPASSRLS NOINHERIT`, contraseña de desarrollo) en `db/init/01-roles.sql`.
  - Agregar la creación en las pruebas, en `backend/test/helpers/test-db.ts`, junto a `barberias_publico`, con `TEST_DB_PLATAFORMA_URL`.
  - Documentar en `README.md` el SQL para bases ya existentes, como se hizo con `barberias_publico`.
- [x] T004 [P] Backend: en `docker-compose.yml`, agregar el servicio `pasarela-simulada`.
  - Imagen `node:22`, con los volúmenes del build y de `node_modules` de solo lectura (como las réplicas).
  - Comando `node --import tsx simulador-pagos/servidor.ts` (un solo proceso de Node; con `npx` el contenedor rozaba los 64 MB), IP fija `${IP_SIMULADOR:-172.28.0.14}`, puerto `3100:3100` y 64 MB.
  - Agregar a `x-backend-entorno`: `DATABASE_URL_PLATAFORMA`, `PAGOS_URL_BASE=http://${IP_SIMULADOR:-172.28.0.14}:3100` y `PAGOS_URL_NOTIFICACIONES=http://nginx/api/v1/pagos/notificaciones`.
  - Agregar `IP_SIMULADOR` a `.env.example`.
  - Actualizar `specs/006-escalado-cache-balanceo/contracts/entorno-compose.md` §1 con la fila nueva.
- [x] T005 [P] Backend: en `backend/package.json`, agregar los scripts `"simulador": "tsx simulador-pagos/servidor.ts"`, `"simulador:modo": "tsx scripts/simulador-modo.ts"`, `"plataforma:crear-admin": "tsx scripts/crear-admin-plataforma.ts"` y `"demo:vencimiento": "tsx scripts/demo-vencimiento.ts"`.
  - Incluir `simulador-pagos/` en `backend/tsconfig.json` (revisión de tipos y lint), sin dependencias nuevas.

---

## Phase 2: Base (bloquea todo)

**Purpose**: migraciones y RLS, lectura de plataforma, interruptor, ejecutor de tareas, puerto
`PaymentGateway` con su simulador y su contrato, dominio de la suscripción, política de operación,
token de plataforma en el guard y reglas de PR14.

**Independent Test**: las migraciones `0014`–`0017` se aplican sobre una base con los datos de 002. La
suite de PR20 pasa contra el simulador. `lectura-plataforma` (PR09) demuestra los permisos exactos. PR14
detecta las violaciones nuevas.

### Tests for Base ⚠️

- [x] T006 [P] Backend: en `backend/test/unit/shared/interruptor.spec.ts` (se mueve con el interruptor), probar la ventana opcional `ventanaMs`: 5 fallos dentro de 60 s abren el circuito, y 5 fallos repartidos en más tiempo no. Mantener los casos de 006.
- [x] T007 [P] Backend: en `backend/test/unit/shared/ejecutor-tareas.spec.ts`, con candado y reloj falsos, probar:
  - la tarea no corre si el candado está tomado;
  - un error en un elemento no detiene el resto;
  - cada corrida se registra con los procesados y los fallidos;
  - el desfase queda entre 0 y 30 s;
  - con `TAREAS_ACTIVAS=false` no se programa nada.
- [x] T008 [P] Backend: **PR25** en `backend/test/unit/suscripciones/estado-suscripcion.spec.ts`. Todas las transiciones de [data-model.md](data-model.md) §2, incluidas las inválidas, la reactivación recalculada por fechas y el pago durante la prueba (sigue en TRIAL hasta que termina).
- [x] T009 [P] Backend: **PR25** en `backend/test/unit/suscripciones/periodos.spec.ts`. Casos:
  - un mes calendario con ajuste al fin de mes (31 de enero → 28 o 29 de febrero);
  - el inicio al terminar la prueba o el período vigente;
  - en gracia, el inicio al final del período vencido (P2: A, escenario 8 de US2);
  - vencida, el inicio al aprobarse;
  - el rechazo de más de un período por adelantado;
  - el plan del período vigente.
- [x] T010 [P] Backend: **PR25** en `backend/test/unit/suscripciones/politica-de-operacion.spec.ts`. La prueba **lee** la tabla §1 de `specs/003-suscripciones-pagos/contracts/restricciones-estado.md` y comprueba cada celda; una acción sin fila hace fallar la prueba.
- [x] T011 [P] Backend: **PR25** en `backend/test/unit/pagos/pago.spec.ts`. La máquina de estados del pago de [data-model.md](data-model.md) §3, celda por celda:
  - `ANULADO` y `EXPIRADO` pasan a `APROBADO`;
  - un `APROBADO` atrasado tras un `RECHAZADO` deja la marca;
  - los eventos atrasados no tienen efecto;
  - `DUPLICADO`, `IMPORTE_DISTINTO`, `APROBADO_TRAS_RECHAZO` y `DEVOLUCION` son marcas de revisión, no estados (equivalencia de la entidad Pago de la especificación).
- [x] T012 [P] Backend: **PR09** en `backend/test/integration/aislamiento/lectura-plataforma.spec.ts`. Comprobar, como en `lectura-publica.spec.ts`:
  - `barberias_plataforma` tiene exactamente los permisos por columna de data-model §4;
  - no tiene `BYPASSRLS` ni objetos propios, ni `EXECUTE` sobre las funciones de ADR-015;
  - leer citas, clientes, catálogo, `user_account`, `auth_session` o `payment_receipt_file` da "permission denied";
  - no tiene `INSERT`, `UPDATE` ni `DELETE` sobre ninguna tabla, de barbería ni de la plataforma, y todas sus transacciones son `READ ONLY`;
  - no puede leer `payment.bank_operation_number`, solo `bank_operation_last4` y `bank_operation_hash`;
  - `barberias_app` solo puede insertar en `provider_event` (un `SELECT` da "permission denied"), no tiene ningún permiso sobre `platform_admin`, y tiene exactamente `SELECT`, `INSERT` y `UPDATE` sobre `platform_session` y `platform_challenge`, `INSERT` en `platform_audit_log` e `INSERT` y `UPDATE` en `scheduled_job_run` (constitución 1.3.1).
- [x] T013 [P] Backend: **PR20** en `backend/test/contract/payment-gateway.contract.ts`, una función `probarContratoDePasarela(fabrica)` que comprueba:
  - crear y consultar;
  - aprobar y rechazar;
  - cancelar una sesión pendiente;
  - la firma válida, inválida, ausente y vencida;
  - un tiempo límite que se traduce en `ProveedorNoDisponible`;
  - que el importe consultado sea igual al enviado.

  Ejecutarla en `backend/test/integration/pagos/gateway-simulado.spec.ts`, siempre, y en `backend/test/integration/pagos/gateway-sandbox.spec.ts`, solo con `PAGOS_SANDBOX_*` definidas; si no, `describe.skip` con un mensaje.

- [x] T014 [P] Backend: en `backend/test/integration/pagos/simulador.spec.ts`, probar cada modo de `specs/003-suscripciones-pagos/contracts/pasarela-simulada.md` §3 contra el simulador iniciado dentro del proceso (`lento`, `caido`, `colgado`, `duplicar`, `firma_invalida`, `sin_firma`, `fuera_de_orden`, `importe_distinto`, `aprobar_despues`, `rechazar` y la devolución), y que las rutas `/control/*` exigen `X-Control`.
- [x] T015 [P] Backend: **PR14**. En `backend/test/architecture/reglas.spec.ts`, agregar casos y fixtures en `backend/test/architecture/fixture/` para las reglas nuevas:
  - `lectura-plataforma-confinada`: solo `*/infrastructure/plataforma/` de M03 y de M01 (`barberias` e `identidad`) importan `shared/lectura-plataforma.ts`;
  - `pasarela-solo-por-puerto`: solo `suscripciones-pagos/pagos/infrastructure/` importa los adaptadores de pasarela, y `application` y `domain` no usan `fetch` ni `node:http`;
  - `simulador-fuera-del-monolito`: nada en `src/` importa `simulador-pagos/`.
- [x] T016 [P] Backend: en `backend/test/integration/host/token-plataforma.spec.ts`, con una ruta de prueba `@Plataforma()` y un ayudante `tokenPlataformaPara(adminId)` en `backend/test/helpers/sesiones.ts`, probar:
  - el token de plataforma sirve solo en rutas `@Plataforma()`;
  - en rutas de barbería (p. ej. `GET /agenda`) responde 401;
  - un token de barbería en una ruta `@Plataforma()` responde 401;
  - un token sin `tid` y sin `aud` plataforma responde 401.

### Implementation for Base

- [x] T017 Backend: crear la migración `backend/migrations/0014_planes_y_suscripcion.ts`:
  - columnas nuevas de `plan` y siembra de BASICO (4900, 3 y 3) y PRO (8900, 8 y 8), públicos; TRIAL no público;
  - columnas nuevas de `subscription` y `GRANT UPDATE` por columna a `barberias_app` (data-model §1.1);
  - `down` reversible.
- [x] T018 Backend: crear la migración `backend/migrations/0015_pagos.ts`, según data-model §1.2:
  - las tablas `subscription_period` (con `EXCLUDE USING gist` y `UNIQUE (payment_id)`), `payment` (con `covers_after`, `bank_operation_last4` y `bank_operation_hash`; índices únicos parciales de pago abierto y de número de operación aprobado, `UNIQUE` de `provider_reference` y de `transfer_reference`), `payment_receipt`, `payment_receipt_file` (`STORAGE EXTERNAL`), `receipt_upload_counter` y `provider_event`;
  - `rlsPorTenant()` en las tablas con tenant;
  - los permisos de `barberias_app` por columna, y en `provider_event` solo `INSERT`, sin `SELECT` (C1).
- [x] T019 Backend: crear la migración `backend/migrations/0016_plataforma.ts`:
  - permisos por columna y políticas `FOR SELECT TO barberias_plataforma USING (true)` en `tenant`, `plan`, `subscription`, `subscription_period`, `payment` y `provider_event`;
  - sin vista: el rol lee `bank_operation_last4` y `bank_operation_hash` por columna, nunca `bank_operation_number` (las repeticiones se detectan comparando el hash);
  - las tablas globales `platform_admin`, `platform_session` (con `totp_step` y `UNIQUE (admin_id, totp_step)`), `platform_challenge` (con `used_recovery_index` y `UNIQUE (admin_id, used_recovery_index)`) y `platform_audit_log`. El rol de la aplicación escribe `platform_session`, `platform_challenge` y `platform_audit_log` y no tiene permiso sobre `platform_admin`; `barberias_plataforma` solo las lee;
  - `GRANT UPDATE (status) ON tenant TO barberias_app`, para suspender y reactivar (H5);
  - según data-model §1.3 y §4.
- [x] T020 Backend: crear la migración `backend/migrations/0017_tareas.ts` (`scheduled_job_run`, con `INSERT`, `UPDATE` de fin y conteos y `SELECT` solo de `id` para `barberias_app` —el `UPDATE ... WHERE id` lo exige— y solo `SELECT` para `barberias_plataforma`). Registrar `0014` a `0017` en `backend/migrations/index.ts`; `ULTIMA_MIGRACION` y `/salud/listo` lo siguen solos.
- [x] T021 Backend: crear `backend/src/shared/persistence/lectura-plataforma.ts` (pool propio con `DATABASE_URL_PLATAFORMA` y solo `ejecutarLectura`, en `READ ONLY`; no ofrece escrituras) y la entrada confinada `backend/src/shared/lectura-plataforma.ts`. Registrar el cierre del pool en `backend/src/shared/shared.module.ts`. Hace pasar T012.
- [x] T022 [P] Backend: mover `backend/src/shared/cache/interruptor.ts` a `backend/src/shared/resiliencia/interruptor.ts`, con la ventana opcional, y exportarlo en `backend/src/shared/index.ts`. Actualizar los imports del adaptador de Redis. Hace pasar T006 y las pruebas de 006.
- [x] T023 Backend: crear `backend/src/shared/tareas/ejecutor-tareas.ts` (ADR-024), en M06 y sin reglas de negocio:
  - registro de tareas por nombre;
  - `pg_try_advisory_lock(hashtext(nombre))` en una conexión propia que se libera al terminar;
  - intervalo con desfase;
  - fila en `scheduled_job_run` con la réplica (`INSTANCIA_ID`), escrita con el rol de la aplicación;
  - método `ejecutarAhora(nombre)` para pruebas y demos;
  - `onModuleDestroy`.

  Agregar `backend/src/host/tareas.ts`, que registra las tareas de los módulos (vacío por ahora), y su proveedor en `app.module.ts`. Hace pasar T007.

- [x] T024 Backend: dominio de M03 en `backend/src/modules/suscripciones-pagos/suscripciones/domain/`:
  - `estado-suscripcion.ts`, con la máquina de estados;
  - `periodo.ts`, con el cálculo de períodos (mes calendario y reglas de FR-004);
  - `politica-de-operacion.ts`, con la tabla de restricciones;
  - `errores.ts`, con `SuscripcionNoPermite`, código `SUSCRIPCION_NO_PERMITE` y detalle `{ estado, accion }`.

  Ampliar `suscripcion.ts` (plan vigente por período). Hace pasar T008, T009 y T010.

- [x] T025 Backend: repositorios de M03 en `backend/src/modules/suscripciones-pagos/suscripciones/infrastructure/` (Kysely y RLS): la suscripción con `FOR UPDATE`, los períodos (insertar y traducir la violación de `EXCLUDE` o `UNIQUE` a "ya cubierto"; `subscription.current_period_end` se actualiza en la misma transacción que el período, M2) y los planes públicos. Están en la Base porque los usan US1 y US2 (M1).
- [x] T026 Backend: dominio del pago en `backend/src/modules/suscripciones-pagos/pagos/domain/pago.ts` (estados, transiciones, marcas de revisión e importe en céntimos) y `errores.ts` (`PagoAdelantadoNoPermitido`, `MedioNoDisponible`, `PagoEnLineaNoDisponible`, `PagoYaRevisado`, `NumeroOperacionYaAprobado` e `ImporteDistinto`). Hace pasar T011.
- [x] T027 Backend: crear el puerto `backend/src/modules/suscripciones-pagos/pagos/application/ports/payment-gateway.ts` con los tipos y errores (`ProveedorNoDisponible`, `FirmaInvalida` y `PagoDesconocido`) del contrato §1, sin tipos del proveedor.
- [x] T028 [P] Backend: crear el simulador en `backend/simulador-pagos/`:
  - `servidor.ts`, con `iniciarSimulador({ puerto, secretoFirma, llaveSecreta, tokenControl, urlNotificaciones })`, que devuelve `{ url, cerrar, cambiarModo }`, y arranque por línea de comandos;
  - `estado.ts`, con las sesiones en memoria;
  - `firma.ts`, con el HMAC-SHA256 `t.cuerpo`;
  - `modos.ts`;
  - `checkout.ts`, con la página alojada mínima.

  Solo `node:http`, `node:crypto` y `fetch`, con reintentos de notificación (5, con espera de 1 a 16 s). Hace pasar T014.

- [x] T029 Backend: crear `backend/src/modules/suscripciones-pagos/pagos/infrastructure/pasarela-simulada.adapter.ts`:
  - `fetch` con `AbortSignal.timeout(PAGOS_TIEMPO_LIMITE_MS)`;
  - interruptor de M06 (5 fallos en 60 s, 30 s abierto);
  - `verificarNotificacion` con `timingSafeEqual`, ±5 min y descarte de los datos del pagador;
  - `limitesYape`, que en el simulador va de 600 a 50 000.

  Crear la fábrica que elige el adaptador por `PAGOS_PROVEEDOR` (`culqi` lanza "adaptador no disponible" hasta que exista; línea de corte R15) en `suscripciones-pagos.module.ts`. Agregar el ayudante `backend/test/helpers/simulador.ts`, que lo inicia en el proceso y fija las variables. Hace pasar T013.

- [x] T030 Backend: token de plataforma:
  - `JoseTokenSigner` (`backend/src/modules/acceso-barberias/identidad/infrastructure/jose-token-signer.ts`) firma y verifica `aud: "plataforma"` sin `tid`, sin aceptar nunca un token de barbería como de plataforma ni al revés;
  - el decorador `@Plataforma()` va en `backend/src/host/solicitud.ts`;
  - `AuthGuard` (`backend/src/host/auth.guard.ts`) acepta el token de plataforma solo en rutas `@Plataforma()`, sin fijar el tenant, deja en la solicitud el actor `{ adminId, rol: 'ADMIN_PLATAFORMA', sesionId }` y rechaza en las demás.

  Hace pasar T016.

- [x] T031 Backend: implementar en `backend/.dependency-cruiser.cjs` las reglas `lectura-plataforma-confinada`, `pasarela-solo-por-puerto` y `simulador-fuera-del-monolito`, y ajustar `m06-solo-por-interfaz-publica` para permitir `shared/lectura-plataforma.ts`. Hace pasar T015.
- [x] T032 Backend: en `backend/src/modules/suscripciones-pagos/suscripciones-api.ts`, agregar `exigirOperacion(tenantId, accion)` y `estadoOperativo(tenantId)`. Leen la suscripción en la transacción del llamador, con RLS, y todavía no tienen llamadores. Exportar `SuscripcionNoPermite` y el tipo `AccionSuscripcion` en `backend/src/modules/suscripciones-pagos/index.ts`.

**Checkpoint (Base)**: CI en verde, con el backend completo. Hay que comprobar:

- `npm run migrate` sobre la base de desarrollo con datos de 002;
- `/salud/listo` responde 200;
- PR20 pasa contra el simulador;
- PR09 `lectura-plataforma` y PR14 pasan.

El frontend no cambia.

---

## Phase 3: User Story 1 - El propietario ve su suscripción y la paga con Yape (Priority: P1) 🎯 MVP

**Goal**: estado y planes; iniciar el pago con Yape, con un solo pago abierto; notificación firmada,
idempotente y atómica que crea el período; conciliación periódica de los pagos pendientes (principio
V); resiliencia ante el proveedor; pantalla de suscripción.

**Independent Test**: con el simulador, una barbería en prueba paga BÁSICO. La notificación, aunque
llegue 10 veces, crea un solo período, que empieza al terminar la prueba. Con la pasarela caída, el
mensaje llega en 3 s o menos. Un pago aprobado sin notificación queda aprobado tras la conciliación,
con un solo período.

### Tests for User Story 1 ⚠️

- [x] T033 [P] [US1] Backend: en `backend/test/helpers/contrato.ts`, agregar `erroresDeContrato003`, que carga `specs/003-suscripciones-pagos/contracts/openapi.yaml`. Crear `backend/test/contract/suscripcion.contract.spec.ts`: `GET /planes`, `GET /suscripcion`, `GET /suscripcion/estado-operativo`, `POST /suscripcion/pagos` (201, 200, 409, 422 y 503) y `GET /suscripcion/pagos/{id}` validan contra el esquema; `estado-operativo` con BARBERO o CLIENTE solo trae `aceptaReservas` y el mensaje, sin el estado de la suscripción (FR-039).
- [x] T034 [P] [US1] Backend: en `backend/test/integration/pagos/iniciar-pago.spec.ts`, probar:
  - el pago queda `PENDIENTE` con el importe del plan;
  - dos `POST` simultáneos iguales dejan **una** fila y la misma respuesta;
  - otro plan anula el pago anterior y lo cancela en el simulador;
  - pagar con un período ya pagado por adelantado responde 409 `PAGO_ADELANTADO_NO_PERMITIDO`;
  - un plan fuera del rango de Yape responde 422 `MEDIO_NO_DISPONIBLE_PARA_EL_PLAN`;
  - el cuerpo no acepta campos de tarjeta (400);
  - un cambio de precio posterior no cambia el importe del pago;
  - el mismo intento con la sesión de pago vencida (`checkout_url_expires_at` pasado) anula el pago anterior, intenta cancelarlo en el simulador y crea uno nuevo con otra `urlPago` (H3);
  - con un comprobante `EN_REVISION`, iniciar otro pago, de cualquier plan o medio, responde 409 `COMPROBANTE_YA_EN_REVISION` y no anula nada (H4);
  - el pago guarda en `covers_after` la cobertura vigente al iniciarlo.
- [x] T035 [P] [US1] Backend: **PR17** en `backend/test/integration/pagos/notificaciones.spec.ts`, con el simulador:
  - notificación válida: el pago queda aprobado y el período empieza al terminar la prueba (escenario 6);
  - **10 repetidas**: 1 período, 1 transición y 9 respuestas 200 sin efecto;
  - firma inválida, ausente o con `t` vencido: 401, sin filas, y una línea resumida `PAGO_NOTIFICACION_RECHAZADA` sin el cuerpo;
  - `PENDIENTE` después de `APROBADO`: sin efecto;
  - importe distinto: sin período, con `review = IMPORTE_DISTINTO`;
  - referencia desconocida: `provider_event` con `SIN_PAGO`;
  - aprobación tardía de un pago `ANULADO` o `EXPIRADO`: aprobado, y `DUPLICADO` si su período objetivo ya estaba tomado (FR-012a);
  - **dos pagos del mismo período objetivo** (un Yape anulado que se terminó de pagar y otro pago ya aprobado): el segundo queda `DUPLICADO` y sin período, aunque no se solaparía (H1); un pago que al aprobarse excedería el tope de un período por adelantado también queda `DUPLICADO`;
  - aprobado tras un rechazado: con marca y sin período;
  - devolución: marca `DEVOLUCION` sin cambio de la suscripción;
  - dos eventos distintos de aprobación del mismo pago a la vez: un solo período (gracias a `EXCLUDE` y `UNIQUE`);
  - el reenvío legítimo días después, con `t` nuevo y el mismo `evento_id`: 200 sin efecto;
  - más de `PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO` solicitudes por minuto desde una IP (600 por defecto; la prueba lo baja a 5) responden 429 (FR-013a);
  - el p95 de 50 notificaciones válidas queda por debajo de 300 ms y ninguna supera 1 s (FR-018).
- [x] T036 [P] [US1] Backend: **PR09** en `backend/test/integration/aislamiento/aislamiento-pagos.spec.ts`. Con las barberías A y B, pagos, períodos y eventos de ambas:
  - el propietario de A recibe 404 en el pago de B;
  - `GET /suscripcion` solo muestra la suya;
  - por SQL con `barberias_app` y el tenant de A, no aparece ninguna fila de B en `payment`, `subscription_period` ni `subscription`;
  - una notificación de un pago de B nunca modifica a A.
- [x] T037 [P] [US1] Backend: **PR06** en `backend/test/integration/pagos/proveedor-caido.spec.ts`:
  - con el modo `caido`: 503 `PAGO_EN_LINEA_NO_DISPONIBLE` en 3 s o menos, con la alternativa de transferencia en los detalles, y el pago `ANULADO`;
  - con el modo `colgado`: tiempo límite de 2 s y el mismo resultado;
  - tras 5 fallos en 60 s, el circuito se abre y la respuesta llega en menos de 100 ms;
  - durante la caída, una reserva y `GET /publico/{slug}` siguen respondiendo.
- [x] T038 [P] [US1] Backend: en `backend/test/integration/pagos/canarios.spec.ts` (SC-010), con la llave secreta, el secreto de firma y un teléfono de pagador enviado por el simulador como datos canario, comprobar que ninguno aparece en los registros capturados, en `audit_log`, en `provider_event` ni en las respuestas de error.
- [x] T039 [P] [US1] Backend: **PR08**. Crear `backend/test/contract/rbac-003.spec.ts`, que lee `specs/003-suscripciones-pagos/contracts/rbac.md` y recorre las filas de una lista `IMPLEMENTADAS` (cada fase agrega las suyas). En US1: `GET /planes`, `GET /suscripcion`, `GET /suscripcion/estado-operativo`, `POST /suscripcion/pagos`, `GET /suscripcion/pagos/{id}` y `POST /pagos/notificaciones`. Cada celda se prueba con PROPIETARIO, BARBERO, CLIENTE, el token de plataforma y sin token.
- [x] T040 [P] [US1] Backend: en `backend/test/integration/pagos/conciliacion.spec.ts` (principio V, en P1), probar:
  - un pago aprobado en el simulador sin notificación queda aprobado y con un solo período;
  - uno rechazado o expirado en el proveedor queda así;
  - uno pendiente de 24 h pasa a `EXPIRADO`, y una aprobación posterior se aplica o queda como duplicado si su período objetivo ya está tomado (FR-012a);
  - la conciliación y la notificación simultáneas producen un solo efecto;
  - con el proveedor caído durante la conciliación, no hay cambios y se reintenta en la siguiente corrida;
  - dos réplicas a la vez producen una sola consulta por pago (registro de solicitudes del simulador).
- [x] T041 [P] [US1] Backend: en `backend/test/integration/suscripciones/cobertura-derivada.spec.ts` (M2), comprobar que, tras la aprobación por notificación y por conciliación, `subscription.current_period_end` es igual al mayor `ends_at` de `subscription_period` de esa suscripción, y que una transacción que falla a mitad no deja los dos valores distintos. US2, US3 y US5 agregan sus casos (vencimiento, revisión del comprobante y activación manual).
- [x] T042 [P] [US1] Frontend: en `frontend/test/pages/suscripcion.spec.tsx`, con MSW, probar:
  - estado "En prueba" con fechas y días;
  - los planes con su precio;
  - "Pagar con Yape" redirige a `urlPago`;
  - al volver con `?pago=`, consulta hasta ver "Aprobado";
  - el 503 muestra el mensaje con la opción de transferencia;
  - el aviso FR-005a, calculado con `GET /usuarios` y `GET /barberos` frente a los límites del plan elegido.

### Implementation for User Story 1

- [x] T043 [US1] Backend: repositorios de pagos en `backend/src/modules/suscripciones-pagos/pagos/infrastructure/`:
  - el pago, que traduce el índice de pago abierto a "ya existe" y devuelve la fila existente;
  - `provider_event`, solo `INSERT … ON CONFLICT DO NOTHING` con el `effect` ya calculado (el rol de la aplicación no lee ni actualiza la tabla); devuelve si se insertó;
  - `plataforma/pago-por-referencia.ts`, con la búsqueda exacta por `provider_reference` mediante `LecturaPlataforma` (ADR-031).
- [x] T044 [US1] Backend: casos de uso en `backend/src/modules/suscripciones-pagos/suscripciones/application/`: `ListarPlanes` (públicos y activos, con los medios disponibles según `limitesYape`), `ConsultarSuscripcion` (FR-001: estado, fechas, días, próximo período, pago abierto y avisos) y `ConsultarEstadoOperativo` (al propietario, el estado y el motivo; al barbero y al cliente, solo `aceptaReservas` y el mensaje: FR-039, M8).
- [x] T045 [US1] Backend: casos de uso en `backend/src/modules/suscripciones-pagos/pagos/application/`:
  - `IniciarPago`: Yape, con un solo pago abierto, `covers_after` fijado al insertar, reutilización solo si la sesión de pago sigue vigente (si venció, se anula, se intenta cancelar y se crea otra), anulación al cambiar de plan o de medio salvo con un comprobante `EN_REVISION` (409 `COMPROBANTE_YA_EN_REVISION`), el rechazo del pago adelantado, `crearSesionDePago` tras insertar y `ANULADO` si el proveedor falla;
  - `AplicarResultadoDelProveedor`: función única con el pago y la suscripción bloqueados, la transición del pago, el período por FR-004 (`DUPLICADO` si el período objetivo de `covers_after` ya está tomado o si se excede el tope de un período por adelantado), `current_period_end` actualizado en la misma transacción, la marca de revisión y la auditoría `PAGO_APROBADO`. Hace pasar T041;
  - `RecibirNotificacion`: verificar, buscar el tenant por la vía de la plataforma y aplicar en **una** transacción con ese tenant: bloquear el pago, calcular el efecto, insertar el evento y, si se insertó, aplicar; si no, revertir y responder 200.
- [x] T046 [US1] Backend: crear la tarea `conciliar-pagos` en `backend/src/modules/suscripciones-pagos/pagos/application/conciliar-pagos.ts` (pendientes de más de 10 min, por la lectura de plataforma, con `consultarPago` y `AplicarResultadoDelProveedor`, y la expiración a las 24 h). Registrarla en `backend/src/host/tareas.ts`. Hace pasar T040.
- [x] T047 [US1] Backend: en `backend/src/modules/suscripciones-pagos/suscripciones/application/obtener-limite-barberos.ts` y `obtener-limite-usuarios.ts`, usar el **plan del período vigente** (R04, FR-005). Las pruebas de límites de 001 y 002 deben seguir en verde. Agregar `backend/test/integration/suscripciones/plan-menor.spec.ts` (FR-005a, M3): con un período vigente de un plan con límites menores que los usuarios y barberos activos, nada se desactiva solo; crear o reactivar un usuario o un barbero por encima del límite se rechaza con el error de límite existente, y desactivar sigue permitido.
- [x] T048 [US1] Backend: crear la matriz de permisos de M03 en `backend/src/modules/suscripciones-pagos/suscripciones/domain/permisos.ts`, con `VER_PLANES`, `VER_SUSCRIPCION`, `VER_ESTADO_OPERATIVO` y `PAGAR_SUSCRIPCION` según `contracts/rbac.md`, exportada por `index.ts`. Sumarla a `rolPermiteOperacion` en `backend/src/host/roles.guard.ts`.
- [x] T049 [US1] Backend: controladores en `backend/src/modules/suscripciones-pagos/suscripciones/presentation/`:
  - `suscripcion.controller.ts`: `/planes`, `/suscripcion`, `/suscripcion/estado-operativo`, `POST /suscripcion/pagos` y `GET /suscripcion/pagos/:id`;
  - `notificaciones.controller.ts`: `@Publica()`, límite propio por IP de `PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO` (600 por defecto, configurable) y cuerpo crudo de hasta 16 KB.

  Configurar el cuerpo crudo de `/pagos/notificaciones` en `configurarApp`, en `backend/src/main.ts`. Hace pasar T033 a T039.

- [x] T050 [P] [US1] Frontend: crear `frontend/src/api/suscripcion.ts`, con los tipos de `contracts/openapi.yaml` y las funciones `planes`, `suscripcion`, `estadoOperativo`, `iniciarPago` y `pago(id)`, y el código `PAGO_EN_LINEA_NO_DISPONIBLE` en `frontend/src/api/client.ts`.
- [x] T051 [US1] Frontend: crear `frontend/src/pages/panel/Suscripcion.tsx`, con carga diferida:
  - estado, fechas, límites y avisos;
  - elegir plan, con el aviso FR-005a;
  - "Pagar con Yape", que redirige;
  - al volver, consulta el pago hasta 60 s.

  Agregar la ruta `/app/suscripcion` y el enlace en el menú del propietario (`frontend/src/routes.tsx` y `frontend/src/components/app/`). Hace pasar T042.

**Checkpoint (US1)**: CI en verde (backend, y luego frontend). Hay que comprobar:

- PR17, PR06, PR09 de pagos, `canarios`, `conciliacion`, `cobertura-derivada`, `plan-menor`, las filas de US1 de `rbac-003` y el contrato pasan;
- `quickstart.md` §3, pasos 1 a 4 y 8 (conciliación, con el simulador en `aprobar_despues`), funciona con Docker Compose.

---

## Phase 4: User Story 2 - La prueba y las suscripciones impagas vencen solas y restringen la barbería (Priority: P1)

**Goal**: tarea `vencer-suscripciones` sin duplicados entre réplicas; llamadas a `exigirOperacion` en
las operaciones de 002 y de M01; avisos en la interfaz.

**Independent Test**: dos instancias ejecutan la tarea a la vez sobre 50 suscripciones vencidas, y cada
una cambia una sola vez. Una barbería vencida rechaza las reservas con `SUSCRIPCION_NO_PERMITE` y
permite cancelar.

### Tests for User Story 2 ⚠️

- [x] T052 [P] [US2] Backend: en `backend/test/integration/tareas/vencimiento.spec.ts`, ejecutando con `ejecutarAhora`, probar las transiciones:
  - TRIAL → EXPIRED;
  - ACTIVE → PAST_DUE, con `grace_ends_at` a 7 días;
  - PAST_DUE → EXPIRED;
  - TRIAL → ACTIVE con un período pagado, y el cambio de `plan_id`;
  - ACTIVE → ACTIVE al empezar un período de otro plan;
  - un caso más en `cobertura-derivada.spec.ts`: tras cada transición, `current_period_end` coincide con los períodos.

  Comprobar también la auditoría con la fecha que correspondía (FR-031), y el pago confirmado durante la gracia que empieza al final del período vencido (escenario 8).

- [x] T053 [P] [US2] Backend: **vencimiento con dos réplicas** en `backend/test/integration/tareas/vencimiento-dos-replicas.spec.ts`, con dos instancias (`crearApp`) sobre la misma base y 50 suscripciones vencidas:
  - `ejecutarAhora` en ambas a la vez da 50 transiciones y 50 auditorías, sin repetir;
  - una instancia que falla a mitad (repositorio sustituido que lanza tras 20) deja que la siguiente corrida termine el resto sin repetir;
  - una aprobación de pago simultánea con el vencimiento deja la suscripción en ACTIVE (FR-033);
  - `scheduled_job_run` registra las dos réplicas.
- [x] T054 [P] [US2] Backend: en `backend/test/integration/suscripciones/restricciones-estado.spec.ts`, la prueba lee las dos tablas de `contracts/restricciones-estado.md`. Para cada estado y cada caso de uso de §2, llama a la API real y comprueba 2xx o 403 `SUSCRIPCION_NO_PERMITE`, con el mensaje correcto ("no acepta reservas por ahora" para `RESERVAR`, nunca "horario no disponible"). Las lecturas siguen respondiendo, y nada se borra ni se cancela. Además (SC-008, escenario 7 de US2), una barbería vencida que paga vuelve a aceptar reservas en la solicitud siguiente a la aprobación, sin esperar a la tarea.
- [x] T055 [P] [US2] Backend: **PR14**. En `backend/test/architecture/operaciones-con-politica.spec.ts`, la prueba lee §2 de `contracts/restricciones-estado.md` y falla si alguna clase listada no llama a `exigirOperacion` en su método `ejecutar` (análisis del texto fuente).
- [x] T056 [P] [US2] Backend: **PR13**. Ampliar `backend/test/integration/auditoria.spec.ts` con `SUSCRIPCION_VENCIDA`, `SUSCRIPCION_EN_GRACIA` y `SUSCRIPCION_ACTIVADA` (tenant, fecha que correspondía y sin datos personales), y `PAGO_APROBADO`.
- [x] T057 [P] [US2] Frontend: en `frontend/test/pages/suscripcion-vencida.spec.tsx`, con MSW, probar:
  - `Reservar` muestra "Esta barbería no acepta reservas por ahora" antes de elegir horario si `aceptaReservas` es falso;
  - el panel muestra el aviso de gracia con su fecha;
  - un formulario de catálogo que recibe 403 `SUSCRIPCION_NO_PERMITE` muestra "Tu suscripción no permite este cambio".

### Implementation for User Story 2

- [x] T058 [US2] Backend: crear la tarea `vencer-suscripciones` en `backend/src/modules/suscripciones-pagos/suscripciones/application/vencer-suscripciones.ts`, más su lectura en `backend/src/modules/suscripciones-pagos/suscripciones/infrastructure/plataforma/suscripciones-por-vencer.ts` (lotes de 100). Cada elemento corre en su transacción con el tenant, con `FOR UPDATE SKIP LOCKED`, transición condicional y auditoría. Registrarla en `backend/src/host/tareas.ts`. Hace pasar T052, T053 y T056.
- [x] T059 [US2] Backend: en `backend/test/helpers/fixtures.ts`, hacer que `sembrarBarberia` siembre una suscripción TRIAL vigente por defecto (opción `suscripcion: false` para no sembrarla). Ajustar `barberiaParaReservar` para no duplicarla. Así, las pruebas de 001, 002 y 006 siguen en verde con las restricciones activas.
- [x] T060 [US2] Backend: en M02, llamar a `suscripciones.exigirOperacion(tenantId, accion)` al empezar, dentro del `uow.ejecutar`, de cada caso de uso de §2:
  - `backend/src/modules/catalogo-citas/citas/application/reservar-cita.ts`, `cancelar-cita.ts` y `cambiar-estado-cita.ts`;
  - `backend/src/modules/catalogo-citas/catalogo/application/servicios.ts`, `barberos.ts`, `horarios.ts` y `bloqueos.ts`.

  Traducir el error de `RESERVAR` al mensaje "Esta barbería no acepta reservas por ahora". Hace pasar T054 y T055 para M02.

- [x] T061 [US2] Backend: en M01, llamar a `exigirOperacion(…, 'GESTIONAR_USUARIOS')` en `backend/src/modules/acceso-barberias/identidad/application/crear-usuario.ts`, `actualizar-usuario.ts` y `regenerar-activacion.ts`. Hace pasar T054 y T055 para M01.
- [x] T062 [US2] Frontend:
  - aviso en `frontend/src/pages/publico/Reservar.tsx`, con `estadoOperativo` tras el inicio de sesión;
  - aviso de gracia, vencida y suspendida en el diseño del panel (`frontend/src/components/app/`);
  - manejo de 403 `SUSCRIPCION_NO_PERMITE` en `frontend/src/api/client.ts`, con el mensaje del servidor.

  Hace pasar T057.

**Checkpoint (P1: US1 + US2)**: CI en verde (backend, y luego frontend). Toda la suite de 001, 002 y 006
sigue pasando con las restricciones activas. Hay que comprobar `quickstart.md` §3, paso 7, con Compose.
**MVP de cobro:** pagar con Yape y vencer automáticamente.

---

## Phase 5: Ingreso del administrador con segundo factor (Priority: P2, habilita US3 y US5)

**Goal**: cuenta del administrador por línea de comandos, ingreso en dos pasos con TOTP, sesión de
plataforma y auditoría del acceso (ADR-031, R07).

**Independent Test**: con `plataforma:crear-admin`, el administrador entra con su contraseña y un
código TOTP, obtiene un token de plataforma que sirve solo en `/plataforma/*`, y 5 intentos fallidos
lo bloquean.

### Tests ⚠️

- [x] T063 [P] [US3] Backend: en `backend/test/unit/identidad/totp.spec.ts`, probar:
  - los vectores de prueba del RFC 6238 (SHA-1, 6 dígitos, paso de 30 s);
  - la tolerancia de ±1 paso;
  - un código cuyo paso no es mayor que el último `totp_step` de las sesiones del administrador se rechaza;
  - el secreto cifrado con AES-256-GCM se descifra, y uno alterado falla;
  - los códigos de recuperación se aceptan una sola vez.
- [x] T064 [P] [US3] Backend: en `backend/test/integration/identidad/segundo-factor.spec.ts`, probar:
  - el ingreso devuelve el desafío;
  - el TOTP correcto da el token `aud` plataforma y la cookie con ruta `/api/v1/plataforma/auth`;
  - un desafío vencido o usado da 401;
  - un código reusado da 401, también si llega por la otra réplica (`platform_session.totp_step`), y dos ingresos simultáneos con el mismo código abren una sola sesión (`UNIQUE (admin_id, totp_step)`);
  - un código de recuperación sirve una sola vez, y dos usos simultáneos del mismo código dejan uno aceptado (`UNIQUE (admin_id, used_recovery_index)`);
  - 5 fallos en 15 min dan 429 (`login_attempt`);
  - renovar y salir funcionan;
  - `platform_audit_log` registra el ingreso, el fallo, la recuperación y la salida;
  - el token del administrador da 401 en `GET /agenda`, `GET /clientes` y `GET /servicios`;
  - **canarios (SC-010, M7):** el secreto TOTP, la URI `otpauth://` y los códigos de recuperación no aparecen en los registros capturados, en `platform_audit_log`, en `audit_log` ni en las respuestas de error.
- [x] T065 [P] [US3] Backend: **PR08**. Agregar a `IMPLEMENTADAS`, en `backend/test/contract/rbac-003.spec.ts`, las filas `POST /plataforma/auth/ingresar` y `POST /plataforma/auth/segundo-factor`, y la fila "Cualquier ruta de 001 y 002 con token" con el administrador (401 en todas las rutas con `@Operacion` de M01 y M02, generadas desde las matrices existentes).
- [x] T066 [P] [US3] Frontend: en `frontend/test/pages/plataforma-ingreso.spec.tsx`, con MSW, probar los dos pasos, el código incorrecto, el uso de un código de recuperación y la salida, y que el token de plataforma vive separado de la sesión de barbería.

### Implementation

- [x] T067 [US3] Backend: crear el puerto `backend/src/modules/acceso-barberias/identidad/application/ports/segundo-factor.ts` y su adaptador `backend/src/modules/acceso-barberias/identidad/infrastructure/totp-node.ts` (HMAC-SHA1 con `node:crypto`, AES-256-GCM con `PLATAFORMA_LLAVE_TOTP` y códigos de recuperación con hash Argon2id). Hace pasar T063.
- [x] T068 [US3] Backend: repositorios de la plataforma en `backend/src/modules/acceso-barberias/identidad/infrastructure/plataforma/` (el administrador se lee con `LecturaPlataforma`, porque el rol de la aplicación no tiene permiso sobre `platform_admin`; el desafío, la sesión con `totp_step`, el uso del código de recuperación en `platform_challenge.used_recovery_index` y la auditoría de acceso se escriben con el rol de la aplicación) y casos de uso en `backend/src/modules/acceso-barberias/identidad/application/plataforma/`: `IngresarAdmin` (tiempo constante, igual que el inicio de sesión de 001), `VerificarSegundoFactor`, `RenovarSesionPlataforma` (vida máxima de 8 h) y `SalirPlataforma`.
- [x] T069 [US3] Backend: crear `backend/src/modules/acceso-barberias/identidad/presentation/plataforma-auth.controller.ts` (`/plataforma/auth/*`, con la cookie `HttpOnly`, `SameSite=Strict` y la ruta propia). Hace pasar T064 y T065.
- [x] T070 [P] [US3] Backend: crear `backend/scripts/crear-admin-plataforma.ts` (`npm run plataforma:crear-admin -- --correo --nombre`). Pide la contraseña sin eco o la toma de `--contrasena-desde-entorno`, e imprime **una vez** la URI `otpauth://` y 10 códigos de recuperación. Rechaza un correo repetido.
- [x] T071 [US3] Frontend: crear `frontend/src/auth/plataforma.tsx` (sesión de plataforma separada), `frontend/src/api/plataforma.ts`, `frontend/src/pages/plataforma/Ingresar.tsx` (dos pasos) y el diseño `/plataforma` con su menú. Agregar las rutas en `frontend/src/routes.tsx` con carga diferida. Hace pasar T066.

**Checkpoint (administrador)**: CI en verde. El administrador creado por línea de comandos entra con
TOTP. Su token no abre ninguna ruta de barbería, y uno de barbería no abre las de plataforma.

---

## Phase 6: User Story 3 - El propietario paga por transferencia y el administrador revisa el comprobante (Priority: P2)

**Goal**: transferencia con referencia, comprobante privado (ADR-023), cola de revisión, aprobación
única con importe exacto y número de operación único.

**Independent Test**: el propietario sube un PNG con su número de operación y el administrador lo
aprueba, lo que crea un período. El mismo número en otra barbería no puede aprobarse. Un `.txt`
renombrado se rechaza sin guardarse.

### Tests for User Story 3 ⚠️

- [x] T072 [P] [US3] Backend: en `backend/test/unit/pagos/tipo-de-archivo.spec.ts`, probar la detección por bytes: JPEG, PNG y PDF válidos, un texto renombrado, un archivo vacío, una cabecera truncada y un PNG con extensión `.pdf`.
- [x] T073 [P] [US3] Backend: en `backend/test/integration/pagos/comprobantes.spec.ts`, probar:
  - iniciar la transferencia devuelve los datos de la cuenta, el importe y la referencia `SUS-…`;
  - subir JPG, PNG o PDF con número de operación y fecha deja `EN_REVISION`;
  - un tipo falso, más de 5 MB, o un número o una fecha inválidos responden 400 sin guardar nada;
  - el sexto comprobante del día responde 429;
  - un segundo comprobante con uno en revisión responde 409 `COMPROBANTE_YA_EN_REVISION`;
  - la descarga del propietario lleva `attachment`, `nosniff` y `no-store`, y sin sesión responde 401;
  - el administrador aprueba con el importe exacto y se crea un período;
  - un importe distinto responde 422;
  - un rechazo sin motivo responde 400, y con motivo permite un comprobante nuevo;
  - dos revisiones simultáneas dejan una aplicada y la otra con 409 `PAGO_YA_REVISADO`;
  - el mismo número de operación ya aprobado en otra barbería responde 409 `NUMERO_OPERACION_YA_APROBADO`; en la cola aparece con `numeroRepetido` (comparando `bank_operation_hash`) y solo `numeroOperacionFinal`, y el número completo solo en `GET /plataforma/barberias/{id}/pagos/{pagoId}` (H2);
  - el mismo SHA-256 en otra barbería queda señalado;
  - `ESPERANDO_COMPROBANTE` pasa a `EXPIRADO` a los 7 días;
  - un caso más en `cobertura-derivada.spec.ts`: tras aprobar un comprobante, `current_period_end` coincide con los períodos.
- [x] T074 [P] [US3] Backend: **PR09**. Ampliar `backend/test/integration/aislamiento/aislamiento-pagos.spec.ts`:
  - el comprobante de A da 404 al propietario de B, por la API;
  - por SQL con `barberias_app` y el tenant de B, no aparece en `payment_receipt` ni en `payment_receipt_file`;
  - `barberias_plataforma` no puede leer `payment_receipt_file`;
  - `GET /plataforma/barberias/{B}/pagos/{pago de A}/comprobante` responde 404.
- [x] T075 [P] [US3] Backend: en `backend/test/integration/pagos/canarios.spec.ts`, agregar casos: el contenido y el nombre original de un comprobante canario no aparecen en los registros, la auditoría, los errores ni la cola del administrador.
- [x] T076 [P] [US3] Backend: **PR13** en `backend/test/integration/auditoria.spec.ts`: `COMPROBANTE_APROBADO` y `COMPROBANTE_RECHAZADO` en el `audit_log` de la barbería, con el administrador como actor, el motivo y sin el contenido del comprobante.
- [x] T077 [P] [US3] Backend: **PR08**. Agregar a `IMPLEMENTADAS` en `rbac-003.spec.ts` las filas de los comprobantes del propietario y del administrador (`/suscripcion/pagos/{id}/comprobante`, `/plataforma/comprobantes`, `GET /plataforma/barberias/{id}/pagos/{pagoId}`, `/plataforma/barberias/{id}/pagos/{pagoId}/comprobante` y `/revision`).
- [x] T078 [P] [US3] Frontend: en `frontend/test/pages/transferencia.spec.tsx` y `frontend/test/pages/plataforma-comprobantes.spec.tsx`, con MSW, probar:
  - los datos de la transferencia y la referencia;
  - la subida con el archivo, el número y la fecha;
  - el estado "comprobante en revisión";
  - el motivo de rechazo y la subida de otro;
  - la cola del administrador con el número ya usado;
  - ver el comprobante como `blob:` que se revoca;
  - aprobar con el importe y rechazar con motivo.

### Implementation for User Story 3

- [x] T079 [US3] Backend: crear el puerto `backend/src/modules/suscripciones-pagos/pagos/application/ports/almacen-comprobantes.ts` y el adaptador `backend/src/modules/suscripciones-pagos/pagos/infrastructure/almacen-comprobantes-postgres.ts` (`bytea` con RLS y SHA-256), y la detección por bytes en `backend/src/modules/suscripciones-pagos/pagos/domain/tipo-de-archivo.ts`. Hace pasar T072.
- [x] T080 [US3] Backend: casos de uso en `backend/src/modules/suscripciones-pagos/pagos/application/`:
  - `IniciarPago` con el medio `TRANSFERENCIA` (referencia y datos de la cuenta desde la configuración);
  - `SubirComprobante` (contador diario, un solo comprobante en revisión, número normalizado, con `bank_operation_last4` y `bank_operation_hash`, y fecha válida);
  - `DescargarComprobante`.
- [x] T081 [US3] Backend: casos de uso del administrador en `backend/src/modules/suscripciones-pagos/plataforma/application/`:
  - `ColaDeComprobantes` (lectura de plataforma, con `bank_operation_last4`, el número repetido por `bank_operation_hash` y el SHA-256 repetido);
  - `DetalleDePago`, con el tenant de la ruta, que devuelve el número de operación completo (H2);
  - `VerComprobante`, con el tenant de la ruta;
  - `RevisarComprobante`, con el tenant de la ruta, revisión única, importe exacto, número único traducido a 409 y `AplicarResultadoDelProveedor` para crear el período.

  Las lecturas van en `backend/src/modules/suscripciones-pagos/plataforma/infrastructure/plataforma/`.

- [x] T082 [US3] Backend: crear la tarea `expirar-transferencias` (`ESPERANDO_COMPROBANTE` de más de 7 días) en `backend/src/modules/suscripciones-pagos/pagos/application/expirar-transferencias.ts`, y registrarla en `backend/src/host/tareas.ts`.
- [x] T083 [US3] Backend: controladores.
  - **Propietario:** en `suscripcion.controller.ts`, `POST` y `GET /suscripcion/pagos/:id/comprobante`, con `FileInterceptor` en memoria, un archivo y 5 MB, más un tipo mínimo propio del archivo en lugar de `@types/multer`.
  - **Administrador:** `backend/src/modules/suscripciones-pagos/plataforma/presentation/comprobantes-plataforma.controller.ts`, con `@Plataforma()`, incluido `GET /plataforma/barberias/:barberiaId/pagos/:pagoId` (detalle con el número completo).
  - **Encabezados de la descarga:** `attachment`, `nosniff` y `no-store`.

  Hace pasar T073 a T077.

- [x] T084 [US3] Frontend: en `frontend/src/pages/panel/Suscripcion.tsx`, agregar la sección de transferencia (datos, subida, estado y rechazo). Crear `frontend/src/pages/plataforma/Comprobantes.tsx` (cola, ver como `blob:` revocado a los 60 s, aprobar con el importe y rechazar con motivo). Hace pasar T078.

**Checkpoint (US3)**: CI en verde. `quickstart.md` §3, pasos 5 y 6, funciona con Compose.

---

## Phase 7: User Story 4 - Historial de pagos y conciliación (Priority: P2)

**Goal**: historial del propietario y lista de pagos por revisar. La tarea `conciliar-pagos` ya se
entregó en US1 (principio V).

**Independent Test**: el historial muestra solo los pagos de la barbería, del más reciente al más
antiguo, con sus marcas. Un pago duplicado aparece en la lista de pagos por revisar y, al resolverse
con nota, sale de ella y queda auditado.

### Tests for User Story 4 ⚠️

- [x] T085 [P] [US4] Backend: en `backend/test/integration/pagos/historial.spec.ts` y en `backend/test/contract/suscripcion.contract.spec.ts`, probar:
  - el orden;
  - los campos (plan, importe, medio, estado, motivo y marca);
  - el número de operación solo con sus últimos 4 caracteres;
  - la paginación;
  - que no aparezca ningún pago de otra barbería.
- [x] T086 [P] [US4] Backend: en `backend/test/integration/plataforma/pagos-por-revisar.spec.ts`, probar que se listan las marcas `DUPLICADO`, `IMPORTE_DISTINTO`, `APROBADO_TRAS_RECHAZO`, `DEVOLUCION` y `SIN_PAGO`, y que la resolución con nota sale de la lista y queda en la auditoría de la barbería (PR13).
- [x] T087 [P] [US4] Backend: **PR08**. Agregar a `IMPLEMENTADAS` las filas `GET /suscripcion/pagos`, `GET /plataforma/pagos/por-revisar` y `/revision/resolucion`.
- [x] T088 [P] [US4] Frontend: en `frontend/test/pages/historial-pagos.spec.tsx` y `frontend/test/pages/plataforma-pagos-revisar.spec.tsx`, con MSW, probar el historial (estados, marca "pago duplicado (en revisión)" y paginación) y la lista del administrador con la resolución.

### Implementation for User Story 4

- [x] T089 [US4] Backend: crear `HistorialDePagos` en `backend/src/modules/suscripciones-pagos/pagos/application/historial-de-pagos.ts` y `GET /suscripcion/pagos` en `suscripcion.controller.ts`. Hace pasar T085.
- [x] T090 [US4] Backend: crear `PagosPorRevisar` y `ResolverRevision` en `backend/src/modules/suscripciones-pagos/plataforma/application/`, y sus rutas en `backend/src/modules/suscripciones-pagos/plataforma/presentation/pagos-plataforma.controller.ts`. Hace pasar T086 y T087.
- [x] T091 [US4] Frontend: agregar el historial en `frontend/src/pages/panel/Suscripcion.tsx`, y crear `frontend/src/pages/plataforma/PagosPorRevisar.tsx`. Hace pasar T088.

**Checkpoint (P2)**: CI en verde. El historial y la lista de pagos por revisar funcionan con Compose
(un pago duplicado provocado con el simulador en `aprobar_despues`).

---

## Phase 8: User Story 5 - El administrador de la plataforma gestiona barberías y suscripciones (Priority: P3)

**Goal**: suspender y reactivar barberías (M01) y suscripciones (M03), activación manual y listado de
barberías sin datos de negocio.

**Independent Test**: el administrador suspende una barbería, y sus usuarios no entran y su enlace no
responde. Al reactivarla, todo vuelve. Una activación manual crea un pago `MANUAL` con su período.

### Tests for User Story 5 ⚠️

- [x] T092 [P] [US5] Backend: en `backend/test/integration/plataforma/barberias-plataforma.spec.ts`, probar:
  - el listado muestra el nombre, el enlace, los estados, el plan y la cobertura, y nada de citas, clientes ni usuarios;
  - suspender la barbería hace que el inicio de sesión dé 401 y el enlace público dé 404, conserva los datos y queda auditado;
  - reactivarla devuelve el acceso;
  - suspender la suscripción con motivo hace que las reservas den 403 y el propietario vea el motivo;
  - un pago aprobado durante la suspensión crea su período, pero la suscripción sigue suspendida;
  - reactivarla recalcula el estado por las fechas (también a EXPIRED si venció);
  - la activación manual crea un pago `MANUAL` con el **precio del plan** como importe, el motivo y la referencia externa, y su período; anula el pago abierto y respeta la regla del pago adelantado y la del período objetivo (FR-036, M6);
  - suspender y reactivar cambian `tenant.status` con el tenant de la ruta, y ninguna ruta del propietario lo cambia (H5);
  - un caso más en `cobertura-derivada.spec.ts`: tras una activación manual, `current_period_end` coincide con los períodos.
- [x] T093 [P] [US5] Backend: **PR13** en `backend/test/integration/auditoria.spec.ts`: `BARBERIA_SUSPENDIDA`, `BARBERIA_REACTIVADA`, `SUSCRIPCION_SUSPENDIDA`, `SUSCRIPCION_REACTIVADA` y `ACTIVACION_MANUAL`, con el administrador como actor y el motivo.
- [x] T094 [P] [US5] Backend: **PR08**. Agregar a `IMPLEMENTADAS` las filas restantes de `contracts/rbac.md` (barberías, suspensiones y activación manual). Ninguna fila queda fuera de la lista: la prueba debe fallar si una fila de la tabla no está implementada.
- [x] T095 [P] [US5] Frontend: en `frontend/test/pages/plataforma-barberias.spec.tsx`, con MSW, probar el listado con búsqueda, suspender y reactivar con motivo y confirmación, y la activación manual.

### Implementation for User Story 5

- [x] T096 [US5] Backend: en M01 `barberias`, crear `SuspenderBarberia` y `ReactivarBarberia` (`tenant.status`, con el tenant de la ruta y auditoría) en `backend/src/modules/acceso-barberias/barberias/application/plataforma/`, y el listado en `backend/src/modules/acceso-barberias/barberias/infrastructure/plataforma/barberias-plataforma.ts`. Los resúmenes de suscripción vienen de `SuscripcionesApi.resumenesParaPlataforma(ids)`, que se agrega en M03 (M01 → M03 está permitido).
- [x] T097 [US5] Backend: en M03 `plataforma`, crear `SuspenderSuscripcion`, `ReactivarSuscripcion` (recalculada por fechas) y `ActivacionManual` (con las reglas de FR-036: el precio del plan como importe, medio `MANUAL`, motivo y referencia externa, y `AplicarResultadoDelProveedor` para el período) en `backend/src/modules/suscripciones-pagos/plataforma/application/`.
- [x] T098 [US5] Backend: crear los controladores `backend/src/modules/acceso-barberias/barberias/presentation/barberias-plataforma.controller.ts` y `backend/src/modules/suscripciones-pagos/plataforma/presentation/suscripciones-plataforma.controller.ts`, con `@Plataforma()`. Hace pasar T092 a T094.
- [x] T099 [US5] Frontend: crear `frontend/src/pages/plataforma/Barberias.tsx` (listado, búsqueda, suspender y reactivar, y activación manual con motivo y referencia). Hace pasar T095.

**Checkpoint (P3)**: CI en verde. `rbac-003` recorre la tabla completa. `quickstart.md` §3, pasos 9 y
10, funciona con Compose.

---

## Phase 9: Cierre (documentación y suite completa)

**Purpose**: documentación exigida por los ADR (principio XI), demostración con el entorno real y suite
completa.

- [x] T100 [P] Backend: crear `backend/scripts/demo-vencimiento.ts` (`npm run demo:vencimiento -- --barberias 50`). Siembra suscripciones vencidas hace una hora, con el superusuario de desarrollo, y las limpia con `--limpiar`. Crear también `backend/scripts/simulador-modo.ts` (`npm run simulador:modo -- <modo> [parámetros]`, con `SIMULADOR_TOKEN_CONTROL`).
- [x] T101 Actualizar la documentación de `docs/`:
  - [multi-tenancy y datos](../../docs/02-arquitectura-software/multi-tenancy-y-datos.md) §3: las tablas nuevas de M03 y de la plataforma, con sus restricciones;
  - [tecnologías](../../docs/02-arquitectura-software/tecnologias.md): el simulador, TOTP y el uso de `multer` ya instalado, sin dependencias nuevas; el contenedor de 64 MB;
  - [API REST](../../docs/02-arquitectura-software/api-rest.md): las rutas de 003;
  - [seguridad y privacidad](../../docs/02-arquitectura-software/seguridad-y-privacidad.md): el segundo factor, los comprobantes y las notificaciones firmadas;
  - [despliegue y escalabilidad](../../docs/02-arquitectura-software/despliegue-y-escalabilidad.md): el simulador y las equivalencias en la nube (S3 y EventBridge).
- [x] T102 [P] Actualizar `tecnologia/plataforma-barberias/README.md`: el servicio `pasarela-simulada`, las variables, los scripts (`plataforma:crear-admin`, `simulador:modo` y `demo:vencimiento`), el rol `barberias_plataforma` para bases existentes, y ADR-022 a ADR-024 y ADR-031.
- [x] T103 [P] Actualizar `docs/trazabilidad.md` (la fila de 003 con su estado y los números de la suite, y una subsección con los componentes y su evidencia), `docs/05-gestion/04-pruebas.md` (PR06, PR17, PR20 y PR25 ejecutadas; PR08, PR09 y PR13 ampliadas) y `docs/05-gestion/02-backlog-y-sprints.md` (003 implementada y las líneas de corte aplicadas, si se usaron).
- [x] T104 Recorrer `specs/003-suscripciones-pagos/quickstart.md` §3, pasos 1 a 10, y §4 (vencimiento con dos réplicas) con Docker Compose y el simulador, por HTTP con un script temporal en `tmp/` que se borra al terminar. Registrar los resultados y los tiempos de SC-001 y SC-007 en §6.
- [x] T105 Ejecutar la suite completa y registrar los totales en `quickstart.md` §6: primero el backend (Prettier, lint, build, unitarias, integración y arquitectura) y después, solo, el frontend (Prettier, lint, build y un solo proceso de Vitest). Si una prueba de tiempos falla por la carga del equipo, repetirla sola y anotarlo.
- [x] T106 Limpieza: borrar `tmp/`, detener Compose (`docker compose stop`), comprobar que no quedan contenedores de Testcontainers ni archivos en la caché de npm de C:, y formatear con el Prettier local (`npx --no-install`) los documentos tocados.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (fase 1):** sin dependencias.
- **Base (fase 2):** depende de la 1 y **bloquea** todo. Dentro de la fase, las migraciones (T017–T020) van antes de la lectura de plataforma (T021) y de los adaptadores (T029).
- **US1 (fase 3):** depende de la Base.
- **US2 (fase 4):** depende de la Base, donde están los repositorios de suscripción y períodos (T025) que usa la tarea de vencimiento. Su prueba de pago simultáneo con el vencimiento (T053) usa `AplicarResultadoDelProveedor` de US1 (T045), y el caso de SC-008 de T054 usa el pago de US1.
- **Administrador (fase 5):** depende de la Base (T030, token de plataforma). Es independiente de US1 y US2.
- **US3 (fase 6):** depende del administrador (fase 5) y de `AplicarResultadoDelProveedor` (US1).
- **US4 (fase 7):** depende de US1 (pagos y conciliación), y de US3 para la lista de pagos por revisar con comprobantes.
- **US5 (fase 8):** depende del administrador (fase 5) y de US1 para la activación manual.
- **Cierre (fase 9):** después de las historias que se entreguen.

### User Story Dependencies

- **US1:** independiente tras la Base.
- **US2:** independiente tras la Base, salvo T053 y el caso de SC-008 de T054, que usan el pago de US1.
- **US3:** requiere la fase 5.
- **US4:** requiere US1.
- **US5:** requiere la fase 5.

### Within Each Phase

- Las pruebas se escriben primero y deben fallar.
- Dominio → repositorios → casos de uso → controladores → interfaz.
- Backend antes que frontend: la interfaz usa MSW con el contrato, así que puede empezar en paralelo
  una vez fijado el contrato.

### Parallel Opportunities

- **Fase 1:** T001, T003, T004 y T005.
- **Fase 2:**
  - todas las pruebas (T006–T016) en paralelo;
  - T022 y T028 en paralelo con las migraciones;
  - T024 y T026 en paralelo; T025 después de T017–T020 y de T024.
- **US1:** T033–T042 en paralelo; T050 (cliente de la API) en paralelo con el backend.
- **US2:** T052–T057 en paralelo; T060 y T061 en paralelo (M02 y M01).
- **Administrador:** T063–T066 en paralelo; T070 en paralelo con T068 y T069.
- **US3:** T072–T078 en paralelo.
- **US4:** T085–T088 en paralelo.
- **US5:** T092–T095 en paralelo.
- **US1 y US2** pueden avanzar a la vez tras la Base, igual que la fase 5 con P1.
- **Cierre:** T100, T102 y T103 en paralelo.

---

## Parallel Example: User Story 1

```bash
# Pruebas de US1 juntas (deben fallar):
Task: "T034 iniciar-pago.spec.ts"
Task: "T035 notificaciones.spec.ts (PR17)"
Task: "T036 aislamiento-pagos.spec.ts (PR09)"
Task: "T037 proveedor-caido.spec.ts (PR06)"
Task: "T038 canarios.spec.ts"
Task: "T040 conciliacion.spec.ts"
Task: "T041 cobertura-derivada.spec.ts"
Task: "T042 frontend/test/pages/suscripcion.spec.tsx"
# Luego: T043 (repositorios de pagos) y, en paralelo, T050 (cliente de la API del frontend); T046 (conciliación) tras T045
```

---

## Implementation Strategy

### MVP primero (P1)

1. Fases 1 y 2, que bloquean todo. **Punto de control con CI en verde.**
2. US1: pagar con Yape, con conciliación. **Punto de control.**
3. US2: vencimiento y restricciones. **Punto de control: MVP de cobro.**

### Entrega incremental

4. Administrador con TOTP. **Punto de control.**
5. US3: transferencia. **Punto de control.**
6. US4: historial y pagos por revisar. **Punto de control.**
7. US5: administración de barberías. **Punto de control.**
8. Cierre: documentación, recorrido con Compose y suite completa.

### Líneas de corte (backlog §3.2)

En este orden:

1. El adaptador `culqi` queda sin construir si al día 11 no hay credenciales (la fábrica de T029 ya lo contempla).
2. El panel del administrador queda en listas (T084, T091, T099).
3. La lista de pagos por revisar sin pantalla (T091 solo con el historial). La tarea de conciliación (T046) no se recorta.

**No se recortan:** PR09, PR17, la notificación idempotente, la conciliación, el vencimiento sin duplicados ni la
ausencia de datos de tarjeta.

---

## Notes

- [P] = archivos distintos y sin dependencias pendientes.
- Cada tarea se marca `[x]` al terminarla.
- No hacer commits salvo que se pidan.
- No editar el `.env` del usuario.
- Nada se descarga en C:: siempre `npx --no-install`, y las cachés y los temporales en `tmp/`.
- El frontend se prueba con un solo proceso de Vitest, nunca a la vez que el backend.
