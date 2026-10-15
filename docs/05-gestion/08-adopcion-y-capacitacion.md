# Adopción y capacitación de usuarios

Muchos propietarios y barberos no están acostumbrados a usar un sistema. La plataforma no puede depender de que alguien "sepa de computadoras": se diseña para que **se entienda sin curso** y, cuando haga falta, se acompaña con una capacitación corta. Complemento del [MVP](06-mvp-y-evolucion.md) y del escenario de usabilidad [EQ-15](../01-analisis-de-sistema/08-escenarios-atributos-calidad.md). Estado de todo: **planificado**; las medidas son **propuestas por validar** con las barberías.

## 1. Principio

Primero se reduce lo que hay que aprender (diseño simple); después se enseña lo que queda (ayuda dentro del sistema y capacitación breve); por último se acompaña (soporte). Cada rol aprende **solo lo que usa**.

## 2. Qué aprende cada rol

| Rol                           | Tareas que necesita dominar                                                                                                           | Tiempo objetivo de aprendizaje (por validar) |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Propietario (administra todo) | Registrar la barbería, cargar servicios y barberos, reservar y reprogramar citas por teléfono o en mostrador, ver la agenda y el plan | Una sesión guiada de unos 45 min             |
| Barbero                       | Ver su agenda, marcar una cita como atendida o no asistió, bloquear un horario                                                        | Una sesión de unos 15 min                    |
| Cliente                       | Reservar sin capacitación (EQ-15)                                                                                                     | Ninguno                                      |

## 3. Cómo se resuelve (de lo que más pesa a lo que menos)

| Medida                                     | Qué es                                                                                                                                         | Dónde se apoya                                          | Estado       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------ |
| Pantallas por rol                          | Cada rol ve solo sus opciones; el barbero tiene una vista de "mi agenda de hoy" con pocos botones                                              | RBAC del [API](../02-arquitectura-software/api-rest.md) | Planificado  |
| Lenguaje del oficio                        | Textos como "cita", "corte", "barbero"; sin términos técnicos                                                                                  | Diseño de la interfaz                                   | Planificado  |
| Configuración inicial guiada               | Asistente de primeros pasos con casillas: 1) datos de la barbería, 2) servicios, 3) barberos, 4) horarios, 5) compartir el enlace de reservas  | RF01, RF03, RF07–RF09                                   | Planificado  |
| Prueba gratuita con datos de ejemplo       | La barbería puede probar sin miedo a equivocarse; los datos de ejemplo se borran con un botón                                                  | RF18                                                    | Planificado  |
| Ayuda dentro del sistema                   | Mensajes breves en cada pantalla, textos de ayuda y una sección de preguntas frecuentes                                                        | Interfaz web                                            | Planificado  |
| Asistente de IA administrativo             | Responde "¿cómo bloqueo un horario?" o "¿cuántas citas tengo hoy?" con herramientas de solo lectura (IA-002); **no sustituye** la capacitación | RF28                                                    | Planificado  |
| Guías cortas                               | Hojas de una página con capturas por rol, para imprimir o ver en el celular, y videos de 1 a 2 minutos por tarea                               | Material de apoyo                                       | Por producir |
| Capacitación presencial o por videollamada | Sesión breve por rol, con práctica sobre la propia barbería; se puede agrupar a varias barberías                                               | Plan de la sección 4                                    | Por validar  |
| Soporte                                    | Canal de consulta (correo o WhatsApp) en horario definido, con tiempos de respuesta propuestos                                                 | Operación                                               | Por definir  |

## 4. Plan de adopción por barbería

| Etapa                           | Qué ocurre                                                                          | Resultado esperado                   |
| ------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| 1. Antes de empezar             | Conversación con el propietario: quién usará el sistema y con qué tareas            | Roles y usuarios definidos           |
| 2. Puesta en marcha             | Se acompaña la configuración inicial guiada en vivo (servicios, barberos, horarios) | Barbería lista para recibir reservas |
| 3. Capacitación por rol         | Sesiones cortas con práctica real (propietario y barbero)                           | Cada rol hace sus tareas sin ayuda   |
| 4. Primera semana               | Seguimiento: revisar dudas y errores frecuentes                                     | Ajustes a la ayuda y a las guías     |
| 5. Cierre de la prueba gratuita | Revisión de uso antes de pasar al plan de pago                                      | Decisión informada del propietario   |

## 5. Cómo se mide (propuesto, por validar)

| Indicador                                                                | Propuesta                                    | Verificación                       |
| ------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------- |
| Un propietario reserva una cita para un cliente sin ayuda tras la sesión | Meta por validar con observación de usuarios | PR15 ampliada a roles internos     |
| Un barbero marca su primera cita atendida sin ayuda                      | Meta por validar                             | Observación en la puesta en marcha |
| Consultas de soporte por barbería en la primera semana                   | Se registra para mejorar la ayuda            | Registro de soporte                |
| Barberías que completan la configuración inicial durante la prueba       | Se registra                                  | Indicadores de uso (RF31)          |

## 6. Riesgo asociado

La baja adopción es un riesgo del negocio: si el personal no usa el sistema, la agenda queda desactualizada y se pierde el valor del producto. Se mitiga con el diseño simple, la capacitación por rol y el soporte de la primera semana. Los umbrales reales se definirán con el trabajo de campo con barberías de Ayacucho; hasta entonces son **hipótesis por validar**.
