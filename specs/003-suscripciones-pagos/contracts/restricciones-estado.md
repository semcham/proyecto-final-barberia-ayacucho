# Restricciones por estado de la suscripción (FR-006, FR-007)

Fuente única de `PoliticaDeOperacion` (dominio de M03). La prueba de integración
`restricciones-estado` lee las dos tablas, fila por fila y estado por estado. Una acción o un caso de
uso nuevo sin fila hace fallar la prueba.

## 1. Acciones por estado

| Acción                | TRIAL | ACTIVE | PAST_DUE | EXPIRED | CANCELLED | SUSPENDED |
| --------------------- | ----- | ------ | -------- | ------- | --------- | --------- |
| `RESERVAR`            | ✓     | ✓      | ✓        | ✗       | ✗         | ✗         |
| `GESTIONAR_CITAS`     | ✓     | ✓      | ✓        | ✓       | ✓         | ✓         |
| `CONFIGURAR_CATALOGO` | ✓     | ✓      | ✓        | ✗       | ✗         | ✗         |
| `GESTIONAR_USUARIOS`  | ✓     | ✓      | ✓        | ✗       | ✗         | ✗         |
| `PAGAR`               | ✓     | ✓      | ✓        | ✓       | ✓         | ✓         |

✗ responde 403 `SUSCRIPCION_NO_PERMITE` con `detalles: [{ estado, accion }]` y un mensaje propio:
"Esta barbería no acepta reservas por ahora" (`RESERVAR`) o "Tu suscripción no permite este cambio"
(el resto). Nunca "horario no disponible".

Las lecturas (catálogo, agenda, historial, citas, usuarios y suscripción) no se restringen en ningún
estado. Una barbería **suspendida por el administrador** (tenant `SUSPENDIDA`, FR-034) no llega a
esta tabla: sus usuarios no pueden iniciar sesión (001).

## 2. Casos de uso que llaman a `SuscripcionesApi.exigirOperacion`

| Caso de uso                                                | Módulo          | Acción                |
| ---------------------------------------------------------- | --------------- | --------------------- |
| `ReservarCita` (cliente y presencial)                      | M02 `citas`     | `RESERVAR`            |
| `ReprogramarCita` (cliente y propietario; agregada por 004) | M02 `citas`     | `RESERVAR`            |
| `CancelarCita`                                             | M02 `citas`     | `GESTIONAR_CITAS`     |
| `CambiarEstadoCita`                                        | M02 `citas`     | `GESTIONAR_CITAS`     |
| `CrearServicio`, `ActualizarServicio`                      | M02 `catalogo`  | `CONFIGURAR_CATALOGO` |
| `CrearBarbero`, `ActualizarBarbero`                        | M02 `catalogo`  | `CONFIGURAR_CATALOGO` |
| `ReemplazarHorarioAtencion`, `ReemplazarDisponibilidad`    | M02 `catalogo`  | `CONFIGURAR_CATALOGO` |
| `CrearBloqueo`, `EliminarBloqueo`                          | M02 `catalogo`  | `CONFIGURAR_CATALOGO` |
| `CrearUsuario`, `ActualizarUsuario`, `RegenerarActivacion` | M01 `identidad` | `GESTIONAR_USUARIOS`  |
| `ConfirmarAdelanto` (agregada por 008)                     | M02 `citas`     | `GESTIONAR_CITAS`     |
| `RechazarPagoDeAdelanto` (agregada por 008)                | M03 `adelantos` | `GESTIONAR_CITAS`     |
| `ConfigurarAdelanto` (agregada por 008)                    | M03 `adelantos` | `CONFIGURAR_CATALOGO` |
| `MarcarAdelantoDevuelto` (agregada por 008)                | M03 `adelantos` | `GESTIONAR_CITAS`     |

`CancelarCita` y `CambiarEstadoCita` también llaman a `exigirOperacion` (con `GESTIONAR_CITAS`, que
hoy es ✓ en todos los estados). Así, la prueba de arquitectura exige la llamada en **todo** caso de
uso de escritura listado, y un cambio futuro de la política no necesita tocar M02.

**Nota (004):** la fila `ReprogramarCita` la agregó la funcionalidad 004 (T051): reprogramar toma una hora
nueva, así que exige `RESERVAR` como una reserva (specs/004-notificaciones-reprogramacion/contracts/rbac.md,
US1-7). La prueba de arquitectura `operaciones-con-politica` y la de integración `restricciones-estado` la
recorren como a las demás.

**Nota (008, adelanto de reserva con QR; research R12 de 008):** las filas `ConfirmarAdelanto`,
`RechazarPagoDeAdelanto` y `ConfigurarAdelanto` las agregó la funcionalidad 008 (T044), y `MarcarAdelantoDevuelto`
en su fase 6 (T057). Confirmar o rechazar el pago de un adelanto, y marcarlo devuelto, es gestionar una cita ya
reservada (`GESTIONAR_CITAS`): con la suscripción vencida o suspendida, el propietario sigue resolviendo las pendientes
y devolviendo adelantos, mientras la reserva nueva queda bloqueada. Configurar el adelanto (activarlo, cambiarlo o subir
el QR) es configuración, como el catálogo (`CONFIGURAR_CATALOGO`). El registro del pago del cliente
(`RegistrarPagoDeAdelanto`) **no** se restringe: completa una reserva ya aceptada.
