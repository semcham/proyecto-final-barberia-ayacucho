# Matriz rol × operación de la funcionalidad 002

Amplía la [matriz de 001](../../001-registro-acceso-barberia/contracts/rbac.md) y es la fuente de la
prueba parametrizada **PR08**. Cada celda es un caso.

**Símbolos:**

- ✓ permitido.
- ✓\* permitido solo sobre sus propios recursos (sus citas; o el barbero vinculado a su usuario).
- — denegado: 403 `ACCESO_DENEGADO` y se audita `ACCESO_DENEGADO_ROL`.
- 401: sin token.
- PUB: sin sesión.

**Roles:** PROPIETARIO (administra todo en su barbería), BARBERO (usuario del personal; sus
operaciones ✓\* exigen un barbero vinculado a su usuario) y CLIENTE (rol nuevo, ADR-020).

| Operación                                                    | PUB | PROPIETARIO | BARBERO | CLIENTE |
| ------------------------------------------------------------ | --- | ----------- | ------- | ------- |
| `GET /publico/{slug}`                                        | ✓   | ✓ ¹         | ✓ ¹     | ✓ ¹     |
| `GET /publico/{slug}/horarios`                               | ✓   | ✓ ¹         | ✓ ¹     | ✓ ¹     |
| `POST /clientes/registro`                                    | ✓   | ✓ ²         | ✓ ²     | ✓ ²     |
| `POST /auth/login` (con o sin `barberia`)                    | ✓   | ✓           | ✓       | ✓       |
| `POST /auth/barberia`                                        | 401 | — ³         | — ³     | ✓       |
| `POST /auth/logout`, `GET /auth/yo` (001)                    | 401 | ✓           | ✓       | ✓       |
| `GET /barberia`, `GET /barberia/horario`                     | 401 | ✓           | ✓       | —       |
| `PATCH /barberia`, `PUT /barberia/horario`                   | 401 | ✓           | —       | —       |
| `GET /servicios`, `GET /barberos`                            | 401 | ✓           | ✓       | —       |
| `POST /servicios`, `PATCH /servicios/{id}`                   | 401 | ✓           | —       | —       |
| `POST /barberos`, `PATCH /barberos/{id}`                     | 401 | ✓           | —       | —       |
| `GET`/`PUT /barberos/{id}/disponibilidad`                    | 401 | ✓           | ✓\*     | —       |
| `GET`/`POST /barberos/{id}/bloqueos`, `DELETE …/{bloqueoId}` | 401 | ✓           | ✓\*     | —       |
| `GET /horarios`                                              | 401 | ✓           | —       | ✓       |
| `POST /citas`                                                | 401 | ✓ ⁴         | —       | ✓\* ⁵   |
| `POST /citas/{id}/cancelar`                                  | 401 | ✓ ⁶         | —       | ✓\* ⁷   |
| `POST /citas/{id}/estado`                                    | 401 | ✓           | ✓\* ⁸   | —       |
| `GET /agenda`                                                | 401 | ✓           | ✓\* ⁹   | —       |
| `GET /clientes`, `POST /clientes` (presencial)               | 401 | ✓           | —       | —       |
| `GET /clientes/yo/citas`                                     | 401 | —           | —       | ✓\*     |
| `GET /usuarios`, `POST /usuarios`, … (001)                   | 401 | ✓           | —       | — ¹⁰    |

**Notas:**

1. La vía pública no lee el token aunque llegue (ADR-021): un token de otra barbería no cambia nada.
2. El registro de cliente no depende de la sesión; el correo debe ser nuevo
   (`CORREO_NO_DISPONIBLE` si no lo es).
3. El personal pertenece a una sola barbería (001); no cambia de barbería.
4. Cita presencial con `clienteId` de un cliente de su barbería (con cuenta o presencial).
5. Siempre para sí mismo: el cliente sale de la sesión. Un `clienteId` en el cuerpo da 400
   `VALIDACION`.
6. Nunca queda marcada como tardía (FR-038).
7. Solo hasta la hora de inicio; tardía si `inicio − ahora < antelación mínima`.
8. Solo citas de su barbero vinculado; `COMPLETADA` y `NO_ASISTIO` desde la hora de inicio.
   `CONFIRMADA` (aprobar) solo PROPIETARIO.
9. Sin `barbero`: el suyo. Con el `barbero` de otro: 403.
10. Las operaciones de usuarios de 001 siguen solo para el PROPIETARIO; los clientes no aparecen en
    `GET /usuarios` ni cuentan en el límite del plan.

En todas las celdas ✓ y ✓\* con sesión, un `id` de otra barbería da 404 (PR09). Un recurso propio de
otro cliente o de otro barbero de la misma barbería también da 404 en las celdas ✓\*, para no revelar
que existe.

La matriz se aplica en dos lugares, como en 001 (R22 de 001):

- el `RolesGuard` del host, con `@Roles` por ruta;
- la autorización de cada caso de uso, con `PermisosCatalogoCitas` en el dominio de M02 para sus
  operaciones y `Permisos` de M01 para las de M01.

Una prueba verifica que ambas coinciden con esta tabla.
