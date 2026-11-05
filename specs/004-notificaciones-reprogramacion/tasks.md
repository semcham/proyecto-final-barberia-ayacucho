# Tasks: Notificaciones y reprogramación de citas (004)

**Input**: [plan.md](plan.md), [spec.md](spec.md), [data-model.md](data-model.md), [research.md](research.md), [contracts/](contracts/), [decisiones/](decisiones/) y [quickstart.md](quickstart.md)

**Prerequisites**: plan aprobado y Constitution Check en verde con la constitución 1.4.0 (fase 0, hecha el 2026-11-04).

**Tests**: obligatorios (constitución, principio X). En cada fase, las pruebas se escriben **antes** que el código y deben fallar primero (TDD).

**Rutas**: las de `backend/` y `frontend/` son relativas a `tecnologia/plataforma-barberias/` (principio XII). `.github/`, `docs/` y `specs/` son relativas a la raíz del repositorio.

**Cada fase es un commit** y debe cerrar con la CI en verde en el backend y en el frontend (la tarea "Cierre de fase" de cada una).

## Format: `[ID] [P?] [Story] Descripción (requisito)`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin depender de tareas pendientes).
- **[Story]**: US1 a US5 de la [especificación](spec.md); las fases 1 y 7 no llevan historia.
- Al final de cada descripción va el requisito que cubre: RF13, RF30, RF33, RF34, la historia o el principio.

## Mapa de fases del plan

| Fase del plan | Sección de este archivo      | Historia | Prioridad | Recorte                     |
| ------------- | ---------------------------- | -------- | --------- | --------------------------- |
| 1             | Fase 1: Base                 | —        | —         | Nunca                       |
| 2             | Fase 2: Reprogramar          | US1      | P1        | Nunca                       |
| 3             | Fase 3: Avisos de la cita    | US2      | P1        | Nunca                       |
| 4             | Fase 4: Recordatorio y enlaces | US3    | P2        | Nunca                       |
| 5             | Fase 5: Canal y consentimiento | US4    | P2        | Nunca (RF33)                |
| 6             | Fase 6: Avisos de suscripción | US5     | P3        | **⚠️ PRIMER RECORTE**       |
| 7             | Fase 7: Cierre               | —        | —         | Nunca (se puede reducir)    |

---

## Fase 1: Base (bloquea todo)

**Propósito**: CI con escaneo de dependencias, migraciones `0021` a `0025` con RLS, bus de eventos con salida transaccional (M06), enlaces firmados (M06), esqueleto de M05 con el puerto y el adaptador de correo, Mailpit en Compose y reglas de PR14.

**Prerrequisito del responsable**: comprobar que Docker guarda las imágenes en D: y descargar la imagen de Mailpit (research R16). Las pruebas de T016, T017 y T042 la necesitan.

**⚠️ CRÍTICO**: ninguna historia empieza antes de cerrar esta fase.

### Preparación

- [ ] T001 Ejecutar `npm audit --omit=dev` en `backend/` y en `frontend/` **antes** de tocar la CI y decidir cada hallazgo de nivel alto o crítico: si tiene arreglo, se corrige en `backend/package.json` o `frontend/package.json` y su `package-lock.json`, con versión fija; si no tiene arreglo, se documenta la excepción con fecha, paquete, aviso y motivo en la sección "Excepciones de `npm audit`" de `docs/02-arquitectura-software/tecnologias.md`. La suite debe seguir en verde (research R10)
- [ ] T002 Agregar el escaneo de dependencias a la CI: un paso `npm audit --omit=dev --audit-level=high` (solo dependencias de producción; falla desde nivel alto) en los trabajos `backend` y `frontend` de `.github/workflows/plataforma-barberias.yml`, después de `npm ci`. Requiere T001 cerrada; si quedan excepciones documentadas sin arreglo, el paso las excluye una por una, nunca bajando el nivel (research R10)
- [ ] T003 Instalar `nodemailer` (dependencia) y `@types/nodemailer` (devDependency), ambos con versión exacta fija, en `backend/package.json` y `backend/package-lock.json`, verificando la licencia y la versión antes de fijarlas (ADR-026)
- [ ] T004 [P] Agregar a `.env.example` las variables nuevas: `ENLACES_LLAVE`, `ENLACES_SAL_IP`, `SMTP_HOST`, `SMTP_PUERTO`, `SMTP_TLS`, `SMTP_USUARIO`, `SMTP_CLAVE`, `CORREO_REMITENTE`, `CORREO_TIEMPO_LIMITE_MS`, `URL_PUBLICA` y `EVENTOS_INTERVALO_MS`, con valores solo de desarrollo (plan, Technical Context)
- [ ] T005 [P] Agregar el servicio `mailpit` a `docker-compose.yml` (IP fija en la red `plataforma`, 32 MB, puertos 1025 y 8025) y las variables `SMTP_*`, `CORREO_*`, `ENLACES_*`, `URL_PUBLICA` y `EVENTOS_INTERVALO_MS` en `x-backend-entorno`, sin descargar la imagen (ADR-026)

### Pruebas de la base (escribir primero, deben fallar) ⚠️

- [ ] T006 [P] Ampliar `backend/test/unit/shared/configuracion.spec.ts`: lectura y validación de `ENLACES_LLAVE` (32 bytes), `SMTP_*`, `URL_PUBLICA` y `EVENTOS_INTERVALO_MS` (plan, Constraints)
- [ ] T007 [P] Ampliar `backend/test/unit/shared/ejecutor-tareas.spec.ts`: una tarea con intervalo propio se programa con ese intervalo y las demás siguen con `TAREAS_INTERVALO_MS` (research R05)
- [ ] T008 [P] Crear `backend/test/unit/shared/enlaces-firmados.spec.ts`: emitir y verificar; token alterado en un byte, con otra llave, vencido o con otro separador de dominio → rechazado; la comparación usa tiempo constante; el token no contiene datos personales (ADR-032, contracts/enlaces-de-accion.md §1)
- [ ] T009 [P] Ampliar `backend/test/integration/aislamiento/rls.spec.ts`: `outbox_event`, `notification`, `customer_notification_preference`, `whatsapp_consent`, `appointment_reschedule` y `appointment_link_use` tienen RLS `ENABLE` y `FORCE` con la política `tenant_isolation`; `action_link_attempt` no tiene `tenant_id` (constitución 1.4.0, principio III)
- [ ] T010 [P] Crear `backend/test/integration/aislamiento/aislamiento-004.spec.ts` con **un caso por tabla nueva con barbería**: con el tenant A no se lee ni se modifica una fila de B en `outbox_event`, `notification`, `customer_notification_preference`, `whatsapp_consent`, `appointment_reschedule` ni `appointment_link_use`, y un `INSERT` con el tenant de otra barbería falla por `WITH CHECK` (PR09, FR-034)
- [ ] T011 [P] Ampliar `backend/test/integration/aislamiento/lectura-plataforma.spec.ts`: `barberias_plataforma` lee solo las cinco columnas técnicas de `outbox_event` y de `notification` (data-model §7), sin `type`, `payload` ni el resto, y no tiene ningún permiso sobre las otras tablas nuevas; `barberias_auth` no tiene ningún permiso sobre ninguna tabla nueva (ADR-025, ADR-031)
- [ ] T012 [P] Crear `backend/test/integration/aislamiento/permisos-004.spec.ts`: los permisos de `barberias_app` sobre las tablas y columnas nuevas coinciden con data-model §7 (sin `DELETE`, salvo en `action_link_attempt`) (data-model §7)
- [ ] T013 [P] Crear `backend/test/integration/shared/salida-eventos.spec.ts`: `publicar` dentro de una transacción confirmada deja el evento `PENDIENTE` con el tenant de la transacción; si la transacción se revierte, no hay evento; `publicar` sin transacción falla; `reemplazar` y `anular` actúan solo sobre el pendiente de esa clave y ese tenant; el despacho ejecuta el manejador y marca `PROCESADO` en el mismo COMMIT; un manejador que falla deja el evento pendiente con `attempts + 1` (ADR-025, contracts/eventos.md §1–§2)
- [ ] T014 [P] Crear `backend/test/integration/shared/evento-sin-manejador.spec.ts`: un evento de un tipo sin suscriptor queda `SIN_MANEJADOR` en su primer despacho, se escribe una advertencia en el registro (solo el tipo y el id, sin el `payload`) y no se reintenta ni consume más intentos; un evento con suscriptor no se ve afectado (contracts/eventos.md §2, punto 6)
- [ ] T015 [P] Crear `backend/test/integration/shared/despacho-dos-instancias.spec.ts`: con dos instancias en proceso despachando a la vez 100 eventos, cada evento llega al manejador y queda `PROCESADO` una sola vez (ADR-025, SC-005)
- [ ] T016 [P] Crear la suite de contrato `backend/test/contract/notification-channel.contract.ts` (`probarContratoDeCanal(nombre, crear)`), **independiente del canal**: recibe la fábrica del adaptador y cómo leer lo enviado, y cubre los casos de contracts/notification-channel.md §4. En esta fase solo la corre `backend/test/contract/canal-correo.contract.spec.ts`, contra `canal-correo-smtp` con Mailpit; el simulador de WhatsApp se le agrega en la fase 5 (ADR-026)
- [ ] T017 [P] Crear `backend/test/contract/canal-sandbox.contract.spec.ts`, la variante contra un proveedor real que se omite con un aviso si faltan `SMTP_SANDBOX_*`, como `gateway-sandbox.spec.ts` (ADR-026)
- [ ] T018 [P] Agregar a `backend/test/architecture/reglas.spec.ts` y a sus fixtures en `backend/test/architecture/fixture/src/modules/notificaciones/` las violaciones de las reglas nuevas: `matriz-m05` (M05 solo hacia M01 por `index.ts` y hacia M06), `canal-solo-por-puerto` (adaptadores solo dentro de `notificaciones/infrastructure/`), `eventos-solo-por-bus` (la salida transaccional solo desde `shared/eventos/`) y `enlaces-confinados` (`EnlacesFirmados` solo desde M05 y desde las rutas de enlaces de M02); y que nadie llama a M05 (PR14, revisión de ADR-013)

### Implementación de la base

- [ ] T019 Crear `backend/migrations/0021_salida_de_eventos.ts`: `outbox_event` con `rlsPorTenant`, estados `PENDIENTE`, `PROCESADO`, `ANULADO` y `SIN_MANEJADOR`, índices parciales, unicidad de `replace_key`, `GRANT` de `barberias_app` y `SELECT` de cinco columnas con la política `plataforma_lectura` para `barberias_plataforma`; exportar la lista de columnas, como `COLUMNAS_PLATAFORMA_TAREAS` en `0017` (data-model §3)
- [ ] T020 [P] Crear `backend/migrations/0022_canal_y_consentimiento_whatsapp.ts`: `customer_notification_preference` y `whatsapp_consent` con `rlsPorTenant`, índice único parcial del consentimiento vigente y `GRANT` por columna (data-model §2)
- [ ] T021 [P] Crear `backend/migrations/0023_citas_reprogramacion.ts`: `ALTER TABLE appointment` con `version` y `client_confirmed_at`; `GRANT UPDATE` por columna; `appointment_reschedule` y `appointment_link_use` con `rlsPorTenant` y `UNIQUE (link_hash)` (data-model §1)
- [ ] T022 [P] Crear `backend/migrations/0024_avisos.ts`: `notification` con `rlsPorTenant`, `UNIQUE (tenant_id, event_id, recipient_kind, recipient_ref)`, índice parcial y `SELECT` de cinco columnas para `barberias_plataforma` (data-model §4)
- [ ] T023 [P] Crear `backend/migrations/0025_intentos_enlaces.ts`: `action_link_attempt` sin `tenant_id`, con índice `(ip_hash, attempted_at)` y `SELECT, INSERT, DELETE` para `barberias_app` (data-model §5, constitución 1.4.0)
- [ ] T024 Registrar `0021` a `0025` en `backend/migrations/index.ts` y agregar sus tablas a `backend/src/shared/persistence/db-types.ts` (data-model)
- [ ] T025 Agregar el intervalo por tarea en `backend/src/shared/tareas/ejecutor-tareas.ts` (`Tarea.intervaloMs` opcional), sin cambiar el comportamiento de las tareas de 003 (research R05)
- [ ] T026 Crear el bus de eventos de M06 en `backend/src/shared/eventos/bus-de-eventos.ts` (puerto: `publicar`, `reemplazar`, `anular`, `suscribir`), `backend/src/shared/eventos/salida-postgres.ts` (escritura en la transacción en curso del `UnitOfWork`) y `backend/src/shared/eventos/despachador.ts` (despacho tras `alConfirmar` y tarea `despachar-eventos`, `FOR UPDATE SKIP LOCKED`, una transacción por evento con su tenant, esperas crecientes del manejador; un tipo sin suscriptor queda `SIN_MANEJADOR` con una advertencia y sin reintento, T014); exportarlo en `backend/src/shared/index.ts` y registrarlo en `backend/src/shared/shared.module.ts` (ADR-025)
- [ ] T027 Crear la lectura de eventos pendientes con `barberias_plataforma` en `backend/src/shared/eventos/pendientes-plataforma.ts` (solo las cinco columnas técnicas) y ampliar la regla `lectura-plataforma-confinada` de `backend/.dependency-cruiser.cjs` para permitirla allí y en `backend/src/modules/notificaciones/infrastructure/plataforma/` (ADR-025, research R08)
- [ ] T028 [P] Crear `backend/src/shared/enlaces/enlaces-firmados.ts` (`emitir` y `verificar`; formato de contracts/enlaces-de-accion.md §1; llave de `Configuracion`) y exportarlo en `backend/src/shared/index.ts` (ADR-032)
- [ ] T029 [P] Leer las variables nuevas en `backend/src/shared/config/configuracion.ts` (T006)
- [ ] T030 Crear el esqueleto de M05: `backend/src/modules/notificaciones/index.ts`, `backend/src/modules/notificaciones/notificaciones.module.ts`, `backend/src/modules/notificaciones/application/ports/notification-channel.ts` (puerto, `MensajeSaliente`, `EnvioAceptado`, `CanalNoDisponible`, `DestinatarioInvalido`) (contracts/notification-channel.md §1)
- [ ] T031 Crear `backend/src/modules/notificaciones/infrastructure/canal-correo-smtp.ts` con `nodemailer`: texto simple `utf-8`, `Message-ID` a partir de la clave de idempotencia, tiempo límite de 5 s, `Interruptor` de M06, y sin registrar el texto ni el destino; y `backend/src/modules/notificaciones/infrastructure/fabrica-canales.ts` (contracts/notification-channel.md §2)
- [ ] T032 [P] Crear `backend/test/helpers/mailpit.ts`: Mailpit en Testcontainers y lectura de los mensajes por su API HTTP (ADR-026)
- [ ] T033 Importar `NotificacionesModule` en `backend/src/host/app.module.ts`, crear `backend/src/host/eventos.ts` (raíz de composición de las suscripciones al bus, vacía por ahora) y registrar `despachar-eventos` con `EVENTOS_INTERVALO_MS` en `backend/src/host/tareas.ts` (ADR-025)
- [ ] T034 Implementar en `backend/.dependency-cruiser.cjs` las reglas de T018 (PR14)
- [ ] T035 Cierre de fase 1: `npm run lint`, `npm run build`, `npm test`, `npm run test:int` y `npm run test:arch` en el backend, y `npm run lint`, `npm run build` y `npm test` en el frontend; Prettier sin cambios; CI en verde con el paso de `npm audit` (`.github/workflows/plataforma-barberias.yml`). Un commit: `feat(004): base de notificaciones (fase 1)`

**Checkpoint**: tablas con RLS, bus y enlaces probados, M05 con el correo y la CI con escaneo de dependencias.

---

## Fase 2: User Story 1 - El cliente reprograma su cita sin perderla (Priority: P1) 🎯 MVP

**Goal**: el cliente con sesión, o el propietario, mueve una cita activa a otra hora libre con las reglas de una reserva nueva; si choca, la cita conserva su hora (RF13).

**Independent Test**: spec.md US1 ("Independent Test"): reprogramar a una hora libre, rechazar la hora de otra cita y 50 reprogramaciones simultáneas → 1.

### Pruebas de US1 (escribir primero, deben fallar) ⚠️

- [ ] T036 [P] [US1] Crear `backend/test/unit/citas/reprogramar.spec.ts`: `Cita.reprogramar` solo en `PENDIENTE` o `CONFIRMADA` y antes del inicio; sube `version` y borra la confirmación del cliente; a la misma hora y barbero no cambia; el cliente necesita la antelación de cancelación y el propietario no; cancelar, completar y no asistió también suben `version` (RF13, FR-001 a FR-007)
- [ ] T037 [P] [US1] Crear `backend/test/integration/citas/reprogramar.spec.ts`: escenarios US1-1, US1-2, US1-4, US1-6 y US1-7 (hora libre, hora ocupada con 409, motivos de 002 con 422, propietario con otro barbero, suscripción que no acepta reservas con 403); historial en `appointment_reschedule`; la hora anterior vuelve a estar libre; misma hora → 200 con `cambio: false` (RF13)
- [ ] T038 [P] [US1] Crear `backend/test/integration/citas/reprogramar-antelacion.spec.ts`: el cliente sin antelación recibe 422 `SIN_ANTELACION_PARA_REPROGRAMAR` con `puedeCancelar: true` y la cita no cambia; el propietario sí reprograma (US1-5, FR-006, SC-012)
- [ ] T039 [P] [US1] Crear `backend/test/integration/citas/reprogramar-concurrencia.spec.ts`: 50 citas distintas reprogramadas a la vez a la misma hora libre del mismo barbero → 1 éxito, 49 respuestas 409 y 0 respuestas 5xx, con las perdedoras en su hora original; variante con 25 reservas y 25 reprogramaciones; variante que cambia de barbero sin bloqueo mutuo (PR16, US1-3, SC-001, research R03)
- [ ] T040 [P] [US1] Crear `backend/test/contract/rbac-004.spec.ts` con la fila `POST /citas/{id}/reprogramar` de contracts/rbac.md, y ampliar `backend/test/contract/citas.contract.spec.ts` con su respuesta y sus errores según contracts/openapi.yaml (PR08, PR26)
- [ ] T041 [P] [US1] Agregar `ReprogramarCita` a la lista de `backend/test/architecture/operaciones-con-politica.spec.ts` y el caso `REPROGRAMAR` (como `RESERVAR`) a `backend/test/integration/suscripciones/restricciones-estado.spec.ts` (PR14, US1-7)
- [ ] T042 [P] [US1] Crear `backend/test/integration/citas/reprogramar-evento.spec.ts`: una reprogramación con cambio publica un `CitaReprogramada` en la misma transacción, con el payload de contracts/eventos.md §3 y sin datos de contacto; una fallida o sin cambio no publica nada (FR-010)
- [ ] T043 [P] [US1] Crear `frontend/test/pages/reprogramar.spec.tsx`: desde Mis citas (cliente) y desde la Agenda (propietario); estados cargando, vacío ("no hay horas libres ese día") y error; 409 con la cita intacta; 422 sin antelación con la opción de cancelar; se puede completar solo con teclado (RF13)

### Implementación de US1

- [ ] T044 [US1] Agregar `reprogramar`, `version` y el aumento de versión al cancelar, completar y no asistió en `backend/src/modules/catalogo-citas/citas/domain/cita.ts` (T036)
- [ ] T045 [US1] Agregar los errores `SinAntelacionParaReprogramar` y `CitaCambio` en `backend/src/modules/catalogo-citas/catalogo/domain/errores.ts` y su código HTTP en `backend/src/host/error.filter.ts` (contracts/openapi.yaml)
- [ ] T046 [US1] Agregar `reprogramar` al puerto `backend/src/modules/catalogo-citas/citas/application/ports/cita-repository.ts` e implementarlo en `backend/src/modules/catalogo-citas/citas/infrastructure/cita-repository-postgres.ts`: candados de los dos barberos en orden, `UPDATE` condicional por versión y estado, `23P01` → `HorarioNoDisponible` o `CitaSolapadaDelCliente`, 0 filas → `CitaCambio`, reintento ante `40P01` e inserción en `appointment_reschedule` (research R01–R03)
- [ ] T047 [US1] Extraer las reglas de la nueva hora de `backend/src/modules/catalogo-citas/citas/application/reservar-cita.ts` a `backend/src/modules/catalogo-citas/citas/application/reglas-de-horario.ts` y usarlas desde la reserva, sin cambiar su comportamiento (PR16 de 002 debe seguir en verde) (FR-003)
- [ ] T048 [US1] Crear `backend/src/modules/catalogo-citas/citas/application/reprogramar-cita.ts`: autorización (cliente dueño o propietario), `exigirOperacion(RESERVAR)`, antelación solo del cliente, reglas de T047, repositorio, auditoría `CITA_REPROGRAMADA` y `publicar(CitaReprogramada)` (FR-001 a FR-007)
- [ ] T049 [US1] Agregar `POST /citas/:id/reprogramar` en `backend/src/modules/catalogo-citas/citas/presentation/citas.controller.ts` con su DTO en `backend/src/modules/catalogo-citas/citas/presentation/citas.dto.ts`, y registrar el caso de uso en `backend/src/modules/catalogo-citas/catalogo-citas.module.ts` (contracts/openapi.yaml)
- [ ] T050 [US1] Agregar `specs/004-notificaciones-reprogramacion/contracts/openapi.yaml` al script `gen:api` de `frontend/package.json` y generar `frontend/src/api/schema-004.d.ts` (contracts/openapi.yaml)
- [ ] T051 [US1] Extraer la selección de horas de `frontend/src/pages/publico/CatalogoPublico.tsx` a `frontend/src/components/app/SelectorDeHora.tsx`, sin cambiar el catálogo (`frontend/test/pages/catalogo-publico.spec.tsx` sigue en verde) (research R15)
- [ ] T052 [US1] Crear `frontend/src/components/app/ReprogramarCita.tsx` (usa `SelectorDeHora`; estados cargando, vacío y error; 409 y 422 con la oferta de cancelar) y agregar el botón "Reprogramar" en `frontend/src/pages/cliente/MisCitas.tsx` y en `frontend/src/pages/panel/Agenda.tsx` (RF13)
- [ ] T053 [US1] Revisión manual de las pantallas de T052 a 360 px y en escritorio, en tema claro y oscuro y solo con teclado, más una pasada con la **extensión axe DevTools del navegador** (sin dependencias nuevas); anotar el resultado (fecha, pantalla, tema, hallazgos y su corrección o motivo) en la sección "Revisión manual de la interfaz" de `specs/004-notificaciones-reprogramacion/quickstart.md` (principio IX)
- [ ] T054 [US1] Cierre de fase 2: suite completa del backend y del frontend, `npm run test:arch` y CI en verde (`.github/workflows/plataforma-barberias.yml`). Un commit: `feat(004): reprogramar citas (fase 2, US1)`

**Checkpoint**: US1 funciona sola. El evento `CitaReprogramada` queda publicado; hasta la fase 3 no tiene manejador, así que el despacho lo marca `SIN_MANEJADOR` y esas reprogramaciones no generan aviso (solo afecta a datos de desarrollo anteriores a la fase 3).

---

## Fase 3: User Story 2 - El cliente recibe la confirmación, la cancelación y la reprogramación (Priority: P1)

**Goal**: cada cita creada, cancelada o reprogramada produce un aviso por correo, una sola vez, sin demorar ni deshacer la operación (RF30).

**Independent Test**: spec.md US2 ("Independent Test"): un correo por operación en Mailpit, y con el correo detenido las operaciones se completan igual y los avisos llegan una vez al volver.

### Pruebas de US2 (escribir primero, deben fallar) ⚠️

- [ ] T055 [P] [US2] Crear `backend/test/unit/notificaciones/destinatarios.spec.ts`: la tabla de destinatarios de contracts/eventos.md §4 (cliente, propietario y barbero con usuario según quién canceló o reprogramó) y el cliente presencial sin correo → `DESCARTADO` (FR-008, FR-009, FR-015)
- [ ] T056 [P] [US2] Crear `backend/test/unit/notificaciones/plantillas.spec.ts`: texto simple con barbería, servicio, barbero, fecha y hora en la hora de la barbería, y la hora anterior en la reprogramación; nunca teléfono, correo ni datos de otras citas (FR-013, FR-014)
- [ ] T057 [P] [US2] Crear `backend/test/unit/notificaciones/politica-reintentos.spec.ts`: esperas de 30 s, 2 min, 10 min, 30 min y 1 h con ±20 %; hasta 6 intentos; un error permanente no se reintenta; con el circuito abierto no se consume un intento; el aviso pasa a `FALLIDO` a las 24 h (FR-032, FR-033, research R13)
- [ ] T058 [P] [US2] Crear `backend/test/integration/notificaciones/avisos-cita.spec.ts` con Mailpit: escenarios US2-1 a US2-4 y US2-7 (un correo por operación, cita presencial con y sin correo, avisos al personal, operación fallida → 0 avisos) (PR27, RF30)
- [ ] T059 [P] [US2] Crear `backend/test/integration/notificaciones/correo-caido.spec.ts`: con Mailpit detenido, reservar, cancelar y reprogramar responden igual y en el mismo tiempo; al volver, cada aviso llega una vez; el circuito se abre con 5 fallos en 60 s (PR06, US2-5, SC-003)
- [ ] T060 [P] [US2] Crear `backend/test/integration/notificaciones/salida-eventos-dos-instancias.spec.ts`: 100 operaciones con dos instancias en proceso → 100 avisos, 0 perdidos y 0 duplicados (US2-6, SC-005)
- [ ] T061 [P] [US2] Crear `backend/test/integration/notificaciones/salida-eventos-caida.spec.ts`: los casos de caída de ADR-025 (después del COMMIT y antes del despacho; durante el despacho; con el aviso reclamado y sin enviar) sin pérdidas ni duplicados (ADR-025)
- [ ] T062 [P] [US2] Ampliar `backend/test/integration/citas/reservar.spec.ts` y `backend/test/integration/citas/cancelar.spec.ts`: la reserva publica `CitaCreada` y la cancelación `CitaCancelada`, en la misma transacción y sin datos de contacto (FR-010)
- [ ] T063 [P] [US2] Crear `backend/test/integration/notificaciones/retencion.spec.ts`: los eventos procesados, anulados o sin manejador de más de 30 días y los avisos de más de 90 días se purgan; los pendientes nunca (research R17)

### Implementación de US2

- [ ] T064 [US2] Publicar `CitaCreada` en `backend/src/modules/catalogo-citas/citas/application/reservar-cita.ts` y `CitaCancelada` en `backend/src/modules/catalogo-citas/citas/application/cancelar-cita.ts` (contracts/eventos.md §3)
- [ ] T065 [US2] Ampliar la interfaz pública de M01 en `backend/src/modules/acceso-barberias/api-publica.ts` con `ClientesApi.contactoParaAvisos` (por ahora: correo y canal `CORREO`), `PersonalApi.correoDe` y `BarberiasApi.correoDelPropietario` y `nombre`, e implementarla en `backend/src/modules/acceso-barberias/clientes/application/clientes-api.ts`, `backend/src/modules/acceso-barberias/identidad/application/personal-api.ts` y `backend/src/modules/acceso-barberias/barberias/application/barberias-api.ts` (revisión de ADR-013)
- [ ] T066 [P] [US2] Crear el dominio de M05: `backend/src/modules/notificaciones/domain/aviso.ts` (estados de data-model §4), `domain/destinatarios.ts`, `domain/plantillas.ts`, `domain/politica-reintentos.ts` y `domain/eleccion-canal.ts` (por ahora siempre correo) (T055 a T057)
- [ ] T067 [US2] Crear `backend/src/modules/notificaciones/application/ports/aviso-repository.ts` y `backend/src/modules/notificaciones/infrastructure/kysely-aviso-repository.ts` (alta única por evento y destinatario, reclamo con `claimed_until` y `SKIP LOCKED`, anotación del resultado) (data-model §4)
- [ ] T068 [P] [US2] Crear `backend/src/modules/notificaciones/infrastructure/plataforma/avisos-pendientes.ts`: la lectura de avisos pendientes con `barberias_plataforma` (solo las cinco columnas) (research R08)
- [ ] T069 [US2] Crear `backend/src/modules/notificaciones/application/manejadores-de-cita.ts` (crea los avisos de `CitaCreada`, `CitaCancelada` y `CitaReprogramada` en la transacción del despacho) y suscribirlos en `backend/src/host/eventos.ts` (ADR-025 paso 3)
- [ ] T070 [US2] Crear `backend/src/modules/notificaciones/application/enviar-avisos.ts`: reclama, resuelve el destino con M01, compone, envía fuera de la transacción, anota y purga a los 30 y 90 días; y registrar la tarea `enviar-avisos` con `EVENTOS_INTERVALO_MS` en `backend/src/host/tareas.ts` (ADR-025 pasos 4 a 6)
- [ ] T071 [US2] Crear `backend/scripts/demo-avisos.ts` y el script `demo:avisos` en `backend/package.json` (dos réplicas con Compose y Mailpit detenido y vuelto a levantar; quickstart pasos 1 a 3 y 16) (plan, fase 3; recorte 2 si quedan 4 días)
- [ ] T072 [US2] Cierre de fase 3: suite completa del backend y del frontend, `npm run test:arch` y CI en verde (`.github/workflows/plataforma-barberias.yml`). Un commit: `feat(004): avisos de citas por correo (fase 3, US2)`

**Checkpoint**: US1 y US2 funcionan. RF13 y RF30 (avisos al cliente y al personal) tienen valor real por correo.

---

## Fase 4: User Story 3 - Recordatorio del día con enlaces para confirmar, reprogramar o cancelar (Priority: P2)

**Goal**: un solo recordatorio 2 h antes, con tres enlaces de un solo uso que funcionan sin sesión, alcanzan una sola cita y vencen (RF34).

**Independent Test**: spec.md US3 ("Independent Test").

### Pruebas de US3 (escribir primero, deben fallar) ⚠️

- [ ] T073 [P] [US3] Crear `backend/test/unit/citas/accion-por-enlace.spec.ts`: la acción de la ruta debe ser la del enlace; la cita debe tener la misma versión, un estado activo y un inicio futuro; confirmar no cambia la versión y cancelar sí (contracts/enlaces-de-accion.md §3–§4)
- [ ] T074 [P] [US3] Crear `backend/test/unit/citas/limite-rechazos-enlace.spec.ts`: el caso de uso de M02 que registra y evalúa los rechazos usa la **misma** `PoliticaIntentos` de M01, importada de `acceso-barberias/index.ts` (no una copia), con la IP como clave: 5 rechazos en 60 s bloquean 60 s; cada racha siguiente duplica la espera hasta 900 s; el historial es de 24 h. La regla en sí ya la prueba `backend/test/unit/identidad/politica-intentos.spec.ts` (FR-031, research R07)
- [ ] T075 [P] [US3] Crear `backend/test/integration/enlaces/recordatorio.spec.ts`: un solo recordatorio 2 h antes, con dos instancias; una cita reservada o reprogramada a menos de 2 h no recibe recordatorio; reprogramar reemplaza el recordatorio y cancelar lo anula; un recordatorio no enviado antes del inicio se descarta; sin respuesta la cita no cambia (US3-1, US3-5, US3-6, FR-022, FR-023, FR-033, SC-006, SC-010, PR28)
- [ ] T076 [P] [US3] Crear `backend/test/integration/enlaces/enlaces-acciones.spec.ts`: confirmar marca `client_confirmed_at`; cancelar libera la hora con la marca de tardía y avisa al personal; reprogramar aplica las reglas del cliente; confirmar y luego cancelar está permitido; `GET` no consume el enlace (US3-2 a US3-4, US3-8, FR-026, FR-028 a FR-030, PR28)
- [ ] T077 [P] [US3] Crear `backend/test/integration/enlaces/enlaces-rechazos.spec.ts`: **firma inválida** (token alterado), **vencido** (después de la hora de inicio), **ya usado** (segundo uso), de otra acción, y de una cita cancelada, reprogramada o completada → 410 `ENLACE_NO_VALIDO` con el mismo mensaje y la cita sin cambios; dos usos simultáneos en dos instancias → exactamente 1 con efecto; una reprogramación fallida no consume el enlace (US3-7, FR-024, FR-025, SC-008, PR28)
- [ ] T078 [P] [US3] Crear `backend/test/integration/enlaces/enlaces-limite.spec.ts`: el **límite de rechazos por IP** responde 429 con `reintentarEnSegundos` tras 5 rechazos en 60 s; `action_link_attempt` guarda solo el hash de la IP; se purga a las 24 h; además, el límite de 30 solicitudes por minuto de las rutas de enlaces (FR-031)
- [ ] T079 [P] [US3] Crear `backend/test/integration/aislamiento/aislamiento-avisos.spec.ts`: un enlace firmado para la barbería A con la cita de B se rechaza; un token alterado se rechaza **sin ninguna consulta a la base** (se cuentan las consultas); las rutas de enlaces ignoran un token de sesión de otra barbería (PR09, FR-027, SC-011)
- [ ] T080 [P] [US3] Crear `backend/test/integration/enlaces/sin-token-en-registros.spec.ts`: el token nunca aparece en los registros capturados de la aplicación (contracts/enlaces-de-accion.md §6)
- [ ] T081 [P] [US3] Ampliar `backend/test/contract/rbac-004.spec.ts` con las filas de `/enlaces/accion*` y crear `backend/test/contract/enlaces.contract.spec.ts` según contracts/openapi.yaml; ampliar `backend/test/contract/agenda.contract.spec.ts` con `confirmadaPorClienteEn` (PR08, PR26)
- [ ] T082 [P] [US3] Crear `frontend/test/pages/enlace.spec.tsx`: la página `/e` lee el token del fragmento y lo quita de la dirección; muestra los datos mínimos; confirma, cancela y reprograma (con `SelectorDeHora` y los horarios públicos); con un enlace no válido muestra el mensaje genérico con la opción de iniciar sesión; estados cargando y error; uso solo con teclado (RF34)
- [ ] T083 [P] [US3] Ampliar `frontend/test/pages/agenda.spec.tsx`: la agenda muestra "confirmada por el cliente" o "sin confirmar" (FR-028)

### Implementación de US3

- [ ] T084 [US3] Agregar `confirmarAsistencia` en `backend/src/modules/catalogo-citas/citas/domain/cita.ts` y `confirmadaPorClienteEn` en las vistas de `backend/src/modules/catalogo-citas/citas/application/consultar-agenda.ts` y `consultar-historial.ts` (FR-028)
- [ ] T085 [US3] Publicar `RecordatorioDeCita` con `reemplazar('recordatorio:<citaId>')` a `inicio − 2 h` (si faltan 2 h o más) en `reservar-cita.ts` y `reprogramar-cita.ts`, y `anular` en `cancelar-cita.ts` y `cambiar-estado-cita.ts`, todos en `backend/src/modules/catalogo-citas/citas/application/` (research R09)
- [ ] T086 [US3] Exponer `PoliticaIntentos`, `HISTORIAL_MS` y el tipo `EvaluacionIntentos` de `backend/src/modules/acceso-barberias/identidad/domain/politica-intentos.ts` en la interfaz pública `backend/src/modules/acceso-barberias/index.ts`, con un comentario que diga que la usan el ingreso (M01) y los enlaces de acción (M02). La regla no se mueve ni se duplica; la matriz `matriz-m02` de PR14 ya permite que M02 importe ese `index.ts` (FR-031, research R07)
- [ ] T087 [US3] Crear `backend/src/modules/catalogo-citas/citas/application/ports/intentos-enlace-repository.ts` y `backend/src/modules/catalogo-citas/citas/infrastructure/kysely-intentos-enlace-repository.ts` (`action_link_attempt`, SHA-256 de la IP con `ENLACES_SAL_IP`, purga a las 24 h); la evaluación del bloqueo, en la capa de aplicación de M02, usa `PoliticaIntentos` de T086 (FR-031)
- [ ] T088 [US3] Crear `backend/src/modules/catalogo-citas/citas/application/accion-por-enlace.ts`: verifica con `EnlacesFirmados` antes de leer nada, abre la transacción con el tenant del enlace, comprueba versión, estado e inicio, aplica confirmar, `CancelarCita` como cliente o `ReprogramarCita` como cliente, inserta `appointment_link_use` en la misma transacción y audita con la vía `ENLACE` (ADR-032, contracts/enlaces-de-accion.md §3)
- [ ] T089 [US3] Crear `backend/src/modules/catalogo-citas/citas/presentation/enlaces.controller.ts`: `GET /enlaces/accion` y `POST /enlaces/accion/confirmar`, `/cancelar` y `/reprogramar`, públicos, con el token solo del encabezado `X-Enlace-Accion` y `@Throttle` de 30 por minuto; registrarlo en `backend/src/modules/catalogo-citas/catalogo-citas.module.ts` (contracts/openapi.yaml)
- [ ] T090 [US3] Crear `backend/src/modules/notificaciones/application/manejador-recordatorio.ts`: crea el aviso `RECORDATORIO` con `discard_after = inicio`, emite los tres enlaces con `EnlacesFirmados` al enviar y compone `URL_PUBLICA/e#<token>`; descartar los recordatorios pendientes de la cita al recibir `CitaCancelada` o `CitaReprogramada` en `manejadores-de-cita.ts`; suscribirlo en `backend/src/host/eventos.ts` (research R06, R09)
- [ ] T091 [US3] Crear `frontend/src/pages/publico/Enlace.tsx` y la ruta pública `/e` en `frontend/src/routes.tsx` (T082)
- [ ] T092 [US3] Mostrar la marca de confirmación en `frontend/src/pages/panel/Agenda.tsx` (T083)
- [ ] T093 [US3] Revisión manual de `/e` y de la agenda a 360 px y en escritorio, en tema claro y oscuro y solo con teclado, más una pasada con la **extensión axe DevTools del navegador**; anotar el resultado (fecha, pantalla, tema, hallazgos y su corrección o motivo) en la sección "Revisión manual de la interfaz" de `specs/004-notificaciones-reprogramacion/quickstart.md` (principio IX)
- [ ] T094 [US3] Cierre de fase 4: suite completa, `npm run test:arch` y CI en verde (`.github/workflows/plataforma-barberias.yml`). Un commit: `feat(004): recordatorio con enlaces de un solo uso (fase 4, US3)`

**Checkpoint**: RF34 completo por correo.

---

## Fase 5: User Story 4 - Canal de aviso y consentimiento para WhatsApp (Priority: P2)

**Goal**: el cliente elige WhatsApp con su número y su consentimiento; sin consentimiento vigente, o si WhatsApp falla, el aviso sale por correo (RF33).

**Independent Test**: spec.md US4 ("Independent Test").

### Pruebas de US4 (escribir primero, deben fallar) ⚠️

- [ ] T095 [P] [US4] Crear `backend/test/unit/notificaciones/eleccion-canal.spec.ts`: WhatsApp solo con canal WhatsApp y consentimiento vigente para el número actual; si no, correo; respaldo tras 3 fallos o con el circuito abierto (FR-019, FR-020, research R12)
- [ ] T096 [P] [US4] Crear `backend/test/unit/clientes/consentimiento-whatsapp.spec.ts`: exige aceptar con la versión vigente del texto; cambiar el número retira el anterior; el retiro guarda la fecha (FR-017, FR-018)
- [ ] T097 [P] [US4] Crear `backend/test/integration/clientes/canal-aviso.spec.ts`: `GET`, `PUT` y `DELETE` de `/clientes/yo/aviso` (US4-1 a US4-4 y US4-6: número propuesto con el teléfono, rechazo sin aceptar, retiro, cambio de número, una barbería no afecta a la otra) (RF33, PR18)
- [ ] T098 [P] [US4] Crear `backend/test/integration/notificaciones/respaldo-whatsapp.spec.ts` con el simulador: `fallar_n` y `caido` → el aviso llega por correo una sola vez, como `ENVIADO_RESPALDO` (US4-5, SC-009, PR06)
- [ ] T099 [P] [US4] Crear `backend/test/integration/notificaciones/whatsapp-sin-consentimiento.spec.ts`: 0 mensajes en el simulador para clientes sin consentimiento vigente, aunque tengan número guardado o el consentimiento se haya retirado entre la cita y el recordatorio (SC-007, EQ-18, PR18)
- [ ] T100 [P] [US4] Crear `backend/test/contract/canal-whatsapp.contract.spec.ts`, que agrega el simulador de WhatsApp a la **misma** suite `probarContratoDeCanal` de T016 (sin cambiar sus casos), contra `canal-whatsapp-simulado` con el simulador arrancado en el proceso de prueba (ADR-026)
- [ ] T101 [P] [US4] Crear `backend/test/integration/notificaciones/simulador-whatsapp.spec.ts`: autenticación, idempotencia por `Idempotency-Key`, consulta de mensajes y los siete modos de contracts/notification-channel.md §3 (ADR-026; recorte 3 si quedan 4 días: solo `normal`, `caido` y `fallar_n`)
- [ ] T102 [P] [US4] Agregar a `backend/test/architecture/reglas.spec.ts` y a sus fixtures la regla `simulador-whatsapp-fuera-del-monolito` (ningún archivo de `src/` importa `simulador-whatsapp/`) (PR14, ADR-026)
- [ ] T103 [P] [US4] Ampliar `backend/test/contract/rbac-004.spec.ts` con las filas de `/clientes/yo/aviso*` y `backend/test/contract/clientes.contract.spec.ts` con sus esquemas (PR08, PR26)
- [ ] T104 [P] [US4] Crear `frontend/test/pages/canal-aviso.spec.tsx`: la ruta `/mis-avisos` solo con sesión de cliente y el enlace desde Mis citas; elegir WhatsApp con el número propuesto, el texto y su versión visibles y la casilla obligatoria; retirar; estados cargando y error; uso solo con teclado (RF33)

### Implementación de US4

- [ ] T105 [US4] Crear el **simulador de WhatsApp en proceso aparte** en `backend/simulador-whatsapp/servidor.ts`, `backend/simulador-whatsapp/estado.ts` y `backend/simulador-whatsapp/modos.ts` (`node:http`, fuera de `src/`, **nunca se despliega en producción**), con los scripts `whatsapp-simulado` y `whatsapp:modo` (`backend/scripts/whatsapp-modo.ts`) en `backend/package.json` (contracts/notification-channel.md §3; en la fase 5 por decisión del responsable del 2026-11-04)
- [ ] T106 [US4] Agregar el servicio `whatsapp-simulado` a `docker-compose.yml` (IP fija, 64 MB, puerto 3200, solo lectura de su carpeta) y las variables `WHATSAPP_URL_BASE`, `WHATSAPP_TOKEN`, `WHATSAPP_TIEMPO_LIMITE_MS`, `WHATSAPP_PROVEEDOR` y el token de control en `x-backend-entorno` y en `.env.example` (ADR-026)
- [ ] T107 [P] [US4] Crear `backend/test/helpers/whatsapp.ts` (arranca el simulador en el proceso de prueba) y `backend/src/modules/notificaciones/infrastructure/canal-whatsapp-simulado.ts` (`fetch` con 3 s, `Interruptor`, `Idempotency-Key`), y agregarlo a `fabrica-canales.ts` (contracts/notification-channel.md §2)
- [ ] T108 [US4] Implementar la regla de T102 en `backend/.dependency-cruiser.cjs` (PR14)
- [ ] T109 [P] [US4] Crear el dominio de M01 en `backend/src/modules/acceso-barberias/clientes/domain/preferencia-aviso.ts` y `backend/src/modules/acceso-barberias/clientes/domain/consentimiento-whatsapp.ts`, y el **texto del consentimiento** (versión `2026-11`, copiado de `specs/004-notificaciones-reprogramacion/contracts/texto-consentimiento-whatsapp.md` y marcado como texto base por validar) en `backend/src/modules/acceso-barberias/clientes/domain/texto-consentimiento-whatsapp.ts` (FR-017, research R18)
- [ ] T110 [US4] Crear los puertos `backend/src/modules/acceso-barberias/clientes/application/ports/preferencia-aviso-repository.ts` y `consentimiento-whatsapp-repository.ts`, y sus implementaciones `kysely-preferencia-aviso-repository.ts` y `kysely-consentimiento-whatsapp-repository.ts` en `backend/src/modules/acceso-barberias/clientes/infrastructure/` (data-model §2)
- [ ] T111 [US4] Crear `backend/src/modules/acceso-barberias/clientes/application/canal-de-aviso.ts` (obtener, cambiar y retirar, con auditoría `CANAL_AVISO_CAMBIADO`, `CONSENTIMIENTO_WHATSAPP_ACEPTADO` y `CONSENTIMIENTO_WHATSAPP_RETIRADO`) y `backend/src/modules/acceso-barberias/clientes/presentation/aviso.controller.ts` (`/clientes/yo/aviso`, solo `CLIENTE`); registrarlos en `backend/src/modules/acceso-barberias/acceso-barberias.module.ts` (contracts/openapi.yaml)
- [ ] T112 [US4] Completar `ClientesApi.contactoParaAvisos` en `backend/src/modules/acceso-barberias/clientes/application/clientes-api.ts` con el canal, el número y el consentimiento vigente, y aplicar el canal y el respaldo en `backend/src/modules/notificaciones/domain/eleccion-canal.ts` y `application/enviar-avisos.ts` (research R12)
- [ ] T113 [US4] Crear `frontend/src/pages/cliente/CanalAviso.tsx` con **ruta propia** `/mis-avisos` (solo `CLIENTE`, protegida como `/mis-citas`) en `frontend/src/routes.tsx`, y un enlace "Cómo recibo mis avisos" desde `frontend/src/pages/cliente/MisCitas.tsx` (RF33)
- [ ] T114 [US4] Revisión manual de `CanalAviso` a 360 px y en escritorio, en tema claro y oscuro y solo con teclado, más una pasada con la **extensión axe DevTools del navegador**; anotar el resultado (fecha, pantalla, tema, hallazgos y su corrección o motivo) en la sección "Revisión manual de la interfaz" de `specs/004-notificaciones-reprogramacion/quickstart.md` (principio IX)
- [ ] T115 [US4] Cierre de fase 5: suite completa, `npm run test:arch` y CI en verde (`.github/workflows/plataforma-barberias.yml`). Un commit: `feat(004): canal de aviso y WhatsApp simulado con consentimiento (fase 5, US4)`

**Checkpoint**: RF33 completo. Con las fases 2 a 5, los cuatro RF de 004 tienen código y pruebas (RF30 sin los avisos de suscripción).

---

## Fase 6: User Story 5 - Avisos de suscripción al propietario (Priority: P3) ⚠️ PRIMER RECORTE

> **⚠️ PRIMER RECORTE.** Todas las tareas de esta fase (T116 a T124) se omiten juntas si falta tiempo. Ninguna otra fase depende de ellas. Si se recorta, RF30 queda con una deuda explícita (los avisos al propietario), que se anota en la trazabilidad y en el backlog en la fase 7.

**Goal**: el propietario recibe por correo, una vez cada uno, la prueba por terminar, el período en gracia, la suscripción vencida y el pago aprobado o rechazado (RF30).

**Independent Test**: spec.md US5 ("Independent Test").

### Pruebas de US5 (escribir primero, deben fallar) ⚠️

- [ ] T116 [P] [US5] Crear `backend/test/unit/suscripciones/aviso-fin-de-prueba.spec.ts`: el mismo criterio de "prueba por terminar" del panel (en prueba, sin período siguiente y con 3 días o menos) (FR-037)
- [ ] T117 [P] [US5] Crear `backend/test/integration/notificaciones/avisos-suscripcion.spec.ts`: cada uno de los cuatro hechos produce un correo al propietario, una sola vez, con dos instancias; con un período siguiente pagado no hay aviso de prueba por terminar; con el correo caído, la transición de 003 se completa igual; los mensajes no traen datos de pago sensibles (US5-1 a US5-5, FR-036 a FR-039, SC-013)
- [ ] T118 [P] [US5] Ampliar `backend/test/integration/tareas/vencimiento-dos-replicas.spec.ts`: la gracia y el vencimiento publican un evento por suscripción, sin duplicados (SC-013)

### Implementación de US5

- [ ] T119 [US5] Publicar `SuscripcionEnGracia` y `SuscripcionVencida` en `backend/src/modules/suscripciones-pagos/suscripciones/application/avanzar-suscripcion.ts`, en la misma transacción de la transición (contracts/eventos.md §3)
- [ ] T120 [US5] Publicar `PagoAprobado` y `PagoRechazado` en `backend/src/modules/suscripciones-pagos/pagos/application/aplicar-resultado.ts` y en `backend/src/modules/suscripciones-pagos/plataforma/application/comprobantes-plataforma.ts` (contracts/eventos.md §3)
- [ ] T121 [US5] Crear `backend/src/modules/suscripciones-pagos/suscripciones/application/avisar-fin-de-prueba.ts` (reutiliza el criterio de `consultas.ts`; clave `prueba-por-terminar:<id>`) y registrarla cada 6 h en `backend/src/host/tareas.ts` (research R14)
- [ ] T122 [US5] Agregar las plantillas de suscripción a `backend/src/modules/notificaciones/domain/plantillas.ts` y el manejador `backend/src/modules/notificaciones/application/manejadores-de-suscripcion.ts` (destinatario: `BarberiasApi.correoDelPropietario`); suscribirlo en `backend/src/host/eventos.ts` (FR-036, FR-039)
- [ ] T123 [US5] Verificar que la fase no agrega pantallas ni opciones (`frontend/src/` sin cambios en esta fase) (FR-040) y que las pruebas de 003 siguen en verde (`backend/test/integration/pagos/`, `backend/test/integration/suscripciones/`, `backend/test/integration/tareas/`)
- [ ] T124 [US5] Cierre de fase 6: suite completa y CI en verde (`.github/workflows/plataforma-barberias.yml`). Un commit: `feat(004): avisos de suscripción al propietario (fase 6, US5)`

---

## Fase 7: Cierre (documentación, suite completa y quickstart)

**Propósito**: dejar la documentación con el estado real de 004 y recorrer el quickstart. **Solo lo construido pasa de "planificado" a "implementado"**: si se recortó la fase 6, los avisos de suscripción siguen como planificados.

- [ ] T125 Recorrer `specs/004-notificaciones-reprogramacion/quickstart.md` §1 a §3 con Docker Compose y anotar cada resultado en su columna (el responsable ejecuta los pasos que usan Docker) (plan, fase 7)
- [ ] T126 [P] Actualizar `docs/05-gestion/02-backlog-y-sprints.md`: §3.3 con ADR-025, ADR-026 y ADR-032 Aceptados, y la fila de 004 del plan de 31 días con lo implementado y las líneas de corte aplicadas (plan, "Documentos que se actualizan")
- [ ] T127 [P] Actualizar `docs/05-gestion/07-guion-exposicion-y-defensa.md`: "las tres excepciones" pasa a "las cuatro excepciones", con la de las acciones por enlace (constitución 1.4.0)
- [ ] T128 [P] Actualizar `docs/trazabilidad.md`: §1 con RF13, RF30, RF33 y RF34; §3 con el estado de las pruebas; una tabla §4.5 de 004 con componentes y evidencia; y §5 con los diagramas tocados (plan, Trazabilidad)
- [ ] T129 [P] Actualizar `docs/05-gestion/04-pruebas.md` con los resultados medidos de PR06 (correo y WhatsApp), PR09, PR16, PR18, PR27 y PR28, y `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md` (EQ-06 y EQ-18) con lo medido contra los simuladores (plan, "Lo que NO se afirmará")
- [ ] T130 [P] Cambiar "planificado" o "aceptado, aún no implementado" por "implementado" **solo en lo construido** en: `docs/02-arquitectura-software/multi-tenancy-y-datos.md` (§1.3, control 1, casos especiales, §2.1), `docs/02-arquitectura-software/estilo-arquitectonico.md` (nota ², regla 4, diagrama), `docs/02-arquitectura-software/componentes-arquitectonicos.md` (fila M05, §3, §4), `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md` (filas y estados de ADR-013, ADR-025, ADR-026 y ADR-032), `.specify/templates/plan-template.md` (puerta III) y `docs/03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md` (§7)
- [ ] T131 [P] Actualizar `docs/03-diseño-de-software/diseño-interno/principios-de-diseño.md` y `docs/03-diseño-de-software/diseño-interno/patrones-de-diseño.md`: M05 y el bus de eventos dejan de ser planificados, con sus nombres reales
- [ ] T132 [P] Actualizar `docs/02-arquitectura-software/tecnologias.md` (Mailpit, `nodemailer` con su versión, simulador de WhatsApp), `docs/02-arquitectura-software/api-rest.md` (rutas nuevas) y `docs/02-arquitectura-software/seguridad-y-privacidad.md` (enlaces firmados, consentimiento de WhatsApp)
- [ ] T133 [P] Actualizar `tecnologia/plataforma-barberias/README.md`: servicios `mailpit` y `whatsapp-simulado`, variables nuevas y los comandos `demo:avisos` y `whatsapp:modo`
- [ ] T134 **Pendiente de Sem:** el chat de Sem regenera `img/aislamiento-excepciones.png` y `img/modulos-dependencias-permitidas.png` desde su código Mermaid ya actualizado (`docs/02-arquitectura-software/multi-tenancy-y-datos.md` §1.3 y `docs/02-arquitectura-software/estilo-arquitectonico.md` §3), y Sem los copia al repositorio. Esta sesión no renderiza imágenes; solo verifica que el código Mermaid coincida con lo implementado
- [ ] T135 Cierre de fase 7: suite completa del backend (incluido `test:arch`) y del frontend, Prettier y CI en verde (`.github/workflows/plataforma-barberias.yml`). Un commit: `docs(004): cierre de notificaciones y reprogramación (fase 7)`

---

## Dependencies & Execution Order

### Dependencias entre fases

- **Fase 1** no depende de nada y bloquea a todas.
- **Fase 2 (US1)** depende de la 1.
- **Fase 3 (US2)** depende de la 1. Consume el evento que publica la 2: si la 3 se hace antes que la 2, el aviso de reprogramación se prueba cuando la 2 termine.
- **Fase 4 (US3)** depende de la 2 (reprogramar) y de la 3 (envío).
- **Fase 5 (US4)** depende de la 3 (envío y elección de canal).
- **Fase 6 (US5)** depende de la 3. **Ninguna fase depende de la 6.**
- **Fase 7** depende de las fases que se hayan hecho.

### Dentro de cada fase

Pruebas primero (deben fallar) → migraciones y dominio → repositorios → casos de uso → rutas → interfaz → revisión manual → cierre con CI en verde.

### Paralelismo

- Fase 1: T004 y T005; todas las pruebas T006 a T018; las migraciones T020 a T023 (después de T019, por el patrón de columnas exportadas); T028, T029 y T032.
- Fase 2: las pruebas T036 a T043 en paralelo.
- Fase 3: las pruebas T055 a T063 en paralelo; T066 y T068.
- Fase 4: las pruebas T073 a T083 en paralelo.
- Fase 5: las pruebas T095 a T104 en paralelo; T107 y T109.
- Fase 7: T126 a T133 en paralelo.

**Ejemplo (fase 2):** T036, T037, T038, T039, T040, T041, T042 y T043 se escriben a la vez; luego T044 → T045 → T046 → T047 → T048 → T049; en paralelo con T049, T050 y T051 en el frontend.

---

## Trazabilidad requisito → tareas

| Requisito | Historia | Tareas                                                                                  |
| --------- | -------- | --------------------------------------------------------------------------------------- |
| RF13      | US1      | T036–T054; también T085 (recordatorio al reprogramar) y T088 (reprogramar por enlace)   |
| RF30      | US2      | T055–T072 (citas: cliente y personal)                                                   |
| RF30      | US5      | T116–T124 (suscripción: propietario) · **primer recorte**                               |
| RF33      | US4      | T095–T115                                                                               |
| RF34      | US3      | T073–T094                                                                               |
| Principio III (constitución 1.4.0) | —  | T009–T012, T019–T023, T027, T079, T088                                                  |
| Principio VII (ADR-025, ADR-026)   | —  | T013–T017, T026, T030–T031, T057–T061, T098–T101, T105–T107                             |
| PR09 (una prueba por tabla nueva)  | —  | T010, más T011, T012, T079                                                              |
| PR14                               | —  | T018, T034, T041, T102, T108                                                            |
| PR16                               | US1 | T039                                                                                   |
| Escaneo de dependencias            | —  | T001, T002                                                                              |
| FR-031 (regla de bloqueo única)    | US3 | T086, T074, T087                                                                       |
| Documentación                      | —  | T126–T134                                                                               |

## Estimación de esfuerzo por fase

Estimación para una persona, en horas de trabajo efectivo. Sigue el S, M y L del plan; no es una medición.

| Fase | Contenido                                  | Plan | Horas estimadas |
| ---- | ------------------------------------------ | ---- | --------------- |
| 1    | Base (incluye la revisión de `npm audit`)  | L    | 10–13           |
| 2    | US1 Reprogramar                            | M    | 6–7             |
| 3    | US2 Avisos de la cita                      | L    | 10–12           |
| 4    | US3 Recordatorio y enlaces                 | L    | 10–12           |
| 5    | US4 Canal, consentimiento y WhatsApp simulado | M (incluye el simulador) | 7–9 |
| 6    | US5 Avisos de suscripción (primer recorte) | S    | 3–4             |
| 7    | Cierre                                     | M    | 5–6             |
|      | **Total**                                  |      | **52–63**       |

## Qué es indispensable si vas atrasado

- **Indispensables para entregar 004 con valor real:** fases **1, 2 y 3**. Dan RF13 (reprogramar sin perder la cita) y RF30 (avisos al cliente y al personal por correo), con todo lo que no se recorta nunca: salida transaccional, aislamiento y PR16. Son unas 26–32 horas.
- **Indispensables para cubrir los cuatro RF** (el backlog dice que ningún RF sale de la entrega): **además, fases 4 y 5** (RF34 y RF33). Son unas 17–21 horas más.
- **Se recorta primero:** la **fase 6** completa. Después, en este orden (plan, "Si solo quedan 4 días"): T071 (`demo:avisos`); los modos del simulador de T101 reducidos a `normal`, `caido` y `fallar_n`; la variante por Nginx de PR16 (T039 queda dentro del proceso); y el acabado visual.
- **La fase 7 se puede reducir, no omitir:** como mínimo, T128 (trazabilidad), T129 (pruebas) y T130 (estados), para no presentar como construido lo que no lo está.
