# Enmienda de la constitución: 1.3.1 → 1.4.0 (aprobada y aplicada el 2026-11-04)

- **Estado:** **Aprobada y aplicada** (decisión del responsable, 2026-11-04). El texto de abajo está en `.specify/memory/constitution.md` (versión 1.4.0, con su Sync Impact Report), junto con ADR-032 Aceptado.
- **Tipo de cambio: MINOR (1.4.0).** Amplía materialmente la guía del principio III con una cuarta excepción acotada y nombra una tabla técnica sin barbería. No elimina ni redefine nada: todo lo que cumplía la 1.3.1 (funcionalidades 001, 002, 003 y 006) sigue cumpliendo.
- **Origen:** `specs/004-notificaciones-reprogramacion/research.md` R06 a R08, ADR-032 y el Complexity Tracking del plan de 004.

## Texto aplicado

Se agrega al principio III, después de la excepción "operaciones de la plataforma":

> - **Excepción acotada: acciones por enlace de la cita.** El recordatorio de una cita (RF34) MAY incluir enlaces que permitan al cliente, sin sesión, confirmar su asistencia, reprogramar o cancelar **esa** cita. La barbería y la cita MUST obtenerse **solo** del dato firmado del enlace, después de verificar su firma, y MUST NOT tomarse de la ruta, la consulta, el cuerpo ni otros encabezados. Antes de verificar la firma, el sistema MUST NOT leer datos de ninguna barbería. La acción MUST ejecutarse con el rol de la aplicación, sin `BYPASSRLS`, en una transacción con el tenant del enlace fijado y con RLS, y MUST aplicar las mismas reglas que la operación equivalente con sesión. Cada enlace MUST servir para una sola cita, una sola acción y un solo uso, MUST vencer como máximo a la hora de inicio de la cita, MUST dejar de valer si la cita cambia y MUST guardarse solo de forma que no pueda reconstruirse a partir de lo guardado. Las respuestas MUST mostrar solo los datos mínimos de la cita y MUST NOT revelar datos del cliente ni si una cita existe. Los intentos rechazados MUST limitarse por origen, con su contador en PostgreSQL. La decisión se registra en ADR-032.

Se amplía el párrafo **"Tablas de la plataforma"** de la tercera excepción con:

> **Tablas técnicas de intentos:** `login_attempt` (desde 001) y `action_link_attempt` (004) no pertenecen a ninguna barbería; MAY no tener `tenant_id` ni RLS, y MUST guardar solo un resumen criptográfico del origen (nunca correos, IP en claro ni datos de negocio), con purga a las 24 h.

Se agrega a la **Razón** del principio III:

> La cuarta existe porque el recordatorio del día debe poder responderse desde el celular sin iniciar sesión (HU28), incluso por un cliente presencial sin cuenta; se limita a una cita, una acción y un uso, verifica la firma antes de leer nada y no omite RLS.

## Efectos

| Archivo                                                     | Cambio al aprobarse                                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `.specify/memory/constitution.md`                           | Texto anterior; versión 1.4.0; "Last Amended" con la fecha de aprobación; Sync Impact Report                         |
| `.specify/templates/plan-template.md`                       | Puerta III: "only four exceptions", con la cuarta resumida                                                           |
| `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md` | ADR-032 Aceptado                                                                                                  |
| `docs/02-arquitectura-software/multi-tenancy-y-datos.md`    | §1.3 "Las cuatro excepciones acotadas (constitución 1.4.0)"; tablas técnicas                                        |
| `specs/001`, `002`, `003` y `006`                           | Sin cambios: no usan la excepción nueva                                                                              |

## Observación que esta enmienda regulariza

`login_attempt` existe desde la funcionalidad 001 sin `tenant_id` y no figura en la lista cerrada de la 1.3.1, que nombra solo las tablas de la plataforma de 003. La enmienda la nombra junto con `action_link_attempt`, sin cambiar su diseño.

## Lo que la excepción no permite

- Escribir o leer otra cita que no sea la del enlace.
- Cualquier operación que no sea confirmar, reprogramar o cancelar.
- Usar el enlace después de la hora de inicio, después de un cambio de la cita o por segunda vez.
- Usar `barberias_auth`, `barberias_plataforma` o cualquier rol con `BYPASSRLS` en la acción.
- Tomar el tenant de algo que no sea la firma verificada.
