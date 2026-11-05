# Enmienda de la constitución: 1.4.0 → 1.4.1 (aprobada y aplicada el 2026-11-04)

- **Estado:** **Aprobada y aplicada** (decisión del responsable, 2026-11-04), tras el análisis de consistencia de 004 (hallazgos C1, C2 y C3). El texto de abajo está en `.specify/memory/constitution.md`, con su Sync Impact Report.
- **Tipo de cambio: PATCH (1.4.1).** Tres aclaraciones que corrigen el texto de la 1.4.0 para que coincida con el sistema existente y con la especificación de 004. No amplían lo que se permite: todo lo que cumplía la 1.4.0 sigue cumpliendo.

## C1 · Tablas técnicas de intentos (principio III)

- **Problema:** la 1.4.0 decía que `login_attempt` y `action_link_attempt` guardan "solo un resumen criptográfico del origen (nunca … IP en claro)". La migración `backend/migrations/0006_intentos_login.ts` crea `login_attempt` con `ip inet NOT NULL`: la IP está en claro desde 001. Tampoco hay una purga programada: `KyselyIntentosRepository.registrarFallo` borra las filas de más de 24 h en la misma sentencia que registra un fallo nuevo, y `borrarFallos` borra las del par cuenta e IP tras un ingreso correcto.
- **Texto aplicado:** `login_attempt` se describe tal como es (SHA-256 del correo, IP en claro y fecha; borrado oportunista de lo mayor a 24 h, sin purga programada). `action_link_attempt` MUST guardar el origen solo como hash con sal (`ENLACES_SAL_IP`), con purga a las 24 h.
- **Mejora asignada a 007:** pasar `login_attempt` a hash de la IP, anotada en `docs/05-gestion/02-backlog-y-sprints.md` §3.1. El código de inicio de sesión no cambia en 004.

## C2 · Datos mínimos de los mensajes (principio VII)

- **Problema:** la 1.4.0 limitaba los mensajes a "barbería, servicio, fecha y hora", y la especificación de 004 (FR-013, FR-039 y HU25) pide además el barbero, la hora anterior, los enlaces y, en los avisos al propietario, el plan, el período y el motivo.
- **Texto aplicado:** sobre una cita, el nombre de la barbería, el servicio, el nombre visible del barbero, la fecha y la hora, la hora anterior si se reprogramó y los enlaces de acción del recordatorio; en los avisos al propietario, además, el plan, el período y el motivo (de un rechazo o de una activación manual). El cuerpo MUST NOT incluir teléfonos, correos ni datos de pago.

## C3 · Listado de pendientes por los trabajos en segundo plano (principio III, 3.ª excepción)

- **Problema:** la 3.ª excepción solo permitía localizar el tenant "por una clave exacta", pero las tareas de 003 (ADR-024) ya **listan** pendientes, y 004 lo necesita para el despacho de eventos y el envío de avisos (ADR-025).
- **Texto aplicado:** los trabajos en segundo plano MAY listar los pendientes de sus propias tablas leyendo solo columnas técnicas (identificador, `tenant_id`, estado y fechas), sin leer su contenido, y MUST procesar cada elemento en una transacción con su tenant fijado y con RLS.

## Efectos

| Archivo | Cambio |
| --- | --- |
| `.specify/memory/constitution.md` | Texto, versión 1.4.1 y Sync Impact Report |
| `.specify/templates/plan-template.md` | Puertas III y VII |
| `docs/02-arquitectura-software/multi-tenancy-y-datos.md` | Casos especiales: tablas técnicas de intentos y listado de pendientes |
| `docs/05-gestion/02-backlog-y-sprints.md` | Mejora "login_attempt con hash de IP" para 007 |
| `specs/004-notificaciones-reprogramacion/` | Constitution Check del plan con la 1.4.1; FR-012, FR-035 y SC-005 de la spec; tareas |
