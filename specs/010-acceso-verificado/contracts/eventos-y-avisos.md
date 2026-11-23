# Contrato: eventos de M01 a M05 y avisos de la cuenta (010)

Complementa `specs/004-notificaciones-reprogramacion/contracts/eventos.md` y `notification-channel.md`. Todo pasa por la
salida de eventos de ADR-025 y el puerto `NotificationChannel` de ADR-026. **Ningún evento, aviso ni registro contiene el
token, la dirección completa del enlace ni la contraseña** (research R02).

## 1. Eventos

### `EnlaceDeCuentaSolicitado` (M01)

- **Cuándo**: al registrar un cliente (`VERIFICAR_CORREO`), al pedir el reenvío (`VERIFICAR_CORREO`) y al pedir la
  recuperación con una cuenta que puede recuperarse (`RECUPERAR_CONTRASENA`). En la misma transacción que crea la fila de
  `account_link` (data-model §2).
- **Tenant**: el del enlace (research R03).
- **Payload**: `{ enlaceId: uuid, proposito: 'VERIFICAR_CORREO' | 'RECUPERAR_CONTRASENA', usuarioId: uuid, venceEn: ISO-8601 }`.
- **Clave de reemplazo**: `enlace:<usuarioId>:<proposito>`: un evento pendiente se reemplaza por el más nuevo.

### `ContrasenaCambiada` (M01)

- **Cuándo**: después de que `auth_restablecer_contrasena` tuvo efecto.
- **Tenant**: el del enlace usado. **Payload**: `{ usuarioId: uuid, cambiadaEn: ISO-8601 }`.

## 2. Avisos (M05)

| Tipo | Destinatario | Canal | Descarte | Contenido (texto simple) |
| --- | --- | --- | --- | --- |
| `VERIFICAR_CORREO` | `CUENTA` (`user_id`) | Siempre correo | Al vencer el enlace | Nombre de la barbería, el enlace `URL_PUBLICA/verificar#<token>`, su vigencia (24 h) y "si no fuiste tú, ignora este correo" |
| `RECUPERAR_CONTRASENA` | `CUENTA` | Siempre correo | Al vencer el enlace | El enlace `URL_PUBLICA/restablecer#<token>`, su vigencia (1 h) y "si no lo pediste, ignora este correo; tu contraseña no cambia" |
| `CONTRASENA_CAMBIADA` | `CUENTA` | Siempre correo | 24 h | Fecha y hora del cambio, que se cerraron sus sesiones y qué hacer si no fue la persona (pedir otra recuperación) |

- **Al enviar** `VERIFICAR_CORREO` o `RECUPERAR_CONTRASENA`, M05 llama a `CuentasApi.emitirToken(enlaceId)`. Si el enlace ya
  no está vigente (usado, anulado o vencido), M01 no emite nada y el aviso se **descarta** sin enviar.
- **Reintentos**: los de la política de 004. Cada reintento pide un token nuevo (el anterior deja de servir).
- **Datos del mensaje** (principio VII, con la ampliación de la enmienda 1.8.0): nombre de la barbería, el enlace de la
  cuenta y su vigencia. Nunca el correo de la persona en el cuerpo, la contraseña, teléfonos ni datos de citas.

## 3. Interfaz pública nueva de M01 (`CuentasApi`, en `acceso-barberias/index.ts`)

| Método | Para quién | Regla |
| --- | --- | --- |
| `correoVerificado(usuarioId)` | Host (guard de R05) | En el tenant del token; `false` si la cuenta no es visible |
| `correoDeCuenta(usuarioId)` | M05 al enviar | En el tenant del aviso; el correo solo se usa como destino |
| `emitirToken(enlaceId)` | M05 al enviar | Devuelve el token en memoria y guarda su hash; `null` si el enlace no está vigente |

## 4. Aviso existente que se comprueba (sin cambios de código)

- `ADELANTO_SOLICITADO` al cliente **ya** incluye `URL_PUBLICA/mis-citas/<citaId>/adelanto`
  (`notificaciones/application/enviar-avisos.ts:252-257`). Se agrega una prueba de contrato que lo fija (FR-030); la
  interfaz lo atiende sin sesión con la pantalla de US4.
