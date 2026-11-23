# Implementation Plan: Acceso verificado

**Branch**: `010-acceso-verificado` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/010-acceso-verificado/spec.md`

## Summary

Cuatro piezas para recibir clientes reales (brechas 1 a 3 y 7 de la auditoría del 2026-11-19):

1. **Verificación del correo del cliente:** enlace de 24 h; sin verificar no puede reservar, usar el asistente ni pagar
   el adelanto.
2. **Recuperación de contraseña para todos los roles:** enlace de 1 h; cierra todas las sesiones.
3. **Textos legales versionados y publicados.**
4. **Pantallas del cliente sin sesión** que llevan al ingreso de su barbería.

**Enfoque técnico** (research R01 a R14):

- **El enlace:** un mecanismo común de enlace de cuenta de un solo uso, guardado solo como hash (`account_link`), cuyo
  token **se genera al enviar** el correo. Así nunca queda en la salida de eventos ni en los avisos.
- **El envío:** M01 publica un evento hacia M05, que envía por `NotificationChannel`.
- **El consumo:** sin sesión, con dos funciones de consumo, de las cuatro funciones de sistema nuevas del rol existente
  `barberias_auth` (ADR-015). Escriben solo
  filas de esa cuenta y no crean ningún rol nuevo con `BYPASSRLS`.
- **La exigencia de verificación:** un guard nuevo del host, en tres rutas y solo para clientes; el `AuthGuard` no cambia.
- **Los textos legales:** páginas estáticas versionadas.
- **Las pantallas sin sesión:** reutilizan las de /mis-citas.

**Gobernanza:** la verificación y la recuperación sin sesión necesitan una **enmienda MINOR 1.8.0 del principio III**:
una quinta excepción acotada con esas dos operaciones exactas. Su borrador, junto con el **ADR-036**, está en
[borradores/enmienda-iii-1.8.0-y-adr-036.md](borradores/enmienda-iii-1.8.0-y-adr-036.md). **No se aplica** a la
constitución hasta que el responsable la revise. Las piezas 3 y 4 no dependen de ella y pueden hacerse antes.

## Technical Context

**Language/Version**: TypeScript 5.9 en Node.js 22+ (backend y frontend).

**Primary Dependencies**:
- Backend: NestJS 11.2, Kysely 0.28 sobre `pg` 8.23, `argon2` 0.45 (contraseñas), `jose` 5.10 (tokens de sesión, sin
  cambios), `nodemailer` 10.2 (adaptador SMTP de M05, sin cambios) y `@nestjs/throttler` 6.7 (límite general, sin
  cambios).
- Frontend: React 19, Vite 6, React Router 7, TanStack Query 5, react-hook-form con zod.
- **Ninguna dependencia nueva.**

**Storage**: PostgreSQL 16 con RLS forzada.
- Una migración nueva, `0036_acceso_verificado`: dos columnas en `user_account`, las tablas `account_link` (por barbería,
  con RLS) y `account_link_attempt` (técnica, sin barbería), cuatro funciones de sistema de `barberias_auth`, y tipos y un
  destinatario nuevos en `notification`.
- Redis no se usa para nada de esto (principio VIII).

**Testing**:
- Jest 29 con Testcontainers 12 (unitarias, integración, contrato y arquitectura); Vitest con MSW en el frontend.
- Mailpit (contenedor de prueba o servicio de Compose) para leer los correos; proveedor de IA **falso**.
- Capturas con Playwright y revisión con axe sobre el build de producción.

**Target Platform**: servidor Linux en contenedores (dos réplicas detrás de Nginx, ADR-030) e interfaz web responsive
(principio IX).

**Project Type**: aplicación web (backend modular monolítico y SPA).

**Performance Goals**:
- El correo llega al buzón de pruebas en menos de 1 min en el 95 % de los casos (SC-004).
- Las respuestas neutras tienen un tiempo mínimo fijo de 400 ms (R07).
- La exigencia de verificación cuesta una lectura por clave primaria en tres rutas.

**Constraints**:
- Sin cambios en las políticas RLS existentes ni en el `AuthGuard`.
- Sin cambios en el 409 `UNIRSE_REQUIERE_CONSENTIMIENTO` ni en el 409 `CORREO_NO_DISPONIBLE`.
- El correo sale solo por M05.
- El token nunca se guarda ni se registra.
- WCAG 2.2 AA y 360 px.
- No leer ni cambiar el `.env` del responsable.

**Scale/Scope**:
- 4 historias y 34 requisitos.
- 4 rutas nuevas de la API y 5 pantallas nuevas.
- Cambios en 3 rutas existentes (con el guard) y 6 pantallas existentes.
- 3 tipos de aviso nuevos.
- 13 archivos de prueba conocidos registran por la API: deben adaptarse los que reservan después (R13).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Gates from `.specify/memory/constitution.md` (v1.7.2).

- [x] **I. Six modules** ✅
  - Todo cabe en M01 (cuenta, enlaces), M05 (avisos), el host (guard) y la interfaz.
  - M05 llama a M01 solo por su `index.ts` (`CuentasApi`), como ya permite `matriz-m05`.
  - M01 publica por `BusDeEventos`.
  - Nadie llama a M05.
- [x] **II. Four layers** ✅
  - Reglas del enlace en `identidad/domain` (puras).
  - Casos de uso en `application` con puertos.
  - SQL y funciones en `infrastructure` y migraciones.
  - Rutas en `presentation`.
- [ ] **III. Tenant isolation** ⚠️ **Requiere la enmienda 1.8.0** (pendiente de revisión).
  - Las tres operaciones sin sesión (pedir un enlace de recuperación, verificar el correo y restablecer la contraseña)
    no caben en las cuatro excepciones vigentes (research R04): la segunda exige la contraseña o una sesión, y la
    cuarta es solo para una cita.
  - **Resto conforme:**
    - `account_link` tiene `tenant_id` y RLS;
    - cada evento y cada aviso llevan la barbería de una membresía de la propia cuenta (R03);
    - las rutas con sesión siguen tomando el tenant solo del token;
    - no se crea ningún rol con `BYPASSRLS`;
    - `account_link_attempt` es una tabla técnica sin datos de negocio, con el origen como hash con sal, y la enmienda la
      nombra.
  - US3 y US4 no tocan nada de esto.
- [x] **IV. No duplicate appointments** ✅ No cambia. El guard actúa antes del caso de uso de la reserva; la restricción y
  PR16 siguen igual.
- [x] **V. Payments** ✅ Sin cambios: el adelanto (008) solo gana la exigencia de verificación en una ruta; la pasarela
  simulada sigue solo para la suscripción.
- [x] **VI. AI** ✅ Sin cambios en el asistente: el guard actúa antes de la ruta, con el proveedor falso en pruebas.
- [ ] **VII. Notifications** ⚠️ **Ajuste mínimo incluido en la enmienda 1.8.0.**
  - Los avisos de la propia cuenta llevan el enlace de la cuenta y su vigencia, que la lista vigente de contenidos no
    menciona.
  - **Resto conforme:** puerto `NotificationChannel`, por eventos, asíncrono, sin bloquear el registro ni la solicitud,
    sin teléfonos ni datos de pago, y siempre por correo (WhatsApp no aplica a estos avisos).
- [x] **VIII. Redis** ✅ Los contadores de seguridad (reenvíos, solicitudes, usos fallidos) van en PostgreSQL
  (`account_link_attempt`); el estado de verificación, en `user_account`.
- [x] **IX. Web only** ✅ Pantallas responsive; los enlaces del correo abren la web.
- [x] **X. Mandatory tests** ✅ Pruebas planificadas por historia:
  - PR09 (un enlace de A no sirve en B; el guard toma el tenant del token);
  - PR14 (reglas de dependencias, incluida una nueva: el guard es el único consumidor de `CuentasApi.correoVerificado`
    fuera de M01 y M05);
  - PR07 y PR12 (autenticación y límites);
  - PR13 (auditoría);
  - permisos exactos de las funciones de sistema.
- [ ] **XI. ADR** ⚠️ ADR-036 en borrador (pendiente de revisión). También hace falta la **revisión obligatoria de
  ADR-015**, porque se amplían sus funciones de sistema.
- [x] **XII. Code location** ✅ Todo bajo `tecnologia/plataforma-barberias/`; la CI no cambia, salvo correr las pruebas
  nuevas.

**Actualización (2026-11-23, fase 0 de 010):** el responsable aprobó la enmienda 1.8.0, el ADR-036 y la revisión de
ADR-015, y se aplicaron. La constitución vigente es la **1.8.0**: las puertas III, VII y XI quedan ✅ con la quinta
excepción acotada (tres operaciones sobre la propia cuenta), el ajuste del principio VII y el ADR-036 Aceptado. US1 y
US2 ya no están bloqueadas por gobernanza. Abajo se conserva el resultado tal como se evaluó con la 1.7.2.

**Resultado de la puerta (con la 1.7.2):** **condicional**.
- US3 (textos legales) y US4 (pantallas sin sesión) pasan sin cambios de gobernanza y pueden implementarse ya.
- US1 y US2 quedan bloqueadas hasta que el responsable apruebe la enmienda 1.8.0 y el ADR-036. Ver Complexity Tracking.

**Re-check después del diseño (fase 1):**
- El modelo de datos y los contratos confirman lo anterior.
- **Ningún cambio de RLS existente:** solo políticas propias de la tabla nueva `account_link`.
- **Ningún rol nuevo:** las funciones son de `barberias_auth`, y la prueba `funciones-definer.spec.ts` fija sus permisos.
- **El guard no es el `AuthGuard`.**
- **Sin token en eventos ni en avisos** (R02).
- No aparece ninguna otra desviación.

## Project Structure

### Documentation (this feature)

```text
specs/010-acceso-verificado/
├── spec.md
├── plan.md                 # este archivo
├── research.md             # decisiones R01–R14
├── data-model.md           # columnas, tablas, funciones, avisos, eventos
├── quickstart.md           # validación automática y recorridos en la copia aparte
├── contracts/
│   ├── openapi.yaml        # rutas nuevas y cambios (403 CORREO_NO_VERIFICADO, correoVerificado)
│   ├── eventos-y-avisos.md # EnlaceDeCuentaSolicitado, ContrasenaCambiada, avisos y CuentasApi
│   └── pantallas.md        # rutas y pantallas de la interfaz
├── borradores/
│   └── enmienda-iii-1.8.0-y-adr-036.md   # para revisión; no aplicado
├── checklists/
│   └── requirements.md
└── tasks.md                # lo crea /speckit-tasks
```

### Source Code (repository root)

```text
tecnologia/plataforma-barberias/
├── backend/
│   ├── migrations/0036_acceso_verificado.ts         # columnas, account_link, account_link_attempt, funciones, avisos
│   ├── src/
│   │   ├── host/
│   │   │   ├── correo-verificado.guard.ts           # nuevo (R05) + decorador @RequiereCorreoVerificado()
│   │   │   └── app.module.ts                        # registra el guard; suscribe M05 a los eventos nuevos
│   │   ├── modules/acceso-barberias/
│   │   │   ├── index.ts / api-publica.ts            # CuentasApi (correoVerificado, correoDeCuenta, emitirToken)
│   │   │   └── identidad/
│   │   │       ├── domain/enlace-de-cuenta.ts       # reglas puras del enlace (propósito, vigencia, un solo uso)
│   │   │       ├── domain/limite-enlaces.ts         # límites por cuenta y origen
│   │   │       ├── application/solicitar-verificacion.ts, verificar-correo.ts,
│   │   │       │   pedir-recuperacion.ts, restablecer-contrasena.ts, cuentas-api.ts
│   │   │       ├── application/ports/enlace-de-cuenta-repository.ts, intentos-enlace-repository.ts
│   │   │       ├── infrastructure/kysely-enlace-de-cuenta-repository.ts, kysely-intentos-enlace-repository.ts
│   │   │       └── presentation/cuenta.controller.ts (+ DTO)   # /cuenta/verificacion*, /cuenta/recuperacion*
│   │   │   (cambian: clientes/application/registrar-cliente.ts → crea el enlace y publica el evento;
│   │   │    identidad/application/activar-cuenta.ts → marca ACTIVACION; emitir-sesion / sesion-iniciada → correoVerificado)
│   │   ├── modules/notificaciones/
│   │   │   ├── application/manejadores-de-cuenta.ts # nuevo: EnlaceDeCuentaSolicitado, ContrasenaCambiada
│   │   │   ├── application/enviar-avisos.ts         # destinatario CUENTA; emite el token al enviar
│   │   │   └── domain/aviso.ts, plantillas.ts, destinatarios.ts   # tipos y plantillas nuevas
│   │   └── shared/audit/audit-log.ts                # acciones nuevas
│   └── test/ (unit/identidad, integration/cuenta/, contract/cuenta.contract.spec.ts, integration/aislamiento/…)
├── frontend/src/
│   ├── legal/terminos.ts, privacidad.ts             # textos versionados (borrador base)
│   ├── legal.ts                                     # versiones por defecto nuevas
│   ├── pages/publico/Verificar.tsx, Recuperar.tsx, Restablecer.tsx, DocumentoLegal.tsx   # nuevas
│   ├── components/app/AvisoVerificacion.tsx         # nuevo
│   ├── pages/Ingresar.tsx, publico/IngresarBarberia.tsx    # "¿Olvidaste tu contraseña?"
│   ├── pages/Registro.tsx, publico/RegistroCliente.tsx, publico/Union.tsx   # enlaces a los textos
│   ├── pages/Portada.tsx, components/MarcoAcceso.tsx       # enlaces del pie
│   ├── pages/publico/Reservar.tsx, cliente/Asistente.tsx, cliente/PagarAdelanto.tsx  # aviso de verificación
│   ├── pages/publico/Enlace.tsx                     # "Iniciar sesión" → /mis-citas
│   ├── routes.tsx                                   # 5 rutas nuevas; sinSesion en 4 rutas del cliente
│   └── auth/SesionProvider.tsx                      # correoVerificado en el usuario
└── semilla/cargar-semilla.mjs (+ lib/buzon.mjs, test/)   # verifica a sus clientes por Mailpit
```

**Structure Decision**: el monolito modular existente (principio XII); sin módulos nuevos. M01 gana el submódulo de
enlaces de cuenta dentro de `identidad/`, M05 gana un manejador y la interfaz gana cinco pantallas.

## Fases (una por commit, del responsable; cortables en este orden)

| Fase | Contenido | Depende de | Cortable |
| --- | --- | --- | --- |
| 0 | **Del responsable**: revisar y aprobar (o pedir cambios a) la enmienda 1.8.0, el ADR-036 y la revisión de ADR-015. Si se aprueban, aplicarlos a la constitución, al plan-template y a `07-decisiones` | — | — |
| 1 | **US3 textos legales**: páginas, versiones nuevas, enlaces desde los 6 lugares, prueba de la versión aceptada. Paso del responsable: actualizar `TERMS_VERSION` y `PRIVACY_POLICY_VERSION` en su `.env` | — | No (bloqueante legal) |
| 2 | **US4 cliente sin sesión**: `sinSesion` en 4 rutas, `/e` → `/mis-citas`, prueba de contrato del enlace de `ADELANTO_SOLICITADO` | — | Sí |
| 3 | **Base común**: migración 0036, reglas del enlace, límites, `CuentasApi`, manejadores y avisos de M05, permisos exactos | Fase 0 aprobada | No |
| 4 | **US1 verificación**: registro, reenvío, verificar, guard en 3 rutas, `correoVerificado`, aviso en la interfaz, cuentas existentes, semilla y pruebas adaptadas | Fase 3 | No |
| 5 | **US2 recuperación**: pedir, restablecer, cierre de sesiones, aviso de contraseña cambiada, pantallas y "¿Olvidaste tu contraseña?" | Fase 3 | Sí (en el peor caso, después de la entrega) |
| 6 | **Cierre**: capturas y axe, quickstart en la copia aparte, documentación de `docs/` | 1–5 | — |

**Si la enmienda no se aprueba**, se entregan las fases 1 y 2. Las brechas 1 y 2 de la auditoría siguen abiertas y se
documentan así.

## Documentos de `docs/` que se actualizan al cerrar

- `docs/01-analisis-de-sistema/03-requisitos-funcionales.md`: RF04 y RF05 ampliados y RF nuevos (verificación,
  recuperación, textos legales; numeración en las tareas).
- `docs/01-analisis-de-sistema/02-historias-del-usuario.md`: HU nuevas o ampliadas.
- `docs/01-analisis-de-sistema/01-actores.md`: capacidades de ACT-02 a ACT-04.
- `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`: ADR-036 y revisión de ADR-015, si se aprueban.
- `docs/02-arquitectura-software/seguridad-y-privacidad.md`: excepciones, matriz rol × operación y cookies en la
  política.
- `docs/02-arquitectura-software/multi-tenancy-y-datos.md` y `api-rest.md`.
- `docs/05-gestion/04-pruebas.md` y `docs/trazabilidad.md`: fila de 010.
- `specs/auditoria-coherencia.md`: las brechas 1 a 3 y 7 pasan a "resueltas en 010" (o a "parcial" si se corta la
  fase 5).

## Riesgos (de mayor a menor)

1. **La enmienda no se aprueba o se demora:** bloquea US1 y US2, que son las brechas bloqueantes. Mitigación: las fases
   1 y 2 no dependen de ella.
2. **Pruebas existentes que reservan con clientes recién registrados:** si no se adaptan, falla la suite de integración.
   Mitigación: ayudante común de verificación (R13), y los ayudantes que crean cuentas por SQL las crean verificadas.
3. **El `.env` del responsable con la versión legal antigua:** el registro rechazaría la versión nueva de la interfaz.
   Mitigación: es un paso manual explícito de la fase 1 y el quickstart.
4. **Tiempo de respuesta distinguible:** el piso de 400 ms y la medición de SC-005 lo controlan.
5. **Revisores automáticos de correo que abren los enlaces:** la acción explícita en la página (FR-004) lo evita.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Nueva excepción acotada del principio III (enmienda 1.8.0): tres operaciones sin sesión sobre la propia cuenta (pedir un enlace de recuperación, verificar el correo y restablecer la contraseña), con funciones de sistema que escriben solo filas de esa cuenta, eligen la barbería solo entre sus membresías y cierran sus sesiones en todas sus barberías al restablecer | Sin sesión no hay tenant; recuperar la contraseña de un cliente con varias barberías debe cerrar sesiones de todas, y RLS por barbería impide hacerlo con el rol de la aplicación en una transacción | (a) Un rol nuevo con `BYPASSRLS`: prohibido por la constitución. (b) Ampliar la excepción de selección de membresía para aceptar un enlace: mezcla mecanismos y amplía su alcance. (c) Recorrer barbería por barbería: también necesita una lectura sin tenant y no es atómico |
| Ajuste mínimo del principio VII (los avisos de la propia cuenta llevan el enlace y su vigencia) | Sin el enlace, el aviso no sirve | No hay otro canal permitido para entregar el enlace (FR-001) |
| Tabla técnica nueva sin tenant (`account_link_attempt`) | Los límites deben contar por cuenta y origen antes de conocer la barbería, en PostgreSQL (principio VIII) | Redis no sirve para contadores de seguridad; una tabla por barbería no cuenta el abuso que cruza barberías |
