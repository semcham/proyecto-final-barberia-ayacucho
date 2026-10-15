# Guía rápida de validación: funcionalidad 001

Cómo levantar el entorno y comprobar, de punta a punta, que la funcionalidad cumple la
[especificación](spec.md). Contrato: [contracts/openapi.yaml](contracts/openapi.yaml). Permisos:
[contracts/rbac.md](contracts/rbac.md). Datos: [data-model.md](data-model.md).

Todas las rutas son relativas a `tecnologia/plataforma-barberias/`.

## 1. Requisitos previos

- Docker Desktop con Docker Compose v2.
- Node.js 22 LTS (solo para ejecutar las pruebas fuera de contenedores).
- Puertos libres: 5432 (PostgreSQL), 3000 (backend), 5173 (frontend).

## 2. Levantar el entorno

```powershell
cd tecnologia/plataforma-barberias
Copy-Item .env.example .env      # completar claves JWT de desarrollo (ver comentarios del archivo)
docker compose up -d --build
docker compose exec backend npm run migrate     # aplica migraciones como barberias_owner
```

Esperado: `GET http://localhost:3000/api/v1/salud` → `200 {"estado":"ok"}`; la aplicación web
abre en `http://localhost:5173`.

## 3. Ejecutar las pruebas

```powershell
cd tecnologia/plataforma-barberias/backend
npm ci
npm run test            # unitarias de dominio (sin base)
npm run test:int        # integración y contrato HTTP con PostgreSQL en Testcontainers
npm run test:arch       # PR14: matriz de módulos y regla de capas
cd ../frontend
npm ci
npm run test            # formularios y manejo de sesión
```

Esperado: todo en verde. Suites obligatorias que deben aparecer en el informe:
`aislamiento-tenant (PR09)`, `autenticacion (PR07)`, `rbac (PR08)`, `entradas (PR10)`,
`limite-intentos (PR12)`, `auditoria (PR13)`, `arquitectura (PR14)`.

## 4. Escenarios manuales

Se pueden hacer desde la aplicación web o con cualquier cliente HTTP contra
`http://localhost:3000/api/v1`.

| # | Escenario (historia) | Pasos | Resultado esperado |
| - | -------------------- | ----- | ------------------ |
| 1 | Registro con prueba gratuita (HU02) | En `/registro`, crear "Barbería Huamanga" con un correo nuevo | Entra directo a su espacio; `GET /auth/yo` da rol `PROPIETARIO`; la respuesta del registro trae `suscripcion.estado = TRIAL` y `venceEn` a 14 días. Ningún paso pide tarjeta |
| 2 | Correo repetido | Repetir el registro con el mismo correo | 409 `CORREO_NO_DISPONIBLE`, sin nombre de barbería |
| 3 | Inicio de sesión (HU05) | Cerrar sesión y entrar en `/ingresar` | 200 con `tokenAcceso`; cookie `rt` HttpOnly |
| 4 | Mensaje genérico | Entrar con correo inexistente y luego con contraseña errada | Ambos 401 `CREDENCIALES_INVALIDAS` con el mismo cuerpo |
| 5 | Límite de intentos (EQ-12) | 6 intentos fallidos en menos de 1 min | El sexto da 429 con `Retry-After`; otra cuenta entra sin problema |
| 6 | Crear personal (HU04) | Como propietario, en `/app/usuarios` crear un BARBERO; intentar crear otro con rol `PROPIETARIO` | El primero 201 con enlace de activación y estado `PENDIENTE`; el segundo 400 `VALIDACION` |
| 7 | Activación | Abrir el enlace del barbero y fijar contraseña; reutilizar el enlace | Primera vez 204; segunda vez 400 `ENLACE_INVALIDO` |
| 8 | Permisos por rol (EQ-08) | Iniciar sesión como barbero y llamar `POST /usuarios` | 403 `ACCESO_DENEGADO`; aparece `ACCESO_DENEGADO_ROL` en `audit_log` |
| 9 | Cierre de sesión (SC-004) | Guardar el `tokenAcceso`, cerrar sesión y reutilizarlo en `GET /auth/yo` | 401 inmediato, aunque el token no haya vencido |
| 10 | Desactivación | El propietario desactiva al barbero mientras este tiene sesión | La siguiente solicitud del barbero da 401 y no puede volver a entrar (403 `ACCESO_SUSPENDIDO`) |
| 11 | Autoprotección | El propietario intenta desactivarse a sí mismo | 422 `OPERACION_NO_PERMITIDA` |
| 12 | Límite del plan | Crear usuarios hasta superar 5 en total | 403 `SUSCRIPCION_NO_PERMITE`, `motivo = LIMITE_USUARIOS` |
| 13 | Aislamiento (EQ-09) | Registrar "Barbería B" con un usuario. Con el token del propietario de A: `GET /usuarios/{id de B}`, `PATCH` del mismo id, y `POST /usuarios` con `"tenantId": "<id de B>"` en el cuerpo | 404, 404 y 400 respectivamente; los datos de B no cambian; `GET /usuarios` de A no muestra a nadie de B |
| 14 | RLS en la base | `docker compose exec db psql -U barberias_app -d barberias -c "select count(*) from membership"` | `0` (sin contexto de tenant, RLS no deja ver filas) |

## 5. Criterios de cierre

- Escenarios 1–14 conformes.
- Suites de la sección 3 en verde en CI (GitHub Actions bloquea la fusión si fallan).
- Documentos actualizados en el mismo cambio: caso especial de funciones de autenticación (`docs/02-arquitectura-software/multi-tenancy-y-datos.md`), librerías elegidas
  (`docs/02-arquitectura-software/tecnologias.md`) y `docs/trazabilidad.md`.
