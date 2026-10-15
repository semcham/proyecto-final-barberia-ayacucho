# 07. Decisiones arquitectónicas (ADR)

Un ADR registra **qué** se decidió, **por qué**, qué alternativas se descartaron y qué consecuencias trae. Todas las decisiones nacen de un driver ([06](06-driver-arquitectonicos.md)). Estado de todos: **Propuesto** (pendiente de aprobación del equipo).

## 1. Tabla resumen

| ID      | Decisión                                                           | Driver relacionado     | Justificación                                                                                            | Resultado                                                                                              |
| ------- | ------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| ADR-001 | Monolito modular                                                   | DA04, DA06, DA09, DA10 | Complejidad adecuada a un equipo pequeño, bajo costo, un solo despliegue                                 | Un backend, 6 módulos con límites                                                                      |
| ADR-002 | Arquitectura lógica de cuatro capas                                | DA06                   | Separa presentación, aplicación, dominio e infraestructura                                               | 4 capas dentro de cada módulo                                                                          |
| ADR-003 | Multi-tenancy: base compartida con `tenant_id` + RLS               | DA01, DA11, DA09       | Menor costo y operación sencilla, con aislamiento reforzado en la base                                   | Una base; políticas RLS; ruta de evolución para tenants grandes                                        |
| ADR-004 | PostgreSQL como base principal                                     | DA02, DA01             | Transacciones, restricciones de exclusión, RLS                                                           | PostgreSQL fuente de verdad                                                                            |
| ADR-005 | Redis como caché selectiva                                         | DA03                   | Aliviar lecturas frecuentes sin comprometer la consistencia                                              | Caché con claves por tenant, nunca fuente de verdad                                                    |
| ADR-006 | Balanceador de carga y escalado horizontal                         | DA03, DA04, DA05       | Repartir carga y tolerar la caída de una instancia                                                       | ALB de AWS + instancias sin estado; una instancia al inicio                                            |
| ADR-007 | Módulo de pagos desacoplado                                        | DA07                   | Cambiar de proveedor y proteger la suscripción                                                           | Puerto `PaymentGateway` + adaptador; webhook idempotente                                               |
| ADR-008 | Integración de IA desacoplada                                      | DA08, DA09             | Limitar riesgos y costo; poder cambiar de proveedor                                                      | Puerto `AIProvider`; herramientas cerradas; degradación                                                |
| ADR-009 | Prevención de reservas duplicadas en PostgreSQL                    | DA02                   | La disponibilidad definitiva no puede depender de caché ni de pantalla                                   | Restricción de exclusión + transacción                                                                 |
| ADR-010 | Autenticación, autorización y aislamiento de datos                 | DA01, DA11             | Proteger datos entre barberías y por rol                                                                 | JWT firmado con tenant y rol, RBAC, RLS, auditoría                                                     |
| ADR-011 | Clean Architecture como enfoque interno (evolución de 3 a 4 capas) | DA06, DA10             | Dominio independiente de frameworks y proveedores                                                        | Regla de dependencia hacia el interior; abstracciones donde hay riesgo                                 |
| ADR-012 | Resiliencia ante servicios externos                                | DA05, DA07, DA08, DA12 | Los servicios externos fallan                                                                            | Reintentos, circuit breaker, degradación, conciliación                                                 |
| ADR-013 | Notificaciones multicanal al cliente (correo y WhatsApp)           | DA05, DA09, DA11       | El cliente debe recibir la fecha de su cita por el canal que elija, sin acoplar el núcleo a un proveedor | Puerto `NotificationChannel` con adaptadores de correo y WhatsApp; consentimiento; respaldo por correo |
| ADR-014 | Frontend con React, Vite y TypeScript                              | DA06, DA10             | Poco código obligatorio, ecosistema amplio y tipos compartidos con el backend                            | Interfaz web de una sola página que consume la API REST                                                |
| ADR-015 | Autenticación antes de conocer el tenant y RLS en `user_account`   | DA01, DA11             | Iniciar sesión exige leer datos protegidos por RLS sin conocer aún la barbería                           | Rol `barberias_auth` NOLOGIN BYPASSRLS dueño de solo 3 funciones acotadas; RLS en `user_account`       |

---

## ADR-001 Monolito modular

- **Estado:** Propuesto.
- **Contexto:** Equipo universitario, presupuesto mínimo (RC06), necesidad de evolución (DA06) y de despliegue sencillo (DA10).
- **Problema:** ¿Qué estilo organiza el backend de forma defendible y viable?
- **Alternativas:** (a) monolito sin módulos; (b) **monolito modular**; (c) microservicios; (d) arquitectura serverless por funciones.
- **Decisión:** Un backend desplegable como unidad, con seis módulos de límites explícitos (cinco de negocio y un núcleo compartido; los de dos responsabilidades se dividen en submódulos) ([estilo](../02-arquitectura-software/estilo-arquitectonico.md)).
- **Justificación:** Un monolito sin módulos se vuelve inmanejable; los microservicios añaden red, despliegues múltiples, consistencia distribuida y operación que el equipo no puede sostener; serverless dificulta transacciones y control de costos en este contexto.
- **Ventajas:** bajo costo, pruebas y despliegue simples, transacciones locales (útil para reservas y pagos), escalado horizontal por réplicas.
- **Desventajas:** despliegue común; una falla del proceso afecta a todos los módulos; los límites exigen disciplina.
- **Riesgos:** erosión de límites (R13). **Mitigación:** verificación automática de dependencias (T13) y revisión de código.
- **Drivers:** DA04, DA06, DA09, DA10.
- **Consecuencias:** microservicios solo como opción futura condicionada a necesidades demostradas; varias instancias del mismo monolito siguen siendo una arquitectura monolítica.

## ADR-002 Arquitectura lógica de cuatro capas

- **Estado:** Propuesto.
- **Contexto:** La propuesta inicial (Guía 02) fue de tres capas; la Guía 03 exige separar el dominio.
- **Problema:** ¿Cómo se organiza la lógica dentro de cada módulo?
- **Alternativas:** (a) tres capas (presentación, lógica de negocio, datos); (b) **cuatro capas** (presentación, aplicación, dominio, infraestructura); (c) hexagonal pura.
- **Decisión:** Cuatro capas lógicas con dependencias hacia el interior.
- **Justificación:** Separar aplicación (casos de uso) de dominio (reglas) permite probar reglas sin infraestructura y cambiar proveedores. El balanceador es parte del despliegue, no una capa.
- **Ventajas:** mantenibilidad, pruebas, claridad de responsabilidades.
- **Desventajas:** más archivos y mapeos; riesgo de sobreingeniería en módulos simples.
- **Riesgos:** abstracción innecesaria. **Mitigación:** casos de uso delgados en módulos CRUD (ADR-011).
- **Drivers:** DA06.
- **Consecuencias:** estructura de carpetas por módulo y capa; ver [enfoque](../02-arquitectura-software/enfoque-arquitectonico.md).

## ADR-003 Estrategia multi-tenant

- **Estado:** Propuesto.
- **Contexto:** Muchas barberías pequeñas, costo mínimo (DA09), aislamiento obligatorio (DA01).
- **Problema:** ¿Cómo se separan los datos de las barberías?
- **Alternativas:** (a) base por tenant; (b) esquema por tenant; (c) **base compartida con `tenant_id`**.
- **Decisión:** Base compartida con `tenant_id` en toda tabla de negocio **más** controles complementarios: `tenant_id` del token firmado, contexto de tenant por solicitud, filtro en repositorios, **Row-Level Security** y pruebas automáticas de fuga.
- **Justificación:** Menor costo y operación (una base, una migración); el aislamiento no descansa solo en `tenant_id` sino en RLS y pruebas. **No se afirma que `tenant_id` basta por sí solo.**
- **Ventajas:** costo bajo, migraciones únicas, alta de tenants inmediata.
- **Desventajas:** un error de configuración afecta a todos; "vecino ruidoso"; respaldo y restauración por tenant más difíciles.
- **Riesgos:** fuga entre tenants (R01). **Mitigación:** RLS, rol de base sin privilegio de omitir RLS, pruebas PR09.
- **Drivers:** DA01, DA09, DA11.
- **Consecuencias:** ruta de evolución para tenants grandes (esquema o base dedicada) sin cambiar los casos de uso, ya que el acceso va por repositorios. Ver [multi-tenancy](../02-arquitectura-software/multi-tenancy-y-datos.md).

## ADR-004 PostgreSQL como base principal

- **Estado:** Propuesto (también restricción RC04).
- **Contexto:** Datos transaccionales con integridad referencial y reglas de no solape.
- **Alternativas:** (a) **PostgreSQL**; (b) MySQL/MariaDB; (c) MongoDB.
- **Decisión:** PostgreSQL como fuente de verdad.
- **Justificación:** Soporta restricciones de exclusión (EXCLUDE con `gist`), RLS, transacciones y tipos de rango; el modelo es relacional.
- **Ventajas:** consistencia fuerte, funcionalidades útiles para ADR-003 y ADR-009; software libre.
- **Desventajas:** escalado de escritura vertical; requiere administración (respaldos, índices).
- **Riesgos:** saturación o pérdida de datos (R06, R12). **Mitigación:** índices, pool de conexiones, respaldos verificados.
- **Drivers:** DA02, DA01.
- **Consecuencias:** las migraciones son versionadas; la caché nunca sustituye a la base.

## ADR-005 Redis como caché selectiva

- **Estado:** Propuesto.
- **Contexto:** Lecturas frecuentes de catálogo, servicios y configuración.
- **Alternativas:** (a) sin caché; (b) caché en memoria del proceso; (c) **Redis**.
- **Decisión:** Redis solo para datos de lectura frecuente y tolerantes a retraso, con claves que incluyen el tenant y expiración. Nunca fuente de verdad de reservas, pagos ni suscripciones.
- **Justificación:** La caché en proceso no se comparte entre instancias; sin caché, el rendimiento depende solo de la base.
- **Ventajas:** menor latencia y carga en PostgreSQL; compartida entre instancias.
- **Desventajas:** datos desactualizados; un componente más que operar; riesgo de fuga si la clave omite el tenant.
- **Riesgos:** R05. **Mitigación:** TTL corto, invalidación al escribir, comportamiento ante caída (EQ-05).
- **Drivers:** DA03.
- **Consecuencias:** la reserva comprueba disponibilidad actual en PostgreSQL. Ver [caché](../02-arquitectura-software/estrategia-de-cache.md).

## ADR-006 Balanceador de carga y escalado horizontal

- **Estado:** Propuesto.
- **Contexto:** Necesidad de repartir carga y tolerar fallos con presupuesto mínimo.
- **Alternativas:** (a) una sola instancia sin balanceador; (b) **Nginx** administrado por el equipo; (c) **balanceador gestionado de la nube (Application Load Balancer de AWS)**; (d) orquestador completo.
- **Decisión:** Arquitectura objetivo en **AWS** con **Application Load Balancer** y varias instancias del **mismo** monolito sin estado. **Se empieza con una instancia** y se escala con necesidad justificada.
- **Justificación:** Sesiones sin estado permiten réplicas; el ALB oculta la falla de una instancia, verifica la salud, termina TLS y no requiere administrar un servidor propio.
- **Ventajas:** escalado horizontal, verificación de salud, despliegues sin corte.
- **Desventajas:** costo mensual del ALB y dependencia del proveedor; PostgreSQL puede ser punto único de falla; más conexiones a la base.
- **Riesgos:** R03, R04. **Mitigación:** pool de conexiones, pruebas de carga y de falla.
- **Aclaración:** **no se afirma alta disponibilidad por incluir un balanceador.** La alta disponibilidad exige además redundancia del propio balanceador, réplica de PostgreSQL con conmutación, Redis tolerante a fallos y pruebas. Ver [despliegue](../02-arquitectura-software/despliegue-y-escalabilidad.md).
- **Drivers:** DA03, DA04, DA05.
- **Consecuencias:** configuración y secretos externos; registros centralizados.

## ADR-007 Módulo de pagos desacoplado

- **Estado:** Propuesto.
- **Contexto:** Pasarela externa (RC05), sin datos de tarjeta (RC12), riesgo de pagos duplicados.
- **Alternativas:** (a) integración directa en los casos de uso; (b) **puerto `PaymentGateway` + adaptador**; (c) servicio de pagos separado.
- **Decisión:** El módulo M03 expone el puerto `PaymentGateway`; un adaptador de infraestructura habla con el proveedor. La confirmación llega por **webhook autenticado e idempotente**; la suscripción se actualiza de forma atómica; se concilian pagos pendientes.
- **Justificación:** Cambiar de proveedor no toca la suscripción; la confirmación no depende del navegador del usuario.
- **Ventajas:** intercambiable, probable con simulador, seguro.
- **Desventajas:** más código de contrato y pruebas.
- **Riesgos:** R07, R08, R15. **Mitigación:** idempotencia por identificador de evento, conciliación, ambiente de pruebas.
- **Proveedor:** candidato Culqi (documentación leída: Yape máx. S/ 500 solo en soles, billeteras QR S/ 6 a S/ 500, webhook `order.status.changed`, token de tarjeta de 5 minutos y un uso). **No se afirma compatibilidad ni condiciones de contratación hasta confirmarlas con el proveedor.** Diferenciar _método de pago_ (Yape, tarjeta) de _proveedor que procesa_.
- **Drivers:** DA07.
- **Consecuencias:** el pago de citas por clientes queda fuera del MVP.

## ADR-008 Integración de IA desacoplada

- **Estado:** Propuesto.
- **Contexto:** IA por API (RC11); riesgos de datos, alucinación, costo y latencia.
- **Alternativas:** (a) la IA consulta directamente la base; (b) **orquestador con herramientas cerradas sobre casos de uso, detrás de `AIProvider`**; (c) modelo propio.
- **Decisión:** M04 expone el puerto `AIProvider`. El orquestador convierte la solicitud en una **intención estructurada** y ejecuta solo herramientas cerradas por rol (sin SQL libre) que llaman a casos de uso de otros módulos. La disponibilidad la comprueba siempre el backend. Hay límites de uso, registro y degradación al flujo manual.
- **Justificación:** La IA no puede inventar horarios ni saltarse permisos si no tiene acceso a datos fuera de los casos de uso.
- **Ventajas:** control de seguridad y costo; proveedor intercambiable.
- **Desventajas:** menos "magia" que un agente libre; diseño de herramientas.
- **Riesgos:** R09, R10, R11. **Mitigación:** pruebas adversariales (PR19), cuotas, circuit breaker.
- **Drivers:** DA08, DA09.
- **Consecuencias:** no se entrena un modelo propio.

## ADR-009 Prevención de reservas duplicadas

- **Estado:** Propuesto.
- **Contexto:** Dos clientes pueden reservar a la vez; el cálculo de disponibilidad puede quedar viejo.
- **Alternativas:** (a) verificar en la aplicación y luego insertar; (b) bloqueo distribuido en Redis; (c) **restricción de exclusión en PostgreSQL + transacción**.
- **Decisión:** La tabla de citas tiene una **restricción de exclusión** sobre `(barber_id, rango de tiempo)` para citas activas; la inserción ocurre en transacción y el conflicto se traduce a "horario no disponible".
- **Justificación:** Es la única garantía que no depende del orden de ejecución de las instancias.
- **Ventajas:** correcta aun con varias instancias o Redis caído.
- **Desventajas:** acopla la regla a una característica de PostgreSQL (aceptable por RC04).
- **Riesgos:** R02. **Mitigación:** PR16 (200 solicitudes simultáneas).
- **Drivers:** DA02.
- **Consecuencias:** Redis nunca decide disponibilidad. Ver [multi-tenancy y datos](../02-arquitectura-software/multi-tenancy-y-datos.md#6-prevención-de-reservas-duplicadas).

## ADR-010 Autenticación, autorización y aislamiento de datos

- **Estado:** Propuesto.
- **Contexto:** Cuatro roles; datos de varias barberías; Ley N.° 29733.
- **Alternativas:** (a) sesiones en servidor; (b) **JWT de corta vida firmado + refresco**; (c) proveedor de identidad externo.
- **Decisión:** Token firmado con identificador de usuario, rol y `tenant_id`; autorización RBAC en la capa de aplicación; contexto de tenant por solicitud; RLS en PostgreSQL; contraseñas con hash lento; límites de solicitudes; auditoría; HTTPS y CORS restringido.
- **Justificación:** Sin estado en servidor (compatible con ADR-006); el tenant sale del token y no del cliente.
- **Ventajas:** escalable, auditable.
- **Desventajas:** revocar tokens requiere lista de bloqueo o vida corta.
- **Riesgos:** R01, R12. **Mitigación:** vida corta, rotación de claves, pruebas PR07–PR09.
- **Drivers:** DA01, DA11.
- **Consecuencias:** ver [seguridad y privacidad](../02-arquitectura-software/seguridad-y-privacidad.md).

## ADR-011 Clean Architecture como enfoque interno

- **Estado:** Propuesto.
- **Contexto:** La Guía 03 presenta Clean Architecture; equipo pequeño y MVP.
- **Alternativas:** (a) capas tradicionales con dominio acoplado al ORM; (b) **Clean Architecture simplificada**; (c) arquitectura hexagonal pura.
- **Decisión:** Adoptar Clean Architecture con **regla de dependencia hacia el interior**: el dominio no depende de frameworks, PostgreSQL, Redis ni proveedores; la infraestructura implementa contratos. **Evolución:** la propuesta inicial de tres capas pasa a cuatro capas para separar aplicación y dominio.
- **Justificación honesta:** la guía advierte que no conviene en proyectos muy pequeños. Se aplica **de forma proporcional**: casos de uso delgados en módulos simples (catálogo, reportes), y abstracciones (puertos) solo donde hay riesgo de cambio (pagos, IA, correo, repositorio de citas).
- **Ventajas:** dominio probable sin infraestructura; proveedores intercambiables.
- **Desventajas:** curva de aprendizaje; más archivos.
- **Riesgos:** R13, R14. **Mitigación:** plantillas de módulo, alcance acotado.
- **Drivers:** DA06, DA10.
- **Consecuencias:** la aplicación se construye en `tecnologia/plataforma-barberias/` con esta estructura de capas y módulos.

## ADR-012 Resiliencia ante servicios externos

- **Estado:** Propuesto.
- **Contexto:** Pagos, IA, correo y mensajería (WhatsApp) pueden fallar o ser lentos.
- **Alternativas:** (a) llamadas directas sin protección; (b) **tiempo límite + reintentos con espera + circuit breaker + degradación + conciliación**.
- **Decisión:** Toda llamada externa pasa por un adaptador con tiempo límite, reintentos con espera creciente solo en operaciones seguras (idempotentes), circuit breaker y respuesta alternativa. Los pagos pendientes se concilian periódicamente. El correo se envía de forma asíncrona.
- **Justificación:** Un fallo externo no debe bloquear reservas ni hundir el servidor.
- **Ventajas:** el núcleo sigue operando (EQ-06).
- **Desventajas:** más estados que probar; reintentos mal diseñados pueden duplicar efectos.
- **Riesgos:** R08, R09. **Mitigación:** idempotencia (T08) y pruebas con simulador (PR06).
- **Drivers:** DA05, DA07, DA08, DA12.
- **Consecuencias:** se registran métricas por proveedor.

## ADR-013 Notificaciones multicanal al cliente (correo y WhatsApp)

- **Estado:** Propuesto.
- **Contexto:** El cliente debe saber la fecha y hora de su cita (confirmación, recordatorio, cancelación o reprogramación) por su **número de WhatsApp** o por su **correo electrónico**. WhatsApp depende de un proveedor externo con condiciones propias (consentimiento previo del usuario, plantillas de mensaje aprobadas, costos), **por verificar con su documentación oficial**; el correo es más simple y barato.
- **Problema:** ¿Cómo notificar por más de un canal sin acoplar las reglas de citas a un proveedor y sin que un fallo de envío afecte la reserva?
- **Alternativas:** (a) solo correo; (b) llamar al proveedor de WhatsApp directamente desde el caso de uso de reservas; (c) **puerto `NotificationChannel` con adaptadores `EmailSender` y `WhatsAppSender`, activados por eventos**.
- **Decisión:** M05 escucha los eventos de M02 (`CitaCreada`, `CitaReprogramada`, `CitaCancelada`) y un **recordatorio del día de la cita** con acciones de confirmar, reprogramar o cancelar (RF34); elige el canal según la preferencia del cliente (RF33); envía de forma **asíncrona** con reintentos y circuit breaker; si WhatsApp falla o el cliente no aceptó recibirlo, usa el **correo como respaldo**. Los mensajes llevan solo los datos mínimos (barbería, servicio, fecha y hora). El consentimiento para WhatsApp se registra antes de enviar.
- **Justificación:** El correo cubre el MVP sin dependencias especiales; WhatsApp aporta alcance (a nivel nacional el 90 % de los usuarios de Internet usa celular, D-02; en Ayacucho por validar) pero añade dependencia y costo, por lo que se desacopla y es opcional.
- **Ventajas:** canal intercambiable, el núcleo no se entera del proveedor, un fallo de envío no afecta la reserva.
- **Desventajas:** más estados y plantillas que mantener; costo variable de WhatsApp; el recordatorio exige un planificador sin duplicados entre instancias.
- **Riesgos:** R17 (condiciones del proveedor de WhatsApp), R16 (consentimiento). **Mitigación:** consentimiento registrado, respaldo por correo, simulador del canal en pruebas, evaluar proveedor antes de contratar.
- **Drivers:** DA05, DA09, DA11.
- **Consecuencias:** WhatsApp se implementa **solo si el proveedor lo permite**; el MVP puede salir con correo. Ver [diseño interno](../03-diseño-de-software/diseño-interno/diseño-interno-de-modulos.md#7-m05-notificaciones).

## ADR-014 Frontend con React, Vite y TypeScript

- **Estado:** Propuesto.
- **Contexto:** La interfaz web debe ser responsive y consumir la API REST (RC01, RC03). El equipo es pequeño y el tiempo es limitado (RC06, RC14).
- **Problema:** ¿Con qué tecnología se construye la interfaz web?
- **Alternativas:** (a) Angular; (b) **React con Vite y TypeScript**; (c) Vue; (d) páginas renderizadas en servidor.
- **Decisión:** Interfaz web de una sola página con React, Vite y TypeScript, ubicada en `tecnologia/plataforma-barberias/frontend/`. No contiene reglas críticas de negocio: la validación definitiva ocurre en el backend.
- **Justificación:** Arranque rápido con poco código obligatorio, amplio ecosistema de componentes (agenda, formularios, gráficos de reportes) y TypeScript compartido con NestJS para reutilizar los tipos de la API.
- **Ventajas:** curva de aprendizaje corta, mucha documentación y ejemplos, buena generación de código con asistentes de IA.
- **Desventajas:** menos estructura impuesta que Angular; hay que fijar convenciones de carpetas y de manejo de estado.
- **Riesgos:** R13, R14 (curva de aprendizaje). **Mitigación:** convenciones simples definidas en el plan de cada funcionalidad y revisión en cada sprint.
- **Drivers:** DA06, DA10.
- **Consecuencias:** se actualiza [tecnologías](../02-arquitectura-software/tecnologias.md); las librerías concretas de interfaz se eligen al planificar la primera funcionalidad.

## ADR-015 Autenticación antes de conocer el tenant y RLS en `user_account`

- **Estado:** Propuesto.
- **Contexto:** ADR-003 y ADR-010 fijan que el `tenant_id` sale del token y que toda tabla de negocio tiene RLS con `FORCE` y un rol de aplicación sin privilegio para omitirla. Pero tres operaciones ocurren **antes** de tener token: iniciar sesión (buscar la cuenta por correo y su membresía), renovar la sesión (buscar la sesión por el hash del token de renovación) y activar una cuenta (buscar el token de activación). Esas filas están en tablas con RLS (`membership`, `auth_session`, `account_activation`). Además, `user_account` era una tabla global sin RLS que guarda correo y nombre del personal de todas las barberías y que el rol de aplicación podía leer completa. Con `FORCE ROW LEVEL SECURITY`, ni siquiera el dueño de las tablas omite RLS, así que una función `SECURITY DEFINER` de ese dueño tampoco encontraría las filas. Detectado al analizar la funcionalidad [001](../../specs/001-registro-acceso-barberia/spec.md).
- **Problema:** ¿Cómo resolver esas tres búsquedas sin aceptar el tenant del cliente y sin dar al rol de aplicación la capacidad de omitir RLS? ¿Cómo evitar que un error de código exponga cuentas de otras barberías desde `user_account`?
- **Alternativas:**
  - (a) Hacer globales `membership`, `auth_session` y `account_activation`: contradice el principio III (datos de negocio sin RLS).
  - (b) Dar `BYPASSRLS` al rol de aplicación o a un rol de sistema con conexión propia: superficie enorme; cualquier consulta de ese rol omitiría RLS.
  - (c) Pedir la barbería en el formulario de inicio de sesión o guardarla en la cookie: el tenant vendría del cliente (prohibido por ADR-010).
  - (d) Políticas RLS con una excepción activada por una variable de sesión (`app.auth_lookup = on`): el propio rol de aplicación podría activarla con `set_config`, así que no protege nada.
  - (e) **Un rol dedicado `NOLOGIN BYPASSRLS` que solo es dueño de tres funciones `SECURITY DEFINER` acotadas, más RLS en `user_account`.**
- **Decisión:** opción (e).
  1. Rol `barberias_auth` con `NOLOGIN NOSUPERUSER NOINHERIT BYPASSRLS`: nadie puede conectarse con él. Es dueño **únicamente** de tres funciones y tiene `SELECT` solo sobre las columnas que ellas leen.
  2. Funciones, todas con `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC` y `GRANT EXECUTE` solo a `barberias_app`:
     - `auth_resolver_cuenta(email)`: datos para verificar la contraseña y la membresía del personal (`user_id`, `password_hash`, `tenant_id`, `role_code`, estado de membresía y estado del tenant).
     - `auth_buscar_sesion(token_hash)`: sesión por hash del token de renovación vigente o anterior.
     - `auth_buscar_activacion(token_hash)`: token de activación por su hash.
     Cada una busca por una clave exacta, devuelve **como máximo una fila**, no recibe `tenant_id` y no lista ni modifica nada. Con el `tenant_id` obtenido, el resto del flujo corre en una transacción normal con RLS.
  3. `user_account` pasa a tener RLS con `FORCE`: el rol de aplicación solo ve cuentas que tienen membresía en el tenant de la transacción (la subconsulta sobre `membership` ya está filtrada por RLS). La inserción se permite (`WITH CHECK (true)`) porque la cuenta se crea antes que su membresía; por eso esas inserciones no usan `RETURNING`. El rol de aplicación no recibe `SELECT` sobre `password_hash`: solo la lee `auth_resolver_cuenta`.
  4. `barberias_owner` (migraciones) es miembro de `barberias_auth` solo para asignarle la propiedad de las funciones. La aplicación nunca se conecta como `barberias_owner`.
- **Justificación:** la omisión de RLS queda encerrada en tres consultas por clave exacta, revisables y probadas, y el rol de aplicación conserva `NOBYPASSRLS`. Es el mismo patrón de "acceso de sistema restringido" que [multi-tenancy y datos](../02-arquitectura-software/multi-tenancy-y-datos.md) prevé para el webhook de pagos. RLS en `user_account` agrega una barrera de base de datos donde antes solo había código.
- **Ventajas:** el tenant nunca viene del cliente; el rol de aplicación no puede omitir RLS; superficie mínima y auditable; una consulta con un error en el código ya no puede listar cuentas de otra barbería.
- **Desventajas:** tres funciones SQL que mantener junto con las migraciones; la creación de un rol `BYPASSRLS` exige privilegios elevados al preparar la base; las inserciones en `user_account` no pueden usar `RETURNING`.
- **Riesgos:** R01 (fuga entre barberías) si una función devolviera más de una fila o aceptara filtros amplios; errores al cambiar las funciones. **Mitigación:** pruebas automáticas (abajo) en CI y revisión obligatoria de cualquier cambio en estas funciones. **Por validar:** que en **Amazon RDS for PostgreSQL** el usuario administrador pueda crear un rol con `BYPASSRLS`; si no se puede, hay que registrar una alternativa en un nuevo ADR antes del despliegue.
- **Pruebas (parte de PR09):** (1) cada función devuelve 0 o 1 fila, también con entradas inexistentes; (2) ninguna función tiene un parámetro de tenant; (3) `barberias_auth` no puede iniciar sesión y no es dueño de ninguna tabla; (4) `barberias_app` no tiene `BYPASSRLS`, no puede ejecutar otras funciones `SECURITY DEFINER` y no puede leer `user_account.password_hash`; (5) sin contexto de tenant, `SELECT` sobre `user_account` devuelve 0 filas y, con el contexto de A, no aparece ninguna cuenta de B.
- **Drivers:** DA01, DA11.
- **Consecuencias:** se actualizan [multi-tenancy y datos](../02-arquitectura-software/multi-tenancy-y-datos.md) (casos especiales y tablas globales) y la [trazabilidad](../trazabilidad.md); la funcionalidad 001 implementa el rol, las funciones y sus pruebas en su fase fundacional.
