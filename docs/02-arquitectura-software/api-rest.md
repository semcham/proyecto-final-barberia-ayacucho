# Diseño de la API REST

Contrato entre la aplicación web y el backend (cuarto punto del enfoque SDD). Las rutas de M01, M02 y M03 están **implementadas** (funcionalidades 001, 002, 003 y 006); las de M04, M05 y parte de M01 y M06 siguen **planificadas** y se confirman al implementarlas. Complemento de la documentación núcleo.

## 1. Convenciones

| Tema                    | Convención                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transporte              | HTTPS obligatorio; cuerpos en JSON (UTF-8)                                                                                                                                       |
| Versión                 | Prefijo `/api/v1`                                                                                                                                                                |
| Autenticación           | `Authorization: Bearer <token firmado>`; el token lleva usuario, rol y `tenant_id`                                                                                               |
| Tenant                  | **Siempre** se toma del token; nunca de un parámetro del cliente. La ruta pública del catálogo usa el identificador público de la barbería (`slug`) y se resuelve en el servidor |
| Autorización            | Se valida el rol por endpoint (RBAC) y la pertenencia al tenant (RLS en la base de datos)                                                                                        |
| Errores                 | Formato único: `{ "codigo": "HORARIO_NO_DISPONIBLE", "mensaje": "…", "detalles": [] }` con códigos HTTP 400, 401, 403, 404, 409, 422, 429 y 503 (balanceador sin réplicas, 006)  |
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

| Método y ruta                                      | Propósito                                                                                          | RF         | Roles             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------- | ----------------- |
| `POST /auth/login`                                 | Iniciar sesión; con `barberia` (enlace) el cliente entra a esa barbería o se une con su aceptación | RF04, RF05 | PUB               |
| `POST /auth/barberia`                              | Cambiar la sesión del cliente a otra barbería (ADR-020)                                            | RF05       | CLI               |
| `POST /auth/logout`                                | Cerrar sesión                                                                                      | RF04       | Todos             |
| `POST /barberias`                                  | Registrar barbería y crear tenant (inicia prueba gratuita)                                         | RF01, RF18 | PUB               |
| `POST /clientes/registro`                          | Registrar cliente con consentimiento desde el enlace de la barbería                                | RF05       | PUB               |
| `GET/POST /clientes`                               | Buscar clientes y registrar el cliente presencial (consentimiento verbal)                          | RF05       | PRO               |
| `GET/POST/PATCH /usuarios`                         | Gestionar usuarios y roles de la barbería                                                          | RF06       | PRO               |
| `GET/PATCH /barberia`                              | Ver y editar datos comerciales, enlace y antelación de cancelación                                 | RF03       | PRO (BAR lectura) |
| `PUT/DELETE /plataforma/barberias/{id}/suspension` | Suspender (con motivo) o reactivar la barbería (003, US5)                                          | RF02       | ADM               |
| `PATCH /clientes/yo/notificaciones`                | Cambiar canal (correo o WhatsApp)                                                                  | RF33       | CLI               |
| `POST /clientes/yo/solicitudes-datos`              | Pedir acceso, rectificación o eliminación                                                          | RF32       | CLI               |

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

Implementadas en la funcionalidad 003 ([contrato](../../specs/003-suscripciones-pagos/contracts/openapi.yaml),
[matriz de permisos](../../specs/003-suscripciones-pagos/contracts/rbac.md)). El cambio de plan se hace pagando
el período siguiente con otro plan: no hay una ruta aparte.

| Método y ruta                                                        | Propósito                                                                                            | RF         | Roles             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- | ----------------- |
| `GET /planes`                                                        | Planes contratables con su precio y los medios disponibles                                           | RF19, RF20 | PRO               |
| `GET /suscripcion`                                                   | Estado, plan, fechas, días restantes, límites, avisos, motivo de suspensión y pago abierto           | RF19       | PRO               |
| `GET /suscripcion/estado-operativo`                                  | Si la barbería acepta reservas (al barbero y al cliente, sin el estado)                              | RF21       | PRO, BAR, CLI     |
| `POST /suscripcion/pagos`                                            | Iniciar el pago de un período con Yape (URL del proveedor) o por transferencia (cuenta y referencia) | RF20, RF23 | PRO               |
| `GET /suscripcion/pagos?pagina=`                                     | Historial de pagos de la barbería, de a 20                                                           | RF25       | PRO               |
| `GET /suscripcion/pagos/{id}`                                        | Estado de un pago (al volver del proveedor)                                                          | RF23       | PRO               |
| `POST/GET /suscripcion/pagos/{id}/comprobante`                       | Subir (multipart, hasta 5 MB, tipo verificado por bytes) y ver el comprobante de la transferencia    | RF23       | PRO               |
| `POST /pagos/notificaciones`                                         | Notificación del proveedor: firma HMAC con marca de tiempo e idempotencia por `evento_id`            | RF24       | Proveedor (firma) |
| `POST /plataforma/auth/ingresar`, `…/segundo-factor`                 | Ingreso del administrador: contraseña y luego código TOTP o de recuperación                          | RF02, RF22 | PUB               |
| `POST /plataforma/auth/renovar`, `…/salir`                           | Renovar (cookie propia) y cerrar la sesión de plataforma                                             | —          | ADM               |
| `GET /plataforma/barberias?buscar=&pagina=`                          | Barberías con estado, plan y cobertura, sin datos de negocio                                         | RF02, RF22 | ADM               |
| `PUT/DELETE /plataforma/barberias/{id}/suscripcion/suspension`       | Suspender con motivo o reactivar la suscripción (estado recalculado por fechas)                      | RF22       | ADM               |
| `POST /plataforma/barberias/{id}/activacion-manual`                  | Activar un período a mano (pago `MANUAL` con el precio del plan, motivo y referencia externa)        | RF22, RF23 | ADM               |
| `GET /plataforma/planes`                                             | Planes que se pueden activar a mano                                                                  | RF22       | ADM               |
| `GET /plataforma/comprobantes`                                       | Cola de comprobantes en revisión de todas las barberías                                              | RF23       | ADM               |
| `GET /plataforma/barberias/{id}/pagos/{pagoId}[/comprobante]`        | Detalle del pago (número de operación completo) y el archivo                                         | RF23       | ADM               |
| `POST /plataforma/barberias/{id}/pagos/{pagoId}/revision`            | Aprobar con el importe transferido o rechazar con motivo                                             | RF23       | ADM               |
| `GET /plataforma/pagos/por-revisar`                                  | Duplicados, importes distintos, aprobados tras rechazo, devoluciones y notificaciones sin pago       | RF25, RF26 | ADM               |
| `POST /plataforma/barberias/{id}/pagos/{pagoId}/revision/resolucion` | Marcar resuelto un caso con una nota (no mueve dinero)                                               | RF25       | ADM               |

### M04 Asistente IA y reportes · M06 Núcleo

| Método y ruta                       | Propósito                                                                     | RF         | Roles    |
| ----------------------------------- | ----------------------------------------------------------------------------- | ---------- | -------- |
| `POST /asistente/mensajes`          | Consulta al asistente (herramientas cerradas)                                 | RF27, RF28 | CLI, PRO |
| `GET /reportes/citas?desde=&hasta=` | Reporte por período                                                           | RF29       | PRO      |
| `GET /admin/indicadores`            | Indicadores agregados de uso                                                  | RF31       | ADM      |
| `GET /admin/auditoria`              | Auditoría de acciones sensibles                                               | RF31       | ADM      |
| `GET /salud`                        | Vida: la instancia responde y PostgreSQL acepta consultas                     | RC         | PUB      |
| `GET /salud/listo`                  | Listo para recibir tráfico: base accesible y al día con las migraciones (006) | RC         | PUB      |

Las notificaciones (M05) no exponen endpoints propios: se disparan por eventos y por el recordatorio programado del día de la cita.

## 3. Reglas de contrato

- Una operación rechazada por plan o estado de suscripción responde `403` con código `SUSCRIPCION_NO_PERMITE`.
- Una reserva en conflicto responde `409` con código `HORARIO_NO_DISPONIBLE` (lo garantiza la restricción de exclusión en PostgreSQL); si el cliente ya tiene otra cita activa que se solapa, `409` `CITA_SOLAPADA_DEL_CLIENTE`.
- **`Idempotency-Key` en `POST /citas` (R09 de 002):** obligatoria, en formato UUID. La interfaz la genera al abrir la confirmación y la reutiliza en cada reintento. Un reintento con la misma clave y el mismo contenido devuelve `200` con la cita ya creada; la misma clave con otro contenido responde `422` `IDEMPOTENCIA_CONFLICTO`. La clave es por autor.
- Los cambios del catálogo que chocan con citas activas (bloqueo, horario o disponibilidad reducidos, servicio o barbero desactivado) responden `409` `CONFLICTO_CON_CITAS` con la lista de citas afectadas, sin datos del cliente, y no guardan nada; se repiten con `confirmarConflictos: true` (R11 de 002).
- La vía pública (`/publico/*`) solo admite `GET`, no lee el token y responde `404` `BARBERIA_NO_DISPONIBLE` igual para un enlace inexistente, cambiado o suspendido (ADR-021).
- **Salud (006, R02):** `GET /salud/listo` responde `200 {"estado":"listo"}` si la base responde y tiene aplicadas las migraciones de la versión de la réplica, y `503` si no. No consulta Redis: una réplica sin Redis sigue lista y trabaja sin caché. Ninguna de las dos rutas de salud cuenta para el límite de solicitudes.
- **Sin réplicas disponibles (006, ADR-030):** el balanceador responde `503` con `Retry-After: 5` y el formato de error de la API: `{"codigo":"SERVICIO_NO_DISPONIBLE","mensaje":"El servicio no está disponible en este momento. Intenta de nuevo en unos segundos.","detalles":[]}`. La interfaz lo muestra como un aviso de reintento.
- **`X-Instancia` (006, R14):** cada respuesta de una réplica lleva el nombre lógico que la atendió (`backend-1` o `backend-2`), para demostrar el reparto sin leer registros. No es parte del contrato funcional: sin `INSTANCIA_ID` no se envía.
- **Límite de solicitudes por IP compartido (006, ADR-029):** con varias réplicas el límite general se cuenta en Redis, así es el mismo con una o dos réplicas; si Redis no responde, cada réplica lo aplica por su cuenta con los mismos valores. La IP sale de `X-Forwarded-For` solo cuando la conexión llega desde el balanceador.
- **Administrador de la plataforma (003, ADR-031):** su token tiene la audiencia `plataforma` y no lleva tenant. Responde `401` en cualquier ruta de barbería, y un token de barbería responde `401` en `/plataforma/*`. Las escrituras sobre una barbería corren con el tenant de la **ruta** y RLS: un pago de otra barbería responde `404`. Cada acción queda en el `audit_log` de la barbería con el administrador como actor y, cuando la lleva, el motivo.
- **Pagos (003):** el importe se guarda en céntimos enteros. Un pago abierto se reutiliza si es el mismo intento (`200`) y se anula si no (`201` con el nuevo); con un comprobante en revisión, `409` `COMPROBANTE_YA_EN_REVISION`; con un período ya pagado por adelantado, `409` `PAGO_ADELANTADO_NO_PERMITIDO`. Con la pasarela caída o lenta, `503` `PAGO_EN_LINEA_NO_DISPONIBLE` en 3 s o menos, con la transferencia como alternativa.
- **Notificaciones del proveedor (003, PR17):** sin firma, con firma inválida o fuera de la ventana de tiempo, `401` sin efecto y una línea `PAGO_NOTIFICACION_RECHAZADA` en el registro, sin el cuerpo. Una notificación repetida (mismo `evento_id`) responde `200` sin volver a aplicarse.
- **Comprobantes (003, ADR-023):** solo se sirven con una sesión con permiso, como adjunto con `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`. El tipo se verifica por los bytes, no por el nombre. Nginx admite 6 MB solo en la ruta de subida (16 KB en el resto).
- El contrato completo de cada funcionalidad está en `specs/<funcionalidad>/contracts/openapi.yaml`; esta tabla es el resumen.
- El asistente nunca devuelve datos de otro tenant; sus herramientas son las mismas operaciones de arriba con el rol del usuario.
