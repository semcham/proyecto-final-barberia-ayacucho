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

Roles: **ADM** administrador de la plataforma · **PRO** propietario · **ADS** administrativo · **BAR** barbero · **CLI** cliente · **PUB** sin sesión.

### M01 Acceso y barberías

| Método y ruta                         | Propósito                                                    | RF         | Roles    |
| ------------------------------------- | ------------------------------------------------------------ | ---------- | -------- |
| `POST /auth/login`                    | Iniciar sesión y recibir token                               | RF04       | PUB      |
| `POST /auth/logout`                   | Cerrar sesión                                                | RF04       | Todos    |
| `POST /barberias`                     | Registrar barbería y crear tenant (inicia prueba gratuita)   | RF01, RF18 | PUB      |
| `POST /clientes/registro`             | Registrar cliente con consentimiento y canal de notificación | RF05, RF33 | PUB      |
| `GET/POST/PATCH /usuarios`            | Gestionar usuarios y roles de la barbería                    | RF06       | PRO      |
| `GET/PATCH /barberias/actual`         | Ver y editar datos comerciales y horarios                    | RF03       | PRO, ADS |
| `PATCH /admin/barberias/{id}/estado`  | Activar, suspender o reactivar                               | RF02       | ADM      |
| `PATCH /clientes/yo/notificaciones`   | Cambiar canal (correo o WhatsApp)                            | RF33       | CLI      |
| `POST /clientes/yo/solicitudes-datos` | Pedir acceso, rectificación o eliminación                    | RF32       | CLI      |

### M02 Catálogo y citas

| Método y ruta                                   | Propósito                                                           | RF   | Roles         |
| ----------------------------------------------- | ------------------------------------------------------------------- | ---- | ------------- |
| `GET /publico/{slug}/catalogo`                  | Catálogo público de servicios y barberos                            | RF10 | PUB           |
| `GET/POST/PATCH /servicios`                     | Gestionar servicios                                                 | RF07 | PRO, ADS      |
| `GET/POST/PATCH /barberos`                      | Gestionar barberos y servicios asignados                            | RF08 | PRO, ADS      |
| `PUT /barberos/{id}/horarios`                   | Disponibilidad semanal                                              | RF09 | PRO, ADS, BAR |
| `POST /barberos/{id}/bloqueos`                  | Bloquear horarios                                                   | RF09 | PRO, ADS, BAR |
| `GET /disponibilidad?servicio=&barbero=&fecha=` | Horarios libres                                                     | RF11 | CLI, PRO, ADS |
| `POST /citas`                                   | Reservar (sin duplicados)                                           | RF12 | CLI, ADS      |
| `PATCH /citas/{id}/reprogramar`                 | Reprogramar                                                         | RF13 | CLI, ADS      |
| `PATCH /citas/{id}/cancelar`                    | Cancelar liberando horario                                          | RF14 | CLI, ADS, PRO |
| `PATCH /citas/{id}/estado`                      | Transición válida de estado                                         | RF15 | BAR, ADS, PRO |
| `GET /citas?barbero=&fecha=`                    | Agenda                                                              | RF16 | BAR, ADS, PRO |
| `GET /clientes/yo/citas`                        | Historial del cliente                                               | RF17 | CLI           |
| `POST /recordatorios/{token}/responder`         | Confirmar, reprogramar o cancelar con enlace firmado de un solo uso | RF34 | PUB (token)   |

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

| Método y ruta                       | Propósito                                     | RF         | Roles         |
| ----------------------------------- | --------------------------------------------- | ---------- | ------------- |
| `POST /asistente/mensajes`          | Consulta al asistente (herramientas cerradas) | RF27, RF28 | CLI, PRO, ADS |
| `GET /reportes/citas?desde=&hasta=` | Reporte por período                           | RF29       | PRO, ADS      |
| `GET /admin/indicadores`            | Indicadores agregados de uso                  | RF31       | ADM           |
| `GET /admin/auditoria`              | Auditoría de acciones sensibles               | RF31       | ADM           |
| `GET /salud`                        | Estado del servicio (balanceador y monitoreo) | RC         | PUB           |

Las notificaciones (M05) no exponen endpoints propios: se disparan por eventos y por el recordatorio programado del día de la cita.

## 3. Reglas de contrato

- Una operación rechazada por plan o estado de suscripción responde `403` con código `SUSCRIPCION_NO_PERMITE`.
- Una reserva en conflicto responde `409` con código `HORARIO_NO_DISPONIBLE` (lo garantiza la restricción de exclusión en PostgreSQL).
- El asistente nunca devuelve datos de otro tenant; sus herramientas son las mismas operaciones de arriba con el rol del usuario.
