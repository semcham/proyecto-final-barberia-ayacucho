# Matriz de trazabilidad

Permite responder: **¿de qué requisito sale este componente?** y **¿cómo se comprueba?** Cadena: **HU → RF → AC/EQ → DA → ADR → módulo/componente C4 → prueba**.

Documentos de origen: [HU](01-analisis-de-sistema/02-historias-del-usuario.md) · [RF](01-analisis-de-sistema/03-requisitos-funcionales.md) · [AC](01-analisis-de-sistema/04-atributos-de-calidad.md) · [EQ](01-analisis-de-sistema/08-escenarios-atributos-calidad.md) · [DA](01-analisis-de-sistema/06-driver-arquitectonicos.md) · [ADR](01-analisis-de-sistema/07-decisiones-arquitectonicas.md) · [Componentes](02-arquitectura-software/componentes-arquitectonicos.md) · [Pruebas](05-gestion/04-pruebas.md).

## 1. Matriz principal (de la necesidad a la prueba)

| HU   | RF                     | AC / EQ                                       | DA               | ADR               | Módulo / componente C4                | Prueba           |
| ---- | ---------------------- | --------------------------------------------- | ---------------- | ----------------- | ------------------------------------- | ---------------- |
| HU01 | RF02                   | AC04 / EQ-08, EQ-13                           | DA01             | ADR-003, 010      | M01 (+ M06 auditoría)                 | PR08, PR13       |
| HU02 | RF01, RF18             | AC04 / EQ-09                                  | DA01             | ADR-003           | M01, M03                              | PR09, PR25       |
| HU03 | RF03                   | AC04 / EQ-08, EQ-09                           | DA01             | ADR-003, 010      | M01                                   | PR08, PR09       |
| HU04 | RF06                   | AC04 / EQ-08                                  | DA01             | ADR-010           | M01                                   | PR08             |
| HU05 | RF04                   | AC04 / EQ-07, EQ-12                           | DA01             | ADR-010           | M01, Host                             | PR07, PR12       |
| HU06 | RF05, RF33             | AC08 / EQ-18                                  | DA11             | ADR-010, 013      | M01                                   | PR18             |
| HU07 | RF07                   | AC04 / EQ-08, EQ-09                           | DA01             | ADR-003, 005      | M02                                   | PR08, PR09       |
| HU08 | RF08                   | AC04 / EQ-09                                  | DA01, DA06       | ADR-003           | M02                                   | PR09             |
| HU09 | RF09                   | AC04 / EQ-09                                  | DA01             | ADR-003           | M02                                   | PR09             |
| HU10 | RF10, RF11             | AC01, AC03 / EQ-01, EQ-05                     | DA03             | ADR-005           | M02                                   | PR01, PR05       |
| HU11 | RF11, RF12, RF21       | AC01, AC07 / EQ-02, EQ-16                     | DA02, DA03       | ADR-004, 009      | M02 (+ M03)                           | PR02, PR16, PR23 |
| HU12 | RF13                   | AC07 / EQ-16                                  | DA02             | ADR-009           | M02                                   | PR16, PR24       |
| HU13 | RF14                   | AC07 / EQ-16                                  | DA02             | ADR-009           | M02                                   | PR24             |
| HU14 | RF15, RF16             | AC04 / EQ-08                                  | DA01             | ADR-010           | M02                                   | PR08, PR24       |
| HU15 | RF12, RF16             | AC04, AC07 / EQ-09, EQ-16                     | DA01, DA02       | ADR-003, 009      | M02                                   | PR09, PR16       |
| HU16 | RF17                   | AC04 / EQ-09                                  | DA01             | ADR-003           | M02                                   | PR09             |
| HU17 | RF19                   | AC05 / EQ-14                                  | DA06             | ADR-001           | M03                                   | PR25             |
| HU18 | RF20, RF23             | AC03, AC07 / EQ-06, EQ-17                     | DA07             | ADR-007, 012      | M03                                   | PR06, PR17       |
| HU19 | RF21, RF22             | AC04 / EQ-08                                  | DA06             | ADR-001, 010      | M03                                   | PR08, PR25       |
| HU20 | RF25                   | AC04 / EQ-09                                  | DA01, DA07       | ADR-003, 007      | M03                                   | PR09             |
| HU21 | RF24, RF26             | AC07, AC03 / EQ-17, EQ-06                     | DA07             | ADR-007, 012      | M03 (`pagos` → `suscripciones`)       | PR17, PR06       |
| HU22 | RF27                   | AC03, AC08 / EQ-06, EQ-12, EQ-19              | DA08, DA09       | ADR-008, 012      | M04 (+ M02)                           | PR06, PR12, PR19 |
| HU23 | RF28                   | AC08, AC04 / EQ-09, EQ-19                     | DA08, DA11       | ADR-008           | M04                                   | PR09, PR19       |
| HU24 | RF29                   | AC04 / EQ-09                                  | DA01, DA04       | ADR-003           | M04                                   | PR09             |
| HU25 | RF30, RF33             | AC03, AC08 / EQ-06, EQ-18                     | DA05, DA09, DA11 | ADR-012, 013      | M05 (+ M02 evento, M01 preferencia)   | PR06, PR27       |
| HU26 | RF31                   | AC04, AC10 / EQ-13, EQ-21                     | DA11, DA12       | ADR-010, 012      | M06                                   | PR13, PR21       |
| HU27 | RF05, RF32             | AC08 / EQ-18                                  | DA11             | ADR-010           | M01                                   | PR18             |
| HU28 | RF34, RF30, RF13, RF14 | AC03, AC04, AC07 / EQ-06, EQ-08, EQ-09, EQ-16 | DA02, DA05, DA01 | ADR-009, 010, 013 | M05 → M02 (+ M06 `SignedActionToken`) | PR27, PR28, PR16 |

## 2. Trazabilidad inversa: de cada caja de los diagramas C4 a su requisito

| Elemento (C4)                                                              | Nivel      | RF / HU de origen                             | ADR               | Pruebas                |
| -------------------------------------------------------------------------- | ---------- | --------------------------------------------- | ----------------- | ---------------------- |
| Administrador de la plataforma                                             | 1          | HU01, HU19, HU26                              | ADR-010           | PR08, PR13             |
| Propietario de barbería                                                    | 1          | HU02–HU04, HU17, HU18, HU20, HU23, HU24       | ADR-003           | PR08, PR09             |
| Barbero                                                                    | 1          | HU09, HU14                                    | ADR-010           | PR08                   |
| Cliente                                                                    | 1          | HU06, HU10–HU13, HU16, HU22, HU25, HU27, HU28 | ADR-010, 013      | PR18, PR16, PR27, PR28 |
| Plataforma SaaS                                                            | 1          | RF01–RF34                                     | ADR-001           | Todas                  |
| Proveedor de pagos                                                         | 1–3        | RF23–RF26 (HU18, HU21)                        | ADR-007           | PR17, PR20             |
| Proveedor de IA                                                            | 1–3        | RF27, RF28 (HU22, HU23)                       | ADR-008           | PR06, PR19             |
| Servicio de correo                                                         | 1–3        | RF30 (HU25)                                   | ADR-012, 013      | PR06, PR27             |
| Servicio de mensajería WhatsApp                                            | 1–3        | RF30, RF33 (HU06, HU25)                       | ADR-013           | PR06, PR27             |
| Interfaz web                                                               | 2          | RC01, RC03; HU05–HU28 (pantallas)             | ADR-002           | PR15, PR23             |
| Backend monolítico modular                                                 | 2          | RF01–RF34                                     | ADR-001, 002, 011 | PR14                   |
| PostgreSQL                                                                 | 2          | RF12 (HU11), RC04                             | ADR-003, 004, 009 | PR09, PR16, PR22       |
| Redis                                                                      | 2          | RF10, RF11 (HU10), AC01                       | ADR-005           | PR01, PR05             |
| Host y API REST                                                            | 3          | RF04 (HU05), RC03, CORS                       | ADR-001, 010      | PR07, PR26             |
| M01 Acceso y barberías (identidad)                                         | 3          | RF04, RF05, RF06, RF32 (HU04–HU06, HU27)      | ADR-010           | PR07, PR08, PR18       |
| M01 Acceso y barberías (barberías)                                         | 3          | RF01, RF02, RF03 (HU01–HU03)                  | ADR-003           | PR09                   |
| M02 Catálogo y citas (catálogo)                                            | 3          | RF07–RF10 (HU07–HU10)                         | ADR-005           | PR09, PR01             |
| M02 Catálogo y citas (citas)                                               | 3          | RF11–RF17, RF34 (HU10–HU16, HU28)             | ADR-009           | PR16, PR02             |
| M03 Suscripciones y pagos (suscripciones)                                  | 3          | RF18–RF22 (HU02, HU17–HU19)                   | ADR-007           | PR25                   |
| M03 Suscripciones y pagos (pagos)                                          | 3          | RF23–RF26 (HU18, HU20, HU21)                  | ADR-007, 012      | PR17, PR20             |
| M04 Asistente IA y reportes (asistente)                                    | 3          | RF27, RF28 (HU22, HU23)                       | ADR-008, 012      | PR19, PR06             |
| M04 Asistente IA y reportes (reportes)                                     | 3          | RF29 (HU24)                                   | ADR-003           | PR09                   |
| M05 Notificaciones                                                         | 3          | RF30, RF33, RF34 (HU25, HU28)                 | ADR-012, 013      | PR06, PR27             |
| M06 Núcleo compartido y observabilidad                                     | 3          | RF31 (HU26); soporte transversal              | ADR-005, 012      | PR13, PR21             |
| `ReservarCita`, `Cita`, `RangoHorario`, `CitaRepository`                   | 4          | RF12 (HU11)                                   | ADR-009, 011      | PR16, PR23, PR24       |
| `PaymentGateway`, `IniciarPagoDeSuscripcion`, `ProcesarConfirmacionDePago` | 4          | RF23, RF24 (HU18, HU21)                       | ADR-007, 011      | PR17, PR20             |
| Balanceador de carga ALB de AWS (despliegue)                               | Despliegue | AC02, AC03                                    | ADR-006           | PR03, PR04             |

## 3. Cobertura y verificaciones de coherencia

| Verificación                                                   | Resultado                                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Cada HU tiene al menos un RF                                   | Sí (28 de 28)                                                                                                        |
| Cada RF aparece en alguna HU                                   | Sí (RF01–RF34)                                                                                                       |
| Cada EQ tiene una prueba PRnn (mismo número)                   | Sí (EQ-01 a EQ-22 ↔ PR01 a PR22)                                                                                     |
| Cada ADR tiene al menos un driver                              | Sí (ver [ADR](01-analisis-de-sistema/07-decisiones-arquitectonicas.md))                                              |
| Cada driver tiene ADR y EQ                                     | Sí (ver [drivers](01-analisis-de-sistema/06-driver-arquitectonicos.md#2-relación-de-cada-driver-con-rf-ac-eq-y-adr)) |
| Cada módulo M01–M06 aparece en C4 nivel 3 y tiene RF de origen | Sí (excepto M06, soporte transversal con RF31)                                                                       |
| Estado de verificación                                         | **Todas las pruebas están planificadas**; la columna "Prueba" indica cómo se comprobará, no un resultado             |

> Al cierre del Sprint 6 se agregará una columna "Resultado medido" con la evidencia de cada prueba.

## 4. Funcionalidades en implementación (SDD con Spec Kit)

Cada funcionalidad especificada con Spec Kit enlaza su carpeta en `specs/` con la cadena de este documento.

| Funcionalidad                                                                                             | HU               | RF                     | Escenarios                                      | ADR                         | Componente                                                                                                            | Pruebas                                  | Estado                                 |
| --------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------- | ----------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------- |
| [001 Registro de barbería, acceso con roles y aislamiento](../specs/001-registro-acceso-barberia/spec.md) | HU02, HU04, HU05 | RF01, RF04, RF06, RF18 | EQ-07, EQ-08, EQ-09, EQ-10, EQ-12, EQ-13, EQ-14 | ADR-003, 010, 002, 011, 014 | M01 (`identidad`, `barberias`), M03 (`suscripciones`, mínimo), M06 (contexto de tenant, transacción, auditoría), Host | PR07, PR08, PR09, PR10, PR12, PR13, PR14 | Especificada y planificada; sin código |

Plan, modelo de datos y contrato de la funcionalidad: [plan](../specs/001-registro-acceso-barberia/plan.md) · [modelo de datos](../specs/001-registro-acceso-barberia/data-model.md) · [OpenAPI](../specs/001-registro-acceso-barberia/contracts/openapi.yaml).
