# Matriz rol × operación de la funcionalidad 001

Fuente de la prueba parametrizada **PR08**: cada celda es un caso. ✓ permitido · — denegado (403
`ACCESO_DENEGADO`, se audita) · 401 sin token. PUB = sin sesión. Los roles del personal son solo
PROPIETARIO (administra todo en su barbería) y BARBERO.

| Operación                              | PUB | PROPIETARIO | BARBERO |
| -------------------------------------- | --- | ----------- | ------- |
| `POST /barberias`                      | ✓   | ✓ ¹         | ✓ ¹     |
| `POST /auth/login`                     | ✓   | ✓           | ✓       |
| `POST /auth/refresh` (cookie)          | ✓ ² | ✓           | ✓       |
| `POST /auth/activar`                   | ✓   | ✓           | ✓       |
| `POST /auth/logout`                    | 401 | ✓           | ✓       |
| `GET /auth/yo`                         | 401 | ✓           | ✓       |
| `GET /usuarios`, `GET /usuarios/{id}`  | 401 | ✓           | —       |
| `POST /usuarios` (solo rol BARBERO)    | 401 | ✓ ³         | —       |
| `PATCH /usuarios/{id}`                 | 401 | ✓ ⁴         | —       |
| `POST /usuarios/{id}/activacion`       | 401 | ✓           | —       |

¹ Registrar otra barbería no depende de la sesión; el correo del propietario debe ser nuevo, así que
en la práctica lo hace alguien sin cuenta.
² Requiere la cookie de renovación válida; sin ella, 401.
³ Un `rol` distinto de `BARBERO` en el cuerpo da 400 `VALIDACION`.
⁴ Salvo sobre sí mismo (422 `OPERACION_NO_PERMITIDA`).

En todas las celdas ✓ con sesión, un `id` de otra barbería da 404 (PR09).
