# Tasks: Acceso verificado

**Input**: documentos de diseño de `specs/010-acceso-verificado/` (plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md, borradores/)

**Prerequisites**: plan.md y spec.md (obligatorios); research.md, data-model.md, contracts/ y quickstart.md.

**Tests**: OBLIGATORIAS (principio X). Cada historia empieza por sus pruebas, que deben fallar por la razón correcta antes
de implementar. Incluyen aislamiento (PR09), reglas de dependencias (PR14), autenticación y límites (PR07, PR12),
auditoría (PR13) y permisos exactos de las funciones de sistema. Todas con el proveedor de IA **falso**; los correos se
leen del buzón de pruebas (Mailpit o el canal de pruebas de 004).

**Organization**: por historia. **Orden de las fases** (plan, "Fases"): las historias que no dependen de la enmienda
(US3 y US4) van primero; la base común de US1 y US2 espera la aprobación de la fase 0.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: historia a la que pertenece (US1 a US4).
- **Del responsable**: tareas que solo hace el responsable humano (aprobaciones, `.env`, commits, cronómetro). El agente
  no las marca.

## Path Conventions

Todas las rutas de código son relativas a `tecnologia/plataforma-barberias/` (principio XII): `backend/`, `frontend/` y
`semilla/`. Las de documentación son relativas a la raíz del repositorio.

---

## Phase 0: Gobernanza (bloquea las fases 3, 4 y 5)

**Purpose**: revisar y, si se aprueban, aplicar la enmienda 1.8.0, el ADR-036 y la revisión de ADR-015 (plan, "Constitution
Check"). Las fases 1 y 2 pueden avanzar en paralelo.

- [ ] T001 **Del responsable:** revisar `specs/010-acceso-verificado/borradores/enmienda-iii-1.8.0-y-adr-036.md` (quinta
  excepción del principio III, tabla `account_link_attempt`, ajuste del principio VII, ADR-036 y revisión de ADR-015) y
  aprobarlo o pedir cambios. Si no se aprueba, se entregan solo las fases 1, 2 y 6 (plan, "Si la enmienda no se aprueba").
- [X] T002 Con la aprobación explícita de T001: aplicar la enmienda 1.8.0 en `.specify/memory/constitution.md` (principio
  III con la quinta excepción y la tabla técnica, su Razón, el ajuste del principio VII y el Sync Impact Report con la
  versión 1.7.2 → 1.8.0 y la fecha de aprobación)
- [X] T003 [P] Con la aprobación de T001: actualizar las puertas III ("Only five exceptions", con el resumen en inglés del
  borrador) y VII (avisos de la cuenta) y la versión en `.specify/templates/plan-template.md`
- [X] T004 [P] Con la aprobación de T001: agregar ADR-036 (tras confirmar que el número está libre: ADR-034 y ADR-035 son de
  009) y la nota de revisión de ADR-015 en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`
- [X] T005 Marcar el borrador como aprobado y aplicado, con la fecha, en
  `specs/010-acceso-verificado/borradores/enmienda-iii-1.8.0-y-adr-036.md`, y actualizar las referencias a la versión de la
  constitución en `docs/05-gestion/03-sdd-spec-kit.md`
- [ ] T006 **Del responsable:** commit y push de la fase 0: `docs(010): enmienda 1.8.0 del principio III, ADR-036 y
  revisión de ADR-015`

**Checkpoint**: gobernanza aprobada y aplicada; las fases 3 a 5 pueden empezar.

---

## Phase 1: User Story 3 - Las personas pueden leer lo que aceptan (Priority: P1)

**Goal**: los "Términos y condiciones" y la "Política de privacidad y datos personales" publicados, versionados y
enlazados desde los 6 lugares; la versión aceptada queda registrada (FR-024 a FR-027).

**Independent Test**: abrir los dos textos desde la portada, el pie, los dos registros, la unión y los ingresos; registrar
una cuenta y comprobar que el consentimiento guarda la versión publicada (quickstart §2.3).

### Tests for User Story 3 (MANDATORY - constitution Principle X) ⚠️

- [X] T007 [P] [US3] Prueba de las páginas `/terminos` y `/privacidad` sin sesión (título `h1`, versión, fecha de
  vigencia, marca "Borrador pendiente de revisión", índice de secciones, en la privacidad el enlace a "Mis datos" y las
  cookies técnicas) en `frontend/test/pages/documentos-legales.spec.tsx`
- [X] T008 [P] [US3] Prueba de los enlaces a los textos desde `Portada` (pie), `MarcoAcceso` (pie), `Registro`,
  `RegistroCliente` y el formulario de unión (`Union.tsx`): enlaces reales con `target="_blank"`, `rel="noopener"` y el
  aviso "(se abre en otra pestaña)"; ningún "(en preparación)"; lo escrito en el formulario se conserva, en
  `frontend/test/pages/enlaces-legales.spec.tsx`
- [X] T009 [P] [US3] Prueba de integración: el registro de un cliente, el de una barbería y la unión a otra barbería con
  una versión distinta de la vigente se rechazan sin guardar nada, y con la vigente `consent_record` guarda esa versión
  exacta, en `backend/test/integration/clientes/version-legal.spec.ts`

### Implementation for User Story 3

- [X] T010 [P] [US3] Borrador base de los "Términos y condiciones" (objeto con `version`, `vigenteDesde`, `borrador: true`
  y secciones: el servicio, cuentas y roles, prueba gratuita y planes, uso aceptable, responsabilidad de la barbería
  sobre sus datos, adelanto pagado directo a la barbería, suspensión, cambios, contacto) en `frontend/src/legal/terminos.ts`
- [X] T011 [P] [US3] Borrador base de la "Política de privacidad y datos personales" según la Ley N.° 29733 y su
  reglamento (responsable del tratamiento y de cada barbería, finalidades, datos tratados, plazos de conservación,
  destinatarios y encargados, derechos ARCO y cómo ejercerlos con las solicitudes de 007, consentimiento de WhatsApp,
  cookies técnicas `rt`, `rtp` y `hay_sesion`, almacenamiento local `tema` y `barberias.ultimaBarberia`) en
  `frontend/src/legal/privacidad.ts`
- [X] T012 [US3] Página `DocumentoLegal` (encabezado, versión, fecha, marca de borrador, índice con anclas, texto legible a
  360 px, tokens del sistema de diseño) en `frontend/src/pages/publico/DocumentoLegal.tsx` y
  `frontend/src/pages/publico/DocumentoLegal.module.css`, y las rutas públicas `/terminos` y `/privacidad` (carga diferida)
  en `frontend/src/routes.tsx`
- [X] T013 [US3] Versión nueva de los textos (`2026-11`, research R10) en `frontend/src/legal.ts` (valores
  por defecto que salen de los archivos de T010 y T011), `.env.example` y los valores por defecto de la semilla en
  `docker-compose.yml` y `semilla/cargar-semilla.mjs`; sin tocar el `.env` del responsable. `backend/test/helpers/entorno.ts`
  se queda en `2026-10` (precisión de R10: es solo la versión de prueba del backend)
- [X] T014 [P] [US3] Enlaces a los textos en las casillas de aceptación de `frontend/src/pages/Registro.tsx` y
  `frontend/src/pages/publico/Union.tsx` (`CasillaPolitica`, que también usa `RegistroCliente`)
- [X] T015 [P] [US3] Enlaces reales "Términos y condiciones" y "Política de privacidad" en el pie de
  `frontend/src/pages/Portada.tsx` y en el pie de `frontend/src/components/MarcoAcceso.tsx` (ingreso, registro y
  activación)
- [ ] T016 [US3] **Del responsable:** cambiar `TERMS_VERSION` y `PRIVACY_POLICY_VERSION` a la versión de T013 en su `.env`
  local y recrear las réplicas (el agente no lee ni cambia ese archivo)
- [X] T017 [US3] Verificación de la fase 1: lint, typecheck, Prettier, pruebas del frontend y `version-legal.spec.ts`;
  capturas y axe de `/terminos` y `/privacidad` en claro y oscuro, a 1440 y 360 px, con el build de producción, sin
  incumplimientos ni desbordes
- [ ] T018 [US3] **Del responsable:** commit y push de la fase 1: `feat(010): textos legales publicados y versionados
  (fase 1, US3)`

**Checkpoint**: US3 completa e independiente (brecha bloqueante 3 cerrada).

---

## Phase 2: User Story 4 - El cliente sin sesión siempre sabe cómo volver (Priority: P2)

**Goal**: ninguna pantalla del cliente ni ningún enlace de un correo al cliente lleva al ingreso del personal (FR-028 a
FR-031, sin el enlace de verificación, que llega con US1).

**Independent Test**: sin sesión, abrir cada pantalla del cliente y el enlace del correo del adelanto; nunca aparece
`/ingresar`; tras ingresar, se llega a la pantalla pedida (quickstart §2.4).

### Tests for User Story 4 (MANDATORY - constitution Principle X) ⚠️

- [X] T019 [P] [US4] Ampliar la prueba de pantallas sin sesión a `/asistente`, `/mis-avisos`, `/mis-datos` y
  `/mis-citas/:citaId/adelanto` (título de cada una, "Ingresar" hacia la última barbería con `desde` = la ruta pedida, la
  explicación sin barbería recordada, nunca `/ingresar`) en `frontend/test/pages/cliente-sin-sesion.spec.tsx`
- [X] T020 [P] [US4] Prueba: en `/e`, con el enlace no válido, "Iniciar sesión" lleva a `/mis-citas`, en
  `frontend/test/pages/enlace.spec.tsx`
- [X] T021 [P] [US4] Prueba de integración que fija que el aviso `ADELANTO_SOLICITADO` al cliente incluye
  `URL_PUBLICA/mis-citas/<citaId>/adelanto` (FR-030), en `backend/test/integration/adelantos/avisos-adelanto.spec.ts`
- [X] T022 [P] [US4] Prueba: tras ingresar desde la pantalla sin sesión de `/mis-citas/:citaId/adelanto` (con y sin unión a
  la barbería), el cliente llega a esa misma dirección, en `frontend/test/pages/cliente-reserva.spec.tsx`

### Implementation for User Story 4

- [X] T023 [US4] `ClienteSinSesion` con el motivo según la pantalla (por ejemplo "Para ver tus avisos…", "Para pagar el
  adelanto de tu cita…") sin cambiar el texto de `/mis-citas`, en `frontend/src/pages/cliente/ClienteSinSesion.tsx`
- [X] T024 [US4] Opción `sinSesion` en las rutas `/asistente`, `/mis-avisos`, `/mis-datos` y `/mis-citas/:citaId/adelanto`
  en `frontend/src/routes.tsx`
- [X] T025 [P] [US4] "Iniciar sesión" del enlace no válido → `/mis-citas`, en `frontend/src/pages/publico/Enlace.tsx`
- [X] T026 [US4] Verificación de la fase 2: lint, typecheck, Prettier y todas las pruebas del frontend; `avisos-adelanto.spec.ts`;
  capturas y axe de las cuatro pantallas sin sesión a 360 px y en escritorio
- [ ] T027 [US4] **Del responsable:** commit y push de la fase 2: `feat(010): pantallas del cliente sin sesión (fase 2,
  US4)`

**Checkpoint**: US4 completa (brecha importante 7 cerrada para todas las pantallas del cliente).

---

## Phase 3: Foundational - Base común de los enlaces de cuenta (bloquea US1 y US2)

**Purpose**: migración, reglas del enlace, límites, interfaz pública de M01, avisos de M05 y permisos exactos (research R01
a R04 y R08; data-model §1 a §7; contracts/eventos-y-avisos.md).

**⚠️ CRITICAL**: no empieza sin la fase 0 aprobada y aplicada (T002 a T005).

### Tests for the foundation (MANDATORY) ⚠️

- [X] T028 [P] Pruebas unitarias del enlace de cuenta: vigencia de 24 h y de 1 h, un solo uso, anulación al emitir otro
  del mismo propósito, vencimiento calculado al leer, el mismo error para usado, vencido, anulado o inexistente, en
  `backend/test/unit/identidad/enlace-de-cuenta.spec.ts`
- [X] T029 [P] Pruebas unitarias de los límites (reenvío 3/h por cuenta y 20/h por origen; recuperación 3/h y 10/h; usos
  fallidos 20/h por origen; `reintentarEnSegundos`), en `backend/test/unit/identidad/limite-enlaces.spec.ts`
- [X] T030 [P] Permisos exactos: las 4 funciones nuevas son de `barberias_auth`, solo `barberias_app` las ejecuta y
  `barberias_publico` y `barberias_plataforma` no; ningún rol nuevo con `BYPASSRLS`, en
  `backend/test/integration/aislamiento/funciones-definer.spec.ts`
- [X] T031 [P] Permisos y RLS de las tablas nuevas: `account_link` con RLS forzada y los permisos por columna de
  data-model §2; `account_link_attempt` sin `tenant_id` y solo para `barberias_app`; columnas nuevas de `user_account` solo
  con `SELECT` para la aplicación; las políticas RLS existentes no cambian (comparación con `pg_policies`), en
  `backend/test/integration/aislamiento/permisos-010.spec.ts`
- [X] T032 [P] Migración: toda cuenta existente queda verificada con `MIGRACION`, las nuevas nacen sin verificar y se
  cumplen los `CHECK`, en `backend/test/integration/identidad/migracion-verificacion.spec.ts`
- [X] T033 [P] Plantillas de los avisos `VERIFICAR_CORREO`, `RECUPERAR_CONTRASENA` y `CONTRASENA_CAMBIADA` (sin el correo de
  la persona, sin la contraseña, con la vigencia del enlace), en `backend/test/unit/notificaciones/plantillas.spec.ts`
- [X] T034 [P] Envío de los avisos de la cuenta: el evento crea un aviso para `CUENTA` siempre por correo; al enviar se
  emite el token y se guarda solo su hash; el correo del buzón trae el enlace cuyo hash coincide; un reintento reemite;
  un enlace no vigente descarta el aviso; con un canario, ningún token aparece en `outbox_event.payload`, en
  `notification` ni en los registros; **con el canal de correo caído** (G2), el registro y la solicitud responden bien, el
  aviso queda pendiente y sale al volver el canal; y el correo llega al buzón de pruebas dentro de 60 s (aserción con plazo,
  apoyo de SC-004), en `backend/test/integration/notificaciones/avisos-cuenta.spec.ts`
  *(Fase 3: el enlace se pide con `SolicitarEnlaceDeCuenta`, la base común; el registro que lo pide llega con T057, y su
  prueba con el correo caído se suma ahí.)*
- [X] T035 [P] Reglas de dependencias: solo el host (y M05) consumen `CuentasApi`; M03 y M04 siguen sin llamar a M01, en
  `backend/test/architecture/reglas.spec.ts` (con su regla en `backend/.dependency-cruiser.cjs`)
- [X] T036 [P] Retención: la tarea programada borra los enlaces usados, anulados o vencidos hace más de 30 días, sin
  duplicados entre réplicas, en `backend/test/integration/identidad/retencion-enlaces.spec.ts`

### Implementation for the foundation

- [X] T037 Migración con columnas de `user_account`, `account_link`, `account_link_attempt`, las 4 funciones de
  `barberias_auth` con sus permisos por columna, los tipos y el destinatario nuevos de `notification` (data-model §1 a §5),
  con su `down`, en `backend/migrations/0036_acceso_verificado.ts`
  *(Fase 3: el índice de "un solo enlace vigente" es por barbería; la aplicación también puede borrar en `account_link`
  (retención); y el `INSERT` de la aplicación en `user_account` pasa a ser por columna, para que no pueda crear cuentas ya
  verificadas. Ver data-model.md.)*
- [X] T038 Tipos de las tablas y columnas nuevas en `backend/src/shared/persistence/db-types.ts`
- [X] T039 [P] Reglas puras del enlace y de los límites en
  `backend/src/modules/acceso-barberias/identidad/domain/enlace-de-cuenta.ts` y `limite-enlaces.ts`, con los errores
  `EnlaceNoValido` (410 `ENLACE_NO_VALIDO`) y `CorreoNoVerificado` (403 `CORREO_NO_VERIFICADO`) en `identidad/domain/errores.ts`
  y su mapeo en `backend/src/host/error.filter.ts`
- [X] T040 Puertos y repositorios Kysely del enlace (crear sin token, emitir token, anular, llamar a las funciones de
  sistema) y del contador de intentos (origen con `INTENTOS_SAL_IP`), en
  `backend/src/modules/acceso-barberias/identidad/application/ports/` y
  `identidad/infrastructure/kysely-enlace-de-cuenta-repository.ts` y `kysely-intentos-enlace-repository.ts`
- [X] T041 `CuentasApi` (`correoVerificado`, `correoDeCuenta`, `emitirToken`) en
  `backend/src/modules/acceso-barberias/api-publica.ts`, `index.ts` e `identidad/application/cuentas-api.ts`
  *(Fase 3: sale por `acceso-barberias/cuentas.ts`, no por `index.ts`, para que la regla `cuentas-api-confinada` se pueda
  comprobar; ver contracts/eventos-y-avisos.md §3.)*
- [X] T042 Eventos `EnlaceDeCuentaSolicitado` y `ContrasenaCambiada` (payload sin secretos y clave de reemplazo de
  data-model §6) en el módulo M01, publicados por `BusDeEventos`
- [X] T043 M05: tipos de aviso y destinatario `CUENTA` en `backend/src/modules/notificaciones/domain/aviso.ts` y
  `destinatarios.ts`, plantillas en `domain/plantillas.ts`, manejador nuevo
  `backend/src/modules/notificaciones/application/manejadores-de-cuenta.ts`, emisión del token al enviar y descarte en
  `application/enviar-avisos.ts`, y su registro en `notificaciones.module.ts` y en la suscripción del host
  (`backend/src/host/app.module.ts`)
  *(Fase 3: la suscripción del host está en `backend/src/host/eventos.ts`, no en `app.module.ts`.)*
- [X] T044 [P] Acciones de auditoría nuevas (data-model §7) en `backend/src/shared/audit/audit-log.ts`
- [X] T045 Tarea de retención de enlaces en `backend/src/modules/acceso-barberias/identidad/application/purgar-enlaces-de-cuenta.ts`,
  registrada en el ejecutor de tareas del host (ADR-024)
- [X] T046 Verificación de la fase 3: `npm test`, `npm run test:int`, `npm run test:arch`, lint y Prettier del backend, todo en
  verde
  *(2026-11-23: en la suite completa fallaron 3 pruebas de tiempo (degradacion-asistente, canal-whatsapp, proveedor-caido)
  que pasan solas; y rls.spec necesitaba sembrar un `account_link`, ya corregido.)*
- [ ] T047 **Del responsable:** commit y push de la fase 3: `feat(010): base de los enlaces de cuenta por correo (fase 3)`

**Checkpoint**: la base está lista; US1 y US2 pueden avanzar en paralelo.

---

## Phase 4: User Story 1 - El cliente verifica su correo antes de reservar (Priority: P1) 🎯 MVP

**Goal**: sin verificar, el cliente no puede reservar, usar el asistente ni pagar el adelanto; recibe y usa su enlace de
24 h; las cuentas existentes no cambian (FR-008 a FR-017, FR-031, FR-034).

**Independent Test**: registrar un cliente, intentar reservar (aviso), verificar desde el correo del buzón en otro
navegador, reservar; una cuenta anterior reserva sin pasos nuevos (quickstart §2.1).

### Tests for User Story 1 (MANDATORY - constitution Principle X) ⚠️

- [ ] T048 [P] [US1] Contrato de `POST /cuenta/verificacion`, `POST /cuenta/verificacion/reenvio` y de `correoVerificado`
  en `SesionResponse` (contracts/openapi.yaml), en `backend/test/contract/cuenta.contract.spec.ts`
- [ ] T049 [P] [US1] Integración de la verificación: el registro deja la cuenta sin verificar y envía el correo; el enlace
  verifica sin sesión y devuelve la barbería de origen; usado, vencido (reloj controlado) o reemplazado → el mismo 410; la
  verificación vale para todas las barberías del cliente; un token desconocido o mal formado da el mismo 410 y se registra
  **solo** como `USO_FALLIDO` en `account_link_attempt`, sin auditoría (R15); el uso fallido n.º 21 desde un mismo origen
  en una hora → 429 (G3), en `backend/test/integration/cuenta/verificacion-correo.spec.ts`
- [ ] T050 [P] [US1] Integración del guard: un cliente sin verificar recibe 403 `CORREO_NO_VERIFICADO` en `POST /citas`,
  `POST /asistente/mensajes` y `POST /citas/{id}/adelanto/pago`; verificado, pasa; el propietario (cita presencial y
  asistente) no se ve afectado; el estado se lee con el tenant del token (PR09), en
  `backend/test/integration/cuenta/correo-verificado-guard.spec.ts`
- [ ] T051 [P] [US1] Integración del reenvío: respuesta idéntica con la cuenta verificada o no; una cuenta verificada no
  recibe correo; el anterior queda anulado; el 4.º en una hora por cuenta → 429 sin correo; el 21.º en una hora desde un
  mismo origen (con cuentas distintas) → 429 (G4); el origen se guarda solo como hash, en
  `backend/test/integration/cuenta/reenvio-verificacion.spec.ts`
- [ ] T052 [P] [US1] La activación del personal marca la cuenta como verificada (`ACTIVACION`), en
  `backend/test/integration/identidad/usuarios.spec.ts`
- [ ] T053 [P] [US1] Auditoría de la verificación en la barbería del enlace: solicitud con cuenta, verificación aceptada y
  rechazo **solo de un enlace que pertenece a una cuenta** (usado, vencido o anulado); un token desconocido **no** crea
  registro de auditoría (R15, FR-007); nunca el token, en `backend/test/integration/auditoria.spec.ts`
- [ ] T054 [P] [US1] Pantalla `/verificar#token`: lee el fragmento y lo borra de la barra, no envía nada hasta pulsar
  "Verificar mi correo", éxito → `/b/<slug>`, 410 → mensaje neutro, en `frontend/test/pages/verificar.spec.tsx`
- [ ] T055 [P] [US1] Aviso de verificación en `/b/<slug>/reservar`, `/asistente` y `/mis-citas/:id/adelanto` (con
  `correoVerificado: false` y ante el 403): correo con parte oculta, "Reenviar correo de verificación", confirmación y 429;
  la hora elegida no se pierde, en `frontend/test/pages/aviso-verificacion.spec.tsx`

### Implementation for User Story 1

- [ ] T056 [US1] Casos de uso `SolicitarVerificacion` (registro y reenvío, con límites y anulación) y `VerificarCorreo`
  (función de sistema, auditoría) en `backend/src/modules/acceso-barberias/identidad/application/solicitar-verificacion.ts`
  y `verificar-correo.ts`
- [ ] T057 [US1] El registro de cliente crea el enlace y publica `EnlaceDeCuentaSolicitado` en la misma transacción, en
  `backend/src/modules/acceso-barberias/clientes/application/registrar-cliente.ts`; la activación del personal marca
  `ACTIVACION` en `identidad/application/activar-cuenta.ts`
- [ ] T058 [US1] Rutas `POST /cuenta/verificacion` (pública) y `POST /cuenta/verificacion/reenvio` (con sesión), con DTO y
  tiempo mínimo de respuesta (research R07), en `backend/src/modules/acceso-barberias/identidad/presentation/cuenta.controller.ts`;
  la variable `CUENTA_RESPUESTA_MINIMA_MS` (entero, por defecto 400, rango de 100 a 2000) en
  `backend/src/shared/config/configuracion.ts` con su prueba en `backend/test/unit/shared/configuracion.spec.ts`, documentada en
  `.env.example` y fijada en `backend/test/helpers/entorno.ts` (U1)
- [ ] T059 [US1] `correoVerificado` en el usuario de la sesión (login, renovación, cambio de barbería, registro y
  `/auth/yo`) en `identidad/application/sesion-iniciada.ts`, el repositorio de usuarios y el DTO de respuesta
- [ ] T060 [US1] Decorador `@RequiereCorreoVerificado()` (metadato en `backend/src/shared/`), guard
  `backend/src/host/correo-verificado.guard.ts` registrado en `backend/src/host/app.module.ts`, y el decorador en las rutas
  de `catalogo-citas/citas/presentation/citas.controller.ts` (`POST /citas`),
  `asistente-reportes/asistente/presentation/asistente.controller.ts` y
  `suscripciones-pagos/adelantos/presentation/adelanto-cita.controller.ts` (`POST pago`)
- [ ] T061 [US1] Contratos: agregar `specs/010-acceso-verificado/contracts/openapi.yaml` (solo las rutas `/cuenta/*`; los
  cambios en rutas existentes van en `x-cambios-en-rutas-existentes` y no se generan, I2) al script `gen:api` de
  `frontend/package.json` (salida `src/api/schema-010.d.ts`); agregar el 403 `CORREO_NO_VERIFICADO` en los contratos de
  `specs/002-catalogo-citas-cliente/contracts/openapi.yaml` (`POST /citas`), `specs/005-asistente-ia-reportes/contracts/openapi.yaml`
  (`POST /asistente/mensajes`) y `specs/008-adelanto-reserva-qr/contracts/openapi.yaml` (`POST /citas/{id}/adelanto/pago`), y
  `correoVerificado` en `SesionResponse` de los contratos de 001 y 002; regenerar los tipos; el código
  `CORREO_NO_VERIFICADO` en `frontend/src/api/client.ts` y `correoVerificado` en `frontend/src/auth/SesionProvider.tsx`
- [ ] T062 [P] [US1] Pantalla `Verificar` en `frontend/src/pages/publico/Verificar.tsx` (con su CSS de tokens) y la ruta
  `/verificar` en `frontend/src/routes.tsx`
- [ ] T063 [US1] Componente `AvisoVerificacion` en `frontend/src/components/app/AvisoVerificacion.tsx`, integrado en
  `frontend/src/pages/publico/Reservar.tsx`, `pages/cliente/Asistente.tsx` y `pages/cliente/PagarAdelanto.tsx`
- [ ] T064 [US1] Pruebas existentes (research R13, lista de los 13 archivos que llaman a `POST /clientes/registro`):
  (1) los ayudantes que crean cuentas por SQL, `sesionCliente` y `sembrarCliente`, las crean **verificadas** (`MIGRACION`),
  con una opción para crearlas sin verificar, en `backend/test/helpers/fixtures.ts` (líneas 86 y 373) y
  `backend/test/helpers/sesiones.ts`. Es lo que usan las pruebas que reservan, preguntan al asistente o pagan el
  adelanto: `rbac-002`, `auditoria`, `entradas` y las de citas, asistente y adelantos;
  (2) un ayudante que verifica por el buzón de pruebas, para las que registran por la API y necesitan la cuenta
  verificada, en `backend/test/helpers/`;
  (3) `backend/test/integration/clientes/cuenta-cliente.spec.ts` comprueba que la cuenta nueva nace sin verificar;
  (4) `backend/test/contract/clientes.contract.spec.ts` agrega `correoVerificado` a la forma de la respuesta.
  `limite-compartido.spec.ts` no necesita cambios. Al terminar, `npm run test:int` en verde sin excepciones
- [ ] T065 [P] [US1] Sesiones simuladas del frontend con `correoVerificado: true` (salvo las pruebas del aviso) en
  `frontend/test/` (manejadores de MSW y pruebas que arman `SesionResponse`)
- [ ] T066 [US1] Semilla: verificar a cada cliente leyendo el enlace en Mailpit con `semilla/lib/buzon.mjs` y
  `POST /cuenta/verificacion` antes de reservar, en `semilla/cargar-semilla.mjs`, con sus pruebas en
  `semilla/test/semilla.test.mjs` y `semilla/test/lib.test.mjs`
- [ ] T067 [US1] Verificación de la fase 4: todas las suites del backend (`test`, `test:int`, `test:arch`) y del frontend,
  lint, typecheck y Prettier en verde, incluidas **sin cambios** las pruebas existentes de la unión a otra barbería (409
  `UNIRSE_REQUIERE_CONSENTIMIENTO`: `backend/test/integration/aislamiento/cliente-dos-barberias.spec.ts` y
  `frontend/test/pages/cliente-reserva.spec.tsx`) como regresión de FR-033 (G5); la semilla dos veces contra la API real en
  la copia aparte `barberias-verificacion` (como T025 de 009: crea, luego 0 creadas); capturas y axe de `/verificar` y del
  aviso
- [ ] T068 [US1] **Del responsable:** commit y push de la fase 4: `feat(010): verificación del correo del cliente (fase 4,
  US1)`

**Checkpoint**: US1 completa (brecha bloqueante 1 cerrada). MVP de 010 junto con US3.

---

## Phase 5: User Story 2 - Cualquier persona recupera su contraseña (Priority: P1)

**Goal**: recuperación neutra con enlace de 1 h, cambio de contraseña, cierre de todas las sesiones y aviso del cambio
(FR-018 a FR-023).

**Independent Test**: con una cuenta de cada rol, pedir la recuperación, cambiar la contraseña desde el correo del buzón y
comprobar que las sesiones abiertas se cierran (quickstart §2.2).

### Tests for User Story 2 (MANDATORY - constitution Principle X) ⚠️

- [ ] T069 [P] [US2] Contrato de `POST /cuenta/recuperacion` y `POST /cuenta/recuperacion/contrasena` en
  `backend/test/contract/cuenta.contract.spec.ts`
- [ ] T070 [P] [US2] Integración de la recuperación: correo con y sin cuenta → la misma respuesta; personal pendiente → sin
  enlace; el enlace vence a la hora, sirve una vez y reemplaza al anterior; la contraseña nueva cumple las reglas (incluida
  la del propio correo); al cambiarla se cierran las sesiones en dos barberías (renovación y acceso fallan al siguiente uso),
  la cuenta queda verificada y llega `CONTRASENA_CAMBIADA`; la barbería del aviso sigue research R03 (slug con y sin
  membresía, personal, solo cliente), en `backend/test/integration/cuenta/recuperacion.spec.ts`
- [ ] T071 [P] [US2] Límites de la recuperación (3/h por cuenta, 10/h por origen, usos fallidos por origen) y aislamiento
  (un enlace emitido con la barbería A no da acceso a datos de B; PR09), en
  `backend/test/integration/cuenta/recuperacion-limites.spec.ts`
- [ ] T072 [P] [US2] Respuestas neutras (SC-005, research R07), en dos partes:
  (a) **funcional, bloqueante**: con y sin cuenta, en recuperación, reenvío y verificación, el mismo estado y el mismo cuerpo,
  y ninguna respuesta por debajo de `CUENTA_RESPUESTA_MINIMA_MS`, en `backend/test/integration/cuenta/respuestas-neutras.spec.ts`
  (la recoge `npm run test:int`);
  (b) **medición de tiempos, no bloqueante en la CI**: 100 solicitudes por serie; diferencia de medianas menor de 30 ms y
  percentil 90 de ambas series dentro del piso más 50 ms, en `backend/test/integration/cuenta/respuestas-neutras.medicion.spec.ts`.
  `test:int` **no** la recoge: lleva su propio script `test:medicion` en `backend/package.json` y su configuración de Jest.
  Corre como paso propio con `continue-on-error: true` en `.github/workflows/plataforma-barberias.yml` y se exige con el
  umbral estricto en la verificación local (quickstart §1.1)
- [ ] T073 [P] [US2] Auditoría de la recuperación en la barbería del enlace: solicitud con cuenta, restablecimiento y
  rechazo **solo de un enlace que pertenece a una cuenta**; una solicitud con correo sin cuenta y un token desconocido
  **no** crean registro de auditoría (el segundo queda como `USO_FALLIDO`, R15); nunca el token ni la contraseña, en
  `backend/test/integration/auditoria.spec.ts`
- [ ] T074 [P] [US2] Pantallas `/recuperar` (mensaje neutro, 429, envía `barberia` si viene del ingreso de una barbería) y
  `/restablecer#token` (fragmento borrado, reglas e indicador de fortaleza, éxito → ingreso con aviso, 410 → enlace a
  `/recuperar`), en `frontend/test/pages/recuperar.spec.tsx` y `frontend/test/pages/restablecer.spec.tsx`
- [ ] T075 [P] [US2] Enlace "¿Olvidaste tu contraseña?" en `/ingresar` y en `/b/<slug>/ingresar` (con `state.barberia`), en
  `frontend/test/auth/sesion.spec.tsx` y `frontend/test/pages/cliente-reserva.spec.tsx`

### Implementation for User Story 2

- [ ] T076 [US2] Caso de uso `PedirRecuperacion` (resolver la cuenta con la función existente, elegir la barbería con
  `auth_barberia_para_enlace`, límites, crear el enlace y publicar el evento solo si la cuenta puede recuperarse, tiempo
  mínimo) en `backend/src/modules/acceso-barberias/identidad/application/pedir-recuperacion.ts`
- [ ] T077 [US2] Caso de uso `RestablecerContrasena` (reglas de `Contrasena`, hash con argon2 fuera de la transacción,
  `auth_restablecer_contrasena`, evento `ContrasenaCambiada`, auditoría) en
  `backend/src/modules/acceso-barberias/identidad/application/restablecer-contrasena.ts`
- [ ] T078 [US2] Rutas públicas `POST /cuenta/recuperacion` y `POST /cuenta/recuperacion/contrasena` en
  `backend/src/modules/acceso-barberias/identidad/presentation/cuenta.controller.ts`
- [ ] T079 [P] [US2] Pantallas `Recuperar` y `Restablecer` en `frontend/src/pages/publico/Recuperar.tsx` y
  `frontend/src/pages/publico/Restablecer.tsx` (dentro de `MarcoAcceso`, con iconos en los campos), y las rutas
  `/recuperar` y `/restablecer` en `frontend/src/routes.tsx`
- [ ] T080 [P] [US2] Enlace "¿Olvidaste tu contraseña?" en `frontend/src/pages/Ingresar.tsx` y
  `frontend/src/pages/publico/IngresarBarberia.tsx`
- [ ] T081 [US2] Verificación de la fase 5: todas las suites del backend y del frontend, lint, typecheck y Prettier; capturas y
  axe de `/recuperar` y `/restablecer` en claro y oscuro, a 1440 y 360 px
- [ ] T082 [US2] **Del responsable:** commit y push de la fase 5: `feat(010): recuperación de contraseña (fase 5, US2)`

**Checkpoint**: US2 completa (brecha bloqueante 2 cerrada). Las cuatro historias funcionan por separado.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: validación de extremo a extremo y documentación (plan, "Documentos de `docs/` que se actualizan al cerrar").

- [ ] T083 Recorrer `specs/010-acceso-verificado/quickstart.md` §2 en la copia aparte `barberias-verificacion` (guardián
  confirmado, nunca contra el volumen ni la demo del responsable) y anotar cada resultado en el quickstart, incluida la
  medición de SC-004 (20 envíos, latencia hasta el buzón, quickstart §2.5, G1) y la de SC-005 con el umbral estricto
  (`npm run test:medicion`, quickstart §1.1); bajar la copia con `down -v` solo tras la confirmación del guardián
- [ ] T084 **Del responsable:** cronometrar SC-003 (verificación en menos de 2 min y recuperación en menos de 3 min con el
  buzón abierto) y anotarlo en el quickstart
- [ ] T085 [P] Requisitos y actores: RF04 y RF05 ampliados y los RF nuevos (verificación, recuperación, textos legales) con su
  estado, en `docs/01-analisis-de-sistema/03-requisitos-funcionales.md`; HU nuevas o ampliadas en
  `docs/01-analisis-de-sistema/02-historias-del-usuario.md`; capacidades de ACT-02 a ACT-04 en
  `docs/01-analisis-de-sistema/01-actores.md`
- [ ] T086 [P] Arquitectura: excepciones, matriz rol × operación y declaración de cookies en
  `docs/02-arquitectura-software/seguridad-y-privacidad.md`; casos especiales en
  `docs/02-arquitectura-software/multi-tenancy-y-datos.md`; rutas nuevas en `docs/02-arquitectura-software/api-rest.md`
- [ ] T087 [P] Pruebas y trazabilidad: sección de 010 en `docs/05-gestion/04-pruebas.md` y fila de 010 en
  `docs/trazabilidad.md`
- [ ] T088 [P] Marcar las brechas 1 a 3 y 7 como resueltas en 010 (o parciales si se cortó alguna fase) en
  `specs/auditoria-coherencia.md`
- [ ] T089 Verificación final: todas las suites una vez (backend `test`, `test:int`, `test:arch`; frontend), lint, typecheck,
  Prettier y enlaces de los documentos; CI en verde después del push (`.github/workflows/plataforma-barberias.yml`). El paso
  no bloqueante de la medición de SC-005 se revisa en el registro de la corrida y su resultado se anota en el quickstart,
  sin bloquear el cierre
- [ ] T090 **Del responsable:** commit y push del cierre: `docs(010): cierre del acceso verificado (fase 6)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Fase 0 (gobernanza)**: sin dependencias. Bloquea las fases 3, 4 y 5.
- **Fase 1 (US3)** y **fase 2 (US4)**: sin dependencias entre sí ni con la fase 0; pueden empezar ya y en paralelo.
- **Fase 3 (base)**: depende de T002 a T005 (fase 0 aplicada).
- **Fase 4 (US1)** y **fase 5 (US2)**: dependen de la fase 3; son independientes entre sí. Ambas tocan
  `cuenta.controller.ts`, `cuenta.contract.spec.ts`, `auditoria.spec.ts` y `routes.tsx`: si avanzan en paralelo, esas
  tareas se hacen una después de otra.
- **Fase 6 (cierre)**: depende de las fases que se entreguen.

### User Story Dependencies

- **US3 (P1)**: independiente.
- **US4 (P2)**: independiente. El enlace de verificación sin sesión (FR-031) llega con US1.
- **US1 (P1)**: depende de la base (fase 3) y de la gobernanza.
- **US2 (P1)**: depende de la base (fase 3) y de la gobernanza; no depende de US1.

### Within Each User Story

- Pruebas primero, fallando por la razón correcta.
- Dominio → puertos y repositorios → casos de uso → rutas → interfaz.
- Cerrar cada fase con su verificación y el commit del responsable.

### Parallel Opportunities

- Fases 1 y 2 en paralelo con la revisión de la fase 0.
- En la fase 1: T007, T008 y T009; T010 y T011; T014 y T015.
- En la fase 2: T019 a T022.
- En la fase 3: T028 a T036 (pruebas); T039 y T044.
- En la fase 4: T048 a T055 (pruebas); T062 y T065.
- En la fase 5: T069 a T075 (pruebas); T079 y T080.
- En la fase 6: T085 a T088.

---

## Parallel Example: User Story 1

```text
# Pruebas de US1 a la vez (archivos distintos):
T049 backend/test/integration/cuenta/verificacion-correo.spec.ts
T050 backend/test/integration/cuenta/correo-verificado-guard.spec.ts
T051 backend/test/integration/cuenta/reenvio-verificacion.spec.ts
T054 frontend/test/pages/verificar.spec.tsx
T055 frontend/test/pages/aviso-verificacion.spec.tsx

# Interfaz a la vez que el backend, una vez fijado el contrato (T048, T061):
T062 frontend/src/pages/publico/Verificar.tsx
T065 sesiones simuladas con correoVerificado en frontend/test/
```

---

## Implementation Strategy

### MVP (lo mínimo para clientes reales)

1. Fases 1 (US3) y 2 (US4) mientras el responsable revisa la fase 0.
2. Fase 0 aprobada → fase 3 (base) → fase 4 (US1).
3. **Parar y validar**: con US3 y US1 se cierran las brechas bloqueantes 1 y 3; con US4, la 7.

### Incremental Delivery

1. US3 → commit (textos legales publicados).
2. US4 → commit (ninguna pantalla del cliente sin salida).
3. Base → US1 → commit (verificación).
4. US2 → commit (recuperación; cortable en el peor caso, la brecha 2 quedaría abierta y documentada).
5. Cierre → commit.

### Si la enmienda no se aprueba

Se entregan las fases 1, 2 y 6. US1 y US2 no se construyen, y `specs/auditoria-coherencia.md` deja abiertas las brechas 1
y 2 con el motivo.

---

## Notes

- [P] = archivos distintos, sin dependencias pendientes.
- Las tareas "Del responsable" no las marca el agente.
- Nunca leer ni mostrar el `.env` del responsable; nunca levantar nada contra su volumen ni su demo.
- Sin commit, push ni `git stash` por parte del agente.
- Si una prueba falla de forma intermitente, correrla sola antes de tocar nada e informarlo.
