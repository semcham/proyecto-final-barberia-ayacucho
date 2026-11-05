# Enlaces de acción de la cita (ADR-032, Aceptado el 2026-11-04)

## 1. Formato

```text
token = base64url(datos) "." base64url(HMAC-SHA256(ENLACES_LLAVE, "enlace-accion-v1" || datos))

datos (binario, 62 bytes):
  formato        1 byte   (1)
  tenant         16 bytes (uuid)
  cita           16 bytes (uuid)
  acción         1 byte   (1 CONFIRMAR, 2 REPROGRAMAR, 3 CANCELAR)
  versión cita   4 bytes  (appointment.version al emitirlo)
  vence          8 bytes  (milisegundos UNIX; = hora de inicio de la cita)
  aleatorio      16 bytes (crypto.randomBytes)
```

- **Llave:** `ENLACES_LLAVE`, 32 bytes en base64, solo en `.env`, distinta de las del token de sesión y de TOTP. La cadena fija `enlace-accion-v1` separa este uso de cualquier otro de la misma llave.
- **Rotación:** el byte de formato permite cambiar de llave en el futuro; en 004 hay una sola llave (un cambio de llave invalida los enlaces en curso, que duran como máximo unas horas).
- **Lo que revela:** el tenant y la cita como identificadores opacos. No contiene datos personales.

## 2. Emisión (M05, al enviar el recordatorio)

`EnlacesFirmados.emitir({ tenantId, recursoId: citaId, accion, version, venceEn: inicio })` de M06 genera los tres tokens. **No se guarda nada.** El mensaje lleva `URL_PUBLICA/e#<token>`, con el token en el **fragmento**: el navegador no lo envía al servidor ni en el encabezado `Referer`.

## 3. Verificación y uso (M02, rutas `/enlaces/accion*`)

Orden estricto, **sin leer nada de la base antes del paso 3**:

1. **Límite por IP** (`@Throttle`, 30 por minuto) y **contador de rechazos** en PostgreSQL, con los mismos valores de `login_attempt` (`politica-intentos.ts`): 5 rechazos en 60 s bloquean (429) durante 60 s; cada racha siguiente de 5 duplica la espera, hasta 900 s; el historial es de 24 h.
2. **Firma:** se verifica el HMAC en tiempo constante (`timingSafeEqual`), el formato y que no esté vencido según el reloj del servidor. Si algo falla, se anota el rechazo y se responde `ENLACE_NO_VALIDO`.
3. **Transacción con el tenant del enlace** (`uow.ejecutar(TenantId.de(datos.tenant))`) con `barberias_app` y RLS:
   - se lee la cita por `(tenant, cita)`; si no existe, `ENLACE_NO_VALIDO`;
   - la cita debe tener `version` igual a la del enlace, un estado activo y una hora de inicio futura; si no, `ENLACE_NO_VALIDO`;
   - la acción de la ruta debe ser la del enlace;
   - `GET` devuelve los datos mínimos y **no consume** el enlace (FR-026);
   - `POST` aplica la acción con el mismo caso de uso que la vía con sesión (confirmar, `CancelarCita` como cliente o `ReprogramarCita` como cliente) e **inserta** `appointment_link_use (link_hash = SHA-256(token))` en la **misma transacción**. `23505` → `ENLACE_NO_VALIDO`. Si la acción falla, se revierte todo y el enlace sigue sin usar.
4. **Auditoría** en la barbería de la cita, con la vía `ENLACE` (sin el token).

## 4. Reglas que se derivan

| Caso                                                        | Resultado                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| Segundo uso del mismo enlace (también simultáneo en dos réplicas) | Uno solo tiene efecto; el otro, `ENLACE_NO_VALIDO` (`UNIQUE (link_hash)`) |
| Confirmar y después cancelar con el otro enlace             | Permitido: confirmar no cambia `version`                                  |
| Cancelar o reprogramar (por cualquier vía)                  | `version` sube: todos los enlaces anteriores de la cita dejan de valer    |
| Completar o marcar como no asistió                          | `version` sube: los enlaces dejan de valer                                |
| Pasada la hora de inicio                                    | Vencido                                                                   |
| Token alterado, inventado, con otra cita o de otra barbería | Firma inválida: `ENLACE_NO_VALIDO`, sin leer la base                      |
| Barbería suspendida                                         | Confirmar y cancelar siguen; reprogramar, `SUSCRIPCION_NO_PERMITE`         |

## 5. Datos que se muestran (FR-013, FR-026)

Nombre de la barbería, servicio, nombre visible del barbero, fecha y hora en la hora de la barbería, la acción y, para cancelar, desde cuándo sería tardía. **Nunca** el nombre, el correo ni el teléfono del cliente, ni otras citas.

## 6. Lo que se guarda

| Momento   | Qué se guarda                                                                   | ¿Permite reconstruir el enlace? |
| --------- | ------------------------------------------------------------------------------- | ------------------------------- |
| Emisión   | Nada                                                                            | —                               |
| Uso       | `appointment_link_use`: tenant, cita, acción, SHA-256 del token, fecha          | No: falta la llave y la parte aleatoria, y el SHA-256 no se invierte |
| Rechazo   | `action_link_attempt`: SHA-256 de la IP con sal y fecha                         | No                              |
| Registros | Solo el código del rechazo; el token nunca se escribe (no va en la URL)         | No                              |
