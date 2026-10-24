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
| `CancelarCita`                                             | M02 `citas`     | `GESTIONAR_CITAS`     |
| `CambiarEstadoCita`                                        | M02 `citas`     | `GESTIONAR_CITAS`     |
| `CrearServicio`, `ActualizarServicio`                      | M02 `catalogo`  | `CONFIGURAR_CATALOGO` |
| `CrearBarbero`, `ActualizarBarbero`                        | M02 `catalogo`  | `CONFIGURAR_CATALOGO` |
| `ReemplazarHorarioAtencion`, `ReemplazarDisponibilidad`    | M02 `catalogo`  | `CONFIGURAR_CATALOGO` |
| `CrearBloqueo`, `EliminarBloqueo`                          | M02 `catalogo`  | `CONFIGURAR_CATALOGO` |
| `CrearUsuario`, `ActualizarUsuario`, `RegenerarActivacion` | M01 `identidad` | `GESTIONAR_USUARIOS`  |

`CancelarCita` y `CambiarEstadoCita` también llaman a `exigirOperacion` (con `GESTIONAR_CITAS`, que
hoy es ✓ en todos los estados). Así, la prueba de arquitectura exige la llamada en **todo** caso de
uso de escritura listado, y un cambio futuro de la política no necesita tocar M02.
