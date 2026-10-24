# Matriz de permisos de 003 (PR08)

Cada celda es un caso de la prueba `test/contract/rbac-003.spec.ts`, que lee esta tabla.

- **✓** permitido.
- **✗** 403 con `ACCESO_DENEGADO`.
- **401** el token no sirve para esa ruta: sin token, un token de plataforma en una ruta de barbería
  o un token de barbería en una ruta de plataforma.
- **pública** la ruta no usa el token: lo ignora.

El administrador (ADMIN) solo tiene token de plataforma (ADR-031).

| Operación                                                                                         | PROPIETARIO | BARBERO    | CLIENTE    | ADMIN   | Anónimo                         |
| ------------------------------------------------------------------------------------------------- | ----------- | ---------- | ---------- | ------- | ------------------------------- |
| `GET /planes`                                                                                     | ✓           | ✗          | ✗          | 401     | 401                             |
| `GET /suscripcion`                                                                                | ✓           | ✗          | ✗          | 401     | 401                             |
| `GET /suscripcion/estado-operativo`                                                               | ✓           | ✓          | ✓          | 401     | 401                             |
| `GET /suscripcion/pagos`                                                                          | ✓           | ✗          | ✗          | 401     | 401                             |
| `POST /suscripcion/pagos`                                                                         | ✓           | ✗          | ✗          | 401     | 401                             |
| `GET /suscripcion/pagos/{id}`                                                                     | ✓           | ✗          | ✗          | 401     | 401                             |
| `POST /suscripcion/pagos/{id}/comprobante`                                                        | ✓           | ✗          | ✗          | 401     | 401                             |
| `GET /suscripcion/pagos/{id}/comprobante`                                                         | ✓           | ✗          | ✗          | 401     | 401                             |
| `POST /pagos/notificaciones`                                                                      | pública     | pública    | pública    | pública | pública (solo con firma válida) |
| `POST /plataforma/auth/ingresar`                                                                  | pública     | pública    | pública    | pública | pública                         |
| `POST /plataforma/auth/segundo-factor`                                                            | pública     | pública    | pública    | pública | pública                         |
| `GET /plataforma/barberias`                                                                       | 401         | 401        | 401        | ✓       | 401                             |
| `PUT, DELETE /plataforma/barberias/{id}/suspension`                                               | 401         | 401        | 401        | ✓       | 401                             |
| `PUT, DELETE /plataforma/barberias/{id}/suscripcion/suspension`                                   | 401         | 401        | 401        | ✓       | 401                             |
| `POST /plataforma/barberias/{id}/activacion-manual`                                               | 401         | 401        | 401        | ✓       | 401                             |
| `GET /plataforma/comprobantes`                                                                    | 401         | 401        | 401        | ✓       | 401                             |
| `GET /plataforma/barberias/{id}/pagos/{pagoId}/comprobante`                                       | 401         | 401        | 401        | ✓       | 401                             |
| `POST /plataforma/barberias/{id}/pagos/{pagoId}/revision`                                         | 401         | 401        | 401        | ✓       | 401                             |
| `GET /plataforma/pagos/por-revisar`                                                               | 401         | 401        | 401        | ✓       | 401                             |
| `POST /plataforma/barberias/{id}/pagos/{pagoId}/revision/resolucion`                              | 401         | 401        | 401        | ✓       | 401                             |
| **Cualquier ruta de 001 y 002 con token** (agenda, citas, clientes, catálogo, usuarios, barbería) | (como hoy)  | (como hoy) | (como hoy) | **401** | (como hoy)                      |

**Alcance además del rol:**

- El pago, el comprobante o la suscripción de otra barbería responden 404 al propietario, igual que
  si no existieran.
- En las rutas `/plataforma/barberias/{id}/…`, un `pagoId` que no es de esa barbería responde 404.
  La escritura corre con el tenant `{id}` fijado y RLS (ADR-031).
