# Matriz de permisos de 007 (rol × ruta)

✓ permitido · ✗ denegado (403 `ACCESO_DENEGADO`, auditado como en 001) · la barbería sale siempre del token
(principio III). En las rutas de barbería, el token de la plataforma responde 401; en la ruta de la plataforma,
cualquier token de barbería responde 401 (ADR-031). La prueba `rbac-007.spec.ts` lee esta tabla y ejecuta cada
celda (PR08), como `rbac-005`.

| Ruta | PROPIETARIO | BARBERO | CLIENTE | Sin sesión | Plataforma | Módulo |
| ---- | ----------- | ------- | ------- | ---------- | ---------- | ------ |
| `POST /datos-personales/solicitudes` | ✗ | ✓ | ✓ | ✗ (401) | ✗ (401) | M01 |
| `GET /datos-personales/solicitudes/mias` | ✗ | ✓ | ✓ | ✗ (401) | ✗ (401) | M01 |
| `GET /datos-personales/solicitudes` | ✓ | ✗ | ✗ | ✗ (401) | ✗ (401) | M01 |
| `POST /datos-personales/solicitudes/en-nombre` | ✓ | ✗ | ✗ | ✗ (401) | ✗ (401) | M01 |
| `POST /datos-personales/solicitudes/{id}/atencion` | ✓ | ✗ | ✗ | ✗ (401) | ✗ (401) | M01 |
| `POST /datos-personales/solicitudes/{id}/cierre` | ✓ | ✗ | ✗ | ✗ (401) | ✗ (401) | M01 |
| `GET /plataforma/indicadores` | ✗ (401) | ✗ (401) | ✗ (401) | ✗ (401) | ✓ | M01 (con fuentes de M01, M02 y M03 por el registro de M06) |

**Notas:**

- El **propietario no registra solicitudes sobre su propia cuenta** (FR-005, fuera de 007). Por eso tiene ✗ en
  las dos primeras filas. "En nombre de" solo admite a un cliente de su barbería.
- El barbero y el cliente ven solo **sus** solicitudes. Con el id de otra, la respuesta es 404, igual que si no
  existiera.
- El administrador de la plataforma no tiene ninguna ruta de solicitudes (regla `solicitudes-datos-sin-plataforma`
  de PR14).

**Operaciones nuevas de la matriz de M01** (`Permisos`):

| Operación | PROPIETARIO | BARBERO | CLIENTE |
| --------- | ----------- | ------- | ------- |
| `REGISTRAR_SOLICITUD_DATOS` | ✗ | ✓ | ✓ |
| `VER_MIS_SOLICITUDES_DATOS` | ✗ | ✓ | ✓ |
| `ATENDER_SOLICITUDES_DATOS` | ✓ | ✗ | ✗ |
| `REGISTRAR_SOLICITUD_DATOS_EN_NOMBRE` | ✓ | ✗ | ✗ |

**Cambios a rutas existentes:** ninguno.

**Estado de la suscripción:** las operaciones de esta tabla valen en **todos** los estados (es un derecho del
titular). No se agregan a §2 de `specs/003-suscripciones-pagos/contracts/restricciones-estado.md`.
