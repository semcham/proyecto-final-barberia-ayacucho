# MVP y evolución futura

## 1. Alcance de la entrega (mediados de noviembre de 2026)

El alcance es **completo: los 34 requisitos funcionales (RF01–RF34)**, según el [plan de entrega de 31 días](02-backlog-y-sprints.md#3-plan-de-entrega-31-días-alcance-completo) aprobado el 2026-10-17 (del lunes 19 de octubre al miércoles 18 de noviembre). Si hay atraso, se aplican las [líneas de corte](02-backlog-y-sprints.md#32-líneas-de-corte), que recortan profundidad o acabado dentro de cada funcionalidad **sin sacar nunca un RF**.

| Orden | Capacidad | RF | Funcionalidad · días |
| ----- | --------- | -- | -------------------- |
| 1 | Barberías y usuarios con roles; prueba gratuita al registrarse | RF01, RF04, RF06, RF18 | **001 implementada** |
| 2 | PostgreSQL con **aislamiento multi-tenant** | ADR-003, 009, 015 | **001 implementada**; se amplía con cada funcionalidad (PR09) |
| 3 | Servicios, barberos, disponibilidad, catálogo público y **cuenta de cliente** (una membresía `CLIENTE` por barbería) | RF03, RF05, RF07–RF11 | 002 · días 1–6 |
| 4 | **Reservas sin duplicados**, cancelación, estados de la cita, agenda e historial | RF12, RF14–RF17 | 002 · días 1–6 (PR16 obligatoria) |
| 5 | **Escalado demostrable**: Nginx con 2 réplicas, Redis para la caché del catálogo y el límite general de solicitudes con claves por tenant, demo de caída de una réplica y de Redis, prueba de carga básica | ADR-005, 006 (EQ-01 a EQ-05) | 006 · días 7–9 |
| 6 | Suscripciones: estado, plan, contratación, **restricciones por plan** y **vencimiento automático de la prueba** | RF19–RF22 | 003 · días 10–15 |
| 7 | Pagos: **Yape con pasarela en sandbox o simulada** tras `PaymentGateway` (credenciales reales solo por configuración), historial, conciliación y **transferencia con comprobante** aprobada por el administrador de la plataforma | RF02 (mínimo), RF23–RF26 | 003 · días 10–15 |
| 8 | **Notificaciones**: confirmación, cancelación, reprogramación y recordatorio del día con confirmar, reprogramar o cancelar; **reprogramar**; canal elegido por el cliente (**correo real**, **WhatsApp tras `NotificationChannel`**) | RF13, RF30, RF33, RF34 | 004 · días 16–19 |
| 9 | **Asistente de IA** para el cliente y el propietario, y **reportes** por período | RF27, RF28, RF29 | 005 · días 20–25 |
| 10 | **Indicadores de la plataforma** y **solicitudes sobre datos personales** | RF31, RF32 | 007 · días 26–28 |
| — | Colchón: pruebas, documentación y ensayo | — | días 29–31 |

El alcance completo es viable solo con disciplina de recorte: reutiliza la base de 001 (identidad, aislamiento, CI), usa un solo desplegable, PostgreSQL resuelve la consistencia crítica y lo incierto queda detrás de puertos con simuladores: la pasarela de pagos (`PaymentGateway`), el canal de WhatsApp (`NotificationChannel`) y el proveedor de IA (`AIProvider`). El calendario es muy ajustado frente a la estimación anterior (ver [riesgos del plan](02-backlog-y-sprints.md#34-riesgos-del-plan)).

## 2. Evolución futura

Ningún RF queda como evolución futura. Queda para después, documentado:

| Evolución                                            | Condición para hacerla                                  | Impacto en la arquitectura                                                 |
| ---------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Credenciales reales de la pasarela de pagos** (Yape en producción) | Proveedor confirmado y contratado (R15)  | Solo configuración: el adaptador de `PaymentGateway` ya existe (ADR-022)  |
| **Proveedor real de WhatsApp**                       | Viabilidad, costo y plantillas aprobadas (R17)          | Adaptador real de `NotificationChannel` en lugar del simulado (ADR-013)   |
| **Despliegue en AWS** (ALB, varias instancias, RDS)  | Presupuesto y validación de ADR-015 en RDS              | Documentado, no ejecutado en la entrega (ADR-006); la escalabilidad se demuestra en Docker Compose (006) |
| Análisis predictivo y recomendaciones con IA         | Datos suficientes y consentimiento                      | Nuevo módulo o ampliación de M04                                           |
| **Pago de citas por clientes**                       | Decisión comercial y cumplimiento de pagos              | Ampliar M03 (nuevo caso de uso y reglas)                                   |
| **Aplicación móvil nativa (Play Store / App Store)** | Demanda validada; presupuesto                           | Nuevo contenedor cliente que consume la misma API REST; no se diseña ahora |
| Otros canales de notificación (por ejemplo, SMS)     | Viabilidad y costo                                      | Nuevo adaptador de `NotificationChannel`                                   |
| Reportes avanzados                                   | Volumen de datos                                        | Réplica de lectura para M04                                                |
| Dominios propios por tenant                          | Plan comercial                                          | Cambios en el host y en el balanceador                                     |
| Base de datos dedicada para tenants grandes          | Un tenant domina la carga                               | Evolución de ADR-003 sin cambiar casos de uso                              |
| Separar servicios (microservicios)                   | **Necesidad demostrada** (p. ej. IA con carga distinta) | Extraer un módulo detrás de su interfaz pública                            |

## 3. Lo que no se promete

- No se afirma alta disponibilidad (ver [despliegue](../02-arquitectura-software/despliegue-y-escalabilidad.md#6-alta-disponibilidad-lo-que-no-se-afirma)).
- No se afirma compatibilidad con Yape hasta confirmarla con el proveedor (ADR-007); en la entrega, la pasarela funciona en sandbox o simulada.
- WhatsApp funciona como canal simulado hasta contratar un proveedor; el canal real de la entrega es el correo.
- El despliegue en AWS está documentado, no ejecutado.
- Los precios de los planes son ejemplos hipotéticos.

## Adopción por parte de las barberías

La capacitación de propietarios y barberos se trata en [adopción y capacitación](08-adopcion-y-capacitacion.md).
