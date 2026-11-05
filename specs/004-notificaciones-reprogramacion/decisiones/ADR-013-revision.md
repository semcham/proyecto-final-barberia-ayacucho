# Revisión de ADR-013 Notificaciones multicanal al cliente (correo y WhatsApp)

- **Estado del ADR-013 antes de esta revisión:** Propuesto (registrado antes de 002). Ahora: Aceptado.
- **Estado de esta revisión:** **Aceptada** (decisión del responsable, 2026-11-04). ADR-013 pasa a **Aceptado** con estas precisiones, ya registradas en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`, y la matriz de módulos se actualizó en `estilo-arquitectonico.md` y `componentes-arquitectonicos.md`.

## Qué se mantiene

La decisión de fondo no cambia:

- puerto `NotificationChannel` con un adaptador de correo y otro de WhatsApp;
- M05 reacciona a eventos de M02;
- canal según la preferencia del cliente;
- envío asíncrono con reintentos y circuit breaker;
- correo como respaldo si WhatsApp falla o no hay consentimiento;
- datos mínimos;
- consentimiento registrado antes de enviar por WhatsApp;
- WhatsApp solo si el proveedor lo permite.

## Qué se precisa o cambia

| Tema                        | ADR-013 anterior                                                  | Revisión aceptada                                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adaptadores                 | `EmailSender` y `WhatsAppSender`                                  | `canal-correo-smtp` (Mailpit en desarrollo y pruebas; producción por verificar) y `canal-whatsapp-simulado` (simulador en proceso aparte). El proveedor real de WhatsApp será otro adaptador (ADR-026) |
| Eventos                     | `CitaCreada`, `CitaReprogramada`, `CitaCancelada`                 | Los mismos, más `RecordatorioDeCita` (programado a 2 h, fijo) y los de suscripción de M03 (US5). Todos por la salida transaccional de M06 (ADR-025)                                                                                     |
| Recordatorio                | "del día de la cita", con propuesta de 2 h configurable y 24 h opcional | **Uno solo, 2 h antes, fijo** (aclaración del 2026-11-04). El configurable y el de 24 h quedan como evolución futura                                                                                                             |
| Acciones del recordatorio   | Confirmar, reprogramar o cancelar                                 | Por enlace firmado de un solo uso, sin sesión (ADR-032 y enmienda 1.4.0)                                                                                                                                                                |
| Número de WhatsApp          | No precisado                                                      | Campo propio del cliente en cada barbería, propuesto con su teléfono; cambiarlo exige un consentimiento nuevo                                                                                                                         |
| Respaldo                    | "Si WhatsApp falla"                                               | Tras 3 fallos de WhatsApp o con su circuito abierto → correo, una sola vez                                                                                                                                                              |
| Avisos al personal          | No incluidos                                                      | Por correo al propietario y al barbero con usuario vinculado cuando el **cliente** cancela o reprograma (HU13, HU28)                                                                                                                  |
| Avisos al propietario       | Mencionados en RF30                                               | Cuatro avisos de suscripción por correo (US5), primer bloque que se recorta                                                                                                                                                             |
| **Matriz de módulos**       | M05 → M06 únicamente                                              | **M05 → M01, solo lectura**, por la interfaz pública: `ClientesApi.contactoParaAvisos` (correo, canal, número y consentimiento vigente), `PersonalApi.correoDe` y `BarberiasApi.correoDelPropietario` y `nombre`. M05 no escribe en M01 |

## Por qué M05 → M01

- El consentimiento debe estar **vigente al enviar** (FR-019). Un recordatorio se envía horas después de publicarse; si el canal y el consentimiento viajaran en el evento, un retiro intermedio no se respetaría.
- La salida de eventos no debe guardar datos de contacto (datos mínimos).
- **Alternativas descartadas:**
  - copiar los datos en el evento (ver arriba);
  - mover la preferencia y el consentimiento de WhatsApp a M05: los separa del consentimiento de datos de M01 y contradice la asignación de RF33 a M01;
  - que M02 resuelva el contacto y lo pase en el evento: el mismo problema del retiro intermedio.
- **El grafo sigue sin ciclos:** M01 no llama a M05, y nadie llama a M05 (solo se publican eventos). PR14 incorpora la regla `matriz-m05` (M05 solo hacia M01 por `index.ts` y hacia M06).

## Consecuencias

- `estilo-arquitectonico.md` §3:
  - ✓ de M05 hacia M01;
  - la regla 4 pasa de "eventos planificados" a "eventos por la salida transaccional (ADR-025)";
  - el diagrama de dependencias se actualiza.
- `componentes-arquitectonicos.md`: M05 con su interfaz pública y sus puertos; §3 con los eventos.
- `diseño-interno-de-modulos.md` §7: nombres reales de los elementos propuestos.
