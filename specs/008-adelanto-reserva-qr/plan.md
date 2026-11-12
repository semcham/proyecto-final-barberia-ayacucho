# Implementation Plan: Adelanto de reserva con QR de la barbería

**Branch**: `008-adelanto-reserva-qr` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-adelanto-reserva-qr/spec.md`

**Note**: plan de diseño (fase 0 y fase 1 de Spec Kit). Sin código, sin migraciones escritas y sin commit.

## Summary

Con el adelanto activo, la reserva del cliente nace **pendiente** con el horario retenido (la restricción de
exclusión de 002 ya cubre `PENDIENTE`). El cliente paga a la barbería con su QR de Yape o Plin y registra el
número de operación (y una captura opcional y privada); el propietario lo comprueba en su propia aplicación y
confirma (`Cita.aprobar()`) o rechaza con un motivo. Una tarea programada cancela las citas sin pago al vencer su
hora límite y, si el pago se registró y nadie lo revisó, al alcanzar el límite máximo adicional. Al cancelar o
marcar "no asistió", el adelanto queda **por devolver** o **retenido**, y el propietario puede marcarlo
**devuelto**. La plataforma nunca recibe ni mueve el dinero (constitución 1.5.0, principio V; ADR-033).

Enfoque técnico, sin módulos nuevos (research R01):

- **M03** (`suscripciones-pagos`), submódulo nuevo **`adelantos`**: dueño de los datos y de las reglas del
  adelanto (configuración, monto y plazos, registro del pago con número de operación único, rechazo, devolución
  o retención, archivos privados). Publica sus eventos en el bus de M06. Expone `AdelantosApi` a M02.
- **M02** (`catalogo-citas/citas`): dueño de la cita. Los casos de uso que **cambian la cita** (reservar
  pendiente, confirmar, vencer, cancelar, marcar no asistió, reprogramar) siguen en M02 y llaman a `AdelantosApi`
  **en la misma transacción** (M02 → M03 está permitido; M03 → M02 no).
- **M05** (`notificaciones`): un manejador nuevo, `ManejadoresDeAdelanto`, y sus plantillas, sobre el mismo
  outbox, el mismo envío y el mismo `NotificationChannel` de 004.
- **M06**: sin piezas nuevas. Se reutilizan `BusDeEventos.publicar`, el ejecutor de tareas (ADR-024), la
  lectura de plataforma para listar pendientes, `AuditLog`, `TenantContext` y `UnitOfWork`.

## Technical Context

**Language/Version**: TypeScript 5 en Node.js 22 (backend NestJS 11; frontend React 19 + Vite 6), igual que 001–004.

**Primary Dependencies**: las ya instaladas. **Ninguna dependencia nueva**: los archivos se reciben con el
`FileInterceptor` de `@nestjs/platform-express` que usa 003 (en memoria) y su tipo se detecta por los bytes con
`tipo-de-archivo.ts` de 003; los códigos y los hash con `node:crypto`.

**Storage**: PostgreSQL 16 con RLS. Cuatro tablas nuevas con `tenant_id` y `rlsPorTenant` (research R05,
[data-model](data-model.md)): `booking_deposit_settings`, `booking_deposit`, `booking_deposit_payment` y
`booking_deposit_file` (QR y capturas en `bytea`, como `payment_receipt_file` de 003). Migraciones `0028` a
`0030`. Redis no interviene.

**Testing**: Jest 29 (unitarias de dominio), Jest + Testcontainers (integración con PostgreSQL real, Mailpit y el
simulador de WhatsApp de 004), pruebas de contrato contra `contracts/openapi.yaml` y `contracts/rbac.md`,
dependency-cruiser (PR14) y Vitest + MSW en el frontend.

**Target Platform**: servidor Linux en contenedores (local: Docker Compose con dos réplicas detrás de Nginx);
navegador web responsive.

**Project Type**: aplicación web (backend modular + frontend), código en `tecnologia/plataforma-barberias/`.

**Performance Goals**: vencimiento en ≤ 5 min tras la hora límite (SC-003): tarea `vencer-adelantos` cada 60 s;
las operaciones del adelanto responden como las demás de la cita (p95 < 1 s en local), sin esperar a los avisos.

**Constraints**: sin pasarela ni proveedor de pagos para el adelanto (principio V 1.5.0); `PaymentGateway` y el
cobro de la suscripción no cambian; archivos privados sin URL pública (ADR-023); una cita se confirma o vence una
sola vez aunque haya dos réplicas (EQ-24); avisos asíncronos que nunca bloquean (principio VII).

**Scale/Scope**: una configuración por barbería, un adelanto por cita en línea; decenas de citas pendientes por
barbería al día; tres pantallas nuevas y cambios menores en Reservar, Mis citas y Agenda.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Gates from `.specify/memory/constitution.md` (v1.5.0):

- [x] **I. Seis módulos**: no hay módulo nuevo. `adelantos` es un submódulo de M03. Llamadas solo por `index`:
      M02 → M03 (`AdelantosApi`), M02 → M01 (ya existe), M05 → M01 (ya existe, solo lectura). M03 no llama a M02:
      lo que cambia la cita lo orquesta M02 (R01). Los efectos hacia M05 van por eventos del bus de M06.
- [x] **II. Cuatro capas**: `adelantos/{presentation,application,domain,infrastructure}`; las reglas (monto,
      plazos, transiciones, número de operación) son dominio puro sin NestJS, Kysely ni `node:crypto`.
- [x] **III. Aislamiento**: el tenant sale del token; las cuatro tablas con `tenant_id`, RLS forzada y política
      `tenant_isolation`; los repositorios filtran por tenant. La tarea `vencer-adelantos` lista pendientes con
      `barberias_plataforma` leyendo **solo columnas técnicas** de `booking_deposit` (`id`, `tenant_id`,
      `status`, `due_at`, `review_limit_at`) y procesa cada uno con su tenant y RLS (tercera excepción, 1.4.1).
      El número de operación se compara solo dentro de la barbería. Sin roles que omitan RLS.
- [x] **IV. Sin citas duplicadas**: la cita pendiente usa la misma restricción de exclusión de 002 (cubre
      `PENDIENTE` y `CONFIRMADA`); no hay otra forma de retener el horario.
- [x] **V. Pagos (1.5.0)**: el adelanto se paga **directo a la barbería**; la plataforma solo registra el número
      de operación, la captura opcional y la decisión del propietario. Sin pasarela, sin comisión, sin datos de
      tarjeta. `PaymentGateway`, el webhook y la conciliación de 003 no se tocan (FR-026, FR-027).
- [x] **VI. IA**: no aplica.
- [x] **VII. Notificaciones**: los avisos del adelanto son eventos del bus que M05 envía por
      `NotificationChannel`, asíncronos, con respaldo por correo y sin bloquear. **Contenido mínimo**: barbería,
      servicio, fecha y hora, monto, código de la reserva, hora límite y, en un rechazo, el motivo; nunca el número
      de operación, la captura, teléfonos ni correos (FR-024). Los "datos de pago" que prohíbe VII son los de
      tarjeta o cuenta; el monto y el código del adelanto son necesarios para pagar (ver Complexity Tracking).
- [x] **VIII. Redis**: no interviene.
- [x] **IX. Solo web**: pantallas web responsive.
- [x] **X. Pruebas**: por historia, con PR09 (aislamiento de las cuatro tablas y de los archivos), PR16 (reservas
      simultáneas con adelanto), PR31 (comprobantes del adelanto privados y número no repetible), PR32
      (confirmación sin doble efecto) y PR14 (reglas nuevas).
- [x] **XI. ADR**: ADR-033 (Aceptado) cubre la decisión. **No se necesita ADR nuevo**: no cambia la arquitectura;
      se registra el submódulo `adelantos` en componentes y en la matriz de M03 al cerrar.
- [x] **XII. Código**: todo en `tecnologia/plataforma-barberias/`.

**Re-check post-diseño (tras la fase 1):** ✅ sin violaciones. Los contratos ([openapi](contracts/openapi.yaml),
[rbac](contracts/rbac.md), [eventos](contracts/eventos.md)) y el [modelo de datos](data-model.md) respetan las
puertas: ningún contrato recibe `tenant_id`, ninguna tabla queda sin RLS, y los avisos no llevan el número de
operación.

## Project Structure

### Documentation (this feature)

```text
specs/008-adelanto-reserva-qr/
├── spec.md
├── plan.md              # este archivo
├── research.md          # fase 0: decisiones R01–R14
├── data-model.md        # fase 1: tablas, estados y migraciones
├── quickstart.md        # fase 1: guía de validación
├── contracts/
│   ├── openapi.yaml     # rutas nuevas y cambios a POST /citas
│   ├── rbac.md          # matriz rol × ruta
│   └── eventos.md       # eventos nuevos del bus y destinatarios
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks (no lo crea este comando)
```

### Source Code (repository root)

```text
tecnologia/plataforma-barberias/
├── backend/
│   ├── migrations/
│   │   ├── 0028_adelanto_configuracion.ts     # booking_deposit_settings + booking_deposit_file
│   │   ├── 0029_adelantos.ts                  # booking_deposit + booking_deposit_payment + columnas de plataforma
│   │   └── 0030_avisos_adelanto.ts            # notification.kind admite los tipos del adelanto
│   ├── src/
│   │   ├── host/
│   │   │   ├── eventos.ts                     # suscribe ManejadoresDeAdelanto
│   │   │   └── tareas.ts                      # registra vencer-adelantos (60 s)
│   │   ├── modules/
│   │   │   ├── suscripciones-pagos/           # M03
│   │   │   │   ├── adelantos/                 # submódulo nuevo
│   │   │   │   │   ├── domain/                # politica-adelanto.ts, adelanto.ts, numero-operacion.ts, codigo-reserva.ts
│   │   │   │   │   ├── application/           # configurar-adelanto.ts, registrar-pago.ts, rechazar-pago.ts,
│   │   │   │   │   │                          # marcar-devuelto.ts, consultar-adelanto.ts, adelantos-api.ts, ports/
│   │   │   │   │   ├── infrastructure/        # kysely-*.ts, archivos-adelanto-postgres.ts, plataforma/adelantos-por-vencer.ts
│   │   │   │   │   └── presentation/          # adelanto-configuracion.controller.ts, adelanto-cita.controller.ts
│   │   │   │   ├── pagos/domain/tipo-de-archivo.ts      # se reutiliza (QR: solo imágenes)
│   │   │   │   ├── pagos/presentation/comprobante.interceptor.ts  # se reutiliza
│   │   │   │   ├── adelantos-api.ts           # interfaz pública (clase abstracta) para M02
│   │   │   │   └── index.ts                   # exporta AdelantosApi
│   │   │   ├── catalogo-citas/citas/          # M02
│   │   │   │   ├── domain/cita.ts             # reservar(..., { pendiente })
│   │   │   │   ├── application/               # reservar-cita.ts, confirmar-adelanto.ts (nuevo), vencer-adelantos.ts (nuevo),
│   │   │   │   │                              # bandeja-adelantos.ts (nuevo), cancelar-cita.ts, cambiar-estado-cita.ts,
│   │   │   │   │                              # reprogramar-cita.ts, accion-por-enlace.ts, recordatorio-de-cita.ts
│   │   │   │   └── presentation/              # adelanto.controller.ts (confirmación y bandeja)
│   │   │   └── notificaciones/                # M05
│   │   │       ├── domain/aviso.ts, plantillas.ts         # tipos y plantillas del adelanto
│   │   │       └── application/manejadores-de-adelanto.ts # nuevo
│   │   └── shared/audit/audit-log.ts          # acciones nuevas
│   ├── .dependency-cruiser.cjs                # regla adelantos-solo-por-api (M02 solo por AdelantosApi)
│   └── test/                                  # unit/adelantos, integration/adelantos, contract, architecture
└── frontend/
    └── src/
        ├── pages/panel/Adelanto.tsx           # configuración (propietario)
        ├── pages/panel/AdelantosPorRevisar.tsx # bandeja de verificación (propietario)
        ├── pages/cliente/PagarAdelanto.tsx    # pantalla de pago (cliente)
        ├── pages/publico/Reservar.tsx         # tras reservar con adelanto, lleva a la pantalla de pago
        ├── pages/cliente/MisCitas.tsx         # estado del adelanto y enlace "Pagar adelanto"
        └── pages/panel/Agenda.tsx             # estado del adelanto y saldo
```

**Structure Decision**: aplicación web existente; sin proyectos ni módulos nuevos. Un submódulo nuevo dentro de
M03 (`adelantos`) con sus cuatro capas, cambios acotados en M02 (cita y sus casos de uso) y en M05 (un manejador y
sus plantillas), y tres pantallas.

## Flujo principal (diseño)

1. **Reservar** (M02, `ReservarCita`, una transacción): reglas de 002 → `AdelantosApi.paraReservar(precio, inicio,
   ahora)` decide si hay adelanto, su monto y sus plazos (o rechaza con `SIN_TIEMPO_PARA_ADELANTO`) → la cita se
   guarda **PENDIENTE** (la exclusión retiene el horario) → `AdelantosApi.crear(...)` guarda el adelanto con su
   código y publica `AdelantoSolicitado`. En lugar de `CitaCreada` y del recordatorio, que se publican al
   confirmar (R08).
2. **Registrar el pago** (M03, `RegistrarPagoDeAdelanto`): solo el cliente del adelanto y dentro del plazo;
   número de operación único en la barbería; captura opcional validada por bytes; el adelanto pasa a
   **POR_REVISAR** y se publica `PagoDeAdelantoRegistrado` (propietario).
3. **Confirmar** (M02, `ConfirmarAdelanto`): bloquea la cita y luego el adelanto (mismo orden que el vencimiento)
   → `AdelantosApi.confirmar` (transición condicional) → `cita.aprobar()` → publica `AdelantoConfirmado` y
   programa el recordatorio de 004. Repetir no tiene efecto.
4. **Rechazar** (M03, `RechazarPagoDeAdelanto`): motivo obligatorio; el adelanto vuelve a **POR_PAGAR** con su
   hora límite original; publica `PagoDeAdelantoRechazado`.
5. **Vencer** (M02, tarea `vencer-adelantos`, cada 60 s): lista con la lectura de plataforma los adelantos con
   `due_at` o `review_limit_at` pasados; por cada uno, transacción con su tenant: bloquea la cita, pide a
   `AdelantosApi.decidirVencimiento` (sin pago → VENCIDO; pago sin revisar y límite alcanzado → POR_DEVOLVER;
   si no, nada) y cancela la cita sin marca de tardía; publica `AdelantoVencido`.
6. **Cancelar o no asistió** (M02, casos de uso de 002): llaman a `AdelantosApi.alCancelar` o `alNoAsistir`, que
   dejan el adelanto **ANULADO**, **POR_DEVOLVER** o **RETENIDO** (R10); `CitaCancelada` lleva ese resultado.
7. **Marcar devuelto** (M03, `MarcarAdelantoDevuelto`): solo desde POR_DEVOLVER; auditado; sin aviso.

## Fases de implementación (una fase = un commit, como en 004)

Cada fase empieza por sus pruebas (deben fallar), termina con la suite completa, `test:arch` y CI en verde, y se
cierra con un commit propio.

| Fase | Contenido | Historias |
| ---- | --------- | --------- |
| 1    | **Base**: migraciones `0028`–`0030` con RLS y pruebas de aislamiento por tabla; dominio puro del adelanto (monto, plazos, estados, número de operación, código); `AdelantosApi` vacía y su regla PR14 `adelantos-solo-por-api`; tipos de aviso y acciones de auditoría nuevas | — |
| 2    | **US1 Configuración**: `GET/PUT /barberia/adelanto` y el QR privado; pantalla `Adelanto.tsx`; auditoría | US1 |
| 3    | **US2 Reserva pendiente y registro del pago**: reserva PENDIENTE con adelanto; `POST /citas/{id}/adelanto/pago` con captura; vista del cliente y del QR; pantalla `PagarAdelanto.tsx`; avisos `AdelantoSolicitado` y `PagoDeAdelantoRegistrado`; PR16 con adelanto | US2 |
| 4    | **US3 Confirmar y rechazar**: confirmación (M02) y rechazo (M03); bandeja `AdelantosPorRevisar.tsx`; recordatorio al confirmar; avisos; **PR32** (confirmaciones simultáneas en dos instancias) | US3 |
| 5    | **US4 Vencimiento**: tarea `vencer-adelantos` con dos réplicas; límite máximo adicional; **PR32** (confirmar a la vez que vence) | US4 |
| 6    | **US5 Día de la cita y cancelación**: saldo en Agenda y Mis citas; adelanto por devolver o retenido al cancelar o no asistir; marcar devuelto; reprogramar una cita pendiente (solo propietario) | US5 |
| 7    | **Cierre**: documentación (planificado → implementado solo en lo construido), quickstart con Docker Compose, revisión manual de las tres pantallas | — |

### Esfuerzo relativo por fase

| Fase | Esfuerzo | Por qué |
| ---- | -------- | ------- |
| 1    | M        | Cuatro tablas con el patrón de 004 y un dominio pequeño |
| 2    | S        | Un formulario y un archivo, con piezas de 003 |
| 3    | **L**    | Toca la reserva de 002, el archivo de la captura, dos avisos y la pantalla de pago |
| 4    | M        | Una transición con bloqueo y la bandeja |
| 5    | M        | Reutiliza el ejecutor y la lectura de plataforma de 003 y 004 |
| 6    | M        | Cambios pequeños en tres casos de uso de 002 y en dos pantallas |
| 7    | M        | Documentación y recorrido con Compose |

## Pruebas por escenario de la especificación

| Escenario o requisito | Prueba | Nivel |
| --------------------- | ------ | ----- |
| US1 · FR-001–FR-004 | `adelanto-configuracion` (rangos, QR por bytes, solo propietario, cambio sin afectar citas previas) | Integración + contrato |
| US2-1, FR-005, PR16 | `reserva-con-adelanto` (cita PENDIENTE, horario retenido) y `concurrencia-adelanto` (50 reservas del mismo horario → 1 pendiente, 49 × 409, 0 × 5xx) | Integración |
| FR-006, FR-007 | `politica-adelanto` (monto fijo, porcentaje redondeado, tope del precio, precio cero, hora límite con margen de 30 min, límite máximo adicional) | Unitaria |
| US2-3–US2-6, FR-009–FR-011, **PR31** | `registro-pago-adelanto` (número único en la barbería, un registro vigente, captura por bytes, fuera de plazo) y `aislamiento-adelantos` (número, captura y QR invisibles para otro cliente y otra barbería) | Integración |
| US3, FR-012–FR-015, **PR32** | `confirmacion-adelanto` (confirmar, rechazar con motivo, repetir sin efecto, barbero 403) y `confirmacion-adelanto-concurrencia` (dos confirmaciones a la vez en dos instancias → 1 transición y 1 aviso) | Integración |
| US4, FR-016–FR-019, **PR32** | `vencimiento-adelantos` (sin pago, con pago sin revisar, límite máximo adicional, rechazo y vencimiento) y `vencimiento-adelantos-dos-replicas` (50 a la vez → una cancelación y un aviso por cita; confirmar a la vez que vence → exactamente uno) | Integración |
| US5, FR-020–FR-022 | `adelanto-al-cancelar` (por devolver, retenido, no asistió, cancelación del propietario, marcar devuelto) | Integración |
| FR-023–FR-025 | `avisos-adelanto` (cada aviso una vez, contenido mínimo sin número de operación; recordatorio solo al confirmar) | Integración con Mailpit |
| FR-026, FR-027, SC-009 | revisión del modelo de datos (sin columnas de tarjeta ni de movimientos) y PR14 (M03 `adelantos` no importa `PaymentGateway`) | Arquitectura + revisión |
| FR-028 | `aislamiento-008` (RLS de las cuatro tablas: leer, modificar e insertar con otro tenant) y `lectura-plataforma` (cinco columnas técnicas de `booking_deposit`) | Integración |
| FR-029 | `adelanto-auditoria` (una entrada por acción, sin el número completo ni la captura) | Integración |
| FR-030 | `restricciones-estado` (acciones del adelanto según el estado de la suscripción) | Integración |
| PR08 | `rbac-008` (matriz de [rbac.md](contracts/rbac.md)) | Contrato |
| Interfaz | `adelanto.spec.tsx`, `pagar-adelanto.spec.tsx`, `adelantos-por-revisar.spec.tsx` (estados cargando, vacío y error; solo teclado) | Vitest + MSW |

## Riesgos

| Riesgo | Mitigación |
| ------ | ---------- |
| La verificación es manual: un comprobante falso | Número de operación único en la barbería, monto y código visibles para el propietario, y su confirmación expresa (ADR-033) |
| El propietario no revisa a tiempo | Límite máximo adicional que libera el horario y deja el adelanto por devolver (FR-018) |
| Doble efecto entre confirmar y vencer | Bloqueo de la cita y luego del adelanto en el mismo orden en ambos casos y transiciones condicionales (R06) |
| Cambiar la reserva de 002 rompe pruebas existentes | El adelanto se activa por barbería; sin adelanto, la reserva sigue idéntica y sus pruebas no cambian |
| Archivos grandes en PostgreSQL | Tope de 5 MB por captura y 1 MB por QR, como 003; en la nube, el mismo puerto con almacenamiento privado (ADR-023) |
| Plazo corto y tareas cada 60 s | SC-003 admite hasta 5 min; la cita se cancela en la siguiente corrida tras la hora límite |

## Lo que NO se afirmará

- Que la plataforma verifica el pago con Yape o Plin: la verificación es del propietario.
- Que la plataforma devuelve dinero: solo registra que la barbería lo devolvió.
- Que el texto de los avisos o del QR está validado legalmente.
- Medidas en producción: todo se mide en local con Docker Compose.

## Documentos que se actualizan (al cerrar, fase 7)

`docs/trazabilidad.md` (§4 fila de 008 y tabla de componentes), `docs/05-gestion/04-pruebas.md` (PR31, PR32),
`docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md` (EQ-23, EQ-24),
`docs/02-arquitectura-software/componentes-arquitectonicos.md` (submódulo `adelantos`),
`docs/02-arquitectura-software/multi-tenancy-y-datos.md` (tablas nuevas y lectura de plataforma),
`docs/02-arquitectura-software/api-rest.md`, `docs/02-arquitectura-software/seguridad-y-privacidad.md`,
`docs/03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md` (estados de la cita con PENDIENTE en uso),
`docs/05-gestion/02-backlog-y-sprints.md`, RF35 y HU29 en `docs/01-analisis-de-sistema/` y el README de la
plataforma. Solo lo construido pasa a "implementado".

## Trazabilidad

HU29 → RF35 → AC01, AC02 / EQ-23, EQ-24 → DA02, DA07, DA11 → ADR-033 (+ ADR-009, ADR-023, ADR-024, ADR-025,
ADR-026) → M03 `adelantos`, M02 `citas`, M05 → PR31, PR32, PR09, PR16, PR08, PR13, PR14.

## Complexity Tracking

| Tensión | Por qué se necesita | Alternativa más simple descartada |
| ------- | ------------------- | --------------------------------- |
| Los avisos del adelanto llevan el **monto** y el **código** (principio VII pide datos mínimos y prohíbe "datos de pago") | Sin el monto y el código el cliente no puede pagar ni el propietario reconocer el pago; no son datos de tarjeta ni de cuenta, que es lo que VII protege | Mandar solo "tienes un adelanto pendiente": obliga a entrar a la aplicación y no cumple US2-2. El número de operación y la captura **no** viajan en ningún aviso |
| M03 guarda una **copia** del servicio, la hora y la zona de la cita | Los eventos que publica M03 (registro y rechazo del pago) necesitan esos datos para el aviso, y M03 no puede leer a M02 | Que M03 llame a M02: lo prohíbe la matriz. Mover el registro del pago a M02: contradice que M03 sea el dueño del adelanto. La copia se actualiza desde M02 al reprogramar (R11) |
