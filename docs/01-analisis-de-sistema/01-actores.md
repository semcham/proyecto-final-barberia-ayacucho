# 01. Actores

Paso 1 del análisis: identificar quién interactúa con la plataforma y qué necesita realizar. Los actores humanos y los sistemas externos aparecen igual en el diagrama C4 nivel 1 ([Nivel1](../04-modelo-c4/Nivel1-DiagramadeContextodelSistema.md)).

## 1. Actores humanos

Lo marcado como _(planificado)_ todavía no está implementado; el resto funciona hoy (funcionalidades 001, 002 y 003).

| ID     | Actor                                                                                                                         | ¿Qué necesita realizar?                                                                                                                                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACT-01 | **Administrador de la plataforma** (no pertenece a ninguna barbería; ingresa con contraseña y segundo factor, ADR-031)        | Ver la lista de barberías con su estado y su suscripción; suspender y reactivar barberías y suscripciones; activar un plan a mano; revisar comprobantes de transferencia y pagos por revisar. Ver indicadores de uso _(planificado, 007)_. **No** ve ni cambia citas, clientes, catálogo ni usuarios de las barberías. Las barberías se registran solas |
| ACT-02 | **Propietario de barbería** (es quien administra todo en su barbería: no existe un rol administrativo aparte)                 | Registrar su barbería; configurar datos, horario de atención y servicios; gestionar barberos y usuarios; registrar citas presenciales; ver la agenda; contratar y pagar la suscripción; ver reportes y consultar al asistente de IA _(planificado, 005)_                                                                                       |
| ACT-03 | **Barbero**                                                                                                                   | Consultar su agenda; definir su disponibilidad y sus bloqueos; marcar citas como completadas o no asistidas                                                                                                                                                                                                                                      |
| ACT-04 | **Cliente**                                                                                                                   | Ver servicios y barberos por el enlace de la barbería; consultar horarios libres; crear su cuenta con consentimiento; reservar y cancelar citas; ver su historial. Reprogramar citas y **recibir la fecha y hora de su cita por correo o WhatsApp** _(planificado, 004)_; consultar al asistente de IA _(planificado, 005)_; ejercer sus derechos sobre sus datos _(planificado, 007)_ |

## 2. Sistemas externos

| ID     | Sistema externo                                                                     | ¿Qué necesita realizar?                                                                                     | Estado      |
| ------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| EXT-01 | **Proveedor de pagos** (candidato: Culqi; no contratado)                            | Procesar el pago de la suscripción con Yape; notificar el resultado con una notificación firmada            | **Simulado**: una pasarela simulada hace este papel (ADR-022); el proveedor real está planificado |
| EXT-02 | **Proveedor de IA** (por API; sin elegir)                                           | Interpretar lenguaje natural y generar respuestas dentro de herramientas cerradas                           | Planificado |
| EXT-03 | **Servicio de correo** (sin elegir)                                                 | Entregar correos de confirmación, recordatorios y avisos de cita y de suscripción                           | Planificado |
| EXT-04 | **Servicio de mensajería WhatsApp** (proveedor oficial o intermediario, sin elegir) | Entregar mensajes de confirmación, recordatorio y aviso de cambio de cita al número de WhatsApp del cliente | Planificado |

## 3. Matriz rol × módulo (resumen)

La matriz detallada rol × operación está en [seguridad-y-privacidad.md](../02-arquitectura-software/seguridad-y-privacidad.md#2-matriz-rol--operación-rbac).

| Módulo (estado)                                           | ACT-01                                                 | ACT-02                                | ACT-03                         | ACT-04                                 |
| --------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------- | ------------------------------ | -------------------------------------- |
| M01 Acceso y barberías (identidad) · implementado         | Solo su propia sesión de plataforma                    | Cuentas de su barbería                | Su cuenta                      | Su cuenta                              |
| M01 Acceso y barberías (barberías) · implementado         | Lista de todas, sin datos de negocio; suspende y reactiva | Solo la suya                       | Lectura básica                 | Catálogo público por el enlace         |
| M02 Catálogo y citas (catálogo) · implementado            | —                                                      | Gestiona                              | Lee y define su disponibilidad | Lee                                    |
| M02 Catálogo y citas (citas) · implementado               | —                                                      | Gestiona todas las de su barbería     | Gestiona las suyas             | Gestiona las suyas                     |
| M03 Suscripciones y pagos (suscripciones) · implementado  | Suspende, reactiva y activa un plan a mano             | Consulta y contrata                   | —                              | —                                      |
| M03 Suscripciones y pagos (pagos) · implementado          | Revisa comprobantes y pagos por revisar                | Paga su suscripción y ve el historial | —                              | —                                      |
| M04 Asistente IA y reportes (asistente) · planificado     | —                                                      | Consultas administrativas autorizadas | —                              | Consultas de catálogo y disponibilidad |
| M04 Asistente IA y reportes (reportes) · planificado      | Indicadores de plataforma                              | Reportes de su barbería               | Resumen propio                 | —                                      |
| M05 Notificaciones · planificado                          | —                                                      | Configura                             | Recibe                         | Recibe                                 |
| M06 Núcleo compartido y observabilidad · parcial          | Indicadores (planificado, 007)                         | —                                     | —                              | —                                      |
