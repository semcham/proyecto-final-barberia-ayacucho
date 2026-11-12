---
description: "Tareas de la funcionalidad 008: adelanto de reserva con QR de la barbería"
---

# Tasks: Adelanto de reserva con QR de la barbería (008)

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/) y [quickstart.md](quickstart.md)

**Prerequisites**: plan con el Constitution Check en verde (constitución 1.5.0, principio V con el adelanto permitido; ADR-033 Aceptado el 2026-11-12). Funcionalidades 002, 003 y 004 implementadas.

**Tests**: obligatorias (principio X). En cada fase, **primero las pruebas, que deben fallar**, y después la implementación. **Nunca se recortan** las pruebas de seguridad: aislamiento (PR09), concurrencia (PR16, PR32), auditoría (FR-029) y comprobantes privados con número no repetible (PR31).

**Organization**: siete fases, **una fase = un commit**, como en 004. La última tarea de cada fase es su cierre (suite completa, `test:arch` y CI en verde) con su mensaje de commit. Las revisiones manuales de interfaz son tareas aparte, **del responsable**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (otro archivo, sin dependencias pendientes).
- **[Story]**: US1 a US5 de la [especificación](spec.md); las fases 1 y 7 no llevan historia.
- Rutas relativas a `tecnologia/plataforma-barberias/` salvo `specs/`, `docs/` y `.github/`. En el backend, `src/` y `test/` cuelgan de `backend/`; en el frontend, de `frontend/`.
- Código nuevo de M03 en `backend/src/modules/suscripciones-pagos/adelantos/{domain,application,infrastructure,presentation}/` (abreviado **`adelantos/`**). Código de M02 en `backend/src/modules/catalogo-citas/citas/` (abreviado **`citas/`**).

| Fase | Contenido | Historia | Tareas |
| ---- | --------- | -------- | ------ |
| 1 | Base: migraciones, dominio, `AdelantosApi`, PR14 | — | T001–T011 |
| 2 | Configuración del adelanto | US1 | T012–T020 |
| 3 | Reserva pendiente y registro del pago | US2 | T021–T035 |
| 4 | Confirmar y rechazar | US3 | T036–T047 |
| 5 | Vencimiento automático | US4 | T048–T053 |
| 6 | Día de la cita, cancelación y devolución | US5 | T054–T063 |
| 7 | Cierre de documentación | — | T064–T071 |

---

## Fase 1: Base (Blocking Prerequisites)

**Purpose**: tablas con RLS, reglas puras del adelanto y la interfaz pública de M03, para que las historias solo agreguen casos de uso.

### Pruebas de la base (escribir primero, deben fallar) ⚠️

- [X] T001 [P] Crear `backend/test/unit/adelantos/politica-adelanto.spec.ts`: monto fijo; porcentaje redondeado al céntimo (mitad hacia arriba); nunca mayor que el precio; precio cero → sin adelanto; hora límite `min(reserva + plazo, inicio − 30 min)` y error `SIN_TIEMPO_PARA_ADELANTO` si no queda tiempo; límite máximo adicional `min(inicio − 2 h, hora límite + 24 h)` y, si queda antes de la hora límite, el inicio (research R04; FR-006, FR-007, FR-018)
- [X] T002 [P] Crear `backend/test/unit/adelantos/adelanto.spec.ts`: cada transición de [data-model §5](data-model.md) permitida y cada una no permitida rechazada; marcar devuelto solo desde POR_DEVOLVER (FR-013, FR-014, FR-016–FR-022)
- [X] T003 [P] Crear `backend/test/unit/adelantos/numero-operacion.spec.ts`: normalización del número (sin espacios, mayúsculas, 4 a 20 alfanuméricos) y formato del código de la reserva (6 caracteres del alfabeto sin 0, O, 1, I ni L) (research R07; FR-010)
- [X] T004 [P] Crear `backend/test/integration/aislamiento/aislamiento-008.spec.ts` con el patrón de `aislamiento-004.spec.ts`: para `booking_deposit_settings`, `booking_deposit_file`, `booking_deposit` y `booking_deposit_payment`, con el tenant de A no se lee, no se modifica ni se inserta (`WITH CHECK`) una fila de B; y agregar las cuatro tablas a la lista de `backend/test/integration/aislamiento/rls.spec.ts` (PR09; FR-028)
- [X] T005 [P] Ampliar `backend/test/integration/aislamiento/lectura-plataforma.spec.ts`: `barberias_plataforma` lee exactamente `id`, `tenant_id`, `status`, `due_at` y `review_limit_at` de `booking_deposit` y nada de las otras tres tablas (PR09; data-model §7)
- [X] T006 [P] Ampliar `backend/test/architecture/reglas.spec.ts` y sus fixtures: regla `adelantos-solo-por-api` (M02 no importa nada de `suscripciones-pagos/adelantos/`, solo `AdelantosApi` desde el `index` de M03) y `adelantos` no importa `PaymentGateway` (PR14; FR-027)

### Implementación de la base

- [X] T007 Crear `backend/migrations/0028_adelanto_configuracion.ts` (`booking_deposit_file` y `booking_deposit_settings`), `0029_adelantos.ts` (`booking_deposit` y `booking_deposit_payment`, índices únicos y parciales, permisos de `barberias_app` y las cinco columnas de `barberias_plataforma`) y `0030_avisos_adelanto.ts` (`CHECK` de `notification.kind`), con `rlsPorTenant` y los `CHECK` de [data-model](data-model.md); y actualizar `backend/src/shared/persistence/db-types.ts`
- [X] T008 [P] Crear el dominio puro en `adelantos/domain/`: `politica-adelanto.ts`, `adelanto.ts` (estados y transiciones), `numero-operacion.ts`, `codigo-reserva.ts` y `errores.ts` (`SinTiempoParaAdelanto`, `NumeroOperacionRepetido`, `PagoYaRegistrado`, `AdelantoResuelto`, `AdelantoVencido`, `SinPagoRegistrado`, `AdelantoNoPorDevolver`, `QrRequerido`, `AdelantoPendiente`; el archivo inválido reutiliza `ComprobanteInvalido` de 003, código `VALIDACION`), con su código HTTP en `backend/src/host/error.filter.ts` (contracts/openapi.yaml)
- [X] T009 [P] Crear la interfaz pública `backend/src/modules/suscripciones-pagos/adelantos-api.ts` (clase abstracta con `paraReservar`, `crear`, `confirmar`, `decidirVencimiento`, `porVencer`, `alCancelar`, `alNoAsistir`, `alReprogramar`, `deCita` y `deCitas`), exportarla en `backend/src/modules/suscripciones-pagos/index.ts`, y agregar la regla `adelantos-solo-por-api` a `backend/.dependency-cruiser.cjs` (research R01)
- [X] T010 [P] Agregar las acciones de auditoría de research R13 a `backend/src/shared/audit/audit-log.ts`, los cinco tipos de aviso a `backend/src/modules/notificaciones/domain/aviso.ts` (`TIPOS_DE_AVISO` y un mapa `AVISO_POR_EVENTO_DE_ADELANTO`) y las operaciones `CONFIGURAR_ADELANTO`, `REVISAR_ADELANTO` y `PAGAR_ADELANTO` a la matriz de permisos de M03 (`suscripciones/domain/permisos.ts`) y de M02 (contracts/rbac.md)
- [ ] T011 Cierre de fase 1: suite completa del backend (incluido `npm run test:arch`), del frontend y CI en verde (`.github/workflows/plataforma-barberias.yml`). Commit: `feat(008): base del adelanto de reserva (fase 1)`

**Checkpoint**: tablas con RLS probadas, dominio en verde y `AdelantosApi` declarada; ninguna ruta nueva todavía.

---

## Fase 2: User Story 1 - El propietario activa el adelanto (Priority: P1) 🎯 MVP

**Goal**: el propietario configura monto fijo o porcentaje, plazo y QR privado.

**Independent Test**: spec.md US1 ("Independent Test").

### Pruebas de US1 (escribir primero, deben fallar) ⚠️

- [ ] T012 [P] [US1] Crear `backend/test/integration/adelantos/adelanto-configuracion.spec.ts`: activar con fijo y con porcentaje; rangos inválidos → 422 `VALIDACION`; activar sin QR → 422 `QR_REQUERIDO`; QR que no es JPEG ni PNG por sus bytes → 422; QR de más de 1 MB → 413; `tenantId` en el cuerpo → 400; cambiar o desactivar no toca citas ya creadas (se completa en la fase 3); el QR se sirve con `Cache-Control: no-store` y `nosniff`; con la suscripción vencida, `SUSCRIPCION_NO_PERMITE` (US1-1 a US1-4; FR-001–FR-004, FR-030)
- [ ] T013 [P] [US1] Crear `backend/test/contract/rbac-008.spec.ts`, que lee [contracts/rbac.md](contracts/rbac.md) y ejecuta las filas de `/barberia/adelanto*` (barbero y cliente → 403, sin sesión y plataforma → 401), y `backend/test/contract/adelanto.contract.spec.ts` con el esquema `ConfiguracionAdelanto` (PR08; US1-5)
- [ ] T014 [P] [US1] Crear `backend/test/integration/adelantos/adelanto-auditoria.spec.ts` con el caso `ADELANTO_CONFIGURADO` (una entrada por cambio, con la barbería y sin datos del QR); las fases siguientes le suman sus acciones (FR-029)
- [ ] T015 [P] [US1] Crear `frontend/test/pages/adelanto.spec.tsx` con sus manejadores en `frontend/test/msw-handlers.ts`: ruta `/app/adelanto` solo del propietario; elegir tipo, valor y plazo; subir el QR con vista previa; error si se activa sin QR; estados cargando y error; uso solo con teclado

### Implementación de US1

- [ ] T016 [US1] Crear los puertos `ConfiguracionAdelantoRepository` y `ArchivosAdelanto` en `adelantos/application/ports/` y sus adaptadores Kysely en `adelantos/infrastructure/` (`kysely-configuracion-adelanto.ts`, `archivos-adelanto-postgres.ts`, que reutiliza `detectarTipoComprobante` de `pagos/domain/tipo-de-archivo.ts` y guarda tipo, tamaño y SHA-256) (research R05)
- [ ] T017 [US1] Crear `adelantos/application/configurar-adelanto.ts` (obtener, cambiar, subir y ver el QR; autorización `CONFIGURAR_ADELANTO`; `exigirOperacion('CONFIGURAR_CATALOGO')` para cambiar; auditoría `ADELANTO_CONFIGURADO`) y `adelantos/presentation/adelanto-configuracion.controller.ts` con su DTO, con un interceptor de archivos de tope configurable extraído de `pagos/presentation/comprobante.interceptor.ts` (1 MB para el QR, 5 MB para la captura), sin cambiar el comportamiento de los comprobantes de 003 (sus pruebas siguen en verde); registrarlos en `backend/src/modules/suscripciones-pagos/suscripciones-pagos.module.ts`
- [ ] T018 [US1] Agregar `specs/008-adelanto-reserva-qr/contracts/openapi.yaml` al script `gen:api` de `frontend/package.json`, generar `frontend/src/api/schema-008.d.ts`, y crear `frontend/src/pages/panel/Adelanto.tsx` con su ruta `adelanto` (solo `PROPIETARIO`) en `frontend/src/routes.tsx` y su entrada en el menú del panel
- [ ] T019 [US1] **Del responsable:** revisión manual de `/app/adelanto` a 360 px y en escritorio, en tema claro y oscuro, solo con teclado y con la extensión axe DevTools; anotar el resultado en `specs/008-adelanto-reserva-qr/quickstart.md` §4
- [ ] T020 [US1] Cierre de fase 2: suite completa, `npm run test:arch` y CI en verde. Commit: `feat(008): configuración del adelanto (fase 2, US1)`

**Checkpoint**: el propietario configura el adelanto; las reservas todavía no lo piden.

---

## Fase 3: User Story 2 - Reserva pendiente y registro del pago (Priority: P1)

**Goal**: con el adelanto activo, la reserva del cliente nace PENDIENTE con el horario retenido, y el cliente registra su número de operación con una captura opcional.

**Independent Test**: spec.md US2 ("Independent Test").

### Pruebas de US2 (escribir primero, deben fallar) ⚠️

- [ ] T021 [P] [US2] Crear `backend/test/integration/adelantos/reserva-con-adelanto.spec.ts`: la reserva del cliente nace PENDIENTE con su adelanto (monto, código y hora límite), el horario deja de estar libre y la respuesta trae el `adelanto`; la del propietario nace CONFIRMADA sin adelanto; sin tiempo para pagar → 422 `SIN_TIEMPO_PARA_ADELANTO`; un cambio posterior de la configuración no cambia el adelanto creado; la reserva pendiente no publica `CitaCreada` ni `RecordatorioDeCita`; sin adelanto activo la reserva es idéntica a la de 002 (US2-1; FR-004–FR-008, FR-025; research R03, R08)
- [ ] T022 [P] [US2] Crear `backend/test/integration/adelantos/concurrencia-adelanto.spec.ts`: 50 reservas simultáneas del mismo horario con el adelanto activo → 1 PENDIENTE, 49 × 409 y 0 × 5xx (PR16; SC-007)
- [ ] T023 [P] [US2] Crear `backend/test/integration/adelantos/registro-pago-adelanto.spec.ts`: registrar con y sin captura → POR_REVISAR; número repetido en la barbería (también de una cita cancelada) → 409 `NUMERO_OPERACION_REPETIDO`; un segundo registro → 409 `PAGO_YA_REGISTRADO`; dos registros simultáneos → uno solo; fuera de plazo → 422 `ADELANTO_VENCIDO`; captura inválida por sus bytes → 422 sin guardar nada; el mismo número en **otra** barbería se acepta (US2-3 a US2-5; FR-009, FR-010; PR31)
- [ ] T024 [P] [US2] Crear `backend/test/integration/adelantos/aislamiento-adelantos.spec.ts`: con el token de otro cliente o de otra barbería, `GET /citas/{id}/adelanto`, `/qr` y `/captura` responden 404; el número completo solo lo ven el cliente de la cita y su propietario; ningún archivo aparece en registros ni en la auditoría (US2-6; FR-011, FR-028; PR31, PR09)
- [ ] T025 [P] [US2] Crear `backend/test/integration/adelantos/avisos-adelanto.spec.ts` con Mailpit: `AdelantoSolicitado` deja un correo al cliente con monto, código y hora límite; `PagoDeAdelantoRegistrado` deja un correo al propietario; ninguno trae el número de operación ni la captura; cada aviso una vez con dos instancias; con el correo caído (proxy de 004), la reserva y el registro del pago responden igual y cada aviso llega una vez al volver (las fases 4 y 5 le suman sus avisos) (US2-2; FR-023, FR-024; SC-008)
- [ ] T026 [P] [US2] Ampliar `rbac-008.spec.ts` y `adelanto.contract.spec.ts` con `POST /citas` (esquema `CitaConAdelanto`), `GET /citas/{id}/adelanto`, `/qr`, `/captura` y `POST .../pago`, y `adelanto-auditoria.spec.ts` con `ADELANTO_PAGO_REGISTRADO` sin el número completo (PR08; FR-029)
- [ ] T027 [P] [US2] Crear `frontend/test/pages/pagar-adelanto.spec.tsx` y ampliar `frontend/test/pages/cliente-reserva.spec.tsx`: tras reservar con adelanto, la interfaz lleva a `/mis-citas/:citaId/adelanto`; se ven el QR, el monto, el código (copiable) y la hora límite en texto; registrar el número con o sin captura; mensajes del 409 y del 422; estados por pagar, por revisar, rechazado, confirmado y vencido; uso solo con teclado

### Implementación de US2

- [ ] T028 [US2] Agregar la opción `pendiente` a `Cita.reservar` en `citas/domain/cita.ts` (la cita nace PENDIENTE; `aprobar()` ya existe) (research R03)
- [ ] T029 [US2] Crear el puerto `AdelantoRepository` en `adelantos/application/ports/` y `adelantos/infrastructure/kysely-adelanto-repository.ts` (adelantos y registros de pago, con bloqueo `FOR UPDATE`, transiciones condicionales y el código generado con `node:crypto` e insertado con `ON CONFLICT (tenant_id, code) DO NOTHING`, research R07), y `adelantos/application/adelantos-api-impl.ts` con `paraReservar`, `crear` (publica `AdelantoSolicitado`), `deCita` y `deCitas`, registrado como `AdelantosApi` en `suscripciones-pagos.module.ts` y agregado a sus `exports` (M02 ya importa `SuscripcionesPagosModule`)
- [ ] T030 [US2] En `citas/application/reservar-cita.ts`: con el actor `CLIENTE` y `AdelantosApi.paraReservar` con adelanto, reservar PENDIENTE, llamar a `AdelantosApi.crear` en la misma transacción, y **no** publicar `CitaCreada` ni programar el recordatorio; sumar el `adelanto` a la vista de la cita (también en el reintento idempotente); las demás reservas no cambian (research R08). Anotar el cambio en `specs/004-notificaciones-reprogramacion/contracts/eventos.md` §3 (filas de `CitaCreada` y `RecordatorioDeCita`: "con adelanto, al confirmar; ver 008"), con la nota de que lo agrega 008
- [ ] T031 [US2] Crear `adelantos/application/registrar-pago.ts` (solo el cliente del adelanto, R02; dentro del plazo; un registro vigente; publica `PagoDeAdelantoRegistrado`; auditoría) y `adelantos/application/consultar-adelanto.ts` (adelanto, QR y captura con permiso), y `adelantos/presentation/adelanto-cita.controller.ts` con el interceptor de 5 MB y las cabeceras `no-store` y `nosniff`
- [ ] T032 [US2] En M05: plantillas de `ADELANTO_SOLICITADO` y `PAGO_ADELANTO_REGISTRADO` en `backend/src/modules/notificaciones/domain/plantillas.ts`, `backend/src/modules/notificaciones/application/manejadores-de-adelanto.ts` (cliente por su canal, propietario por correo; [contracts/eventos.md](contracts/eventos.md) §3), su exportación en `notificaciones/index.ts`, la suscripción en `backend/src/host/eventos.ts` y la composición en `enviar-avisos.ts`
- [ ] T033 [US2] Crear `frontend/src/pages/cliente/PagarAdelanto.tsx` con su ruta `/mis-citas/:citaId/adelanto` (solo `CLIENTE`) en `frontend/src/routes.tsx`; en `frontend/src/pages/publico/Reservar.tsx`, llevar ahí tras una reserva con adelanto; en `frontend/src/pages/cliente/MisCitas.tsx`, mostrar el estado del adelanto y el enlace "Pagar adelanto"
- [ ] T034 [US2] **Del responsable:** revisión manual de `/mis-citas/:citaId/adelanto` y del paso de Reservar a 360 px y en escritorio, en tema claro y oscuro, solo con teclado y con axe DevTools; anotar en `quickstart.md` §4
- [ ] T035 [US2] Cierre de fase 3: suite completa, `npm run test:arch` y CI en verde. Commit: `feat(008): reserva pendiente y registro del pago (fase 3, US2)`

**Checkpoint**: el cliente reserva, paga a la barbería y registra su número; el propietario recibe el aviso.

---

## Fase 4: User Story 3 - Confirmar o rechazar el pago (Priority: P1)

**Goal**: el propietario confirma (la cita pasa a CONFIRMADA) o rechaza con un motivo, desde una bandeja.

**Independent Test**: spec.md US3 ("Independent Test").

### Pruebas de US3 (escribir primero, deben fallar) ⚠️

- [ ] T036 [P] [US3] Crear `backend/test/integration/adelantos/confirmacion-adelanto.spec.ts`: confirmar → cita CONFIRMADA y adelanto CONFIRMADO; confirmar otra vez → 200 sin cambios ni aviso; sin pago registrado → 409 `SIN_PAGO_REGISTRADO`; rechazar con motivo → POR_PAGAR con la hora límite original y el registro rechazado conservado; rechazar sin motivo o con menos de 5 caracteres → 422; el cliente registra otro número después del rechazo; el barbero → 403; `POST /citas/{id}/estado` con destino CONFIRMADA en una cita con adelanto → 409 `ADELANTO_PENDIENTE` para el propietario y el barbero, sin cambios (y una cita sin adelanto se sigue aprobando como en 002) (research R15); al confirmar se programa el recordatorio de 004 si faltan 2 h o más; bandeja `GET /adelantos/por-revisar` ordenada por hora límite, sin la captura (US3-1 a US3-4, US3-6; FR-012–FR-014, FR-025)
- [ ] T037 [P] [US3] Crear `backend/test/integration/adelantos/confirmacion-adelanto-concurrencia.spec.ts` con dos instancias: 20 pares de confirmaciones simultáneas de la misma cita → exactamente 1 transición, 1 auditoría y 1 aviso por cita (PR32; US3-5; FR-015; SC-006)
- [ ] T038 [P] [US3] Ampliar `avisos-adelanto.spec.ts` (`AdelantoConfirmado` con el saldo; `PagoDeAdelantoRechazado` con el motivo y sin el número), `adelanto-auditoria.spec.ts` (`ADELANTO_CONFIRMADO`, `ADELANTO_PAGO_RECHAZADO`, sin el motivo en `audit_log`), y `rbac-008.spec.ts` y `adelanto.contract.spec.ts` (confirmación, rechazo y bandeja) (FR-023, FR-029; PR08)
- [ ] T039 [P] [US3] Ampliar `backend/test/integration/suscripciones/restricciones-estado.spec.ts` con confirmar y rechazar (`GESTIONAR_CITAS`): con la suscripción vencida se permiten resolver las pendientes, y la reserva nueva sigue bloqueada (FR-030; research R12)
- [ ] T040 [P] [US3] Crear `frontend/test/pages/adelantos-por-revisar.spec.tsx`: ruta `/app/adelantos` solo del propietario; lista con monto, código, número, hora límite y límite máximo; ver la captura; confirmar con un diálogo accesible; rechazar exigiendo el motivo; estados cargando, vacío ("no hay pagos por revisar") y error; uso solo con teclado

### Implementación de US3

- [ ] T041 [US3] En M03: `AdelantosApi.confirmar` (transición condicional con el adelanto bloqueado) en `adelantos/application/adelantos-api-impl.ts`, y `adelantos/application/rechazar-pago.ts` con su ruta en `adelanto-cita.controller.ts` (`REVISAR_ADELANTO`, `exigirOperacion('GESTIONAR_CITAS')`, publica `PagoDeAdelantoRechazado`, auditoría)
- [ ] T042 [US3] En M02: `citas/application/confirmar-adelanto.ts` (bloquea la cita y después el adelanto, research R06; `cita.aprobar()`; publica `AdelantoConfirmado`; programa el recordatorio con `programarRecordatorio`; auditoría) y `citas/application/bandeja-adelantos.ts` (une `AdelantosApi.deCitas` con el nombre del cliente de `ClientesApi`), con `citas/presentation/adelanto.controller.ts`, registrados en `backend/src/modules/catalogo-citas/catalogo-citas.module.ts`; en `citas/application/cambiar-estado-cita.ts`, rechazar el destino CONFIRMADA con 409 `ADELANTO_PENDIENTE` si `AdelantosApi.deCita` devuelve un adelanto (research R15)
- [ ] T043 [US3] En M05: plantillas `ADELANTO_CONFIRMADO` y `PAGO_ADELANTO_RECHAZADO` y sus casos en `manejadores-de-adelanto.ts`
- [ ] T044 [US3] Agregar las filas `ConfirmarAdelanto`, `RechazarPagoDeAdelanto` y `MarcarAdelantoDevuelto` (`GESTIONAR_CITAS`), `ConfigurarAdelanto` (`CONFIGURAR_CATALOGO`) y `RegistrarPagoDeAdelanto` (sin restricción: completa una reserva ya aceptada, research R12) a `specs/003-suscripciones-pagos/contracts/restricciones-estado.md` §2, con la nota de que las agrega 008, y `ConfirmarAdelanto` a `backend/test/architecture/operaciones-con-politica.spec.ts`
- [ ] T045 [US3] Crear `frontend/src/pages/panel/AdelantosPorRevisar.tsx` con su ruta `adelantos` (solo `PROPIETARIO`) y su entrada en el menú, y mostrar en `frontend/src/pages/panel/Agenda.tsx` el estado del adelanto de cada cita pendiente
- [ ] T046 [US3] **Del responsable:** revisión manual de `/app/adelantos` y de la Agenda a 360 px y en escritorio, en tema claro y oscuro, solo con teclado y con axe DevTools; anotar en `quickstart.md` §4
- [ ] T047 [US3] Cierre de fase 4: suite completa, `npm run test:arch` y CI en verde. Commit: `feat(008): confirmar y rechazar el adelanto (fase 4, US3)`

**Checkpoint**: el flujo principal de RF35 completo de punta a punta (US1 + US2 + US3).

---

## Fase 5: User Story 4 - El adelanto vence solo (Priority: P2)

**Goal**: sin pago, la cita se cancela al pasar la hora límite; con el pago sin revisar, solo al alcanzar el límite máximo adicional.

**Independent Test**: spec.md US4 ("Independent Test").

### Pruebas de US4 (escribir primero, deben fallar) ⚠️

- [ ] T048 [P] [US4] Crear `backend/test/integration/adelantos/vencimiento-adelantos.spec.ts` con el reloj de prueba: sin pago → cita CANCELADA sin marca de tardía, horario libre, adelanto VENCIDO; con pago sin revisar al pasar la hora límite → nada cambia; al pasar el límite máximo → CANCELADA y adelanto POR_DEVOLVER; rechazado y sin registro nuevo → VENCIDO; aviso `AdelantoVencido` al cliente y al propietario (con `porDevolver` cuando corresponde); auditoría `ADELANTO_VENCIDO` (US4-1 a US4-4; FR-016–FR-018, FR-029)
- [ ] T049 [P] [US4] Crear `backend/test/integration/adelantos/vencimiento-adelantos-dos-replicas.spec.ts`: dos instancias corren la tarea a la vez sobre 50 adelantos vencidos → cada cita se cancela una vez y sale un aviso por destinatario; una confirmación a la vez que el vencimiento de la misma cita → exactamente uno de los dos, nunca confirmada y cancelada (PR32; US4-5; FR-015, FR-019; SC-003, SC-006)

### Implementación de US4

- [ ] T050 [US4] En M03: `adelantos/infrastructure/plataforma/adelantos-por-vencer.ts` (lectura de `barberias_plataforma` de las cinco columnas técnicas, en lotes de 100) y `AdelantosApi.porVencer` y `decidirVencimiento` (sin pago → VENCIDO; pago sin revisar y límite alcanzado → POR_DEVOLVER; si no, nada) (research R09)
- [ ] T051 [US4] En M02: `citas/application/vencer-adelantos.ts` (por cada candidato, transacción con su tenant; bloquea la cita con `SKIP LOCKED` y después el adelanto; cancela la cita sin marca de tardía; publica `AdelantoVencido`; anula el recordatorio), exportado en `catalogo-citas/index.ts` y registrado cada 60 s en `backend/src/host/tareas.ts`
- [ ] T052 [US4] En M05: plantilla `ADELANTO_VENCIDO` (con la indicación de devolver cuando `porDevolver`) y su caso en `manejadores-de-adelanto.ts`
- [ ] T053 [US4] Cierre de fase 5: suite completa, `npm run test:arch` y CI en verde. Commit: `feat(008): vencimiento automático del adelanto (fase 5, US4)`

**Checkpoint**: ningún horario queda retenido sin pago, y un pago registrado no se pierde por el vencimiento.

---

## Fase 6: User Story 5 - Día de la cita, cancelación y devolución (Priority: P2)

**Goal**: saldo a pagar, adelanto por devolver o retenido al cancelar o no asistir, y la marca de devuelto.

**Independent Test**: spec.md US5 ("Independent Test").

### Pruebas de US5 (escribir primero, deben fallar) ⚠️

- [ ] T054 [P] [US5] Crear `backend/test/integration/adelantos/adelanto-al-cancelar.spec.ts`: con el adelanto confirmado, cancelar el cliente con tiempo → POR_DEVOLVER; tarde → RETENIDO y cancelación tardía; el propietario → POR_DEVOLVER; no asistió → RETENIDO; cancelar una pendiente sin pago → ANULADO y con el pago por revisar → POR_DEVOLVER; cancelar por el enlace de 004 aplica la misma regla; marcar devuelto desde POR_DEVOLVER → DEVUELTO con su fecha; desde RETENIDO u otro estado → 409 `ADELANTO_NO_POR_DEVOLVER`; el saldo (precio − adelanto) en la cita confirmada; `CitaCancelada` lleva `adelanto`; auditoría `ADELANTO_RESUELTO` y `ADELANTO_DEVUELTO` (US5-1 a US5-6; FR-020–FR-022, FR-029; research R10)
- [ ] T055 [P] [US5] Crear `backend/test/integration/adelantos/reprogramar-con-adelanto.spec.ts`: el cliente no puede reprogramar su cita PENDIENTE (409 `ADELANTO_PENDIENTE`); el propietario sí, y el adelanto conserva su monto, hora límite y límite máximo, con la hora nueva en su copia; reprogramar una cita PENDIENTE **no** programa el recordatorio de 004 (FR-025), y reprogramar una CONFIRMADA lo sigue programando como en 004 (research R11)
- [ ] T056 [P] [US5] Ampliar `rbac-008.spec.ts` y `adelanto.contract.spec.ts` con `POST /citas/{id}/adelanto/devolucion` y la bandeja con `estado=POR_DEVOLVER`, y `frontend/test/pages/mis-citas.spec.tsx` y `frontend/test/pages/agenda.spec.tsx` con el saldo, el estado "por devolver", "devuelto" o "retenido", y el botón "Marcar devuelto" del propietario (PR08)

### Implementación de US5

- [ ] T057 [US5] En M03: `AdelantosApi.alCancelar`, `alNoAsistir` y `alReprogramar`, y `adelantos/application/marcar-devuelto.ts` con su ruta en `adelanto-cita.controller.ts` (`REVISAR_ADELANTO`, `GESTIONAR_CITAS`, auditoría)
- [ ] T058 [US5] En M02: llamar a `AdelantosApi.alCancelar` desde `citas/application/cancelar-cita.ts` y `citas/application/accion-por-enlace.ts`, a `alNoAsistir` desde `citas/application/cambiar-estado-cita.ts`, y a `alReprogramar` desde `citas/application/reprogramar-cita.ts`, con el 409 `ADELANTO_PENDIENTE` para el cliente y sin llamar a `programarRecordatorio` si la cita sigue PENDIENTE (FR-025); sumar el campo `adelanto` al payload de `CitaCancelada`
- [ ] T059 [US5] En M05: la plantilla de `CITA_CANCELADA` menciona el adelanto por devolver o retenido cuando el evento lo trae (`notificaciones/domain/plantillas.ts`)
- [ ] T060 [US5] En el frontend: saldo y estado del adelanto en `frontend/src/pages/cliente/MisCitas.tsx` y `frontend/src/pages/panel/Agenda.tsx`; "Marcar devuelto" en la bandeja (`AdelantosPorRevisar.tsx`, pestaña "Por devolver"); el error `ADELANTO_PENDIENTE` en el diálogo de reprogramar
- [ ] T061 [US5] **Del responsable:** revisión manual de Agenda, Mis citas y la pestaña "Por devolver" a 360 px y en escritorio, en tema claro y oscuro, solo con teclado y con axe DevTools; anotar en `quickstart.md` §4
- [ ] T062 [US5] **Del responsable:** medición manual con cronómetro de SC-001 (activar el adelanto en < 3 min) y SC-002 (registrar el pago en < 1 min), anotada en `quickstart.md` §4
- [ ] T063 [US5] Cierre de fase 6: suite completa, `npm run test:arch` y CI en verde. Commit: `feat(008): adelanto al cancelar y devolución (fase 6, US5)`

**Checkpoint**: RF35 y HU29 completos.

---

## Fase 7: Cierre (documentación, suite completa y quickstart)

**Purpose**: dejar la documentación con el estado real de 008. **Solo lo construido pasa de "planificado" a "implementado"**, como en la fase 7 de 004.

- [ ] T064 Recorrer `specs/008-adelanto-reserva-qr/quickstart.md` §1 a §3 con Docker Compose y anotar cada resultado medido; los pasos que dependan del responsable quedan como "pendiente del responsable"
- [ ] T065 [P] Actualizar `docs/trazabilidad.md`: fila de 008 en §4 (estado, pruebas y totales medidos), HU29 en §1, una tabla §4.6 de componentes de 008 con su evidencia, y §5 si se tocó algún diagrama
- [ ] T066 [P] Actualizar `docs/05-gestion/04-pruebas.md` (PR31 y PR32 ejecutadas, con resultados medidos; §2.4 con los totales de la última corrida; una §2.6 de 008) y `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md` (EQ-23 y EQ-24)
- [ ] T067 [P] Cambiar "planificado" por "implementado" **solo en lo construido** en: `docs/01-analisis-de-sistema/03-requisitos-funcionales.md` (RF35 y el resumen), `docs/01-analisis-de-sistema/02-historias-del-usuario.md` (HU29), `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md` (ADR-033), `docs/05-gestion/02-backlog-y-sprints.md` (fila de 008), `docs/02-arquitectura-software/componentes-arquitectonicos.md` (submódulo `adelantos` de M03 y las filas de M02 y M05), `docs/02-arquitectura-software/multi-tenancy-y-datos.md` (tablas nuevas y columnas de plataforma) y `docs/03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md` (PENDIENTE en uso)
- [ ] T068 [P] Actualizar `docs/02-arquitectura-software/api-rest.md` (rutas nuevas), `docs/02-arquitectura-software/seguridad-y-privacidad.md` (fila RBAC del adelanto, comprobantes del adelanto privados y principio V 1.5.0) y `docs/02-arquitectura-software/tecnologias.md` (sin dependencias nuevas)
- [ ] T069 [P] Actualizar `tecnologia/plataforma-barberias/README.md`: funcionalidad 008, migraciones `0028`–`0030`, pantallas nuevas y la tarea `vencer-adelantos`
- [ ] T070 **Del responsable:** confirmar las revisiones manuales de T019, T034, T046 y T061 y las mediciones de T062 antes de marcarlas
- [ ] T071 Cierre de fase 7: suite completa del backend (incluido `npm run test:arch`) y del frontend, Prettier y CI en verde. Commit: `docs(008): cierre del adelanto de reserva (fase 7)`

---

## Dependencies & Execution Order

- **Fase 1** no depende de nada y bloquea a todas.
- **Fase 2 (US1)** depende de la 1.
- **Fase 3 (US2)** depende de la 2 (sin configuración no hay adelanto que pedir).
- **Fase 4 (US3)** depende de la 3 (confirma lo que registra el cliente).
- **Fase 5 (US4)** depende de la 3; su prueba de concurrencia con la confirmación (T049) depende de la 4.
- **Fase 6 (US5)** depende de la 4 (necesita adelantos confirmados).
- **Fase 7** al final.

Orden: 1 → 2 → 3 → 4 → 5 → 6 → 7. Dentro de cada fase: pruebas (en paralelo, deben fallar) → dominio y puertos → casos de uso → rutas → interfaz → revisión manual → cierre.

### Paralelismo

- Fase 1: T001–T006 en paralelo; T008, T009 y T010 en paralelo después de T007.
- Fase 2: T012–T015 en paralelo; T018 (frontend) en paralelo con T016–T017.
- Fase 3: T021–T027 en paralelo; T032 (M05) y T033 (frontend) en paralelo con T031.
- Fase 4: T036–T040 en paralelo; T043, T044 y T045 en paralelo con T042.
- Fase 5: T048 y T049 en paralelo; T052 en paralelo con T050–T051.
- Fase 6: T054–T056 en paralelo; T059 y T060 en paralelo con T057–T058.
- Fase 7: T065–T069 en paralelo después de T064.

**Ejemplo (fase 3):** T021 a T027 se escriben a la vez; luego T028 → T029 → T030 → T031; en paralelo con T031, T032 (M05) y T033 (frontend).

---

## Estimación de horas por fase

Calendario: del jueves 12 al miércoles 18 de noviembre de 2026 (entrega el 18). Horas de trabajo efectivo estimadas por una persona con asistencia de IA, como en 004.

| Fase | Contenido | Horas | Día objetivo |
| ---- | --------- | ----- | ------------ |
| 1 | Base | 5 | jue 12 |
| 2 | US1 Configuración | 4 | vie 13 |
| 3 | US2 Reserva pendiente y pago | 9 | vie 13 – sáb 14 |
| 4 | US3 Confirmar y rechazar | 6 | dom 15 |
| 5 | US4 Vencimiento | 4 | lun 16 |
| 6 | US5 Cancelación y devolución | 5 | lun 16 – mar 17 |
| 7 | Cierre de documentación | 4 | mar 17 – mié 18 |
| | **Total** | **37** | |

Las corridas completas de integración tardan unos 50 minutos en este equipo (cierre de 004): cada cierre de fase las incluye.

---

## Qué es indispensable si vas atrasado

**Nunca se recortan** (en ninguna fase): las pruebas de aislamiento (T004, T005, T024), de concurrencia (T022, T037, T049), de auditoría (T014 y sus ampliaciones), de comprobantes privados y número no repetible (T023, T024), la regla de arquitectura (T006), la matriz de permisos (T013 y sus ampliaciones) y el principio V (ningún dato de tarjeta ni movimiento de dinero).

| Fase | Indispensable | Línea de corte (lo primero que se recorta) |
| ---- | ------------- | ------------------------------------------ |
| 1 | Todo | — |
| 2 | Configurar por la API con QR privado; pantalla mínima | La vista previa del QR en la pantalla |
| 3 | Reserva PENDIENTE, registro del pago con número único, la pantalla de pago y los dos avisos | La captura opcional se mantiene (es parte de FR-009), pero sin vista previa; el enlace "Pagar adelanto" en Mis citas puede ser solo texto con el estado |
| 4 | Confirmar y rechazar por la API, la bandeja y PR32 | El estado del adelanto en la Agenda (queda en la bandeja) |
| 5 | La tarea con sus dos reglas (sin pago y límite máximo) y PR32 | — (toda la fase es FR-016 a FR-019) |
| 6 | Por devolver o retenido al cancelar o no asistir, y marcar devuelto por la API | La pestaña "Por devolver" en la interfaz (la marca se hace por la API); el saldo en la Agenda (queda en el detalle del adelanto); la reprogramación del propietario de una cita pendiente: si falta tiempo, **ni el cliente ni el propietario** reprograman una pendiente (409 para los dos) y se anota como desviación de R11 |
| 7 | Trazabilidad, pruebas y estados de RF35 y HU29 | El recorrido completo del quickstart con Compose (se hace al menos §1 y §3) y los documentos de arquitectura secundarios (T068) |

**Orden de recorte si quedan menos de 3 días tras la fase 3**: (1) T060 sin la pestaña "Por devolver"; (2) la reprogramación del propietario de una pendiente; (3) T068 y el recorrido completo del quickstart. US1 + US2 + US3 (fases 1 a 4) son el **mínimo demostrable** de RF35; US4 es necesaria para que ningún horario quede bloqueado, así que va antes que US5.

---

## Implementation Strategy

1. **MVP (fases 1 a 4):** configurar, reservar pendiente, registrar el pago y confirmar o rechazar: el flujo de HU29 de punta a punta.
2. **Fase 5:** el vencimiento, que evita horarios retenidos sin pago.
3. **Fase 6:** las reglas del dinero al cancelar y la marca de devuelto.
4. **Fase 7:** documentación con el estado real.

Cada fase es un commit con CI en verde: si el calendario se corta, lo entregado hasta la última fase cerrada funciona y está probado.

## Trazabilidad (requisito → tareas)

| Requisito | Historia | Tareas |
| --------- | -------- | ------ |
| FR-001–FR-004 | US1 | T012, T016–T018 |
| FR-005–FR-008 | US2 | T001, T021, T028–T030, T033 |
| FR-009–FR-011 | US2 | T003, T023, T024, T031 |
| FR-012–FR-015 | US3 | T002, T036, T037, T041, T042 |
| FR-016–FR-019 | US4 | T001, T048, T049, T050, T051 |
| FR-020–FR-022 | US5 | T002, T054, T057, T058, T060 |
| FR-023–FR-025 | US2–US5 | T021, T025, T032, T038, T043, T048, T052, T059 |
| FR-026, FR-027 | — | T006, T007 (sin columnas de tarjeta ni de dinero) |
| FR-028 | — | T004, T005, T024 |
| FR-029 | — | T014, T026, T038, T048, T054 |
| FR-030 | US1, US3 | T012, T039, T044 |
| SC-001, SC-002 | US1, US2 | T062 (manual) |
| SC-003, SC-004 | US4 | T048, T049 |
| SC-005 | US2 | T023, T024 |
| SC-006 | US3, US4 | T037, T049 |
| SC-007 | US2 | T022 |
| SC-008 | US2 | T025 |
| SC-009 | — | T007 (revisión del modelo) |
| PR08 | — | T013, T026, T038, T056 |
| PR09 | — | T004, T005, T024 |
| PR14 | — | T006, T009, T044 |
| PR16 | US2 | T022 |
| PR31 | US2 | T023, T024 |
| PR32 | US3, US4 | T037, T049 |
