# Guion de exposición (12 minutos) y preguntas de defensa

## 1. Guion de 12 minutos

| Min | Tema | Qué se muestra | Documento |
|---|---|---|---|
| 0:00–1:00 | Problema y necesidad del negocio | Hipótesis frente a datos (INEI, MTPE) y plan de campo | [00](../00-contexto-negocio-y-evidencias.md) |
| 1:00–2:30 | Actores, HU y RF clave | Matriz HU ↔ RF; MVP | [01](../01-analisis-de-sistema/) |
| 2:30–4:00 | Atributos de calidad, escenarios y drivers | EQ-09, EQ-16, DA01, DA02 | [04](../01-analisis-de-sistema/04-atributos-de-calidad.md), [06](../01-analisis-de-sistema/06-driver-arquitectonicos.md), [08](../01-analisis-de-sistema/08-escenarios-atributos-calidad.md) |
| 4:00–5:30 | Decisiones: estilo y enfoque | ADR-001, 002, 011; 3 → 4 capas | [ADR](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md) |
| 5:30–7:30 | C4: contexto, contenedores y componentes | Niveles 1 a 3 (zoom) | [04-modelo-c4](../04-modelo-c4/) |
| 7:30–9:00 | Multi-tenancy y reservas sin duplicados | RLS y restricción de exclusión | [multi-tenancy](../02-arquitectura-software/multi-tenancy-y-datos.md) |
| 9:00–10:00 | Pagos, IA y resiliencia | Secuencias; degradación | [diseño interno](../03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md) |
| 10:00–11:00 | Despliegue, trazabilidad y plan | Balanceador; matriz de trazabilidad; sprints | [despliegue](../02-arquitectura-software/despliegue-y-escalabilidad.md), [trazabilidad](../trazabilidad.md) |
| 11:00–12:00 | Límites y siguientes pasos | Lo planificado frente a lo hecho; evolución | [MVP](06-mvp-y-evolucion.md) |

Reparto sugerido: cada integrante debe poder responder de qué requisito sale cualquier componente de un diagrama (consultar `trazabilidad.md`).

## 2. Quince preguntas probables de defensa

| # | Pregunta | Respuesta breve |
|---|---|---|
| 1 | ¿Por qué monolito modular y no microservicios? | Equipo pequeño, presupuesto mínimo y necesidad de transacciones locales (reservas y pagos). Los módulos con límites explícitos permiten extraer servicios luego, solo si hay necesidad demostrada (ADR-001) |
| 2 | ¿Por qué cuatro capas y no tres? | Para separar casos de uso de reglas del dominio y aislar proveedores externos; la propuesta inicial de tres capas era válida pero acoplaba lógica e infraestructura (ADR-002, 011) |
| 3 | ¿Qué diferencia hay entre estilo, enfoque y marco de trabajo? | Estilo = monolito modular (estructura y despliegue); enfoque = Clean Architecture (dependencias internas); marco = Scrum (proceso). SDD es cómo se especifica |
| 4 | ¿Cómo se evita que una barbería vea los datos de otra? | `tenant_id` tomado del token firmado, contexto por solicitud, filtro en repositorios, Row-Level Security y pruebas automáticas de fuga. `tenant_id` solo no basta (ADR-003, EQ-09) |
| 5 | ¿Cómo se evitan las reservas duplicadas? | Restricción de exclusión en PostgreSQL dentro de una transacción; ni Redis ni la pantalla deciden la disponibilidad (ADR-009, EQ-16) |
| 6 | ¿Qué pasa si falla Redis? | Se lee de PostgreSQL con más latencia; las reservas siguen correctas; se emite una alerta (EQ-05) |
| 7 | ¿Qué pasa si falla la IA? | Circuit breaker y degradación: mensaje claro y acceso al flujo manual; el resto de la plataforma sigue (EQ-06) |
| 8 | ¿La IA puede inventar horarios o leer toda la base? | No: usa herramientas cerradas por rol que llaman a casos de uso; la disponibilidad siempre sale del backend; sin SQL libre (ADR-008, EQ-19) |
| 9 | ¿Cómo se manejan los pagos duplicados? | Webhook autenticado e idempotente con índice único por evento, y conciliación de pendientes (ADR-007, EQ-17) |
| 10 | ¿El balanceador garantiza alta disponibilidad? | No. Tolera la falla de una instancia del backend; la alta disponibilidad requiere además redundancia de zonas, base de datos con Multi-AZ o réplica y pruebas; el ALB de AWS reparte entre zonas, pero hay que configurarlo y probarlo (ADR-006) |
| 11 | ¿Por qué base compartida y no una base por barbería? | Costo y operación mínimos para muchas barberías pequeñas; con RLS y pruebas; ruta de evolución para tenants grandes (ADR-003) |
| 12 | ¿Qué datos reales respaldan el problema? | Cifras nacionales y regionales del INEI y el MTPE con su nivel y fuente; no hay dato oficial de barberías de Ayacucho, por eso hay trabajo de campo; lo demás son hipótesis marcadas "por validar" |
| 13 | ¿Cumple la ley de protección de datos personales? | Se diseña para la Ley N.° 29733 y su reglamento (consentimiento, minimización, respaldos, auditoría, incidentes); está por validar su aplicación jurídica con el docente y el texto oficial |
| 14 | ¿Está implementado? | La documentación está completa; los componentes están **planificados**; las medidas de calidad son metas por validar con pruebas |
| 15 | ¿Por qué no hay app móvil ni pago de citas? | Decisión de alcance: plataforma solo web responsive; ambos quedan como evolución futura sin impacto en la arquitectura base (API REST reutilizable) |

## 3. Preguntas de trazabilidad para ensayar

- ¿De qué requisito sale M03 Suscripciones y pagos? → RF23–RF26, RC05, DA07, ADR-007 (ver [trazabilidad](../trazabilidad.md)).
- ¿Por qué existe la restricción de exclusión? → HU11, RF12, EQ-16, DA02, ADR-009.
- ¿Qué componente atiende HU22? → M04, con M02 detrás.
