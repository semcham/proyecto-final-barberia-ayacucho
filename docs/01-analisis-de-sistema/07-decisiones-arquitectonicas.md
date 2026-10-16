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
| ADR-016 | Sistema de diseño propio con componentes accesibles de Radix       | DA06, DA10             | Interfaz coherente, accesible (WCAG AA) y liviana sin depender de una librería de componentes completa    | Tokens CSS, tema claro y oscuro, Radix solo para comportamiento, fuentes autohospedadas, SVG propios   |
| ADR-017 | Indicador de sesión `hay_sesion` en el navegador                   | DA01, DA11             | No llamar a `/auth/refresh` cuando seguro no hay sesión (401 en consola y métricas)                      | Cookie no secreta de 7 días, sin acceso a nada; la cookie de renovación sigue siendo HttpOnly          |
| ADR-018 | Carga diferida de rutas y librerías en archivos separados          | DA03, DA10             | Bajar el JavaScript inicial para celulares con red lenta                                                 | `React.lazy` por pantalla; React, TanStack Query y formularios en chunks propios                       |
| ADR-019 | Período de gracia en la rotación del token de renovación           | DA01, DA11             | Una renovación interrumpida o repetida revocaba sesiones legítimas (R18)                                 | Token anterior aceptado una sola vez durante 10 s; token reemplazado revoca; fila de sesión bloqueada  |

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
- **Consecuencias:** se actualiza [tecnologías](../02-arquitectura-software/tecnologias.md); las librerías concretas de interfaz se eligieron con la funcionalidad 001: React Router, TanStack Query, `react-hook-form` y `zod` (plan de 001), y el sistema de diseño, la sesión en el navegador y la carga de pantallas en ADR-016, ADR-017 y ADR-018.

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
- **Consecuencias:** se actualizan [multi-tenancy y datos](../02-arquitectura-software/multi-tenancy-y-datos.md) (casos especiales y tablas globales) y la [trazabilidad](../trazabilidad.md); la funcionalidad 001 implementa el rol, las funciones y sus pruebas en su fase fundacional. **Cambio posterior (ADR-019, migración `0008`):** `auth_buscar_sesion` también busca por `superseded_token_hash` (misma firma, sin tenant, máximo una fila) y `barberias_auth` recibe `SELECT` solo sobre esa columna; las pruebas de PR09 se ampliaron para cubrirlo.

## ADR-016 Sistema de diseño propio con componentes accesibles de Radix

- **Estado:** Propuesto.
- **Contexto:** La interfaz se usa sobre todo desde el celular (RC01, AC06) por propietarios y barberos con experiencia digital variable, y en redes móviles de calidad irregular (RC15). Tras la funcionalidad 001 las pantallas tenían estilos sueltos por archivo, sin tema oscuro, sin modal accesible (se usaba `window.confirm`) ni avisos. Las piezas interactivas difíciles (ventana modal, menú desplegable, ayuda emergente, avisos) exigen manejar foco, teclado y atributos ARIA, lo que es fácil de hacer mal.
- **Problema:** ¿Cómo lograr una interfaz coherente, accesible (WCAG 2.2 AA) y liviana, con tema claro y oscuro, sin atarse a la apariencia de un tercero?
- **Alternativas:** (a) librería de componentes completa (MUI, Chakra, Ant Design): rápida, pero pesada y con apariencia propia difícil de cambiar; (b) Tailwind con componentes propios: hay que resolver la accesibilidad a mano; (c) todo a mano, incluido el foco y el teclado de modales y menús; (d) **sistema de diseño propio en CSS (tokens) y Radix UI solo para el comportamiento accesible**.
- **Decisión:** opción (d).
  1. **Tokens** en `frontend/src/styles/tokens.css` (color, tipografía, espaciado, radios, sombras, movimiento, capas). Los módulos CSS no escriben valores sueltos.
  2. **Tema claro y oscuro** con `light-dark()`: sigue a `prefers-color-scheme` y el conmutador (Sistema, Claro, Oscuro) lo fija con `data-theme` en `<html>`. La preferencia se guarda en `localStorage` como comodidad: si el navegador no deja guardar, se usa el tema del sistema. Un script en `index.html` la aplica antes de pintar.
  3. **Radix UI** (`react-dialog`, `react-dropdown-menu`, `react-tooltip`, `react-toast`) sin estilos propios, envuelto en componentes del proyecto (`components/ui/`). Los menús se usan **no modales** para no ocultar el resto de la página a los lectores de pantalla.
  4. **Fuentes autohospedadas** con `@fontsource-variable` (Fraunces para títulos, Inter para el cuerpo; solo el eje de peso), sin CDN.
  5. **Iconos e ilustración propios en SVG**. La foto real del panel de marca, cuando exista, sigue las reglas de `frontend/public/img/README.md`.
  6. **Meta de accesibilidad AA:** el cobre de relleno (`--color-acento`) solo lleva texto oscuro encima; como texto o borde de estado se usa la variante oscura (`--color-enlace`). Foco visible y `prefers-reduced-motion`.
- **Justificación:** Radix resuelve lo que más suele fallar (atrapar y devolver el foco, teclado, `role` y `aria-*`) y deja la apariencia al proyecto. Los tokens permiten dos temas sin duplicar estilos y cambiar la identidad sin tocar las pantallas.
- **Ventajas:** accesibilidad comprobada (axe-core: 0 incumplimientos WCAG A/AA en 30 estados; Lighthouse 100 en accesibilidad); peso moderado (solo se descargan las piezas de Radix que usa cada pantalla); identidad propia.
- **Desventajas:** los componentes del sistema de diseño se mantienen en el proyecto; `light-dark()` exige navegadores de 2024 en adelante; las fuentes suman unos 85 KB en la primera visita.
- **Riesgos:** R13 (complejidad). **Mitigación:** pocos componentes base, documentados en el código y con pruebas (`test/components/ui.spec.tsx`). Radix y las fuentes van con versión exacta.
- **Drivers:** DA06, DA10.
- **Consecuencias:** se actualizan [tecnologías](../02-arquitectura-software/tecnologias.md) (versiones, licencias y mediciones) y la [trazabilidad](../trazabilidad.md). Un aviso de buena práctica de axe (`region`) permanece mientras un menú o ayuda emergente está abierto, porque Radix los dibuja en un portal fuera de los *landmarks*.

## ADR-017 Indicador de sesión `hay_sesion` en el navegador

- **Estado:** Propuesto.
- **Contexto:** ADR-010 y la funcionalidad 001 guardan el token de acceso solo en memoria y la renovación en una cookie `rt` HttpOnly. Al cargar la página la interfaz llamaba siempre a `POST /auth/refresh` para recuperar la sesión; un visitante nuevo, o alguien que cerró sesión, recibía un 401 seguro, que ensucia la consola, las métricas de errores y Lighthouse (buenas prácticas). JavaScript no puede saber si existe `rt`, precisamente porque es HttpOnly.
- **Problema:** ¿Cómo evitar esa llamada cuando seguro no hay sesión, sin exponer la cookie de renovación ni cambiar el contrato de la API?
- **Alternativas:** (a) aceptar el 401; (b) que `/auth/refresh` responda 204 sin cookie: cambia el contrato (`openapi.yaml`) y mezcla "sin sesión" con éxito; (c) una marca en `localStorage`: las pruebas exigen no guardar nada de la sesión en el almacenamiento del navegador y no caduca junto con `rt`; (d) **una cookie no secreta `hay_sesion=1` con la misma duración que `rt`**.
- **Decisión:** opción (d). La interfaz marca `hay_sesion=1` (`Max-Age` de 7 días, `Path=/`, `SameSite=Strict` y `Secure` con HTTPS) al iniciar sesión, registrarse o renovar, y la borra al cerrar sesión o si una renovación falla. Sin la marca, la sesión empieza como anónima y no se llama a `/auth/refresh` (`frontend/src/auth/indicadorSesion.ts`, `SesionProvider.tsx`).
- **Justificación:** la marca no es secreta ni da acceso a nada: solo dice "vale la pena intentar renovar". La autenticación sigue dependiendo de `rt` (HttpOnly) y del token en memoria.
- **Ventajas:** sin 401 en la primera visita ni tras cerrar sesión; sin cambios en el backend ni en el contrato; caduca igual que `rt`.
- **Desventajas:** si alguien borra solo esa cookie, la sesión no se recupera al recargar y hay que volver a ingresar (la sesión del servidor vence sola). Es una cookie más que declarar en la política de privacidad.
- **Riesgos:** R01 no aumenta (la marca no autentica). **Mitigación:** pruebas en `test/auth/sesion.spec.tsx` (visitante nuevo sin llamada, marca al ingresar y al cerrar sesión, se quita si la renovación falla).
- **Drivers:** DA01, DA11.
- **Consecuencias:** se actualiza [seguridad y privacidad](../02-arquitectura-software/seguridad-y-privacidad.md) (qué guarda el navegador). Relacionado: R18 en la [matriz de riesgos](../05-gestion/05-riesgos.md).

## ADR-018 Carga diferida de rutas y librerías en archivos separados

- **Estado:** Propuesto.
- **Contexto:** Tras el rediseño, el JavaScript de la interfaz era un solo archivo de 573 KB (179 KB comprimido): quien entraba a registrarse descargaba también el panel y las librerías de menús y ventanas. El público usa celulares con redes de calidad variable (RC15) y AC01 pide tiempos aceptables.
- **Problema:** ¿Cómo bajar lo que se descarga al abrir la aplicación sin cambiar su estructura ni agregar un framework de renderizado en servidor?
- **Alternativas:** (a) un solo archivo; (b) renderizado en servidor o generación estática: cambia el despliegue y la arquitectura (ADR-014); (c) **carga diferida por pantalla con `React.lazy` y librerías en archivos propios**.
- **Decisión:** opción (c). Cada pantalla (Registro, Ingresar, Activar, Inicio, Usuarios) y el diseño del panel se cargan con `React.lazy` y `Suspense` (`frontend/src/routes.tsx`); React, TanStack Query y los formularios van en chunks propios (`vite.config.ts`, `manualChunks`); en las pantallas de acceso el conmutador de tema se descarga después de pintar el formulario.
- **Justificación:** el JavaScript inicial bajó a 372 KB (unos 123 KB comprimido); Lighthouse en modo celular queda entre 92 y 99 en todas las pantallas (mediana de 3 pasadas; ver [tecnologías](../02-arquitectura-software/tecnologias.md)).
- **Ventajas:** primera carga más liviana; las librerías, que cambian poco, se reutilizan desde la caché del navegador entre despliegues.
- **Desventajas:** una breve pantalla "Cargando…" al visitar una pantalla por primera vez; más archivos que servir.
- **Riesgos:** R19: tras publicar una versión nueva, una pestaña abierta con la versión anterior puede pedir un chunk que ya no existe y fallar al navegar. **Mitigación:** conservar en el servidor los chunks de la versión anterior durante al menos un día y servir `index.html` sin caché ([despliegue](../02-arquitectura-software/despliegue-y-escalabilidad.md)).
- **Drivers:** DA03, DA10.
- **Consecuencias:** se actualizan [despliegue y escalabilidad](../02-arquitectura-software/despliegue-y-escalabilidad.md) (cómo servir la aplicación web) y la [matriz de riesgos](../05-gestion/05-riesgos.md).
## ADR-019 Período de gracia en la rotación del token de renovación

- **Estado:** Propuesto.
- **Nota de proceso:** el diseño se aprobó antes de implementar, pero este texto se redactó después de escribir el código (en el mismo cambio, antes de confirmarlo). El principio XI de la constitución pide el ADR antes de implementar; el desvío queda registrado en `specs/001-registro-acceso-barberia/tasks.md` (fase 8) y en la reevaluación de la Constitution Check del plan.
- **Contexto:** ADR-010 y la funcionalidad 001 rotan el token de renovación en cada uso; si llega uno ya rotado, se considera robo y se revoca la sesión (`SESION_REUTILIZADA`). En la medición de la interfaz (2026-10-16) apareció un falso positivo: si la respuesta de una renovación no llega al navegador (recarga doble, pestaña cerrada, red cortada), el navegador conserva el token anterior y la siguiente renovación revoca la sesión de un usuario legítimo (riesgo R18). Al revisar el código apareció una segunda causa: dos renovaciones simultáneas con el mismo token podían pisarse, porque la segunda leía el token ya rotado y lo volvía a rotar, dejando a la primera con un token "anterior".
- **Problema:** ¿Cómo tolerar una renovación interrumpida o repetida sin debilitar la detección de robo del token de renovación?
- **Alternativas:**
  - (a) Dejarlo como está: cada corte de red o recarga rápida puede cerrar la sesión.
  - (b) Aceptar el token anterior sin límite de usos durante una ventana: un token robado serviría varias veces.
  - (c) Volver a entregar el mismo token vigente: solo se guarda su hash; guardarlo en claro o cifrado agrega un secreto que custodiar.
  - (d) No rotar durante la gracia (solo dar token de acceso): el navegador seguiría con el token viejo y la siguiente renovación caería fuera de la ventana.
  - (e) **Ventana corta de un solo uso, con detección del token reemplazado y la fila de la sesión bloqueada.**
- **Decisión:** opción (e).
  1. La renovación bloquea la fila de la sesión (`SELECT … FOR UPDATE`) y decide sobre ella: dos renovaciones con el mismo token se atienden una tras otra.
  2. El token presentado se clasifica (`Sesion.clasificarToken`): **vigente** → rotación normal; **anterior** dentro de `REFRESH_GRACIA_SEGUNDOS` desde la rotación y sin gracia usada → se acepta **una vez**, se emite un token nuevo y el vigente pasa a **reemplazado**; **anterior** fuera de la ventana o con la gracia ya usada → revocación; **reemplazado** → revocación; otro → 401.
  3. `REFRESH_GRACIA_SEGUNDOS` = **10** por defecto, configurable de 0 a 30 (0 = comportamiento previo). La gracia no extiende la ventana y se reinicia con la siguiente rotación normal.
  4. Cada uso de la gracia se audita (`SESION_RENOVADA_EN_GRACIA`, PERMITIDO); cada revocación, como hasta ahora (`SESION_REUTILIZADA`).
  5. En la interfaz, las renovaciones se serializan entre pestañas con la Web Locks API (`navigator.locks`), si el navegador la ofrece.
  6. Datos: columnas `rotated_at`, `grace_used_at` y `superseded_token_hash` en `auth_session` (migración `0008`). `auth_buscar_sesion` (ADR-015) también encuentra el token reemplazado, con la misma firma y como máximo una fila; `barberias_auth` gana `SELECT` solo sobre `superseded_token_hash`.
- **Justificación:** la ventana debe cubrir el tiempo entre que el servidor confirma la rotación y la siguiente renovación con el token viejo: recargar, arrancar la aplicación y llamar a `/auth/refresh`. En la medición de la interfaz (Lighthouse, modo celular con red lenta simulada) el arranque rondó 2 a 3 s; en 3G real se estima hasta unos 5 s. Diez segundos dan el doble de margen y mantienen corta y de un solo uso la ventana en la que un token robado sirve. La detección no se debilita: fuera de la ventana todo sigue igual, y si un atacante usa la gracia, el titular presentará el token reemplazado y la sesión se revoca.
- **Referencias** (consultadas el 2026-10-16): Okta ofrece un "grace period for token rotation" de 30 s por defecto, configurable de 0 a 60 s, durante el cual el token anterior sigue siendo válido ([Okta Developer: Refresh access tokens and rotate refresh tokens](https://developer.okta.com/docs/guides/refresh-tokens/main/)). Auth0 ofrece un "Rotation Overlap Period" (`leeway`), en segundos y desactivado por defecto; durante esa ventana no aplica su detección de robo ([Auth0 Docs: Configure Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-rotation)). Esta decisión es más estricta que ambas: un solo uso y detección del token reemplazado.
- **Ventajas:** sin revocaciones por cortes legítimos ni por renovaciones simultáneas; detección de robo intacta fuera de la ventana y reforzada dentro (token reemplazado); configurable y auditable.
- **Desventajas:** tres columnas y un caso más en una función de ADR-015; la renovación toma un bloqueo de fila breve.
- **Riesgos:** residual: si dos pestañas renuevan a la vez en un navegador sin Web Locks y sus respuestas llegan en orden invertido, el navegador puede quedarse con el token reemplazado y la sesión se revoca (R18). Un atacante con el token anterior que actúe dentro de los 10 s obtiene una sesión hasta que el titular renueve, momento en que se revoca y queda auditado. **Mitigación:** ventana corta y de un solo uso, Web Locks en la interfaz, auditoría de cada uso de la gracia.
- **Pruebas:** unitarias de `Sesion` con reloj simulado (gracia a los 5 s, segundo uso, 11 s, token reemplazado, la ventana no se extiende, gracia 0); integración HTTP con PostgreSQL (recarga doble, robo fuera de la ventana, doble reutilización, robo dentro de la ventana, renovaciones simultáneas); PR09 (`auth_buscar_sesion` con el token reemplazado y permisos de `barberias_auth` por columna); PR13 (`SESION_RENOVADA_EN_GRACIA`); Vitest de la renovación con Web Locks.
- **Drivers:** DA01, DA11.
- **Consecuencias:** se actualizan la especificación de 001 (FR-008a, SC-010), [research](../../specs/001-registro-acceso-barberia/research.md) R23, el modelo de datos, [seguridad y privacidad](../02-arquitectura-software/seguridad-y-privacidad.md), la [matriz de riesgos](../05-gestion/05-riesgos.md) (R18) y la [trazabilidad](../trazabilidad.md). Modifica la superficie de ADR-015 (ver su nota de consecuencias).