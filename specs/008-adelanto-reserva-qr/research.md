# Research: Adelanto de reserva con QR (008)

Decisiones de la fase 0. No quedan "NEEDS CLARIFICATION": las dos preguntas de la especificación se
respondieron el 2026-11-12 (límite máximo adicional y seguimiento de la devolución) y los supuestos los aprobó el
responsable.

## R01 · Dónde vive cada responsabilidad (matriz de módulos)

- **Decisión:** submódulo nuevo **`adelantos` dentro de M03**, dueño de los datos y las reglas del adelanto:
  configuración, cálculo del monto y de los plazos, código de la reserva, registro del pago con su número de
  operación y captura, rechazo, estados (por pagar, por revisar, confirmado, vencido, anulado, por devolver,
  devuelto, retenido) y sus archivos privados. Expone a M02 la interfaz pública **`AdelantosApi`**.
  **M02 orquesta todo lo que cambia la cita**: reservar pendiente, confirmar (`Cita.aprobar()`), vencer,
  cancelar, marcar no asistió y reprogramar; en cada caso llama a `AdelantosApi` en la **misma transacción**.
  Las operaciones que no tocan la cita viven en M03: configurar, registrar el pago, rechazarlo y marcarlo
  devuelto.
- **Justificación:** la matriz permite M02 → M03 y prohíbe M03 → M02 (regla `matriz-m03` de PR14). Si M03
  confirmara la cita, tendría que llamar a M02. Con esta división, cada transición de la cita sigue en el módulo
  dueño de la cita y su restricción de exclusión, y el adelanto queda donde ya están los comprobantes privados
  (003).
- **Alternativas descartadas:** (a) todo en M02: M02 tendría tablas y reglas de pagos, contra el criterio del
  usuario y de 003; (b) un módulo nuevo: lo prohíbe el principio I; (c) que M03 cambie la cita por un evento:
  la confirmación dejaría de ser atómica con la cita y EQ-24 exigiría compensaciones.

## R02 · Cómo el cliente del adelanto se autoriza sin que M03 lea a M01 ni a M02

- **Decisión:** al crear el adelanto, M02 le pasa el `clienteId` y el `usuarioId` del cliente de la sesión;
  M03 los guarda. Registrar el pago y ver el QR o la captura exigen que el `usuarioId` del token sea el del
  adelanto (o que el actor sea el propietario de la barbería).
- **Justificación:** M03 solo depende de M06; con la copia no necesita preguntar a nadie quién es el cliente.
  El tenant sigue saliendo del token y RLS filtra por él.
- **Alternativa descartada:** que el registro del pago pase por un controlador de M02 que valide la cita: suma
  una capa sin valor y M03 dejaría de ser dueño de su caso de uso.

## R03 · Cita pendiente y horario retenido

- **Decisión:** `Cita.reservar` recibe la opción `pendiente: true` cuando hay adelanto y la cita nace en
  `PENDIENTE`. La restricción de exclusión de 002 (`status IN ('PENDIENTE','CONFIRMADA')`, migración 0011) ya
  retiene el horario: **sin cambios de base** para la cita. `Cita.aprobar()` (PENDIENTE → CONFIRMADA) existe
  desde 002.
- **Justificación:** reutiliza el estado y la transición existentes; PR16 sigue cubriendo la concurrencia.
- **Alternativa descartada:** un estado nuevo `ESPERANDO_PAGO`: cambia la restricción, la agenda y los filtros
  de 002 sin ganar nada.

## R04 · Monto, hora límite y límite máximo adicional (dominio puro)

- **Decisión:** `politica-adelanto.ts` (M03, dominio):
  - monto fijo (100 a 50 000 céntimos) o porcentaje (1 a 100) del precio, **en céntimos enteros** y redondeado
    al céntimo (mitad hacia arriba); nunca mayor que el precio; precio cero → sin adelanto;
  - hora límite = `min(reserva + plazo, inicio − 30 min)`; si no es posterior a la reserva → error
    `SIN_TIEMPO_PARA_ADELANTO` (422);
  - límite máximo adicional = `min(inicio − 2 h, hora límite + 24 h)`; si queda antes de la hora límite →
    `inicio` (aclaración Q1 y FR-018). Se calcula y se guarda al crear el adelanto.
- **Justificación:** reglas puras, fáciles de probar con tablas de casos; los céntimos enteros son la convención
  de 003 (FR-005b).
- **Alternativa descartada:** calcular los límites en la tarea: harían falta datos de la cita que M03 no tiene.

## R05 · Tablas y archivos privados

- **Decisión:** cuatro tablas con `tenant_id`, `UNIQUE (tenant_id, id)`, claves foráneas compuestas y
  `rlsPorTenant` ([data-model](data-model.md)). El QR y las capturas en `booking_deposit_file` (`bytea`, con
  tipo, tamaño y SHA-256), **igual que `payment_receipt_file`** de 003: sin URL pública; se sirven solo con
  sesión y permiso, como adjunto o imagen con `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.
  Se reutilizan `detectarTipoComprobante` (tipo por bytes) y el `FileInterceptor` en memoria de 003; el QR admite
  solo JPEG o PNG y hasta 1 MB; la captura, JPEG, PNG o PDF hasta 5 MB.
- **Justificación:** ADR-023 ya resolvió el almacenamiento privado; en la nube el mismo puerto pasa a un
  almacén privado sin cambiar los casos de uso.
- **Alternativa descartada:** reutilizar `payment_receipt` de 003: está atada a `payment` de la suscripción y a
  su cupo diario; mezclaría dos dominios de pago con reglas distintas.

## R06 · Confirmación y vencimiento sin doble efecto (EQ-24, PR32)

- **Decisión:** confirmar y vencer bloquean **primero la cita y después el adelanto** (`FOR UPDATE`), siempre en
  ese orden, y aplican transiciones condicionales (`WHERE status = $esperado`). La tarea usa además
  `SKIP LOCKED` para saltar la cita que una confirmación tiene tomada, y la revisa en la corrida siguiente.
  Confirmar algo ya confirmado responde 200 sin efecto ni aviso.
- **Justificación:** es el patrón de la aprobación de pagos de 003 y de la reprogramación de 004; el mismo orden
  de bloqueo evita bloqueos mutuos.
- **Alternativa descartada:** candado en Redis: lo prohíbe el principio VIII para estado crítico.

## R07 · Número de operación y código de la reserva

- **Decisión:** el número se normaliza (sin espacios, en mayúsculas; 4 a 20 caracteres alfanuméricos) y es
  `UNIQUE (tenant_id, operation_number)` en `booking_deposit_payment`, también para registros rechazados. Un solo
  registro vigente por adelanto: índice único parcial `(tenant_id, deposit_id) WHERE review_result IS DISTINCT
  FROM 'RECHAZADO'`. El código de la reserva: 6 caracteres de un alfabeto sin ambigüedades (sin 0/O ni 1/I/L),
  `UNIQUE (tenant_id, code)`, generado con `node:crypto` en infraestructura. El alta del adelanto usa
  `INSERT ... ON CONFLICT (tenant_id, code) DO NOTHING RETURNING id` y, si no inserta, prueba otro código (hasta
  5 veces): un choque no aborta la transacción de la reserva, como `publicarUnaVez` de 004. Una violación del
  número de operación (`23505`) sí aborta la transacción del registro y se traduce en 409
  `NUMERO_OPERACION_REPETIDO`: no hay nada más que guardar en ella.
- **Justificación:** la unicidad la garantiza la base aunque lleguen dos registros a la vez; comparar solo
  dentro de la barbería evita revelar datos de otra (principio III).
- **Alternativa descartada:** unicidad entre barberías, como el número de operación aprobado de 003: allí los
  pagos van a la misma cuenta de la plataforma; aquí cada barbería tiene su propio QR.

## R08 · Eventos y avisos (reutiliza 004)

- **Decisión:** cinco tipos de evento nuevos en el bus de M06, publicados con `BusDeEventos.publicar` en la
  transacción de cada operación ([contracts/eventos.md](contracts/eventos.md)): `AdelantoSolicitado`,
  `PagoDeAdelantoRegistrado`, `AdelantoConfirmado`, `PagoDeAdelantoRechazado` y `AdelantoVencido`. M05 suma un
  manejador (`ManejadoresDeAdelanto`) que crea un aviso por destinatario, sus plantillas y cinco valores de
  `notification.kind` (migración 0030). Para una cita **pendiente**, la reserva **no** publica `CitaCreada` (su
  texto dice "tu cita quedó confirmada") ni programa el recordatorio: los dos salen al **confirmar**
  (`AdelantoConfirmado` reemplaza a `CitaCreada` y se programa `RecordatorioDeCita` si faltan 2 h o más).
  El vencimiento publica `AdelantoVencido` en lugar de `CitaCancelada`. `CitaCancelada` suma el campo opcional
  `adelanto` (`POR_DEVOLVER` o `RETENIDO`) y su plantilla lo menciona.
- **Justificación:** un solo mecanismo de avisos (FR-023); sin duplicar el outbox ni el envío.
- **Alternativa descartada:** publicar `CitaCreada` también para la cita pendiente con otro texto: el
  manejador de 004 tendría que distinguir estados y el cliente recibiría dos avisos.

## R09 · Tarea de vencimiento

- **Decisión:** tarea `vencer-adelantos` en M02 (cancela citas), registrada en `host/tareas.ts` cada **60 s**,
  con el candado del ejecutor (ADR-024). Lista los candidatos con `AdelantosApi.porVencer(ahora, lote)`, que
  implementa M03 con la lectura de `barberias_plataforma` sobre cinco columnas técnicas de `booking_deposit`
  (`id`, `tenant_id`, `status`, `due_at`, `review_limit_at`), en lotes de 100. Cada candidato se procesa en una
  transacción con su tenant y RLS (R06).
  - *Ajuste de la fase 5:* como ese rol no lee `appointment_id`, el candidato es `{ tenantId, adelantoId }` y M02 pide
    la cita con `AdelantosApi.citaDelAdelanto` ya dentro de la transacción del tenant; `porVencer` recibe además el
    último id del lote anterior (`despuesDe`), así una cita saltada por estar bloqueada no repite el mismo lote.
- **Justificación:** SC-003 pide ≤ 5 min; es el patrón de `vencer-suscripciones` y de `enviar-avisos`.
- **Alternativa descartada:** programar un evento con `disponibleDesde` en la hora límite: el evento se
  despacharía aunque el pago se haya registrado y el manejador tendría que deshacerlo; además, el vencimiento
  cambia la cita, que no es trabajo de M05.

## R10 · Qué pasa con el adelanto al cancelar, no asistir o reprogramar

- **Decisión:** `AdelantosApi.alCancelar(citaId, { porCliente, tardia })` y `alNoAsistir(citaId)`:
  - sin pago registrado (POR_PAGAR) → **ANULADO**;
  - con pago registrado sin revisar (POR_REVISAR) → **POR_DEVOLVER** (el propietario pudo recibirlo);
  - confirmado y cancelado por el cliente con tiempo o por el propietario → **POR_DEVOLVER**;
  - confirmado y cancelado tarde por el cliente, o no asistió → **RETENIDO**.
  Marcar devuelto (M03) solo desde POR_DEVOLVER (aclaración Q2). La "tardía" es la regla de antelación de 002.
- **Justificación:** HU29 criterio 6 y FR-021, sin regla nueva de cancelación.

## R11 · Reprogramación y acciones por enlace

- **Decisión:** el **cliente** no puede reprogramar una cita pendiente (supuesto aprobado): `ReprogramarCita`
  responde 409 `ADELANTO_PENDIENTE` ("paga y espera la confirmación, o cancela"), y el recordatorio de 004 no se envía a citas pendientes, así
  que no hay enlaces que lo permitan. El **propietario** sí puede: la cita conserva su adelanto, su hora límite y
  su límite máximo adicional; M02 actualiza la copia de la hora en M03 con `AdelantosApi.alReprogramar`. Si la
  nueva hora deja la hora límite después de `inicio − 30 min`, se mantiene la hora límite (el propietario decide
  conscientemente).
- **Justificación:** reprogramar una cita sin pagar abriría una forma de retener horarios sin adelanto.

## R15 · La aprobación de 002 no confirma un adelanto

- **Decisión (del responsable, 2026-11-12; análisis de consistencia, hallazgo P1):** `CambiarEstadoCita` con
  destino CONFIRMADA (`POST /citas/{id}/estado`, que en 002 pueden usar el propietario y el barbero en sus citas)
  responde **409 `ADELANTO_PENDIENTE`** si la cita tiene adelanto, para los dos roles. La única forma de confirmar
  una cita con adelanto es `ConfirmarAdelanto` (solo propietario, con un pago registrado). Las citas sin adelanto
  siguen igual que en 002.
- **Justificación:** sin esta regla se confirmaría una cita sin revisar el pago, el adelanto quedaría POR_PAGAR y la
  tarea de vencimiento chocaría con una cita ya confirmada.
- **Alternativas descartadas:** tratar la aprobación del propietario como confirmación del adelanto (dos caminos
  para lo mismo) y dejar que el barbero confirme pagos (amplía quién verifica dinero).

## R12 · Restricciones por estado de la suscripción

- **Decisión:** la reserva usa `RESERVAR` (como hoy); confirmar, rechazar, cancelar y marcar devuelto, como
  cambios de citas, usan `GESTIONAR_CITAS`; configurar el adelanto, `CONFIGURAR_CATALOGO`. El registro del pago
  del cliente no se restringe (completa una reserva ya aceptada). Se agregan las filas a
  `specs/003-suscripciones-pagos/contracts/restricciones-estado.md` §2, con la nota de que las agrega 008.
- **Justificación:** FR-030 y el caso límite de la suscripción vencida: las pendientes se pueden resolver.

## R13 · Auditoría

- **Decisión:** acciones nuevas en `AccionAuditada`: `ADELANTO_CONFIGURADO`, `ADELANTO_PAGO_REGISTRADO`,
  `ADELANTO_CONFIRMADO`, `ADELANTO_PAGO_RECHAZADO`, `ADELANTO_VENCIDO`, `ADELANTO_DEVUELTO` y
  `ADELANTO_RESUELTO` (por devolver o retenido al cancelar o no asistir). Recurso
  `cita:<id>;<estado>`; nunca el número de operación ni la captura. `audit_log.action` no tiene CHECK: no hace
  falta migración. El motivo del rechazo se guarda en `booking_deposit_payment`, no en la auditoría (como 003).
- **Justificación:** FR-029 y el criterio de 003 (sin texto libre en la auditoría).

## R14 · Interfaz

- **Decisión:** tres pantallas con los componentes existentes (sistema de diseño de ADR-016):
  - **`/app/adelanto`** (propietario, menú Barbería): formulario con tipo, valor, plazo y subida del QR con vista
    previa; estados cargando y error.
  - **`/mis-citas/:citaId/adelanto`** (cliente): QR, monto, código copiable, hora límite con cuenta regresiva
    accesible (texto, no solo visual), formulario del número y la captura; estados por pagar, por revisar,
    rechazado, confirmado y vencido. Tras reservar con adelanto, `Reservar.tsx` lleva aquí.
  - **`/app/adelantos`** (propietario): bandeja de pagos por revisar con monto, código, número, captura,
    hora límite y límite máximo; confirmar o rechazar (con motivo) con confirmación accesible.
  - Agenda y Mis citas muestran el estado del adelanto y el saldo.
  Reglas de la constitución (IX y accesibilidad de 001–004): 360 px y escritorio, tema claro y oscuro, todo con
  teclado, foco visible, mensajes con `role="status"` o `role="alert"`, y revisión manual con axe DevTools.
- **Alternativa descartada:** mostrar el pago dentro del diálogo de confirmación de la reserva: con el QR, el
  formulario y la cuenta regresiva no cabe a 360 px y se pierde al cerrarlo.
