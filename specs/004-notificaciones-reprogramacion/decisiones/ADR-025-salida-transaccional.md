# ADR-025 Salida transaccional de eventos (outbox) en PostgreSQL

- **Estado:** **Aceptado** (decisión del responsable, 2026-11-04). Registrado en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md` el mismo día. Este archivo conserva el detalle completo.
- **Contexto:**
  - El principio VII exige que M05 reaccione a eventos, que el envío sea asíncrono y que un fallo de envío nunca bloquee ni revierta la operación.
  - El principio I exige que los efectos entre módulos vayan por eventos del bus de M06.
  - Hoy no hay bus (componentes §3).
  - La especificación exige que ningún aviso de una operación guardada se pierda ni se duplique con dos réplicas (FR-010 a FR-012, SC-005), también si una réplica cae después de guardar.
  - El backend corre en dos réplicas detrás de Nginx (ADR-030), y Redis no puede ser fuente de verdad (principio VIII).
- **Problema:** ¿cómo publicar un hecho de la cita o de la suscripción y entregarlo a M05 sin perderlo, sin duplicar sus efectos y sin demorar la operación?
- **Alternativas:**
  - **(a) Enviar después del COMMIT** con `uow.alConfirmar` (lo que hoy invalida la caché). Si la réplica cae entre el COMMIT y el envío, el aviso se pierde, y no hay reintento persistente.
  - **(b) Enviar dentro de la transacción.** Demora la operación y la ata al proveedor; un fallo de envío revertiría la cita (contradice el principio VII).
  - **(c) Cola en Redis** (listas o BullMQ). Redis sería la fuente de verdad de trabajos que no se pueden perder (principio VIII), y su caída los perdería (Redis sin persistencia, 006).
  - **(d) `LISTEN/NOTIFY` de PostgreSQL solo.** No persiste: si nadie escucha en ese instante, el aviso se pierde.
  - **(e) Un intermediario de mensajes** (RabbitMQ o SQS). Infraestructura nueva para un equipo pequeño y un equipo de 8 GB, y sigue haciendo falta la escritura atómica junto a la operación.
  - **(f) Salida transaccional en PostgreSQL.** Tabla `outbox_event` escrita en la misma transacción; despacho en cualquier réplica con `FOR UPDATE SKIP LOCKED`; manejadores idempotentes; tarea de respaldo con el ejecutor de ADR-024.
- **Decisión:** opción (f), en M06 (`shared/eventos/`), sin reglas de negocio.
  1. **Publicar.** `BusDeEventos.publicar` inserta el evento con el tenant de la transacción en curso. Si la operación se revierte, el evento desaparece con ella. `reemplazar` y `anular` manejan los eventos programados por clave (el recordatorio).
  2. **Despachar.** Tras el COMMIT, la misma réplica intenta despachar los eventos de ese tenant (mejor esfuerzo). Una tarea `despachar-eventos`, cada 15 s, recoge el resto bajo el candado de ADR-024. Lista los pendientes con `barberias_plataforma` (solo columnas técnicas) y abre **una transacción por evento** con su tenant y `barberias_app`: `SELECT … FOR UPDATE SKIP LOCKED`, ejecución del manejador y `status = 'PROCESADO'` en el mismo COMMIT.
  3. **Manejador de M05.** Crea un aviso por destinatario con `UNIQUE (tenant_id, event_id, recipient_kind, recipient_ref)`: repetir el despacho no crea avisos dobles.
  4. **Enviar.** La tarea `enviar-avisos` reclama cada aviso con `status = 'ENVIANDO'` y un plazo (`claimed_until = now() + 2 min`, `SKIP LOCKED`), envía **fuera de la transacción** por `NotificationChannel` con la clave de idempotencia del aviso, y anota el resultado en una transacción corta.
  5. **Reintentos y circuito (ADR-012).**
     - **Tiempo límite:** 5 s para el correo y 3 s para WhatsApp.
     - **Esperas:** 30 s, 2 min, 10 min, 30 min y 1 h, con ±20 % de variación.
     - **Intentos:** hasta 6 por aviso; WhatsApp pasa a correo tras 3 fallos o con su circuito abierto.
     - **Circuito:** el `Interruptor` de M06 por canal (5 fallos en 60 s; prueba de nuevo a los 30 s). Con el circuito abierto, el aviso queda pendiente sin consumir intentos.
     - **Descarte:** los recordatorios se descartan al llegar la hora de inicio de la cita; los demás avisos quedan `FALLIDO` a las 24 h.
  6. **Retención (decisión del responsable, 2026-11-04):** los eventos procesados o anulados se purgan a los 30 días y los avisos a los 90. La afinación por tipo queda para la funcionalidad 007.
- **Qué pasa si una réplica cae:**

  | Momento de la caída                                         | Qué pasa                                                                              | ¿Pérdida? | ¿Duplicado? |
  | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------- | ----------- |
  | Antes del COMMIT de la operación                            | Se revierten la operación y el evento                                                 | No (no hubo operación) | No |
  | Después del COMMIT, antes de despachar                      | El evento sigue `PENDIENTE`; la otra réplica lo despacha en ≤ 15 s más el desfase      | No        | No          |
  | Durante el despacho, antes de su COMMIT                     | Se revierten el manejador y la marca; el evento sigue pendiente                       | No        | No (el aviso es único) |
  | Con el aviso reclamado, antes de enviarlo                   | Al vencer `claimed_until`, la otra réplica lo reclama y lo envía                      | No        | No          |
  | **Después de que el canal aceptó, antes de anotar ENVIADO** | Al vencer el plazo, otra réplica lo reenvía                                           | No        | **Posible** |

- **Lo que no garantiza:** "exactamente una vez" hacia un sistema externo no se puede garantizar sin que el proveedor deduplique. La ventana del último caso es de milisegundos. Se mitiga con la clave de idempotencia: el simulador de WhatsApp deduplica por `Idempotency-Key`, y el correo lleva un `Message-ID` estable, que algunos buzones agrupan pero SMTP no deduplica. **No se afirmará que nunca hay duplicados ante una caída en medio del envío.**
- **Justificación:** es la única opción que cumple a la vez la atomicidad con la operación, la persistencia ante caídas y la ausencia de infraestructura nueva, con PostgreSQL como fuente de verdad (ADR-004). Reutiliza el ejecutor y el candado de ADR-024 y la lectura de plataforma de ADR-031.
- **Ventajas:** ningún evento se pierde; la operación no espera al proveedor; funciona igual con una o varias réplicas; se puede auditar por SQL.
- **Desventajas:**
  - latencia de segundos (no instantánea) si falla el despacho inmediato;
  - una tabla más que crece y se purga;
  - una consulta por réplica cada 15 s.
- **Riesgos:** un manejador con un error que nunca se resuelve deja eventos pendientes. **Mitigación:** a los 10 intentos se registra un error para revisar, y nunca se borra un evento sin procesar.
- **Pruebas:**
  - `salida-eventos-dos-instancias`: 100 operaciones → 100 avisos, 0 perdidos y 0 duplicados;
  - `salida-eventos-caida`: los tres primeros casos de la tabla y el reclamo vencido;
  - `correo-caido` (PR06);
  - unitarias del ejecutor con intervalo por tarea.
- **Drivers:** DA04, DA05, DA09.
- **Consecuencias:**
  - el ejecutor de ADR-024 acepta un intervalo por tarea;
  - `barberias_plataforma` lee cinco columnas técnicas de `outbox_event` y de `notification` (lista cerrada de ADR-031 ampliada; PR09 `lectura-plataforma`);
  - componentes §3 deja de decir "hoy no hay eventos";
  - la funcionalidad 005 podrá publicar eventos con el mismo bus.
