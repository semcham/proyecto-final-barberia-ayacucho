# Puerto `NotificationChannel`, adaptadores, simulador de WhatsApp y suite de contrato (ADR-026, Aceptado el 2026-11-04)

## 1. Puerto (M05, `notificaciones/application/ports/notification-channel.ts`)

```text
abstract class NotificationChannel {
  readonly canal: 'CORREO' | 'WHATSAPP'
  enviar(mensaje: MensajeSaliente): Promise<EnvioAceptado>
}

MensajeSaliente = { destino: string, asunto?: string, texto: string, claveIdempotencia: string }
EnvioAceptado   = { referencia: string }

Errores:
  CanalNoDisponible     temporal: tiempo agotado, red, 5xx, 429, circuito abierto  → se reintenta
  DestinatarioInvalido  permanente: correo o número rechazado                      → no se reintenta
```

- `texto` es texto simple (línea de corte 1). `claveIdempotencia` es el `id` del aviso: el correo la usa en `Message-ID` y WhatsApp en el encabezado `Idempotency-Key`.
- El adaptador aplica su **tiempo límite** y el **`Interruptor`** de M06 (5 fallos en 60 s). Con el circuito abierto, lanza `CanalNoDisponible` sin llamar.
- Ningún adaptador registra el texto ni el destino completo: solo el código del error.

## 2. Adaptadores (`notificaciones/infrastructure/`)

| Adaptador                    | Destino                                    | Configuración                                                                                 |
| ---------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `canal-correo-smtp.ts`       | Mailpit en desarrollo y pruebas; SMTP de producción **por verificar** | `SMTP_HOST`, `SMTP_PUERTO`, `SMTP_TLS` (`no`, `starttls` o `implicito`), `SMTP_USUARIO`, `SMTP_CLAVE`, `CORREO_REMITENTE`, `CORREO_TIEMPO_LIMITE_MS` (5000) |
| `canal-whatsapp-simulado.ts` | Simulador por HTTP                         | `WHATSAPP_URL_BASE`, `WHATSAPP_TOKEN`, `WHATSAPP_TIEMPO_LIMITE_MS` (3000)                      |
| (futuro) proveedor real      | Cuando se contrate (R17)                   | Adaptador nuevo y `WHATSAPP_PROVEEDOR`; debe pasar la suite de §4                              |

La elección es por configuración (`WHATSAPP_PROVEEDOR=simulado`), como `PAGOS_PROVEEDOR` en 003. Una regla de PR14 impide importar los adaptadores fuera de `notificaciones/infrastructure/` y de su fábrica.

## 3. Simulador de WhatsApp (`backend/simulador-whatsapp/`, fuera de `src/`)

Proceso aparte con `node:http`. Servicio de Compose `whatsapp-simulado` (64 MB, IP fija). Herramienta de desarrollo y pruebas: **nunca se despliega en producción**, y una regla de PR14 impide que `src/` lo importe.

| Ruta                       | Autenticación          | Qué hace                                                                                         |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `POST /mensajes`           | `Bearer WHATSAPP_TOKEN` | Acepta `{ para, texto }` con `Idempotency-Key`; responde `{ id }`. La misma clave devuelve el mismo `id` sin guardar otro mensaje |
| `GET /mensajes?para=`      | Token de control       | Mensajes recibidos (para las pruebas y la demostración)                                           |
| `POST /control/modo`       | Token de control       | Cambia el comportamiento                                                                          |
| `POST /control/reiniciar`  | Token de control       | Borra los mensajes y vuelve a `normal`                                                            |

**Modos:** `normal`; `lento` (`retardoMs`); `caido` (cierra conexiones, con `duracionMs` opcional); `colgado` (no responde); `rechazar` (400, número inválido); `limite` (429); `fallar_n` (falla los `veces` primeros envíos y después acepta).

`npm run whatsapp:modo -- <modo>` cambia el modo en Compose, como `simulador:modo` en 003.

## 4. Suite de contrato (`test/contract/notification-channel.contract.ts`)

Una sola batería `probarContratoDeCanal(nombre, crear)` que se ejecuta contra:

- `canal-correo-smtp` con **Mailpit en Testcontainers**: los mensajes se verifican con su API HTTP;
- `canal-whatsapp-simulado` con el **simulador arrancado en el proceso de prueba**;
- un proveedor real: **se omite** sin `WHATSAPP_SANDBOX_*` o `SMTP_SANDBOX_*`, igual que `gateway-sandbox` en 003.

| Caso                                    | Resultado esperado                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| Envío normal                            | `EnvioAceptado`; el destino recibe exactamente el texto, con `charset=utf-8` (tildes y ñ) |
| Misma `claveIdempotencia` dos veces     | WhatsApp: un solo mensaje. Correo: el mismo `Message-ID` (Mailpit guarda los dos: se documenta como límite del SMTP) |
| Canal lento más allá del tiempo límite  | `CanalNoDisponible` en ≤ tiempo límite + 200 ms                                        |
| Canal caído o colgado                   | `CanalNoDisponible`                                                                    |
| 5 fallos en 60 s                        | El circuito se abre: el sexto falla al instante, sin llamar                            |
| Destinatario inválido                   | `DestinatarioInvalido` (no se reintenta)                                               |
| 429                                     | `CanalNoDisponible`                                                                    |
| Ningún registro con el texto o el destino | Los registros capturados no contienen el texto ni el destino completo               |
