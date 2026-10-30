# 04. Atributos de calidad

Los atributos de calidad (AC) describen **cómo** debe comportarse el sistema, además de **qué** hace. Cada uno se concreta en uno o más escenarios medibles en [08-escenarios-atributos-calidad.md](08-escenarios-atributos-calidad.md). Una descripción como "debe ser rápido" **no** es un escenario.

## 1. Catálogo de atributos

| ID   | Atributo                     | Qué significa para la plataforma                                                                           | Prioridad | Escenarios                 |
| ---- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- | -------------------------- |
| AC01 | Rendimiento                  | Consultas de disponibilidad y reservas con tiempos aceptables en horas pico                                | Alta      | EQ-01, EQ-02               |
| AC02 | Escalabilidad                | Soportar más barberías y usuarios añadiendo instancias del mismo backend                                   | Media     | EQ-03                      |
| AC03 | Disponibilidad y resiliencia | Seguir operando ante fallos de una instancia, de Redis o de servicios externos                             | Alta      | EQ-04, EQ-05, EQ-06, EQ-22 |
| AC04 | Seguridad                    | Autenticación, autorización, aislamiento entre barberías, validación, secretos, límites de uso y auditoría | Alta      | EQ-07 a EQ-13              |
| AC05 | Mantenibilidad               | Evolucionar módulos y cambiar proveedores sin reescribir el núcleo                                         | Alta      | EQ-14                      |
| AC06 | Usabilidad                   | Reserva simple desde celular, con pocos pasos                                                              | Media     | EQ-15                      |
| AC07 | Consistencia de datos        | Sin reservas duplicadas; pagos sin efectos repetidos                                                       | Alta      | EQ-16, EQ-17               |
| AC08 | Privacidad                   | Cumplir la Ley N.° 29733 y su reglamento: consentimiento, minimización, derechos; IA con datos mínimos     | Alta      | EQ-18, EQ-19               |
| AC09 | Interoperabilidad            | Integrar pagos, IA, correo y WhatsApp mediante puertos y adaptadores intercambiables                       | Media     | EQ-20                      |
| AC10 | Observabilidad               | Registrar, medir y rastrear solicitudes para diagnosticar fallos                                           | Media     | EQ-21                      |

## 2. Subatributos de seguridad (mínimos exigidos)

| Subatributo              | Escenario | Táctica principal |
| ------------------------ | --------- | ----------------- |
| Autenticación            | EQ-07     | T06               |
| Autorización por rol     | EQ-08     | T06               |
| Aislamiento multi-tenant | EQ-09     | T11               |
| Validación de entradas   | EQ-10     | T07               |
| Gestión de secretos      | EQ-11     | T14               |
| Límite de solicitudes    | EQ-12     | T05               |
| Auditoría                | EQ-13     | T17               |
| Protección de datos      | EQ-18     | T11, T06          |

## 3. Origen de los atributos

| AC   | Se deriva de | Evidencia o razón                                                                            |
| ---- | ------------ | -------------------------------------------------------------------------------------------- |
| AC01 | RF11, RF12   | Las reservas se concentran en horas pico (hipótesis a validar con campo)                     |
| AC02 | Modelo SaaS  | Varias barberías sobre una misma instalación (OB4)                                           |
| AC03 | RF18–RF24    | Dependencia de proveedores externos de pagos e IA                                            |
| AC04 | Multi-tenant | Datos de clientes de varias barberías conviven en una base                                   |
| AC05 | RC06, RC14   | Equipo universitario, recursos limitados                                                     |
| AC06 | Contexto     | A nivel nacional el 90 % de usuarios de Internet usa celular (D-02); en Ayacucho por validar |
| AC07 | RF12, RF24   | Reserva duplicada y pago duplicado son fallos de negocio                                     |
| AC08 | RC08         | Ley N.° 29733 y D. S. N.° 016-2024-JUS                                                       |
| AC09 | RC05, RC11   | Proveedores externos sustituibles                                                            |
| AC10 | AC03, AC04   | Sin observabilidad no se verifica nada de lo anterior                                        |

> **Estado de las medidas.** Las medidas de los escenarios son **metas propuestas** que se validan con las pruebas de [04-pruebas](../05-gestion/04-pruebas.md). Ya se midieron en local, con resultados registrados en la [trazabilidad](../trazabilidad.md): EQ-01 (horarios libres, PR01), EQ-04 (caída de una réplica, PR04), EQ-05 (caída de Redis, PR05), EQ-06 de pagos (pasarela caída, PR06), EQ-07 a EQ-10, EQ-12 y EQ-13 (seguridad), EQ-16 (reservas simultáneas, PR16), EQ-17 (notificaciones de pago, PR17) y EQ-20 contra el simulador (PR20). Las demás siguen por validar.
