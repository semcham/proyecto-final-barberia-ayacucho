# Diseño de la API REST

Contrato **planificado** entre la aplicación web y el backend (cuarto punto del enfoque SDD). Es un diseño de referencia: las rutas se confirman y se versionan al implementar. Complemento de la documentación núcleo.

## 1. Convenciones

| Tema                    | Convención                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transporte              | HTTPS obligatorio; cuerpos en JSON (UTF-8)                                                                                                                                       |
| Versión                 | Prefijo `/api/v1`                                                                                                                                                                |
| Autenticación           | `Authorization: Bearer <token firmado>`; el token lleva usuario, rol y `tenant_id`                                                                                               |
| Tenant                  | **Siempre** se toma del token; nunca de un parámetro del cliente. La ruta pública del catálogo usa el identificador público de la barbería (`slug`) y se resuelve en el servidor |
| Autorización            | Se valida el rol por endpoint (RBAC) y la pertenencia al tenant (RLS en la base de datos)                                                                                        |
| Errores                 | Formato único: `{ "codigo": "HORARIO_NO_DISPONIBLE", "mensaje": "…", "detalles": [] }` con códigos HTTP 400, 401, 403, 404, 409, 422, 429                                        |
| Paginación              | `?pagina=1&tamano=20`; respuesta con `total`                                                                                                                                     |
| Fechas                  | ISO 8601 con zona horaria (almacenamiento en UTC, presentación en America/Lima)                                                                                                  |
| Idempotencia            | `Idempotency-Key` en creación de citas y pagos; el webhook usa `provider_event_id` único                                                                                         |
| Límites                 | Rate limiting por IP y por usuario (HTTP 429); más estricto en login y asistente                                                                                                 |
| CORS                    | Solo el origen de la aplicación web                                                                                                                                              |
| Webhook                 | Sin token de usuario; se valida la **firma** del proveedor y se rechaza lo no firmado                                                                                            |
| Enlaces de recordatorio | Públicos pero con **token firmado de un solo uso** y vencimiento                                                                                                                 |

## 2. Endpoints por módulo

Roles: **ADM** administrador de la plataforma · **PRO** propietario · **BAR** barbero · **CLI** cliente · **PUB** sin sesión.

### M01 Acceso y barberías

| Método y ruta                         | Propósito                                                                                          | RF         | Roles             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------- | ----------------- |
| `POST /auth/login`                    | Iniciar sesión; con `barberia` (enlace) el cliente entra a esa barbería o se une con su aceptación | RF04, RF05 | PUB               |
| `POST /auth/barberia`                 | Cambiar la sesión del cliente a otra barbería (ADR-020)                                            | RF05       | CLI               |
| `POST /auth/logout`                   | Cerrar sesión                                                                                      | RF04       | Todos             |
| `POST /barberias`                     | Registrar barbería y crear tenant (inicia prueba gratuita)                                         | RF01, RF18 | PUB               |
| `POST /clientes/registro`             | Registrar cliente con consentimiento desde el enlace de la barbería                                | RF05       | PUB               |
| `GET/POST /clientes`                  | Buscar clientes y registrar el cliente presencial (consentimiento verbal)                          | RF05       | PRO               |
| `GET/POST/PATCH /usuarios`            | Gestionar usuarios y roles de la barbería                                                          | RF06       | PRO               |
| `GET/PATCH /barberia`                 | Ver y editar datos comerciales, enlace y antelación de cancelación                                 | RF03       | PRO (BAR lectura) |
| `PATCH /admin/barberias/{id}/estado`  | Activar, suspender o reactivar                                                                     | RF02       | ADM               |
| `PATCH /clientes/yo/notificaciones`   | Cambiar canal (correo o WhatsApp)                                                                  | RF33       | CLI               |
| `POST /clientes/yo/solicitudes-datos` | Pedir acceso, rectificación o eliminación                                                          | RF32       | CLI               |

### M02 Catálogo y citas

| Método y ruta                                              | Propósito                                                                   | RF   | Roles                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | ---- | --------------------- |
| `GET /publico/{slug}`                                      | Catálogo público: barbería, horario, servicios y barberos activos (ADR-021) | RF10 | PUB                   |
| `GET /publico/{slug}/horarios?servicio=&fecha=&barbero=`   | Horarios libres por el enlace, sin sesión (ADR-021)                         | RF11 | PUB                   |
| `GET/PUT /barberia/horario`                                | Horario de atención semanal (M02)                                           | RF03 | PRO (BAR lectura)     |
| `GET/POST /servicios`, `PATCH /servicios/{id}`             | Gestionar servicios (se desactivan, no se eliminan)                         | RF07 | PRO (BAR lectura)     |
| `GET/POST /barberos`, `PATCH /barberos/{id}`               | Gestionar barberos, servicios asignados y vínculo con un usuario            | RF08 | PRO (BAR lectura)     |
| `GET/PUT /barberos/{id}/disponibilidad`                    | Disponibilidad semanal                                                      | RF09 | PRO, BAR (la suya)    |
| `GET/POST /barberos/{id}/bloqueos`, `DELETE …/{bloqueoId}` | Bloqueos (con confirmación si chocan con citas)                             | RF09 | PRO, BAR (los suyos)  |
| `GET /horarios?servicio=&fecha=&barbero=`                  | Horarios libres con sesión (mismo cálculo que la vía pública)               | RF11 | CLI, PRO              |
| `POST /citas`                                              | Reservar sin duplicados (`Idempotency-Key` obligatoria)                     | RF12 | CLI, PRO (presencial) |
| `POST /citas/{id}/cancelar`                                | Cancelar liberando el horario; tardía según la antelación                   | RF14 | CLI (las suyas), PRO  |
| `POST /citas/{id}/estado`                                  | Transición válida: aprobar, completar o no asistió                          | RF15 | BAR (las suyas), PRO  |
| `GET /agenda?fecha=&barbero=`                              | Agenda del día con marcas de conflicto y cancelación tardía                 | RF16 | BAR (la suya), PRO    |
| `GET /clientes/yo/citas?pagina=&tamano=`                   | Historial del cliente en la barbería de su sesión                           | RF17 | CLI                   |
| `POST /recordatorios/{token}/responder`                    | Confirmar, reprogramar o cancelar con enlace firmado de un solo uso         | RF34 | PUB (token)           |

### M03 Suscripciones y pagos

| Método y ruta                     | Propósito                                             | RF   | Roles     |
| --------------------------------- | ----------------------------------------------------- | ---- | --------- |
| `GET /suscripcion`                | Estado, fechas y funciones del plan                   | RF19 | PRO       |
| `POST /suscripcion/cambio-plan`   | Contratar o cambiar de plan                           | RF20 | PRO       |
| `PATCH /admin/suscripciones/{id}` | Suspender o reactivar                                 | RF22 | ADM       |
| `POST /pagos`                     | Iniciar pago de la suscripción (sin datos de tarjeta) | RF23 | PRO       |
| `GET /pagos`                      | Historial de transacciones                            | RF25 | PRO       |
| `POST /webhooks/pagos`            | Confirmación del proveedor (firma + idempotencia)     | RF24 | Proveedor |

### M04 Asistente IA y reportes · M06 Núcleo

| Método y ruta                       | Propósito                                     | RF         | Roles    |
| ----------------------------------- | --------------------------------------------- | ---------- | -------- |
| `POST /asistente/mensajes`          | Consulta al asistente (herramientas cerradas) | RF27, RF28 | CLI, PRO |
| `GET /reportes/citas?desde=&hasta=` | Reporte por período                           | RF29       | PRO      |
| `GET /admin/indicadores`            | Indicadores agregados de uso                  | RF31       | ADM      |
| `GET /admin/auditoria`              | Auditoría de acciones sensibles               | RF31       | ADM      |
| `GET /salud`                        | Estado del servicio (balanceador y monitoreo) | RC         | PUB      |

Las notificaciones (M05) no exponen endpoints propios: se disparan por eventos y por el recordatorio programado del día de la cita.

## 3. Reglas de contrato

- Una operación rechazada por plan o estado de suscripción responde `403` con código `SUSCRIPCION_NO_PERMITE`.
- Una reserva en conflicto responde `409` con código `HORARIO_NO_DISPONIBLE` (lo garantiza la restricción de exclusión en PostgreSQL); si el cliente ya tiene otra cita activa que se solapa, `409` `CITA_SOLAPADA_DEL_CLIENTE`.
- **`Idempotency-Key` en `POST /citas` (R09 de 002):** obligatoria, en formato UUID. La interfaz la genera al abrir la confirmación y la reutiliza en cada reintento. Un reintento con la misma clave y el mismo contenido devuelve `200` con la cita ya creada; la misma clave con otro contenido responde `422` `IDEMPOTENCIA_CONFLICTO`. La clave es por autor.
- Los cambios del catálogo que chocan con citas activas (bloqueo, horario o disponibilidad reducidos, servicio o barbero desactivado) responden `409` `CONFLICTO_CON_CITAS` con la lista de citas afectadas, sin datos del cliente, y no guardan nada; se repiten con `confirmarConflictos: true` (R11 de 002).
- La vía pública (`/publico/*`) solo admite `GET`, no lee el token y responde `404` `BARBERIA_NO_DISPONIBLE` igual para un enlace inexistente, cambiado o suspendido (ADR-021).
- El contrato completo de cada funcionalidad está en `specs/<funcionalidad>/contracts/openapi.yaml`; esta tabla es el resumen.
- El asistente nunca devuelve datos de otro tenant; sus herramientas son las mismas operaciones de arriba con el rol del usuario.
