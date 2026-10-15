# 01. Actores

Paso 1 del análisis: identificar quién interactúa con la plataforma y qué necesita realizar. Los actores humanos y los sistemas externos aparecen igual en el diagrama C4 nivel 1 ([Nivel1](../04-modelo-c4/Nivel1-DiagramadeContextodelSistema.md)).

## 1. Actores humanos

| ID     | Actor                                                                                                                         | ¿Qué necesita realizar?                                                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACT-01 | **Administrador de la plataforma**                                                                                            | Dar de alta, suspender y reactivar barberías; definir planes; ver indicadores de uso y auditoría; soporte. No gestiona citas de las barberías                                                                                                                   |
| ACT-02 | **Propietario / administrador de barbería** (es quien administra todo en su barbería: no existe un rol administrativo aparte) | Registrar su barbería; atender reservas presenciales o telefónicas; configurar horarios y servicios; gestionar barberos y usuarios; ver agenda y reportes; contratar y pagar la suscripción; consultar al asistente de IA                                       |
| ACT-03 | **Barbero**                                                                                                                   | Consultar su agenda; definir su disponibilidad; marcar citas como completadas o no asistidas                                                                                                                                                                    |
| ACT-04 | **Cliente**                                                                                                                   | Ver servicios y barberos; consultar disponibilidad; reservar, modificar y cancelar citas; ver su historial; consultar al asistente de IA; ejercer sus derechos sobre sus datos; **recibir la fecha y hora de su cita por correo o WhatsApp** y elegir ese canal |

## 2. Sistemas externos

| ID     | Sistema externo                                                                     | ¿Qué necesita realizar?                                                                                     | Estado      |
| ------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| EXT-01 | **Proveedor de pagos** (candidato: Culqi; no contratado)                            | Procesar el pago de la suscripción; notificar el resultado por webhook autenticado                          | Planificado |
| EXT-02 | **Proveedor de IA** (por API; sin elegir)                                           | Interpretar lenguaje natural y generar respuestas dentro de herramientas cerradas                           | Planificado |
| EXT-03 | **Servicio de correo** (sin elegir)                                                 | Entregar correos de confirmación, recordatorios y avisos de cita y de suscripción                           | Planificado |
| EXT-04 | **Servicio de mensajería WhatsApp** (proveedor oficial o intermediario, sin elegir) | Entregar mensajes de confirmación, recordatorio y aviso de cambio de cita al número de WhatsApp del cliente | Planificado |

## 3. Matriz rol × módulo (resumen)

La matriz detallada rol × operación está en [seguridad-y-privacidad.md](../02-arquitectura-software/seguridad-y-privacidad.md#2-matriz-rol--operación-rbac).

| Módulo                                    | ACT-01                          | ACT-02                                | ACT-03                         | ACT-04                                 |
| ----------------------------------------- | ------------------------------- | ------------------------------------- | ------------------------------ | -------------------------------------- |
| M01 Acceso y barberías (identidad)        | Todas las cuentas de plataforma | Cuentas de su barbería                | Su cuenta                      | Su cuenta                              |
| M01 Acceso y barberías (barberías)        | Todas                           | Solo la suya                          | Lectura básica                 | Catálogo público                       |
| M02 Catálogo y citas (catálogo)           | —                               | Gestiona                              | Lee y define su disponibilidad | Lee                                    |
| M02 Catálogo y citas (citas)              | —                               | Gestiona todas las de su barbería     | Gestiona las suyas             | Gestiona las suyas                     |
| M03 Suscripciones y pagos (suscripciones) | Gestiona estados y planes       | Consulta y contrata                   | —                              | —                                      |
| M03 Suscripciones y pagos (pagos)         | Auditoría                       | Paga su suscripción                   | —                              | —                                      |
| M04 Asistente IA y reportes (asistente)   | —                               | Consultas administrativas autorizadas | —                              | Consultas de catálogo y disponibilidad |
| M04 Asistente IA y reportes (reportes)    | Indicadores de plataforma       | Reportes de su barbería               | Resumen propio                 | —                                      |
| M05 Notificaciones                        | —                               | Configura                             | Recibe                         | Recibe                                 |
| M06 Núcleo compartido y observabilidad    | Auditoría y observabilidad      | —                                     | —                              | —                                      |
