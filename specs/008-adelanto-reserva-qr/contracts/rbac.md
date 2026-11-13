# Matriz de permisos de 008 (rol × ruta)

✓ permitido · ✗ denegado (403 `ACCESO_DENEGADO`, o 404 `NO_ENCONTRADO` cuando la cita no es del cliente, para no
revelar que existe) · — no aplica. La barbería sale siempre del token (principio III). El token de la plataforma
responde 401 en todas estas rutas (ADR-031). La prueba `rbac-008.spec.ts` lee esta tabla y ejecuta cada celda
(PR08), como `rbac-004`.

| Ruta                                       | PROPIETARIO | BARBERO | CLIENTE                                        | Sin sesión | Plataforma | Módulo   |
| ------------------------------------------ | ----------- | ------- | ---------------------------------------------- | ---------- | ---------- | -------- |
| `GET /barberia/adelanto`                   | ✓           | ✗       | ✗                                              | ✗ (401)    | ✗ (401)    | M03      |
| `PUT /barberia/adelanto`                   | ✓           | ✗       | ✗                                              | ✗ (401)    | ✗ (401)    | M03      |
| `PUT /barberia/adelanto/qr`                | ✓           | ✗       | ✗                                              | ✗ (401)    | ✗ (401)    | M03      |
| `GET /barberia/adelanto/qr`                | ✓           | ✗       | ✗                                              | ✗ (401)    | ✗ (401)    | M03      |
| `POST /citas` (con adelanto activo)        | ✓ (sin adelanto, nace CONFIRMADA) | ✗ | ✓ (nace PENDIENTE con adelanto)         | ✗ (401)    | ✗ (401)    | M02      |
| `GET /citas/{id}/adelanto`                 | ✓ (cualquier cita de su barbería) | ✗ | ✓ (solo su cita; otra → 404)            | ✗ (401)    | ✗ (401)    | M03      |
| `GET /citas/{id}/adelanto/qr`              | ✓           | ✗       | ✓ (solo su cita, mientras esté POR_PAGAR o POR_REVISAR; si no → 404) | ✗ (401) | ✗ (401) | M03 |
| `POST /citas/{id}/adelanto/pago`           | ✗           | ✗       | ✓ (solo su cita; otra → 404)                   | ✗ (401)    | ✗ (401)    | M03      |
| `GET /citas/{id}/adelanto/captura`         | ✓           | ✗       | ✓ (solo su cita; otra → 404)                   | ✗ (401)    | ✗ (401)    | M03      |
| `POST /citas/{id}/adelanto/confirmacion`   | ✓           | ✗       | ✗                                              | ✗ (401)    | ✗ (401)    | M02      |
| `POST /citas/{id}/adelanto/rechazo`        | ✓           | ✗       | ✗                                              | ✗ (401)    | ✗ (401)    | M03      |
| `POST /citas/{id}/adelanto/devolucion`     | ✓           | ✗       | ✗                                              | ✗ (401)    | ✗ (401)    | M03      |
| `GET /adelantos/por-revisar`               | ✓           | ✗       | ✗                                              | ✗ (401)    | ✗ (401)    | M02      |

**Cambios a rutas existentes (002 y 004):**

| Ruta                                  | Cambio                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /citas/{id}/reprogramar`        | Con la cita PENDIENTE: el CLIENTE recibe 409 `ADELANTO_PENDIENTE`; el PROPIETARIO sí puede (R11)     |
| `POST /citas/{id}/cancelar`           | Sin cambio de permisos; deja el adelanto ANULADO, POR_DEVOLVER o RETENIDO (R10)                      |
| `POST /citas/{id}/estado` (no asistió) | Sin cambio de permisos; deja el adelanto RETENIDO                                                    |
| `POST /citas/{id}/estado` (aprobar, destino CONFIRMADA) | En una cita con adelanto, **409 `ADELANTO_PENDIENTE`** para el PROPIETARIO y el BARBERO: se confirma solo con `POST /citas/{id}/adelanto/confirmacion`, que exige un pago registrado (decisión del responsable del 2026-11-12, análisis de 008, hallazgo P1). Sin adelanto, igual que en 002 |
| Agenda y historial del cliente        | Sin cambio de permisos; muestran el estado del adelanto y el saldo (el barbero ve el estado, no el número) |

**Operaciones nuevas de la matriz de autorización** (`Permisos` de M03 y de M02): `CONFIGURAR_ADELANTO`,
`REVISAR_ADELANTO` (confirmar, rechazar, bandeja, marcar devuelto) — solo PROPIETARIO — y `PAGAR_ADELANTO` —
solo CLIENTE, además de ser el cliente de la cita. Ver la cita usa las operaciones de 002; ver su adelanto, su QR
y su captura (`GET /citas/{id}/adelanto*`, rutas de M03) usa `VER_ADELANTO` — PROPIETARIO y CLIENTE, este solo el de
su cita —, con las mismas celdas de la tabla de arriba (agregada en la fase 3 de 008: ninguna operación de 002 tiene
esos dos roles y M03 no usa la matriz de M02).
