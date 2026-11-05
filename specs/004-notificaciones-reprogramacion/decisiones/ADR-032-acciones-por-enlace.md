# ADR-032 Acciones sobre una cita por enlace firmado, sin sesión

- **Estado:** **Aceptado** (decisión del responsable, 2026-11-04), junto con la [enmienda 1.4.0 de la constitución](enmienda-constitucion-1.4.0.md), ya aplicada. Registrado en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md` el mismo día.
- **Contexto:**
  - RF34 y HU28 exigen que el recordatorio del día permita **confirmar, reprogramar o cancelar sin iniciar sesión**, con enlaces de un solo uso, que vencen y alcanzan una sola cita de una sola barbería.
  - El cliente presencial con correo ni siquiera tiene cuenta.
  - El principio III (1.3.1) exige tomar el tenant **solo del token**, y ninguna de sus tres excepciones cubre una acción sin token.
  - El rol `barberias_auth` tiene `BYPASSRLS` (`db/init/01-roles.sql`) y el responsable pidió no usar roles que omitan RLS.
- **Problema:** ¿cómo identificar la barbería y la cita de una acción sin sesión, sin aceptar datos del cliente, sin leer entre barberías y sin omitir RLS?
- **Alternativas:**
  - (a) **Exigir iniciar sesión** desde el recordatorio: contradice HU28 (criterio 2) y deja fuera al cliente presencial.
  - (b) **Token aleatorio guardado (su hash) y buscado sin tenant**: necesita leer entre barberías con un dato que envía el cliente (la tercera excepción solo permite claves exactas en trabajos en segundo plano y notificaciones de pagos) o una función `SECURITY DEFINER` con `BYPASSRLS`.
  - (c) **Token de sesión de corta vida enviado por correo**: es una credencial con alcance de cuenta, mucho más amplio que una cita y una acción.
  - (d) **Barbería en la ruta (`/b/{slug}/citas/{id}/...`)** con un código: el tenant saldría de la ruta, que es lo que el principio prohíbe.
  - (e) **Enlace firmado con HMAC** que contiene el tenant, la cita, la acción, la versión de la cita, el vencimiento y una parte aleatoria; verificación **antes de leer nada**; acción con `barberias_app` y RLS en el tenant del enlace; uso registrado por hash con unicidad.
- **Decisión:** opción (e). Formato y reglas en `specs/004-notificaciones-reprogramacion/contracts/enlaces-de-accion.md`.
  1. **Origen del tenant:** **solo** del dato firmado del enlace, tras verificar el HMAC (SHA-256, llave `ENLACES_LLAVE` de 32 bytes, solo en `.env`, separada por dominio con `enlace-accion-v1`). Nunca de la ruta, la consulta, el cuerpo ni otros encabezados.
  2. **Rol de base de datos:** `barberias_app` (sin `BYPASSRLS`), en una transacción con `app.tenant_id` fijado al tenant del enlace. RLS y los repositorios filtran como en cualquier operación. **No se usa `barberias_auth` ni `barberias_plataforma`.**
  3. **Cómo se guarda:**
     - al emitirlo, **nada**;
     - al usarlo, solo el SHA-256 del token en `appointment_link_use`, en la misma transacción que la acción.
     - Lo guardado no permite reconstruir el enlace: falta la parte aleatoria y la llave, y el hash no se invierte.
     - El token viaja en el fragmento de la URL (`/e#…`) y en el encabezado `X-Enlace-Accion`, nunca en la ruta, así que no queda en los registros de Nginx.
  4. **Uso único atómico:** `UNIQUE (link_hash)`. De dos usos simultáneos (en réplicas distintas), uno inserta y el otro recibe `23505` → `ENLACE_NO_VALIDO`. Si la acción falla, la transacción se revierte y el enlace sigue sin usar.
  5. **Vencimiento y revocación:**
     - vence a la hora de inicio de la cita (firmada);
     - cancelar, reprogramar, completar o marcar como no asistió sube `appointment.version`, y todo enlace con otra versión deja de valer sin tocar ninguna fila;
     - confirmar no cambia la versión, así que el cliente que confirmó puede cancelar después.
  6. **Alcance:** una cita, una acción y una barbería. La acción usa los mismos casos de uso y las mismas reglas que la vía con sesión (cancelación del cliente con la marca de tardía, reprogramación del cliente con antelación, restricciones por suscripción).
  7. **Limitación de intentos:**
     - límite por IP en las rutas `/enlaces/accion*` (30 por minuto, contador no crítico de 006);
     - **contador de rechazos en PostgreSQL** (`action_link_attempt`, SHA-256 de la IP con sal), con **los mismos valores de `login_attempt`** (`identidad/domain/politica-intentos.ts`): bloqueo tras 5 rechazos en 60 s, de 60 s la primera racha, duplicándose en cada racha siguiente hasta 900 s (15 min), con 24 h de historial (principio VIII: contador de seguridad).
  8. **Datos mínimos mostrados:** barbería, servicio, nombre visible del barbero, fecha y hora, la acción y, para cancelar, desde cuándo sería tardía. Nunca datos del cliente ni otras citas. El rechazo usa **un solo mensaje** para todos los casos (firma inválida, vencido, usado, de otra acción o de una cita cambiada) y no revela si la cita existe.
- **Justificación:**
  - es la única opción que no lee nada antes de verificar quién emitió el enlace;
  - no omite RLS ni guarda secretos;
  - limita el alcance a una cita y una acción.
  - La firma de 256 bits hace imposible adivinar un enlace; los contadores son defensa en profundidad.
- **Ventajas:**
  - sin búsqueda entre barberías;
  - la revocación no necesita escribir nada;
  - funciona igual con una o varias réplicas;
  - sirve también al cliente presencial con correo.
- **Desventajas:**
  - quien tenga el enlace (por ejemplo, si el cliente reenvía el correo) puede actuar sobre esa cita hasta su hora de inicio;
  - cambiar la llave invalida los enlaces en curso.
- **Riesgos:**
  - **Filtración del enlace.** **Mitigación:** una cita y una acción, vencimiento corto, datos mínimos y auditoría con la vía `ENLACE`.
  - **Fuga de la llave.** **Mitigación:** la llave está solo en `.env` y es rotable con el byte de formato.
- **Pruebas:**
  - `enlaces-acciones` y `enlaces-rechazos` (PR28): usado, vencido, alterado, de otra acción, de cita cambiada y dos usos simultáneos → 1;
  - `aislamiento-avisos` (PR09): enlace firmado para A con una cita de B → rechazado; token alterado → sin consultas a la base;
  - `enlaces-limite`;
  - PR14: `EnlacesFirmados` solo se usa desde M05 (emitir) y desde las rutas de enlaces de M02 (verificar).
- **Drivers:** DA01, DA11.
- **Consecuencias:**
  - enmienda 1.4.0 (cuarta excepción del principio III);
  - `multi-tenancy-y-datos.md` §1.3 con la cuarta excepción;
  - la puerta III de `plan-template.md`;
  - la ruta pública `/e` del frontend.
