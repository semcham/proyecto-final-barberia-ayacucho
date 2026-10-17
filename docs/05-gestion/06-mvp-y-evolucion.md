# MVP y evolución futura

## 1. MVP prioritario

| Prioridad | Capacidad                                                                                                                                                                             | RF                     | Observación                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| 1         | Barberías y usuarios con roles                                                                                                                                                        | RF01, RF04, RF06       | Base de todo                                                                      |
| 2         | Servicios y barberos                                                                                                                                                                  | RF07–RF09              | Catálogo                                                                          |
| 3         | **Reservas sin duplicados**                                                                                                                                                           | RF11, RF12, RF14–RF16  | Núcleo de valor                                                                   |
| 4         | PostgreSQL con **aislamiento multi-tenant**                                                                                                                                           | ADR-003, 009           | RLS y pruebas de fuga                                                             |
| 5         | Suscripciones básicas con prueba gratuita                                                                                                                                             | RF18, RF19, RF21, RF22 | Estados y restricciones                                                           |
| 6         | Pagos: **Yape mediante una pasarela peruana en sandbox** (si el proveedor lo permite) y **transferencia con comprobante** aprobada por el administrador de la plataforma | RF02, RF23–RF26        | Funcionalidad 003. La transferencia funciona aunque la pasarela no confirme Yape  |
| 7         | **Asistente de IA** para el cliente (servicios y horarios) y para el propietario (resúmenes y consultas autorizadas) | RF27, RF28             | **Obligatorio** desde el 2026-10-17 (antes "si hay recursos"). Funcionalidad 005  |
| 7b        | **Aviso de la cita al cliente por correo** (confirmación y **recordatorio del día de la cita con confirmar, reprogramar o cancelar**) y, si el proveedor lo permite, **por WhatsApp** | RF30, RF33, RF34       | El correo entra al MVP (funcionalidad 004); WhatsApp depende de la viabilidad del proveedor (ADR-013) |
| 8         | **Escalado demostrable**: dos réplicas del backend detrás de Nginx y Redis para caché y límites compartidos, en Docker Compose | ADR-005, 006           | Funcionalidad 006. En producción se empieza con una instancia                     |

El MVP es viable para un equipo universitario porque usa un solo desplegable, PostgreSQL resuelve la consistencia crítica y lo costoso o incierto está desacoplado detrás de puertos: los pagos tienen una alternativa (transferencia con comprobante) si la pasarela no confirma Yape, y la IA usa un proveedor intercambiable con cuotas y degradación al flujo manual. Orden de implementación y estimaciones: [backlog, sección 3](02-backlog-y-sprints.md#3-funcionalidades-002-a-006-antes-sprints-3-a-6).

## 2. Evolución futura

| Evolución                                            | Condición para hacerla                                  | Impacto en la arquitectura                                                 |
| ---------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
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
- No se afirma compatibilidad con Yape hasta confirmarla con el proveedor (ADR-007).
- Los precios de los planes son ejemplos hipotéticos.

## Adopción por parte de las barberías

La capacitación de propietarios y barberos se trata en [adopción y capacitación](08-adopcion-y-capacitacion.md).
