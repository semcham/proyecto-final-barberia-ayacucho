# Matriz rol × operación de la funcionalidad 001

Fuente de la prueba parametrizada **PR08**: cada celda es un caso. ✓ permitido · — denegado (403
`ACCESO_DENEGADO`, se audita) · 401 sin token. PUB = sin sesión.

| Operación                              | PUB | PROPIETARIO | ADMINISTRATIVO | BARBERO |
| -------------------------------------- | --- | ----------- | -------------- | ------- |
| `POST /barberias`                      | ✓   | ✓ ¹         | ✓ ¹            | ✓ ¹     |
| `POST /auth/login`                     | ✓   | ✓           | ✓              | ✓       |
| `POST /auth/refresh` (cookie)          | ✓ ² | ✓           | ✓              | ✓       |
| `POST /auth/activar`                   | ✓   | ✓           | ✓              | ✓       |
| `POST /auth/logout`                    | 401 | ✓           | ✓              | ✓       |
| `GET /auth/yo`                         | 401 | ✓           | ✓              | ✓       |
| `GET /usuarios`, `GET /usuarios/{id}`  | 401 | ✓           | —              | —       |
| `POST /usuarios`                       | 401 | ✓           | —              | —       |
| `PATCH /usuarios/{id}`                 | 401 | ✓ ³         | —              | —       |
| `POST /usuarios/{id}/activacion`       | 401 | ✓           | —              | —       |

¹ Registrar otra barbería no depende de la sesión; el correo del propietario debe ser nuevo, así que
en la práctica lo hace alguien sin cuenta.
² Requiere la cookie de renovación válida; sin ella, 401.
³ Salvo sobre sí mismo (422 `OPERACION_NO_PERMITIDA`).

En todas las celdas ✓ con sesión, un `id` de otra barbería da 404 (PR09).

**Seguimiento documental**: añadir la columna ADMINISTRATIVO a la matriz de
`docs/02-arquitectura-software/seguridad-y-privacidad.md` §2 (supuesto de la especificación).
