# Escenarios de atributos de calidad de la plataforma

Un escenario de atributo de calidad es una descripción **concreta y medible** de cómo debe responder el sistema ante un estímulo para cumplir un atributo de calidad. Una descripción general ("debe ser rápido") no es un escenario. Cada escenario sigue las **seis partes de la Guía 04** (fuente del estímulo, estímulo, artefacto, entorno, respuesta y medida de la respuesta) y agrega **Verificación** y **Estado**, como en el archivo de ejemplo de la guía.

> **Las medidas numéricas son metas propuestas** que se comprueban con las pruebas indicadas (la prueba PRnn corresponde al escenario EQ-nn; ver [pruebas](../05-gestion/04-pruebas.md)). La fila **Estado** dice si ya se midió en local, con qué funcionalidad, o si sigue **por medir**; los resultados completos están en la [trazabilidad](../trazabilidad.md). Ningún escenario se ha medido en la nube. Catálogo de atributos: [04-atributos-de-calidad.md](04-atributos-de-calidad.md).

## EQ-01. Rendimiento: Consulta de disponibilidad en hora pico

| Elemento                | Descripción                                                            |
| ----------------------- | ---------------------------------------------------------------------- |
| **Atributo de calidad** | Rendimiento (AC01)                                                     |
| **Fuente**              | Clientes que consultan horarios                                        |
| **Estímulo**            | 50 usuarios concurrentes consultan disponibilidad de la misma barbería |
| **Artefacto**           | Módulo M02 Catálogo y citas, API REST, caché Redis                     |
| **Entorno / condición** | Operación normal, una instancia, catálogo y horarios en caché          |
| **Respuesta esperada**  | El sistema devuelve horarios libres calculados con los datos vigentes  |
| **Medida**              | p95 ≤ 800 ms y 0 % de errores 5xx _(propuesta por validar)_            |
| **Verificación**        | PR01: prueba de carga (por ejemplo k6 o Locust)                        |
| **Estado**              | Medido en local (006): con 2 réplicas y caché, p95 de 288 y 273 ms en caliente y 0 % de 5xx (en frío, 831 y 765 ms) |

## EQ-02. Rendimiento: Creación de cita bajo carga

| Elemento                | Descripción                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| **Atributo de calidad** | Rendimiento (AC01)                                                               |
| **Fuente**              | Clientes que reservan                                                            |
| **Estímulo**            | 20 solicitudes de reserva por segundo durante 5 minutos sobre distintos horarios |
| **Artefacto**           | M02, PostgreSQL                                                                  |
| **Entorno / condición** | Operación normal, dos instancias tras el balanceador                             |
| **Respuesta esperada**  | Cada reserva se confirma o se rechaza con motivo                                 |
| **Medida**              | p95 ≤ 1 500 ms; tasa de error técnico < 1 % _(propuesta por validar)_            |
| **Verificación**        | PR02: prueba de carga con datos de prueba                                        |
| **Estado**              | Por medir |

## EQ-03. Escalabilidad: Agregar una instancia

| Elemento                | Descripción                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Atributo de calidad** | Escalabilidad (AC02)                                                                                                           |
| **Fuente**              | Operador de la plataforma                                                                                                      |
| **Estímulo**            | El tráfico se duplica y se agrega una segunda instancia del backend                                                            |
| **Artefacto**           | Balanceador de carga, instancias del monolito, pool de conexiones a PostgreSQL                                                 |
| **Entorno / condición** | Sin interrupción del servicio, sesiones sin estado                                                                             |
| **Respuesta esperada**  | La nueva instancia recibe tráfico tras superar la verificación de salud                                                        |
| **Medida**              | Sin cambios de código; 0 solicitudes perdidas durante el alta; throughput ≥ 1,6× el de una instancia _(propuesta por validar)_ |
| **Verificación**        | PR03: prueba de escalado con carga constante                                                                                   |
| **Estado**              | Por medir |

## EQ-04. Disponibilidad: Falla de una instancia

| Elemento                | Descripción                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Disponibilidad (AC03)                                                                               |
| **Fuente**              | Fallo de infraestructura                                                                            |
| **Estímulo**            | Una de dos instancias del backend deja de responder                                                 |
| **Artefacto**           | Balanceador de carga (verificación de salud)                                                        |
| **Entorno / condición** | Operación normal con tráfico                                                                        |
| **Respuesta esperada**  | El balanceador deja de enviar tráfico a la instancia caída y la otra atiende                        |
| **Medida**              | Detección en ≤ 15 s; ≤ 2 % de solicitudes con error durante la transición _(propuesta por validar)_ |
| **Verificación**        | PR04: detener una instancia durante la carga                                                        |
| **Estado**              | Medido en local (006): PR04 con Compose, 0 errores al detener una réplica; 503 en menos de 3 s sin réplicas |

## EQ-05. Disponibilidad: Caída de Redis

| Elemento                | Descripción                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Disponibilidad (AC03)                                                                   |
| **Fuente**              | Fallo de infraestructura                                                                |
| **Estímulo**            | Redis deja de estar disponible                                                          |
| **Artefacto**           | Adaptador de caché (M06), M02                                                           |
| **Entorno / condición** | Operación normal                                                                        |
| **Respuesta esperada**  | El sistema consulta directamente PostgreSQL; las reservas siguen siendo correctas       |
| **Medida**              | 0 reservas incorrectas; p95 de lecturas ≤ 2 s; alerta emitida _(propuesta por validar)_ |
| **Verificación**        | PR05: detener Redis durante pruebas funcionales y de carga                              |
| **Estado**              | Medido en local (006): PR05 con Redis detenido, 0 errores y 20 reservas sin duplicados |

## EQ-06. Disponibilidad: Falla del proveedor de IA, de pagos o de mensajería

| Elemento                | Descripción                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Disponibilidad / resiliencia (AC03)                                                                                                                                                                                                                                     |
| **Fuente**              | Proveedor externo de IA, de pagos, de correo o de WhatsApp                                                                                                                                                                                                              |
| **Estímulo**            | El proveedor responde con error o excede el tiempo límite                                                                                                                                                                                                               |
| **Artefacto**           | Adaptadores `AIProvider`, `PaymentGateway` y `NotificationChannel` (correo y WhatsApp), circuit breaker                                                                                                                                                                 |
| **Entorno / condición** | Operación normal                                                                                                                                                                                                                                                        |
| **Respuesta esperada**  | Se reintenta con espera; el circuito se abre y se muestra una alternativa (flujo manual de reserva; "pago pendiente de confirmación"; la notificación por WhatsApp se reenvía por correo)                                                                               |
| **Medida**              | Circuito abierto tras 5 fallos en 60 s; mensaje alternativo en ≤ 3 s; el resto de la plataforma sigue operando; la reserva no se deshace por un fallo de envío; ≥ 95 % de las citas con una notificación entregada por algún canal en ≤ 5 min _(propuesta por validar)_ |
| **Verificación**        | PR06: simulador de proveedor con errores y latencias                                                                                                                                                                                                                    |
| **Estado**              | Parcial: medido para pagos contra el simulador (PR06, 003); IA y mensajería planificadas (004 y 005) |

## EQ-07. Seguridad: Autenticación

| Elemento                | Descripción                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad: autenticación (AC04)                                                                                                    |
| **Fuente**              | Usuario no autenticado o atacante                                                                                                  |
| **Estímulo**            | Acceso a un recurso protegido sin token, con token vencido o manipulado                                                            |
| **Artefacto**           | M01 Acceso y barberías, middleware de autenticación                                                                                |
| **Entorno / condición** | Operación normal                                                                                                                   |
| **Respuesta esperada**  | Se rechaza con 401 sin revelar detalles                                                                                            |
| **Medida**              | 100 % de las solicitudes inválidas rechazadas; contraseñas almacenadas con algoritmo de hash lento y sal _(propuesta por validar)_ |
| **Verificación**        | PR07: pruebas de autenticación y revisión de configuración                                                                         |
| **Estado**              | Prueba en verde en local (PR07, 001) |

## EQ-08. Seguridad: Autorización por rol

| Elemento                | Descripción                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad: autorización (AC04)                                                                                      |
| **Fuente**              | Cliente o barbero autenticado                                                                                       |
| **Estímulo**            | Intenta una operación administrativa (por ejemplo, crear un servicio o ver reportes)                                |
| **Artefacto**           | M01, casos de uso de M02 y M04                                                                                      |
| **Entorno / condición** | Operación normal                                                                                                    |
| **Respuesta esperada**  | Se rechaza con 403 y se registra el intento                                                                         |
| **Medida**              | 100 % de los casos de la matriz rol × operación rechazados o permitidos según corresponda _(propuesta por validar)_ |
| **Verificación**        | PR08: suite parametrizada sobre la matriz RBAC                                                                      |
| **Estado**              | Prueba en verde en local (PR08: `rbac-002` y `rbac-003`, la tabla completa celda por celda) |

## EQ-09. Seguridad: Aislamiento multi-tenant

| Elemento                | Descripción                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad: aislamiento (AC04)                                                                                                            |
| **Fuente**              | Usuario autenticado de la barbería A                                                                                                     |
| **Estímulo**            | Intenta leer o modificar datos de la barbería B (cambiando identificadores, parámetros o cuerpo)                                         |
| **Artefacto**           | Contexto de tenant (M01/M06), repositorios, políticas RLS de PostgreSQL                                                                  |
| **Entorno / condición** | Operación normal, varias barberías con datos                                                                                             |
| **Respuesta esperada**  | Ningún dato de B es visible o modificable; se rechaza o devuelve vacío                                                                   |
| **Medida**              | 0 filtraciones en la suite de pruebas de fuga sobre todos los endpoints; el `tenant_id` se toma solo del token _(propuesta por validar)_ |
| **Verificación**        | PR09: pruebas automáticas de fuga (incluye consultas sin filtro para comprobar que RLS bloquea)                                          |
| **Estado**              | Prueba en verde en local (PR09, 001 a 003 y 006) |

## EQ-10. Seguridad: Validación de entradas

| Elemento                | Descripción                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad: validación de entradas (AC04)                                                                                           |
| **Fuente**              | Atacante o usuario con error                                                                                                       |
| **Estímulo**            | Envía datos mal formados, demasiado largos, con inyección SQL o scripts                                                            |
| **Artefacto**           | Capa de presentación (API) y casos de uso                                                                                          |
| **Entorno / condición** | Operación normal                                                                                                                   |
| **Respuesta esperada**  | Se rechaza con 400 y mensaje controlado; no se ejecuta contenido                                                                   |
| **Medida**              | 100 % de las cargas del conjunto de pruebas rechazadas o neutralizadas; consultas siempre parametrizadas _(propuesta por validar)_ |
| **Verificación**        | PR10: pruebas de entradas inválidas y análisis estático                                                                            |
| **Estado**              | Prueba en verde en local (PR10, 001 y 002) |

## EQ-11. Seguridad: Gestión de secretos

| Elemento                | Descripción                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad: secretos (AC04)                                                                                           |
| **Fuente**              | Desarrollador o atacante con acceso al repositorio                                                                   |
| **Estímulo**            | Intento de obtener claves del proveedor de pagos, de IA o de la base de datos                                        |
| **Artefacto**           | Configuración, repositorio, variables de entorno                                                                     |
| **Entorno / condición** | Desarrollo y producción                                                                                              |
| **Respuesta esperada**  | Los secretos no están en el código ni en los registros; se leen de variables de entorno o gestor de secretos         |
| **Medida**              | 0 secretos detectados por la herramienta de escaneo; rotación posible sin cambio de código _(propuesta por validar)_ |
| **Verificación**        | PR11: escaneo de secretos en el repositorio y en el historial                                                        |
| **Estado**              | Por medir |

## EQ-12. Seguridad: Límite de solicitudes

| Elemento                | Descripción                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad: abuso y fuerza bruta (AC04)                                                                                           |
| **Fuente**              | Atacante o bot                                                                                                                   |
| **Estímulo**            | Más de 5 intentos de inicio de sesión fallidos por minuto desde la misma IP y cuenta; ráfagas contra la API o el asistente de IA |
| **Artefacto**           | Middleware de limitación, M01, M04                                                                                               |
| **Entorno / condición** | Operación normal                                                                                                                 |
| **Respuesta esperada**  | Se responde 429 y se aplica espera creciente                                                                                     |
| **Medida**              | El intento 6 y siguientes se rechazan; el uso normal no se ve afectado _(propuesta por validar)_                                 |
| **Verificación**        | PR12: prueba de limitación                                                                                                       |
| **Estado**              | Prueba en verde en local (PR12, 001); el límite del asistente de IA está planificado (005) |

## EQ-13. Seguridad: Auditoría

| Elemento                | Descripción                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad: auditoría (AC04)                                                                                             |
| **Fuente**              | Usuario con rol privilegiado                                                                                            |
| **Estímulo**            | Suspende una barbería, cambia roles o modifica un plan                                                                  |
| **Artefacto**           | Servicio de auditoría (M06)                                                                                             |
| **Entorno / condición** | Operación normal                                                                                                        |
| **Respuesta esperada**  | Se registra quién, qué, cuándo, desde dónde y sobre qué tenant                                                          |
| **Medida**              | 100 % de las acciones sensibles listadas generan registro inmutable para el rol de aplicación _(propuesta por validar)_ |
| **Verificación**        | PR13: revisión de registros tras ejecutar acciones sensibles                                                            |
| **Estado**              | Prueba en verde en local (PR13, 001 a 003) |

## EQ-14. Mantenibilidad: Cambio de proveedor sin tocar reglas de negocio

| Elemento                | Descripción                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Mantenibilidad (AC05)                                                                                                                                                                          |
| **Fuente**              | Equipo de desarrollo                                                                                                                                                                           |
| **Estímulo**            | Se decide cambiar el proveedor de pagos o de IA, o agregar un método de pago                                                                                                                   |
| **Artefacto**           | Puertos y adaptadores (M03, M04), módulos del monolito                                                                                                                                         |
| **Entorno / condición** | Desarrollo                                                                                                                                                                                     |
| **Respuesta esperada**  | Solo se escribe un nuevo adaptador y se cambia la configuración                                                                                                                                |
| **Medida**              | 0 archivos modificados en las capas de Dominio y Aplicación; pruebas de contrato del puerto en verde; 0 violaciones en la verificación de dependencias entre módulos _(propuesta por validar)_ |
| **Verificación**        | PR14: prueba de arquitectura (dependencias) y pruebas de contrato                                                                                                                              |
| **Estado**              | Parcial: reglas de dependencias en verde (PR14, 24/24); el cambio al proveedor real no se ha hecho |

## EQ-15. Usabilidad: Reserva simple desde celular

| Elemento                | Descripción                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Usabilidad (AC06)                                                                      |
| **Fuente**              | Cliente nuevo                                                                          |
| **Estímulo**            | Reserva una cita desde un celular con navegador                                        |
| **Artefacto**           | Interfaz web (Presentación)                                                            |
| **Entorno / condición** | Sin capacitación previa                                                                |
| **Respuesta esperada**  | Completa la reserva sin ayuda                                                          |
| **Medida**              | ≤ 5 pasos y ≤ 2 minutos; ≥ 80 % de éxito con 5 participantes _(propuesta por validar)_ |
| **Verificación**        | PR15: prueba de usabilidad con usuarios (puede hacerse en el trabajo de campo)         |
| **Estado**              | Por medir |

## EQ-16. Consistencia: Reservas simultáneas del mismo horario

| Elemento                | Descripción                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Consistencia (AC07)                                                                           |
| **Fuente**              | Dos o más clientes simultáneos                                                                |
| **Estímulo**            | 200 solicitudes de reserva concurrentes para el mismo barbero y el mismo horario              |
| **Artefacto**           | M02, PostgreSQL (restricción de exclusión, transacción)                                       |
| **Entorno / condición** | Dos instancias del backend, con o sin Redis disponible                                        |
| **Respuesta esperada**  | Una reserva se acepta; las demás reciben rechazo con mensaje de horario no disponible         |
| **Medida**              | Exactamente 1 cita activa por barbero y rango horario; 0 duplicados _(propuesta por validar)_ |
| **Verificación**        | PR16: prueba de concurrencia y comprobación en base de datos                                  |
| **Estado**              | Prueba en verde en local (PR16, 002), también a través de Nginx con 2 réplicas (006) |

## EQ-17. Consistencia: Notificación de pago repetida

| Elemento                | Descripción                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Consistencia / idempotencia (AC07)                                                                              |
| **Fuente**              | Proveedor de pagos (o atacante)                                                                                 |
| **Estímulo**            | La misma notificación de pago llega 10 veces, o llega una con firma inválida                                    |
| **Artefacto**           | M03 Suscripciones y pagos (submódulos `pagos` y `suscripciones`)                                                |
| **Entorno / condición** | Operación normal                                                                                                |
| **Respuesta esperada**  | Solo el primer evento válido modifica la suscripción; la firma inválida se rechaza                              |
| **Medida**              | 1 transición de estado y 1 registro de pago; 100 % de las firmas inválidas rechazadas _(propuesta por validar)_ |
| **Verificación**        | PR17: pruebas de idempotencia y de firma                                                                        |
| **Estado**              | Prueba en verde en local (PR17, 003): 10 notificaciones iguales producen 1 efecto; la firma inválida se rechaza con 401 |

## EQ-18. Privacidad: Consentimiento y derechos sobre los datos

| Elemento                | Descripción                                                                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Privacidad (AC08)                                                                                                                                                                                                          |
| **Fuente**              | Cliente o propietario                                                                                                                                                                                                      |
| **Estímulo**            | Se registra (eligiendo canal de notificación) y, luego, solicita acceso o eliminación de sus datos                                                                                                                         |
| **Artefacto**           | M01, registro de consentimiento, solicitudes de datos                                                                                                                                                                      |
| **Entorno / condición** | Operación normal                                                                                                                                                                                                           |
| **Respuesta esperada**  | Se guarda el consentimiento (fecha, versión del texto), incluido el de recibir mensajes por WhatsApp, y la solicitud se atiende con seguimiento                                                                            |
| **Medida**              | 100 % de registros con consentimiento; 0 mensajes de WhatsApp enviados sin consentimiento registrado; solicitudes atendidas en el plazo interno propuesto de 10 días hábiles _(por validar contra el plazo legal vigente)_ |
| **Verificación**        | PR18: prueba funcional y revisión de procedimiento                                                                                                                                                                         |
| **Estado**              | Parcial: consentimiento implementado (002); WhatsApp y solicitudes sobre los datos planificados (004 y 007) |

## EQ-19. Privacidad: Privacidad en el asistente de IA

| Elemento                | Descripción                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Atributo de calidad** | Privacidad y seguridad de IA (AC08)                                                                                                  |
| **Fuente**              | Usuario del asistente (incluye intento de prompt injection)                                                                          |
| **Estímulo**            | Pide datos de otra barbería, solicita una consulta libre a la base de datos o intenta que el asistente ignore sus reglas             |
| **Artefacto**           | M04 Asistente IA y reportes, herramientas cerradas por rol                                                                           |
| **Entorno / condición** | Operación normal                                                                                                                     |
| **Respuesta esperada**  | El asistente rechaza o ignora; solo accede a datos del tenant y rol autenticados, con el mínimo necesario                            |
| **Medida**              | 0 fugas en el conjunto de pruebas adversariales; 0 secretos en los prompts; 100 % de consultas registradas _(propuesta por validar)_ |
| **Verificación**        | PR19: pruebas adversariales y revisión de prompts y registros                                                                        |
| **Estado**              | Por medir |

## EQ-20. Interoperabilidad: Integración mediante puertos

| Elemento                | Descripción                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Interoperabilidad (AC09)                                                                                                |
| **Fuente**              | Equipo de desarrollo                                                                                                    |
| **Estímulo**            | Se sustituye un adaptador por una implementación simulada o por otro proveedor                                          |
| **Artefacto**           | Puerto `PaymentGateway` (implementado); `AIProvider` y `NotificationChannel` (planificados)                            |
| **Entorno / condición** | Pruebas                                                                                                                 |
| **Respuesta esperada**  | Los casos de uso funcionan igual con cualquier implementación que cumpla el contrato                                    |
| **Medida**              | Misma suite de contrato en verde con el adaptador real (entorno de pruebas) y con el simulado _(propuesta por validar)_ |
| **Verificación**        | PR20: pruebas de contrato                                                                                               |
| **Estado**              | Parcial: PR20 en verde contra el simulador; contra el sandbox, omitida por falta de credenciales |

## EQ-21. Observabilidad: Diagnóstico de una solicitud fallida

| Elemento                | Descripción                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Observabilidad (AC10)                                                                                                                                                         |
| **Fuente**              | Operador                                                                                                                                                                      |
| **Estímulo**            | Un cliente reporta un error al reservar                                                                                                                                       |
| **Artefacto**           | Registro estructurado, identificador de correlación, métricas (M06)                                                                                                           |
| **Entorno / condición** | Producción                                                                                                                                                                    |
| **Respuesta esperada**  | El operador localiza la solicitud y su traza de extremo a extremo                                                                                                             |
| **Medida**              | 100 % de las solicitudes con identificador de correlación; alerta si 5xx > 2 % durante 5 minutos; sin datos personales ni secretos en los registros _(propuesta por validar)_ |
| **Verificación**        | PR21: revisión de registros y prueba de alerta                                                                                                                                |
| **Estado**              | Por medir |

## EQ-22. Disponibilidad: Recuperación ante pérdida de datos

| Elemento                | Descripción                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Disponibilidad / recuperación (AC03)                                                                                                         |
| **Fuente**              | Fallo o error operativo                                                                                                                      |
| **Estímulo**            | Se pierde o corrompe la base de datos                                                                                                        |
| **Artefacto**           | PostgreSQL, procedimiento de respaldo                                                                                                        |
| **Entorno / condición** | Producción                                                                                                                                   |
| **Respuesta esperada**  | Se restaura desde el último respaldo verificado                                                                                              |
| **Medida**              | RPO ≤ 24 h y RTO ≤ 4 h; respaldos al menos semanales exigidos por la normativa (según fuente secundaria), diarios propuestos _(por validar)_ |
| **Verificación**        | PR22: simulacro de restauración en entorno de pruebas                                                                                        |
| **Estado**              | Por medir |

## Resumen de escenarios

| Código | Atributo de calidad       | Qué se busca comprobar                                    |
| ------ | ------------------------- | --------------------------------------------------------- |
| EQ-01  | Rendimiento               | Tiempo de respuesta al consultar horarios con 50 usuarios |
| EQ-02  | Rendimiento               | Tiempo y errores al reservar bajo carga                   |
| EQ-03  | Escalabilidad             | Agregar una instancia sin cambios y sin pérdida           |
| EQ-04  | Disponibilidad            | Continuidad si cae una instancia                          |
| EQ-05  | Disponibilidad            | Continuidad correcta si cae Redis                         |
| EQ-06  | Resiliencia               | Degradación controlada si fallan IA o pagos               |
| EQ-07  | Seguridad (autenticación) | Rechazo de tokens ausentes, vencidos o falsos             |
| EQ-08  | Seguridad (autorización)  | Cumplimiento de la matriz rol × operación                 |
| EQ-09  | Seguridad (aislamiento)   | Cero fugas entre barberías                                |
| EQ-10  | Seguridad (validación)    | Rechazo de entradas maliciosas o mal formadas             |
| EQ-11  | Seguridad (secretos)      | Ausencia de secretos en código y registros                |
| EQ-12  | Seguridad (abuso)         | Limitación de intentos y ráfagas                          |
| EQ-13  | Seguridad (auditoría)     | Registro de acciones sensibles                            |
| EQ-14  | Mantenibilidad            | Cambiar proveedor sin tocar dominio ni aplicación         |
| EQ-15  | Usabilidad                | Reserva simple desde celular                              |
| EQ-16  | Consistencia              | Cero reservas duplicadas bajo concurrencia                |
| EQ-17  | Consistencia              | Idempotencia y autenticidad de la notificación de pago    |
| EQ-18  | Privacidad                | Consentimiento y derechos sobre los datos                 |
| EQ-19  | Privacidad (IA)           | Cero fugas y resistencia a prompt injection               |
| EQ-20  | Interoperabilidad         | Adaptadores intercambiables por contrato                  |
| EQ-21  | Observabilidad            | Diagnóstico de extremo a extremo                          |
| EQ-22  | Recuperación              | Restaurar desde respaldo dentro de RPO y RTO              |
