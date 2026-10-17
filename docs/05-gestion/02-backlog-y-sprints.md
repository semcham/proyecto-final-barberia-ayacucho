# Product Backlog y plan de seis sprints

> **Alcance del curso.** Las guías indican que el primer sprint del proyecto final es la **documentación completa** (análisis, arquitectura y diseño) y que no se exige desarrollar funcionalidades nuevas. Por eso el plan distingue:
>
> - **Entregable de documentación del curso:** Sprints 1 y 2.
> - **Implementación por funcionalidades (SDD con Spec Kit):** la funcionalidad 001 está implementada; los antiguos Sprints 3 a 6 pasan a ser las funcionalidades **002 a 006** (hoja de ruta aprobada el 2026-10-17, sección 3).
>
> Fechas reales y responsables: **pendientes de asignación**.

## 1. Product Backlog

Prioridades actualizadas el 2026-10-17: RF27 y RF28 pasan de _Could_ a _Must_; RF26 pasa de _Could_ a _Should_; RF02 se implementa en la funcionalidad 003 (versión mínima). Ver [requisitos funcionales](../01-analisis-de-sistema/03-requisitos-funcionales.md#resumen-por-prioridad).

| Prioridad  | HU                           | RF                     | Módulo                  | Funcionalidad |
| ---------- | ---------------------------- | ---------------------- | ----------------------- | ------------- |
| 1 (Must)   | HU02, HU05                   | RF01, RF04, RF18       | M01, M03                | **001** (implementada) |
| 2 (Must)   | HU03, HU04, HU06             | RF03, RF05, RF06       | M01                     | RF06: **001** (implementada); RF03 y RF05 (cuenta de cliente): 002 |
| 3 (Must)   | HU07, HU08, HU09, HU10       | RF07–RF10              | M02                     | 002 |
| 4 (Must)   | HU11, HU13, HU14, HU15       | RF11, RF12, RF14–RF16  | M02                     | 002 |
| 5 (Must)   | HU01, HU17, HU19             | RF02, RF19, RF21, RF22 | M01, M03                | 003 (RF02 en versión mínima: aprobar transferencias) |
| 6 (Must)   | HU22, HU23                   | RF27, RF28             | M04                     | 005 |
| 7 (Should) | HU12, HU16                   | RF13, RF17             | M02                     | 002 |
| 8 (Should) | HU18, HU20, HU21             | RF20, RF23–RF26        | M03                     | 003 |
| 9 (Should) | HU25, HU28                   | RF30, RF33, RF34       | M05, M02                | 004 (solo correo; WhatsApp futuro) |
| 10 (Should) | HU24                        | RF29                   | M04                     | 005 |
| 11 (Should) | HU26                        | RF31                   | M06                     | Parcial: la auditoría ya existe (001); los indicadores de la plataforma, **sin funcionalidad asignada** |
| 12 (Should) | HU27                        | RF32                   | M01                     | **Sin funcionalidad asignada** (derechos sobre datos personales): pendiente de planificar |

La funcionalidad **006** no agrega RF: demuestra atributos de calidad (EQ-01 a EQ-05: rendimiento, escalado y resiliencia).

## 2. Plan de sprints

### Sprint 1: Análisis y especificación — _entregable de documentación_

| Campo                    | Contenido                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objetivo                 | Entender el negocio y especificar qué debe hacer el sistema                                                                                                                                                                           |
| Historias                | Todas las HU (redacción y criterios)                                                                                                                                                                                                  |
| Tareas                   | Necesidad del negocio y evidencias; actores; HU; RF; atributos de calidad y escenarios; restricciones; riesgos iniciales; backlog; **trabajo de campo** (guion de 10 preguntas, 8–15 barberías de Huamanga, consentimiento informado) |
| Responsable              | _Por asignar_                                                                                                                                                                                                                         |
| Criterios de aceptación  | HU y RF consistentes y trazables; escenarios de calidad en el formato de la Guía 04 (seis partes más verificación y estado); evidencias con fuente                                                                                    |
| Entregables              | `docs/00`, `docs/01-analisis-de-sistema/01` a `06` y `08`, resultados del trabajo de campo (si se hace)                                                                                                                               |
| Riesgos                  | Falta de acceso a barberías (R14); datos oficiales incompletos                                                                                                                                                                        |
| Evidencias de validación | Revisión de la entrega; actas de entrevistas; tabla de evidencias                                                                                                                                                                     |

### Sprint 2: Diseño arquitectónico — _entregable de documentación_

| Campo                    | Contenido                                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objetivo                 | Tomar y registrar las decisiones de arquitectura y diagramarlas                                                                                                                                                                                                                                   |
| Historias                | Transversal (todas las HU alimentan las decisiones)                                                                                                                                                                                                                                               |
| Tareas                   | Drivers; ADR-001 a ADR-015; estilo; enfoque; tácticas; componentes; multi-tenancy y modelo de datos; despliegue; seguridad; tecnologías; diseño interno; C4 niveles 1 a 4; trazabilidad; estructura base del repositorio (`docs/`, `tecnologia/`), ejemplo de Clean Architecture en `tecnologia/` |
| Responsable              | _Por asignar_                                                                                                                                                                                                                                                                                     |
| Criterios de aceptación  | Cada ADR con alternativas y consecuencias; cada componente de C4 rastreable a un requisito; Mermaid renderiza en GitHub                                                                                                                                                                           |
| Entregables              | `docs/01-.../07`, `docs/02-*`, `docs/03-*`, `docs/04-*`, `docs/trazabilidad.md`                                                                                                                                                                                                                   |
| Riesgos                  | Sobreingeniería (R13); inconsistencias entre diagramas                                                                                                                                                                                                                                            |
| Evidencias de validación | Revisión cruzada; checklist de coherencia; revisión de la entrega                                                                                                                                                                                                                                 |

## 3. Funcionalidades 002 a 006 (antes Sprints 3 a 6)

Hoja de ruta aprobada el 2026-10-17. Cada funcionalidad sigue el flujo de Spec Kit (especificación → plan → tareas → implementación → `/speckit-analyze`) y registra sus ADR **antes de implementar** (constitución, principio XI). La identidad, el registro de barberías y el aislamiento del antiguo Sprint 3 ya los entregó la funcionalidad [001](../../specs/001-registro-acceso-barberia/spec.md). Las estimaciones son de una persona y están **por validar**, tomando 001 como referencia.

| Funcionalidad | Depende de | ADR por escribir | Constitución | Esfuerzo |
| --- | --- | --- | --- | --- |
| 002 Catálogo, citas y cuenta de cliente | 001 | ADR-020, ADR-021 | Usa la excepción del principio III (versión 1.1.0) | XL · 3–4 semanas |
| 003 Suscripciones y pagos | 001, 002 | ADR-022, ADR-023, ADR-024 (al empezar) | — | L · 2–3 semanas |
| 004 Notificaciones por correo | 002, ADR-024 | ADR-025, ADR-026 | — | M · 1–2 semanas |
| 005 Asistente de IA y reportes | 002, 003 | ADR-027, ADR-028 | — | L · 2–3 semanas |
| 006 Escalado demostrable en Docker Compose | 002, 003, 004 | ADR-029, ADR-030 | Usa la ampliación del principio VIII (versión 1.1.0) | M · 1–2 semanas |

Total estimado: entre 9 y 14 semanas.

### Funcionalidad 002: Catálogo, citas y cuenta de cliente (M02, M01)

| Campo                    | Contenido |
| ------------------------ | --------- |
| Objetivo                 | Que el cliente encuentre la barbería, vea servicios y horarios libres y reserve sin duplicados |
| Historias                | HU03, HU06–HU16 |
| Alcance mínimo           | Servicios, barberos y disponibilidad semanal con bloqueos (RF07–RF09); datos y horarios de la barbería (RF03); catálogo y horarios libres públicos por enlace (RF10, RF11); cuenta de cliente con consentimiento (RF05); reservar, cancelar, historial (RF12, RF14, RF17); estados de la cita (RF15); agenda (RF16); reprogramar (RF13) si cabe |
| Cuenta de cliente        | **Decidida:** una cuenta por correo, con una membresía `CLIENTE` por cada barbería en la que reserva y un token por barbería (`tid`); cambiar de barbería emite otro token tras comprobar la membresía. El tenant siempre sale del token |
| Criterios de aceptación  | 200 solicitudes simultáneas → 1 cita (EQ-16); 0 fugas entre barberías, incluidas las lecturas públicas por enlace (EQ-09); el catálogo público no devuelve datos personales |
| Riesgos                  | Reservas duplicadas (R02); que la lectura pública abra datos privados; zonas horarias; datos personales del cliente |
| ADR por escribir         | ADR-020 Cuenta de cliente con membresía por barbería y token por barbería; ADR-021 Lecturas públicas por enlace (excepción del principio III) |
| Evidencias de validación | PR16 (obligatoria), PR09 ampliada, PR08, PR15 |

### Funcionalidad 003: Suscripciones y pagos (M03, M01)

| Campo                    | Contenido |
| ------------------------ | --------- |
| Objetivo                 | Cerrar el modelo comercial: planes, restricciones por plan y cobro de la suscripción |
| Historias                | HU01, HU17–HU21 |
| Alcance mínimo           | Estado y plan (RF19); contratar o cambiar de plan (RF20); restricciones por plan y estado (RF21); vencimiento automático de la prueba (RF22); **Yape mediante una pasarela peruana en sandbox** (RF23–RF25, proveedor **por verificar**); conciliación mínima (RF26); **transferencia con comprobante** aprobada por el **administrador de la plataforma** en versión mínima (RF02) |
| Criterios de aceptación  | Webhook repetido → 1 efecto (EQ-17); firma inválida rechazada; ningún dato de tarjeta (principio V); el vencimiento de la prueba no se ejecuta dos veces |
| Riesgos                  | La pasarela no confirma Yape o no da sandbox (R15); pagos duplicados (R07); comprobantes con datos personales y bancarios; URL pública para el webhook en desarrollo |
| ADR por escribir         | **ADR-024 Tareas programadas sin duplicados entre instancias, al empezar la funcionalidad** (lo usan 003, 004 y 006); ADR-022 Pasarela de pagos y transferencia con comprobante; ADR-023 Almacenamiento de archivos (comprobantes) |
| Evidencias de validación | PR06, PR17, PR20, PR25 |

### Funcionalidad 004: Notificaciones por correo (M05)

| Campo                    | Contenido |
| ------------------------ | --------- |
| Objetivo                 | Que el cliente sepa la fecha y hora de su cita y pueda confirmarla o cancelarla |
| Historias                | HU25, HU28 |
| Alcance mínimo           | Correo al reservar, cancelar y reprogramar, y recordatorio del día con enlaces de un solo uso para confirmar o cancelar (RF30, RF34 parcial); canal elegido, por ahora solo correo (RF33 parcial); envío por correo del enlace de activación del barbero; buzón de prueba (Mailpit) en Docker Compose |
| Criterios de aceptación  | 100 % de citas con aviso; 0 recordatorios duplicados; los mensajes llevan solo los datos mínimos (principio VII) |
| Riesgos                  | Eventos perdidos (se resuelve con salida transaccional); correos duplicados; correo marcado como spam en producción |
| ADR por escribir         | ADR-025 Bus de eventos con salida transaccional (*outbox*); ADR-026 Proveedor de correo (Mailpit en desarrollo; producción por verificar) |
| Evidencias de validación | PR27, PR28 |

### Funcionalidad 005: Asistente de IA y reportes (M04)

| Campo                    | Contenido |
| ------------------------ | --------- |
| Objetivo                 | Asistente útil y seguro para el cliente y el propietario, y reportes por período |
| Historias                | HU22, HU23 (Must), HU24 |
| Alcance mínimo           | Cliente: servicios y horarios con datos de las herramientas y paso a la reserva confirmada (RF27); propietario: resúmenes de citas y servicios (RF28); reportes por período (RF29); degradación al flujo manual; proveedor simulado en CI |
| Decisiones pendientes    | 1) Tenant del cliente desde su token por barbería (ADR-020). 2) Cuotas por usuario y por barbería, en PostgreSQL. 3) Respuestas solo con datos de las herramientas, y "no lo sé" si no hay dato. 4) Proveedor con la clave solo en el backend (OpenRouter en desarrollo) y sin datos personales reales en desarrollo. 5) Inyección de instrucciones directa e indirecta, límite de longitud y casos de PR19. Además: qué se guarda de cada conversación y por cuánto tiempo, y si el barbero tiene acceso |
| Criterios de aceptación  | 0 fugas y 0 secretos en los prompts en las pruebas adversariales (EQ-19); la IA no inventa horarios; degradación ante fallo del proveedor (EQ-06) |
| Riesgos                  | Inyección o respuestas incorrectas (R10); costo (R11); proveedor caído (R09); datos personales enviados a terceros fuera del país |
| ADR por escribir         | ADR-027 Proveedor de IA (OpenRouter en desarrollo; producción por decidir; política de datos); ADR-028 Contrato del asistente: respuestas fundamentadas, cuotas y defensa ante inyección |
| Evidencias de validación | PR06, PR19, PR20 |

### Funcionalidad 006: Escalado demostrable en Docker Compose (y cierre de calidad)

| Campo                    | Contenido |
| ------------------------ | --------- |
| Objetivo                 | Demostrar que el monolito escala y tolera fallos, y cerrar la verificación de calidad |
| Historias                | Transversal |
| Alcance mínimo           | Dos réplicas del backend detrás de Nginx; Redis con claves por tenant para la caché del catálogo y la disponibilidad pública y para el límite general de solicitudes compartido; apagar una réplica (EQ-04) y apagar Redis (EQ-05) sin perder servicio; prueba de carga básica con k6 en contenedor (EQ-01 a EQ-03) |
| Criterios de aceptación  | Las metas de EQ se miden y se informan (cumplidas o no); la documentación final coincide con lo construido |
| Riesgos                  | Caché con datos de otra barbería por una clave mal armada (R01); datos viejos en caché; tareas programadas duplicadas entre réplicas; espacio en disco de las imágenes de Docker |
| ADR por escribir         | ADR-029 Redis para caché por tenant y límites compartidos (ampliación del principio VIII); ADR-030 Balanceo local con Nginx como representación de ADR-006 |
| Evidencias de validación | PR01–PR05; PR09 ampliada con las claves de caché; informe de pruebas y trazabilidad con resultados medidos |
## 4. Qué se informa y qué no

Hasta ejecutar las pruebas, los umbrales de los escenarios son **metas propuestas**. Ningún documento debe presentar un resultado de prueba que no se haya medido.
