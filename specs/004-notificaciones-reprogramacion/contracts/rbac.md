# Permisos de las rutas de 004 (PR08)

Se suman a las matrices de 001, 002 y 003. La prueba `rbac-004` recorre la tabla completa: cada celda "✓" responde 2xx (o el error de negocio esperado) y cada "✗" responde 403 (o 404 si el recurso es de otra persona, sin revelar que existe).

| Ruta                                          | PROPIETARIO | BARBERO | CLIENTE                | Sin sesión con enlace válido | Plataforma |
| --------------------------------------------- | ----------- | ------- | ---------------------- | ---------------------------- | ---------- |
| `POST /citas/{id}/reprogramar`                | ✓ (cualquier cita de su barbería, sin antelación) | ✗ | ✓ (solo sus citas, con antelación) | ✗ | ✗ |
| `GET /clientes/yo/aviso`                      | ✗           | ✗       | ✓                      | ✗                            | ✗          |
| `PUT /clientes/yo/aviso`                      | ✗           | ✗       | ✓                      | ✗                            | ✗          |
| `DELETE /clientes/yo/aviso/consentimiento-whatsapp` | ✗     | ✗       | ✓                      | ✗                            | ✗          |
| `GET /enlaces/accion`                         | — (no usa el token) | — | —                   | ✓ (cualquier acción)         | —          |
| `POST /enlaces/accion/confirmar`              | —           | —       | —                      | ✓ (solo enlace `CONFIRMAR`)  | —          |
| `POST /enlaces/accion/cancelar`               | —           | —       | —                      | ✓ (solo enlace `CANCELAR`)   | —          |
| `POST /enlaces/accion/reprogramar`            | —           | —       | —                      | ✓ (solo enlace `REPROGRAMAR`) | —         |

Notas:

- **El barbero no reprograma** (supuesto de la especificación: el propietario atiende los imprevistos, HU28 criterio 7). Sigue pudiendo cambiar el estado de sus citas como en 002.
- **Las rutas `/enlaces/accion*` ignoran el token de sesión** aunque llegue: la barbería sale solo del enlace firmado. Un enlace de una acción no sirve para otra (`ENLACE_NO_VALIDO`).
- **El token de plataforma** se rechaza en todas estas rutas (`AuthGuard` de 003).
- **Suscripción:** reprogramar exige `RESERVAR` (`exigirOperacion` de 003). Confirmar y cancelar por enlace son `GESTIONAR_CITAS`, permitido en todos los estados. La prueba `operaciones-con-politica` (PR14) suma `ReprogramarCita` a su lista.
