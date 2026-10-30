# Guion de exposición (12 minutos) y preguntas de defensa

## 1. Guion de 12 minutos

Implementado y probado en local: funcionalidades **001** (registro y acceso), **002** (catálogo, citas y cliente), **003** (suscripciones y pagos con pasarela simulada, y administrador de la plataforma) y **006** (caché compartida y balanceo local). Planificado: **004** (notificaciones y reprogramación), **005** (asistente de IA y reportes) y **007** (indicadores y derechos sobre los datos). Nada está desplegado en la nube.

| Min         | Tema                                       | Qué se muestra                                                                                     | Documento |
| ----------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- | --------- |
| 0:00–1:00   | Problema y necesidad del negocio           | Hipótesis frente a datos (INEI, MTPE) y plan de campo                                              | [00](../00-contexto-negocio-y-evidencias.md) |
| 1:00–2:30   | Actores, HU y RF clave                      | Matriz HU ↔ RF; estado de cada RF (25 implementados, 1 parcial, 8 planificados)                    | [01](../01-analisis-de-sistema/) |
| 2:30–4:00   | Atributos de calidad, escenarios y drivers | EQ-09, EQ-16, EQ-17, DA01, DA02; cuáles ya se midieron en local                                    | [04](../01-analisis-de-sistema/04-atributos-de-calidad.md), [06](../01-analisis-de-sistema/06-driver-arquitectonicos.md), [08](../01-analisis-de-sistema/08-escenarios-atributos-calidad.md) |
| 4:00–5:00   | Decisiones: estilo y enfoque               | ADR-001, 002, 011; de 3 a 4 capas; dependencias entre módulos                                      | [ADR](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md), [estilo](../02-arquitectura-software/estilo-arquitectonico.md) |
| 5:00–6:30   | C4: contexto, contenedores y componentes   | Niveles 1 a 3 con la leyenda común (verde implementado, gris planificado)                          | [04-modelo-c4](../04-modelo-c4/) |
| 6:30–8:00   | Aislamiento entre barberías                | Barbería A, B y C en una base con RLS; qué pasa si A pide datos de B; las tres excepciones         | [multi-tenancy §1.1–1.3](../02-arquitectura-software/multi-tenancy-y-datos.md#11-cómo-se-aíslan-las-barberías-vista-general) |
| 8:00–9:00   | Reservas sin duplicados y modelo de datos  | Restricción de exclusión; los cuatro diagramas de datos                                            | [diseño interno §1](../03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md), [modelo de datos](../02-arquitectura-software/multi-tenancy-y-datos.md#3-modelo-de-datos-actual-001-002-y-003) |
| 9:00–10:00  | Pagos y administrador                      | Pago con notificación firmada y conciliación; ingreso del administrador con segundo factor         | [diseño interno §3](../03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md#3-submódulo-pagos-m03-suscripciones-y-pagos), [seguridad §4](../02-arquitectura-software/seguridad-y-privacidad.md#4-autenticación-y-sesiones) |
| 10:00–11:00 | Despliegue local y pruebas                 | Navegador → Vite → Nginx → 2 réplicas → PostgreSQL, Redis y pasarela; demo de caída de una réplica | [despliegue §2.1](../02-arquitectura-software/despliegue-y-escalabilidad.md#21-entorno-escalado-local-funcionalidad-006), [pruebas](04-pruebas.md) |
| 11:00–12:00 | Límites y siguientes pasos                 | Lo planificado frente a lo hecho; proveedor real de pagos (R15); 004, 005 y 007                    | [MVP](06-mvp-y-evolucion.md), [trazabilidad](../trazabilidad.md) |

Reparto sugerido: cada integrante debe poder responder de qué requisito sale cualquier componente de un diagrama y qué archivo del repositorio lo respalda (línea "Evidencia" debajo de cada diagrama y [trazabilidad](../trazabilidad.md)).

## 2. Preguntas probables de defensa

| #   | Pregunta                                                   | Respuesta breve |
| --- | ---------------------------------------------------------- | --------------- |
| 1   | ¿Por qué monolito modular y no microservicios?             | Equipo pequeño, presupuesto mínimo y necesidad de transacciones locales (reservas y pagos). Los módulos con límites explícitos permiten extraer servicios luego, solo si hay necesidad demostrada (ADR-001) |
| 2   | ¿Por qué cuatro capas y no tres?                           | Para separar casos de uso de reglas del dominio y aislar proveedores externos; la propuesta inicial de tres capas era válida pero acoplaba lógica e infraestructura (ADR-002, 011) |
| 3   | ¿Qué diferencia hay entre estilo, enfoque y marco de trabajo? | Estilo = monolito modular (estructura y despliegue); enfoque = Clean Architecture (dependencias internas); marco = Scrum (proceso). SDD es cómo se especifica |
| 4   | ¿Cómo se evita que una barbería vea los datos de otra?     | El tenant sale solo del token firmado; cada transacción fija `app.tenant_id`; RLS con `FORCE` en todas las tablas de barbería; el rol de la aplicación no puede omitir RLS. Si A pide un id de B recibe 404; si envía un `tenant_id`, 400 y queda auditado (ADR-003, EQ-09, PR09) |
| 5   | ¿Hay excepciones a "el tenant sale del token"?             | Tres, acotadas por la constitución 1.3.1: lectura pública por el enlace (ADR-021), selección de membresía del cliente (ADR-020) y operaciones de la plataforma (ADR-031). Ninguna usa un rol que omita RLS |
| 6   | ¿Cómo se evitan las reservas duplicadas?                   | Dos restricciones de exclusión en PostgreSQL (barbero y cliente); ni Redis ni la pantalla deciden la disponibilidad. Con 200 solicitudes simultáneas queda una sola cita (ADR-009, PR16) |
| 7   | ¿Qué pasa si falla Redis?                                  | Se lee de PostgreSQL; las reservas siguen correctas; el registro emite una sola línea `CACHE_NO_DISPONIBLE` (PR05, medido en local) |
| 8   | ¿Qué pasa si cae una réplica?                              | Nginx la saca del reparto y la otra atiende; medido en local con 0 errores en la caída (PR04, ADR-030) |
| 9   | ¿Cómo se manejan los pagos duplicados o falsos?            | La notificación del proveedor va firmada con HMAC-SHA256 y marca de tiempo; sin firma válida, 401 sin efecto. Cada `evento_id` se aplica una sola vez (`provider_event`); un solo pago abierto por suscripción; períodos sin solape. La conciliación recupera las notificaciones perdidas (ADR-022, PR17) |
| 10  | ¿Los pagos son reales?                                     | No todavía: hay una **pasarela simulada** detrás del puerto `PaymentGateway`. Pasar al proveedor real es escribir su adaptador y cambiar `PAGOS_PROVEEDOR`; depende de credenciales y de confirmar Yape (R15). La transferencia con comprobante sí funciona completa |
| 11  | ¿Quién administra la plataforma y cómo se protege?         | Una cuenta de plataforma fuera de las barberías, con contraseña y segundo factor TOTP; su token no sirve en rutas de barbería y no ve citas, clientes ni catálogo (ADR-031) |
| 12  | ¿El balanceador garantiza alta disponibilidad?             | No. Tolera la falla de una réplica; Nginx, PostgreSQL y Redis siguen siendo únicos. En la nube (planificada) el ALB repartiría entre zonas, pero hay que configurarlo y probarlo (ADR-006, ADR-030) |
| 13  | ¿Por qué base compartida y no una base por barbería?       | Costo y operación mínimos para muchas barberías pequeñas; con RLS y pruebas; ruta de evolución para tenants grandes (ADR-003) |
| 14  | ¿Qué datos reales respaldan el problema?                   | Cifras nacionales y regionales del INEI y el MTPE con su nivel y fuente; no hay dato oficial de barberías de Ayacucho, por eso hay trabajo de campo; lo demás son hipótesis marcadas "por validar" |
| 15  | ¿Cumple la ley de protección de datos personales?          | Se diseña para la Ley N.° 29733 y su reglamento. Hoy se registra el consentimiento (002) y se auditan las acciones sensibles; las solicitudes sobre los datos están planificadas (007). La aplicación jurídica está por validar |
| 16  | ¿Está implementado?                                        | Sí, en local: 001, 002, 003 y 006, con 642 pruebas unitarias, 1328 de integración, 24 de arquitectura y 133 del frontend en verde. Planificado: notificaciones (004), asistente de IA y reportes (005), indicadores y derechos sobre los datos (007). No hay despliegue en la nube |
| 17  | ¿Qué hará la IA y puede leer toda la base?                 | Está planificada (005). El diseño la limita a herramientas cerradas por rol que llaman a casos de uso; la disponibilidad siempre saldrá del backend; sin SQL libre (ADR-008) |
| 18  | ¿Por qué no hay app móvil ni pago de citas?                | Decisión de alcance: plataforma solo web responsive; ambos quedan como evolución futura sin impacto en la arquitectura base (API REST reutilizable) |

## 3. Preguntas de trazabilidad para ensayar

- ¿De qué requisito sale M03 Suscripciones y pagos? → RF18–RF26, RC05, DA07, ADR-007 y ADR-022 (ver [trazabilidad](../trazabilidad.md)).
- ¿Por qué existe la restricción de exclusión? → HU11, RF12, EQ-16, DA02, ADR-009; archivo `backend/migrations/0011_citas.ts`.
- ¿Qué prueba demuestra que A no ve los datos de B? → PR09: `backend/test/integration/aislamiento/aislamiento-tenant.spec.ts` y `rls.spec.ts`.
- ¿Qué componente atenderá HU22? → M04 (planificado, 005), con M02 detrás.
