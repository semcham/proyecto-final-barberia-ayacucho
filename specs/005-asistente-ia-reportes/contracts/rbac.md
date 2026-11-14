# Matriz de permisos de 005 (rol × ruta)

✓ permitido · ✗ denegado (403 `ACCESO_DENEGADO`, auditado como en 001) · la barbería sale siempre del token
(principio III). El token de la plataforma responde 401 en estas rutas (ADR-031). La prueba `rbac-005.spec.ts`
lee esta tabla y ejecuta cada celda (PR08), como `rbac-004` y `rbac-008`.

| Ruta                       | PROPIETARIO                    | BARBERO | CLIENTE                 | Sin sesión | Plataforma | Módulo |
| -------------------------- | ------------------------------ | ------- | ----------------------- | ---------- | ---------- | ------ |
| `POST /asistente/mensajes` | ✓ (asistente del propietario, US3) | ✗   | ✓ (asistente del cliente, US1) | ✗ (401) | ✗ (401) | M04 |
| `GET /reportes`            | ✓                              | ✗       | ✗                       | ✗ (401)    | ✗ (401)    | M04    |

`POST /asistente/mensajes` exige en el `RolesGuard` la operación de ruta `USAR_ASISTENTE`, que tienen CLIENTE y
PROPIETARIO. Después, el caso de uso exige la operación del rol (`USAR_ASISTENTE_CLIENTE` o
`USAR_ASISTENTE_PROPIETARIO`). Así la ruta lleva una sola operación, como todas, y el `RolesGuard` no cambia su
lógica: solo suma la matriz de M04.

Si US3 se recorta, la celda PROPIETARIO de `POST /asistente/mensajes` pasa a ✗ (403 del caso de uso, no del
guardia) en esta tabla y en la prueba.

**Herramientas por rol** (cerradas; ver [asistente.md](asistente.md) §2). Un rol no puede usar las del otro aunque
el modelo las pida: el backend descarta la intención y responde `FUERA_DE_ALCANCE`.

| Herramienta (intención)  | CLIENTE | PROPIETARIO |
| ------------------------ | ------- | ----------- |
| `servicios`              | ✓       | ✗           |
| `barberos`               | ✓       | ✗           |
| `horarios_libres`        | ✓       | ✗           |
| `resumen_citas`          | ✗       | ✓           |
| `servicios_mas_pedidos`  | ✗       | ✓           |

**Operaciones nuevas de la matriz de autorización** (`PermisosAsistenteReportes`, M04):

| Operación                    | PROPIETARIO | BARBERO | CLIENTE |
| ---------------------------- | ----------- | ------- | ------- |
| `USAR_ASISTENTE` (de ruta)   | ✓           | ✗       | ✓       |
| `USAR_ASISTENTE_CLIENTE`     | ✗           | ✗       | ✓       |
| `USAR_ASISTENTE_PROPIETARIO` | ✓           | ✗       | ✗       |
| `VER_REPORTES`               | ✓           | ✗       | ✗       |

**Cambios a rutas existentes:** ninguno.
