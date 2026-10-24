# Contrato: puerto `PaymentGateway` y simulador de pasarela

Decisiones en [research.md](../research.md) R01 a R03. El simulador está en
`tecnologia/plataforma-barberias/backend/simulador-pagos/`. Corre con `node:http` y `node:crypto`,
fuera del monolito, y nunca se despliega en producción.

## 1. Puerto (M03 `pagos/application/ports/payment-gateway.ts`)

| Operación               | Entrada                                                                              | Salida                                                                                              | Errores                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `crearSesionDePago`     | `pagoId`, `importeCentimos`, `moneda`, `descripcion`, `metodo: 'YAPE'`, `urlRetorno` | `{ referenciaProveedor, urlPago, expiraEn }`                                                        | `ProveedorNoDisponible` (tiempo límite de 2 s, conexión rechazada, 5xx o circuito abierto) |
| `consultarPago`         | `referenciaProveedor`                                                                | `{ estado: APROBADO, RECHAZADO, PENDIENTE o EXPIRADO, importeCentimos, moneda }`                    | `ProveedorNoDisponible`; `PagoDesconocido`                                                 |
| `cancelarSesion`        | `referenciaProveedor`                                                                | `boolean` (si el proveedor lo permitió)                                                             | `ProveedorNoDisponible` (se ignora: la anulación local ya ocurrió)                         |
| `verificarNotificacion` | cuerpo crudo y encabezados                                                           | `NotificacionVerificada { eventoId, tipo, referencia, estado, importeCentimos, moneda, emitidoEn }` | `FirmaInvalida` (falta, no coincide o `t` fuera de ±5 min)                                 |
| `limitesYape`           | —                                                                                    | `{ minimoCentimos, maximoCentimos }`                                                                | —                                                                                          |

**Suite de contrato (PR20):** `test/contract/payment-gateway.contract.ts` exporta
`probarContratoDePasarela(fabrica)`. La ejecutan el simulador (siempre) y el ambiente de pruebas del
proveedor (solo con `PAGOS_SANDBOX_*`). Comprueba:

- crear y consultar;
- aprobar y rechazar;
- cancelar una sesión pendiente;
- la firma válida e inválida;
- un tiempo límite que se traduce en `ProveedorNoDisponible`;
- que el importe consultado sea igual al enviado.

## 2. Protocolo HTTP del simulador

| Método y ruta                                                                    | Uso                                                                                                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/sesiones` (`Authorization: Bearer {PAGOS_LLAVE_SECRETA}`)              | Crear la sesión. Devuelve `{ referencia, url_pago, expira_en }`, con una vida de 30 min                                                   |
| `GET /v1/sesiones/{referencia}` (Bearer)                                         | Estado, importe y moneda                                                                                                                  |
| `POST /v1/sesiones/{referencia}/cancelar` (Bearer)                               | Cancelar si está pendiente                                                                                                                |
| `GET /checkout/{referencia}`                                                     | Página alojada mínima con el importe y los botones Aprobar, Rechazar y Dejar pendiente. Al decidir, redirige a `urlRetorno?pago={pagoId}` |
| `POST /control/modo` (`X-Control: {SIMULADOR_TOKEN_CONTROL}`)                    | Cambiar el comportamiento (§3)                                                                                                            |
| `POST /control/sesiones/{referencia}/{aprobar, rechazar o devolver}` (X-Control) | Decidir sin navegador (pruebas y demos)                                                                                                   |
| `POST /control/reiniciar` (X-Control)                                            | Vaciar el estado                                                                                                                          |

## 3. Comportamientos

| Modo                            | Efecto                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `normal`                        | Responde al instante y notifica una vez al decidir                               |
| `lento` (`retardoMs`)           | Demora las respuestas de la API y las notificaciones                             |
| `caido`                         | Cierra el puerto de la API (conexión rechazada) hasta volver a `normal`          |
| `colgado`                       | Acepta la conexión y no responde (para el tiempo límite)                         |
| `duplicar` (`veces`)            | Envía la misma notificación N veces (mismo `evento_id`)                          |
| `firma_invalida` y `sin_firma`  | Notifica con otra llave o sin el encabezado                                      |
| `fuera_de_orden`                | Envía `APROBADO` y luego un `PENDIENTE` atrasado                                 |
| `importe_distinto`              | Notifica un importe distinto del de la sesión                                    |
| `aprobar_despues` (`retardoMs`) | Aprueba tras el retardo, aunque la plataforma ya haya anulado o expirado el pago |
| `rechazar`                      | Toda sesión se rechaza                                                           |

## 4. Notificación

```http
POST {PAGOS_URL_NOTIFICACIONES}
Content-Type: application/json
X-Firma: t=1793001234,v1=5f2b…(hex)

{"evento_id":"evt_01J…","tipo":"pago.actualizado","referencia":"ses_01J…","estado":"APROBADO",
 "importe_centimos":4900,"moneda":"PEN","emitido_en":"2026-10-24T15:00:00Z"}
```

- **Firma:** `v1` = HMAC-SHA256 en hexadecimal de `"{t}.{cuerpo crudo}"` con `PAGOS_SECRETO_FIRMA`. La
  plataforma la compara en tiempo constante, exige un `t` dentro de ±5 minutos y deduplica por
  `evento_id`.
- **Reintentos:** el simulador repite cada notificación hasta 5 veces, con espera exponencial de 1 a
  16 s, mientras la plataforma no responda 200, como un proveedor real.
- **Sin datos del pagador:** la notificación no lleva el teléfono ni el nombre del pagador. Si un
  proveedor real los enviara, el adaptador los descarta antes de guardar (FR-013b).

## 5. Docker Compose

Servicio `pasarela-simulada`:

- imagen `node:22`, con el volumen de `node_modules` del backend;
- comando `npx tsx simulador-pagos/servidor.ts`;
- puerto 3100;
- 64 MB de memoria;
- IP fija en la red `plataforma`.

Las réplicas usan `PAGOS_URL_BASE=http://{IP del simulador}:3100`. El simulador notifica a
`http://nginx/api/v1/pagos/notificaciones`, así que la notificación entra por el balanceador, como lo
haría la de un proveedor real.
