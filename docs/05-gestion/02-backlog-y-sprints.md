# Product Backlog y plan de seis sprints

> **Alcance del curso.** Las guías indican que el primer sprint del proyecto final es la **documentación completa** (análisis, arquitectura y diseño) y que no se exige desarrollar funcionalidades nuevas. Por eso el plan distingue:
>
> - **Entregable de documentación del curso:** Sprints 1 y 2 (y la revisión final del Sprint 6).
> - **Implementación opcional o futura:** Sprints 3 a 6, sujeta a calendario.
>
> Fechas reales y responsables: **pendientes de asignación**.

## 1. Product Backlog

| Prioridad  | HU                           | RF                     | Módulo                  | Sprint |
| ---------- | ---------------------------- | ---------------------- | ----------------------- | ------ |
| 1 (Must)   | HU02, HU05                   | RF01, RF04, RF18       | M01, M03                | 3      |
| 2 (Must)   | HU03, HU04, HU06             | RF03, RF05, RF06       | M01                     | 3      |
| 3 (Must)   | HU07, HU08, HU09, HU10       | RF07–RF10              | M02                     | 3      |
| 4 (Must)   | HU11, HU13, HU14, HU15       | RF11, RF12, RF14–RF16  | M02                     | 4      |
| 5 (Must)   | HU01, HU17, HU19             | RF02, RF19, RF21, RF22 | M01, M03                | 5      |
| 6 (Should) | HU12, HU16                   | RF13, RF17             | M02                     | 4      |
| 7 (Should) | HU18, HU20, HU21             | RF20, RF23–RF25        | M03                     | 5      |
| 8 (Should) | HU24, HU25, HU26, HU27, HU28 | RF29–RF34              | M04, M05, M06, M01, M02 | 5–6    |
| 9 (Could)  | HU22, HU23                   | RF27, RF28             | M04                     | 5      |
| 10 (Could) | —                            | RF26                   | M03                     | 5–6    |

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

### Sprint 3: Identidad, barberías y catálogo — _implementación opcional/futura_

| Campo                    | Contenido                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objetivo                 | Registrar barberías con aislamiento y gestionar el catálogo                                                                                               |
| Historias                | HU02–HU10                                                                                                                                                 |
| Tareas                   | Esqueleto del monolito modular; M01 autenticación y RBAC; M01 alta de tenant; M02 catálogo; RLS y contexto de tenant; prueba gratuita básica; CI con PR14 |
| Responsable              | _Por asignar_                                                                                                                                             |
| Criterios de aceptación  | Matriz RBAC pasa; 0 fugas entre tenants (EQ-09)                                                                                                           |
| Entregables              | Backend con M01–M02, migraciones, pruebas de aislamiento                                                                                                  |
| Riesgos                  | Curva de aprendizaje (R13, R14)                                                                                                                           |
| Evidencias de validación | PR07, PR08, PR09 en verde                                                                                                                                 |

### Sprint 4: Gestión de citas y concurrencia — _implementación opcional/futura_

| Campo                    | Contenido                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Objetivo                 | Reservar sin duplicados                                                                                                  |
| Historias                | HU10–HU16                                                                                                                |
| Tareas                   | Disponibilidad; restricción de exclusión; reserva, reprogramación, cancelación; estados; agenda; interfaz web de reserva |
| Responsable              | _Por asignar_                                                                                                            |
| Criterios de aceptación  | 200 solicitudes simultáneas → 1 cita (EQ-16)                                                                             |
| Entregables              | M02 completo, interfaz de reserva responsive                                                                             |
| Riesgos                  | Concurrencia mal manejada (R02)                                                                                          |
| Evidencias de validación | PR16, PR02, PR15                                                                                                         |

### Sprint 5: Suscripciones, pagos e IA limitada — _implementación opcional/futura_

| Campo                    | Contenido                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objetivo                 | Cerrar el modelo comercial y el asistente acotado                                                                                                           |
| Historias                | HU01, HU17–HU23, HU25 (correo primero; WhatsApp si es viable)                                                                                               |
| Tareas                   | Máquina de estados de suscripción; M03 con simulador y, si el proveedor lo permite, ambiente de pruebas; webhook idempotente; M04 con herramientas cerradas |
| Responsable              | _Por asignar_                                                                                                                                               |
| Criterios de aceptación  | Webhook repetido → 1 efecto (EQ-17); IA no inventa horarios (EQ-19)                                                                                         |
| Entregables              | M03, M04 (alcance limitado)                                                                                                                                 |
| Riesgos                  | Proveedor no confirma Yape o no da pruebas (R15); costos de IA (R11)                                                                                        |
| Evidencias de validación | PR06, PR17, PR19, PR20                                                                                                                                      |

### Sprint 6: Calidad y cierre — _revisión final de documentación + implementación opcional_

| Campo                    | Contenido                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objetivo                 | Verificar atributos de calidad y cerrar la documentación                                                                                                                                                |
| Historias                | HU24–HU28 y refinamiento                                                                                                                                                                                |
| Tareas                   | Redis, balanceador, reportes, notificaciones; pruebas de rendimiento, seguridad y aislamiento; simulacro de restauración; actualizar ADR y trazabilidad con **resultados medidos**; guion de exposición |
| Responsable              | _Por asignar_                                                                                                                                                                                           |
| Criterios de aceptación  | Las metas de EQ se miden y se informan (cumplidas o no); la documentación final coincide con lo construido                                                                                              |
| Entregables              | Informe de pruebas, ADR actualizados, `trazabilidad.md` con evidencias                                                                                                                                  |
| Riesgos                  | Falta de tiempo (R14)                                                                                                                                                                                   |
| Evidencias de validación | PR01–PR22 ejecutadas o declaradas pendientes                                                                                                                                                            |

## 3. Qué se informa y qué no

Hasta ejecutar las pruebas, los umbrales de los escenarios son **metas propuestas**. Ningún documento debe presentar un resultado de prueba que no se haya medido.
