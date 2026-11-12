# Eventos del adelanto (008) sobre el bus de 004

Mismo bus, misma salida transaccional y mismo despacho que 004
([contracts/eventos.md de 004](../../004-notificaciones-reprogramacion/contracts/eventos.md)). Cada evento se
publica con `BusDeEventos.publicar` **en la misma transacción** que la operación que lo origina (si se revierte,
no hay evento). El tenant es el de la transacción. El `payload` lleva solo lo que el mensaje necesita: **nunca**
el número de operación, la captura, el QR, teléfonos ni correos (FR-024); M05 lee el contacto de M01 al enviar.

## 1. Catálogo

| Tipo                       | Publica | Cuándo                                                        | `payload`                                                                                         |
| -------------------------- | ------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AdelantoSolicitado`       | M03     | Al crear el adelanto en la reserva (M02 → `AdelantosApi.crear`) | `citaId, clienteId, servicio, inicio, zonaHoraria, montoCentimos, codigo, horaLimite`             |
| `PagoDeAdelantoRegistrado` | M03     | El cliente registra su pago                                   | `citaId, servicio, inicio, zonaHoraria, montoCentimos, codigo, limiteRevision`                    |
| `AdelantoConfirmado`       | M02     | El propietario confirma (la cita pasa a CONFIRMADA)           | `citaId, version, clienteId, servicio, barbero, inicio, fin, zonaHoraria, montoCentimos, saldoCentimos` |
| `PagoDeAdelantoRechazado`  | M03     | El propietario rechaza el pago                                | `citaId, clienteId, servicio, inicio, zonaHoraria, montoCentimos, codigo, horaLimite, motivo`     |
| `AdelantoVencido`          | M02     | La tarea cancela la cita (sin pago, o límite máximo alcanzado) | `citaId, clienteId, servicio, inicio, zonaHoraria, montoCentimos, codigo, causa (SIN_PAGO o SIN_REVISION), porDevolver` |

`AdelantoConfirmado` lo publica M02 porque es la transición de la cita; lleva el `version` de la cita, como
`CitaCreada` de 004.

## 2. Cambios en eventos de 004

- Una reserva **con adelanto** no publica `CitaCreada` ni programa `RecordatorioDeCita`: los reemplaza
  `AdelantoSolicitado`, y el recordatorio se programa al confirmar si faltan 2 h o más (research R08). Sin
  adelanto, la reserva publica lo mismo que en 004.
- El vencimiento publica `AdelantoVencido` en lugar de `CitaCancelada`.
- `CitaCancelada` suma el campo opcional `adelanto` (`POR_DEVOLVER` o `RETENIDO`); la plantilla lo menciona
  (US5-2). Sin adelanto, el evento no cambia.

## 3. Destinatarios que crea M05

| Evento                     | Cliente (canal elegido) | Propietario (correo) | Barbero |
| -------------------------- | ----------------------- | -------------------- | ------- |
| `AdelantoSolicitado`       | ✓                       | —                    | —       |
| `PagoDeAdelantoRegistrado` | —                       | ✓                    | —       |
| `AdelantoConfirmado`       | ✓                       | —                    | —       |
| `PagoDeAdelantoRechazado`  | ✓                       | —                    | —       |
| `AdelantoVencido`          | ✓                       | ✓                    | —       |

Los avisos son únicos por `(evento, destinatario)` (004, FR-012). El plazo de un aviso del adelanto es el de los
avisos que no son recordatorio: creación + 24 h. Tipos de aviso (`notification.kind`, migración 0030):
`ADELANTO_SOLICITADO`, `PAGO_ADELANTO_REGISTRADO`, `ADELANTO_CONFIRMADO`, `PAGO_ADELANTO_RECHAZADO` y
`ADELANTO_VENCIDO`.

## 4. Contenido de los mensajes (texto simple)

- **Instrucciones de pago** (cliente): barbería, servicio, fecha y hora, monto, código de la reserva ("escríbelo
  en el mensaje del pago"), hora límite y que el QR está en "Mis citas".
- **Comprobante por revisar** (propietario): servicio, fecha y hora, monto, código y hasta cuándo puede revisarlo;
  sin el número ni la captura (los ve en la bandeja).
- **Adelanto confirmado** (cliente): la cita quedó confirmada, con el adelanto y el saldo a pagar el día de la
  cita.
- **Pago rechazado** (cliente): el motivo y la hora límite para registrar otro número.
- **Adelanto vencido** (cliente y propietario): la cita se canceló y el horario quedó libre; con `porDevolver`,
  que la barbería debe devolver el adelanto si lo recibió.
