# 06. Drivers arquitectónicos

Un driver arquitectónico es un requisito, atributo o restricción que **condiciona fuertemente** la arquitectura: si cambia, cambia la solución. Se obtienen filtrando los RF, AC y RC con más impacto.

## 1. Tabla de drivers

| ID   | Driver                                      | Prioridad | Origen                       | Problema que plantea                                                  | Decisión que responde              | ¿Por qué influye en la arquitectura?                                                                                        |
| ---- | ------------------------------------------- | --------- | ---------------------------- | --------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| DA01 | Seguridad y aislamiento entre barberías     | Alta      | AC04, RC08, RF01, RF06       | Una consulta mal filtrada expone datos de otra barbería               | ADR-003, ADR-010                   | Obliga a tener contexto de tenant en cada solicitud, RLS y pruebas de fuga; afecta datos, capas y API                       |
| DA02 | Consistencia de reservas                    | Alta      | AC07, RF12, RF14             | Dos clientes reservan el mismo barbero y horario a la vez             | ADR-009, ADR-004                   | La disponibilidad definitiva se decide en PostgreSQL (restricción de exclusión y transacciones), no en caché ni en pantalla |
| DA03 | Rendimiento bajo concurrencia               | Media     | AC01, RF11, RF12             | Picos de consulta de horarios en horas punta                          | ADR-005, ADR-006                   | Caché selectiva para lecturas y capacidad de repartir carga                                                                 |
| DA04 | Escalabilidad                               | Media     | AC02, RC06                   | Crecer en barberías sin reescribir                                    | ADR-006, ADR-001                   | Backend sin estado, escalable horizontalmente; ruta de evolución por tenant                                                 |
| DA05 | Disponibilidad y resiliencia                | Media     | AC03, RC05, RC11             | Caída de instancia, Redis, pagos o IA                                 | ADR-006, ADR-012                   | Balanceo con verificación de salud, reintentos, circuit breaker y degradación                                               |
| DA06 | Mantenibilidad y evolución modular          | Alta      | AC05, RC06, RC14             | Un monolito puede volverse un enredo                                  | ADR-001, ADR-002, ADR-011          | Módulos con límites, dependencias explícitas y verificación automática                                                      |
| DA07 | Integración de pagos                        | Alta      | RF23–RF26, RC05, RC12, AC07  | Pagos duplicados, webhooks falsos, dependencia de un proveedor        | ADR-007, ADR-012                   | Puerto `PaymentGateway`, webhook autenticado e idempotente, conciliación                                                    |
| DA08 | Integración de IA                           | Media     | RF27, RF28, RC11, AC08       | IA que inventa horarios, filtra datos o se cae                        | ADR-008, ADR-012                   | Puerto `AIProvider`, herramientas cerradas, degradación al flujo manual                                                     |
| DA09 | Control de costos                           | Alta      | RC06, RC11, RC16             | Presupuesto mínimo; costo variable de IA y de mensajería              | ADR-001, ADR-006, ADR-008, ADR-013 | Una sola unidad desplegable; límites de uso de IA; escalar solo si hace falta                                               |
| DA10 | Facilidad de despliegue y pruebas           | Media     | RC06, RC14, AC05             | Equipo pequeño con poco tiempo                                        | ADR-001, ADR-006, ADR-011          | Una unidad de despliegue; dominio probable sin infraestructura                                                              |
| DA11 | Privacidad y protección de datos personales | Alta      | AC08, RC08, RF05, RF32, RF33 | Datos de clientes (incluido el número de WhatsApp) bajo Ley N.° 29733 | ADR-010, ADR-003, ADR-013          | Consentimiento, minimización, respaldos, auditoría; IA con datos mínimos                                                    |
| DA12 | Observabilidad                              | Media     | AC10, AC03                   | No se puede probar lo que no se mide                                  | ADR-012                            | Logs estructurados, identificador de correlación, métricas y alertas                                                        |

## 2. Relación de cada driver con RF, AC, EQ y ADR

| Driver | RF                     | AC         | EQ                         | ADR                                |
| ------ | ---------------------- | ---------- | -------------------------- | ---------------------------------- |
| DA01   | RF01, RF02, RF04, RF06 | AC04, AC08 | EQ-07, EQ-08, EQ-09        | ADR-003, ADR-010                   |
| DA02   | RF11, RF12, RF13, RF14 | AC07       | EQ-16                      | ADR-004, ADR-009                   |
| DA03   | RF10, RF11, RF12       | AC01       | EQ-01, EQ-02               | ADR-005, ADR-006                   |
| DA04   | RF01, RF29             | AC02       | EQ-03                      | ADR-001, ADR-006                   |
| DA05   | RF23, RF24, RF27, RF30 | AC03       | EQ-04, EQ-05, EQ-06, EQ-22 | ADR-006, ADR-012, ADR-013          |
| DA06   | Todos                  | AC05       | EQ-14                      | ADR-001, ADR-002, ADR-011          |
| DA07   | RF20, RF23–RF26        | AC07, AC09 | EQ-17, EQ-20               | ADR-007, ADR-012                   |
| DA08   | RF27, RF28             | AC08, AC09 | EQ-06, EQ-19, EQ-20        | ADR-008, ADR-012                   |
| DA09   | RF27, RF28, RF30       | AC02       | EQ-03, EQ-19               | ADR-001, ADR-006, ADR-008, ADR-013 |
| DA10   | Todos                  | AC05       | EQ-14                      | ADR-001, ADR-006, ADR-011          |
| DA11   | RF05, RF32, RF33       | AC08       | EQ-13, EQ-18, EQ-19        | ADR-003, ADR-010, ADR-013          |
| DA12   | RF31                   | AC10       | EQ-21                      | ADR-012                            |

## 3. Prioridad

Los drivers de prioridad **alta** (DA01, DA02, DA06, DA07, DA09, DA11) deciden el estilo, el modelo de datos y la estructura de módulos. Los de prioridad media se resuelven con tácticas ([tácticas](../02-arquitectura-software/tacticas-arquitectonicas.md)). Un conflicto conocido: **DA03/DA04 (rendimiento y escalabilidad) frente a DA09/DA10 (costo y simplicidad)**; se resuelve empezando con una instancia y evolucionando solo con necesidad demostrada (ADR-006).
