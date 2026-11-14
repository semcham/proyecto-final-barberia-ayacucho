# Matriz de permisos de 005 (rol × ruta)

✓ permitido · ✗ denegado (403 `ACCESO_DENEGADO`, auditado como en 001) · la barbería sale siempre del token
(principio III). El token de la plataforma responde 401 en estas rutas (ADR-031). La prueba `rbac-005.spec.ts`
lee esta tabla y ejecuta cada celda (PR08), como `rbac-004` y `rbac-008`.

| Ruta                       | PROPIETARIO                    | BARBERO | CLIENTE                 | Sin sesión | Plataforma | Módulo |
| -------------------------- | ------------------------------ | ------- | ----------------------- | ---------- | ---------- | ------ |
| `POST /asistente/mensajes` | ✓ (asistente del propietario, US3) | ✗   | ✓ (asistente del cliente, US1) | ✗ (401) | ✗ (401) | M04 |
| `GET /reportes`            | ✓                              | ✗       | ✗                       | ✗ (401)    | ✗ (401)    | M04    |

Si US3 se recorta, la celda PROPIETARIO de `POST /asistente/mensajes` pasa a ✗ en esta tabla y en la prueba.

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
| `USAR_ASISTENTE_CLIENTE`     | ✗           | ✗       | ✓       |
| `USAR_ASISTENTE_PROPIETARIO` | ✓           | ✗       | ✗       |
| `VER_REPORTES`               | ✓           | ✗       | ✗       |

**Cambios a rutas existentes:** ninguno.
