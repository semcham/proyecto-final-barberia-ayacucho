# 07. Decisiones arquitectónicas (ADR)

Un ADR registra **qué** se decidió, **por qué**, qué alternativas se descartaron y qué consecuencias trae. Todas las decisiones nacen de un driver ([06](06-driver-arquitectonicos.md)). Estado: **Propuesto** (pendiente de aprobación del equipo), salvo ADR-020 y ADR-021, **Aceptados** por el responsable el 2026-10-17, y ADR-029 y ADR-030 (funcionalidad 006), **Aceptados** por el responsable el 2026-10-19.

## 1. Tabla resumen

| ID      | Decisión                                                             | Driver relacionado     | Justificación                                                                                            | Resultado                                                                                                                                                                                                |
| ------- | -------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-001 | Monolito modular                                                     | DA04, DA06, DA09, DA10 | Complejidad adecuada a un equipo pequeño, bajo costo, un solo despliegue                                 | Un backend, 6 módulos con límites                                                                                                                                                                        |
| ADR-002 | Arquitectura lógica de cuatro capas                                  | DA06                   | Separa presentación, aplicación, dominio e infraestructura                                               | 4 capas dentro de cada módulo                                                                                                                                                                            |
| ADR-003 | Multi-tenancy: base compartida con `tenant_id` + RLS                 | DA01, DA11, DA09       | Menor costo y operación sencilla, con aislamiento reforzado en la base                                   | Una base; políticas RLS; ruta de evolución para tenants grandes                                                                                                                                          |
| ADR-004 | PostgreSQL como base principal                                       | DA02, DA01             | Transacciones, restricciones de exclusión, RLS                                                           | PostgreSQL fuente de verdad                                                                                                                                                                              |
| ADR-005 | Redis como caché selectiva                                           | DA03                   | Aliviar lecturas frecuentes sin comprometer la consistencia                                              | Caché con claves por tenant, nunca fuente de verdad                                                                                                                                                      |
| ADR-006 | Balanceador de carga y escalado horizontal                           | DA03, DA04, DA05       | Repartir carga y tolerar la caída de una instancia                                                       | ALB de AWS + instancias sin estado; una instancia al inicio                                                                                                                                              |
| ADR-007 | Módulo de pagos desacoplado                                          | DA07                   | Cambiar de proveedor y proteger la suscripción                                                           | Puerto `PaymentGateway` + adaptador; webhook idempotente                                                                                                                                                 |
| ADR-008 | Integración de IA desacoplada                                        | DA08, DA09             | Limitar riesgos y costo; poder cambiar de proveedor                                                      | Puerto `AIProvider`; herramientas cerradas; degradación                                                                                                                                                  |
| ADR-009 | Prevención de reservas duplicadas en PostgreSQL                      | DA02                   | La disponibilidad definitiva no puede depender de caché ni de pantalla                                   | Restricción de exclusión + transacción                                                                                                                                                                   |
| ADR-010 | Autenticación, autorización y aislamiento de datos                   | DA01, DA11             | Proteger datos entre barberías y por rol                                                                 | JWT firmado con tenant y rol, RBAC, RLS, auditoría                                                                                                                                                       |
| ADR-011 | Clean Architecture como enfoque interno (evolución de 3 a 4 capas)   | DA06, DA10             | Dominio independiente de frameworks y proveedores                                                        | Regla de dependencia hacia el interior; abstracciones donde hay riesgo                                                                                                                                   |
| ADR-012 | Resiliencia ante servicios externos                                  | DA05, DA07, DA08, DA12 | Los servicios externos fallan                                                                            | Reintentos, circuit breaker, degradación, conciliación                                                                                                                                                   |
| ADR-013 | Notificaciones multicanal al cliente (correo y WhatsApp)             | DA05, DA09, DA11       | El cliente debe recibir la fecha de su cita por el canal que elija, sin acoplar el núcleo a un proveedor | Puerto `NotificationChannel` con adaptadores de correo y WhatsApp; consentimiento; respaldo por correo                                                                                                   |
| ADR-014 | Frontend con React, Vite y TypeScript                                | DA06, DA10             | Poco código obligatorio, ecosistema amplio y tipos compartidos con el backend                            | Interfaz web de una sola página que consume la API REST                                                                                                                                                  |
| ADR-015 | Autenticación antes de conocer el tenant y RLS en `user_account`     | DA01, DA11             | Iniciar sesión exige leer datos protegidos por RLS sin conocer aún la barbería                           | Rol `barberias_auth` NOLOGIN BYPASSRLS dueño de solo 3 funciones acotadas; RLS en `user_account`                                                                                                         |
| ADR-016 | Sistema de diseño propio con componentes accesibles de Radix         | DA06, DA10             | Interfaz coherente, accesible (WCAG AA) y liviana sin depender de una librería de componentes completa   | Tokens CSS, tema claro y oscuro, Radix solo para comportamiento, fuentes autohospedadas, SVG propios                                                                                                     |
| ADR-017 | Indicador de sesión `hay_sesion` en el navegador                     | DA01, DA11             | No llamar a `/auth/refresh` cuando seguro no hay sesión (401 en consola y métricas)                      | Cookie no secreta de 7 días, sin acceso a nada; la cookie de renovación sigue siendo HttpOnly                                                                                                            |
| ADR-018 | Carga diferida de rutas y librerías en archivos separados            | DA03, DA10             | Bajar el JavaScript inicial para celulares con red lenta                                                 | `React.lazy` por pantalla; React, TanStack Query y formularios en chunks propios                                                                                                                         |
| ADR-019 | Período de gracia en la rotación del token de renovación             | DA01, DA11             | Una renovación interrumpida o repetida revocaba sesiones legítimas (R18)                                 | Token anterior aceptado una sola vez durante 10 s; token reemplazado revoca; fila de sesión bloqueada                                                                                                    |
| ADR-020 | Cuenta de cliente con membresía y sesión por barbería                | DA01, DA11             | Un cliente reserva en varias barberías con un solo correo sin que se mezclen sus datos                   | Una cuenta, una membresía `CLIENTE` y un perfil por barbería; token con un solo `tid`; cambio de barbería emite otra sesión; M02 puede llamar a M01                                                      |
| ADR-021 | Lecturas públicas por enlace (`slug`)                                | DA01, DA03, DA11       | RF10 exige ver el catálogo y los horarios libres sin sesión, sin abrir una vía para leer datos privados  | Rol `barberias_publico` sin `BYPASSRLS`, con `SELECT` solo sobre columnas públicas, transacción de solo lectura y RLS con el tenant del enlace                                                           |
| ADR-029 | Caché compartida con claves por barbería y límite general compartido | DA01, DA03, DA05       | Varias réplicas necesitan la misma caché del catálogo y el mismo conteo por IP, sin mezclar barberías    | Redis sin persistencia; claves solo con `ClavesCache` y `TenantId`; nada por `slug`; invalidación tras confirmar con generación; contadores por IP con respaldo por instancia. **Aceptado (2026-10-19)** |
| ADR-030 | Balanceo local con Nginx como representación de ADR-006              | DA03, DA04, DA05       | Demostrar reparto y tolerancia a la caída de una réplica sin costo de nube                               | Nginx con dos réplicas de IP fija, comprobación pasiva, XFF sobrescrito, `/salud/listo`; equivale al ALB documentado. **Aceptado (2026-10-19)**                                                          |

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
- **Actualización (2026-10-18):** la implementación concreta (claves, invalidación, contadores del límite general y comportamiento sin Redis) se decide en [ADR-029](#adr-029-caché-compartida-con-claves-por-barbería-y-límite-general-compartido).

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
- **Implementación (funcionalidad 002, 2026-10-18):** `appointment.period tstzrange [)` generado con dos
  restricciones `EXCLUDE USING gist` sobre citas `PENDIENTE` y `CONFIRMADA`: `appointment_no_overlap_barber`
  (409 `HORARIO_NO_DISPONIBLE`) y `appointment_no_overlap_customer` (409 `CITA_SOLAPADA_DEL_CLIENTE`).
  Para que 200 reservas simultáneas no se aborten entre sí por bloqueo mutuo, la inserción toma antes un
  bloqueo consultivo por barbero (`pg_advisory_xact_lock`) y reintenta hasta 3 veces ante `40P01`; es una
  ayuda de rendimiento, no la garantía (research R06 de 002). PR16 en verde: 1 respuesta 201, 199
  respuestas 409, 0 respuestas 5xx y una sola cita activa, con dos instancias de la aplicación.

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
- **Consecuencias:** se actualizan [multi-tenancy y datos](../02-arquitectura-software/multi-tenancy-y-datos.md) (casos especiales y tablas globales) y la [trazabilidad](../trazabilidad.md); la funcionalidad 001 implementa el rol, las funciones y sus pruebas en su fase fundacional. **Cambio posterior (ADR-019, migración `0008`):** `auth_buscar_sesion` también busca por `superseded_token_hash` (misma firma, sin tenant, máximo una fila) y `barberias_auth` recibe `SELECT` solo sobre esa columna; las pruebas de PR09 se ampliaron para cubrirlo. **Cambio posterior (ADR-020, migración `0009`), revisado y aprobado el 2026-10-17 por el responsable del proyecto:** `auth_resolver_cuenta` pasa de `JOIN` a `LEFT JOIN` con la membresía de personal y con el tenant, para devolver también las cuentas solo de cliente (con las columnas de membresía en nulo) y verificar su contraseña por el mismo camino de tiempo constante. Se mantienen la firma (un parámetro, sin tenant), las 6 columnas de salida, `LIMIT 1`, el dueño `barberias_auth`, `SECURITY DEFINER`, `search_path = public, pg_temp` y `EXECUTE` solo para `barberias_app`. La función sigue devolviendo como máximo una fila (correo único y una sola membresía de personal por cuenta) y no expone las membresías de cliente, así que no revela en qué barberías está un cliente. Hasta que la funcionalidad 002 agregue el ingreso de clientes (US3), una cuenta solo de cliente recibe el mismo 401 que en 001. Pruebas en PR09 (`funciones-definer.spec.ts`: cliente con membresía en 3 barberías → 1 fila; dueño, `SECURITY DEFINER`, `search_path` y permisos tras la migración) y en `autenticacion.spec.ts`.

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
- **Consecuencias:** se actualizan [tecnologías](../02-arquitectura-software/tecnologias.md) (versiones, licencias y mediciones) y la [trazabilidad](../trazabilidad.md). Un aviso de buena práctica de axe (`region`) permanece mientras un menú o ayuda emergente está abierto, porque Radix los dibuja en un portal fuera de los _landmarks_.

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

## ADR-020 Cuenta de cliente con membresía y sesión por barbería

- **Estado:** Aceptado (decisión del responsable, 2026-10-17).
- **Contexto:** La funcionalidad [002](../../specs/002-catalogo-citas-cliente/spec.md) agrega clientes (RF05) que reservan en una o varias barberías. La funcionalidad 001 fijó: un correo = una cuenta (`user_account`, global con RLS por membresía, ADR-015); un miembro del personal pertenece a una sola barbería (índice único parcial `membership_staff_one_tenant`); el token lleva un solo `tid`; y `auth_resolver_cuenta(email)` solo encuentra cuentas con membresía de personal. El modelo de datos de referencia ya prevé `customer_profile` por barbería ([multi-tenancy y datos](../02-arquitectura-software/multi-tenancy-y-datos.md)). Además, la matriz de dependencias no permite que M02 llame a M01, pero las citas (M02) necesitan identificar al cliente y mostrar su nombre en la agenda, y vincular un barbero con un usuario del personal.
- **Problema:** ¿Cómo modelar al cliente que usa el mismo correo en varias barberías sin mezclar sus datos, sin aceptar el tenant del cliente en operaciones autenticadas y sin romper las reglas de 001?
- **Alternativas:**
  - (a) Una cuenta por correo **y por barbería**: el mismo correo tendría varias contraseñas y rompe la unicidad de `user_account` de 001.
  - (b) Un token con varias barberías (lista de `tid`): cada solicitud tendría que elegir una, es decir, el tenant vendría del cliente (prohibido por ADR-010 y el principio III).
  - (c) Clientes globales fuera del tenant, sin RLS: los datos personales de los clientes quedarían sin la barrera de la base de datos.
  - (d) **Una cuenta por correo; una membresía `CLIENTE` y un perfil de cliente por barbería; una sesión (y un token) por barbería; cambiar de barbería emite una sesión nueva tras comprobar la membresía.**
- **Decisión:** opción (d).
  1. **Datos.** `membership.role_code` admite `CLIENTE`. Cada barbería donde el cliente se une tiene su `membership` (`CLIENTE`, `ACTIVA`) y su `customer_profile` (nombre, correo, teléfono), ambos con `tenant_id` y RLS. El consentimiento se guarda por barbería en `consent_record`. Un perfil puede no tener cuenta: el cliente presencial que registra el propietario (FR-035), con el consentimiento anotado por él.
  2. **Convivencia con 001.** Una cuenta es **o personal de una sola barbería o cliente de una o más**, nunca ambas cosas (supuesto de la especificación 002). `membership_staff_one_tenant` se mantiene. El alta o la unión como cliente se rechaza si la cuenta tiene una membresía de personal, y el alta de personal se rechaza si el correo ya es de un cliente (sigue valiendo el rechazo por correo ya usado de 001). El límite de usuarios del plan (FR-020 de 001) y la lista de usuarios cuentan solo `PROPIETARIO` y `BARBERO`.
  3. **Inicio de sesión.** `auth_resolver_cuenta(email)` conserva su firma (sin tenant, máximo una fila) y pasa a devolver la cuenta aunque no tenga membresía de personal (`LEFT JOIN`): con columnas de membresía nulas para un cliente. Así se verifica la contraseña de cualquier cuenta con un solo camino de tiempo constante. Luego:
     - **Sin enlace** (pantalla general de ingreso): se usa la membresía de personal; si la cuenta es de cliente, tras verificar la contraseña se responde `INGRESA_DESDE_TU_BARBERIA`.
     - **Con enlace** (`barberia`: el `slug` de la página desde la que ingresa): el servidor resuelve el `slug` a un tenant activo, abre una transacción con ese tenant y busca, **con RLS**, la membresía `ACTIVA` de esa cuenta. Si existe, emite la sesión de esa barbería. Si no existe y la cuenta es de cliente, responde `UNIRSE_REQUIERE_CONSENTIMIENTO`, salvo que la solicitud traiga la aceptación de la política de datos: entonces crea la membresía, el perfil y el consentimiento en la misma transacción y emite la sesión.
  4. **Cambio de barbería.** `POST /auth/barberia` (con sesión vigente) recibe el `slug` destino: resuelve el tenant, busca con RLS la membresía `CLIENTE` `ACTIVA` del mismo usuario (`sub` del token) o la crea si viene la aceptación, crea una sesión en el tenant destino, cierra la sesión actual y reemplaza la cookie `rt`. El token nuevo lleva solo el `tid` destino. Nunca hay dos barberías en un mismo token ni en una misma solicitud.
  5. **El `slug` es solo un selector previo a la sesión.** Se usa en cuatro operaciones (registro de cliente, ingreso con enlace, unión y cambio de barbería) para decidir **en qué barbería se crea o se elige la membresía**, siempre después de comprobar la identidad (contraseña o sesión vigente) o de crear la cuenta nueva. Solo escribe filas de la propia persona (cuenta, membresía, perfil, consentimiento, sesión). Ninguna lectura de datos de negocio usa el `slug`: con la sesión emitida, el tenant sale del token. **Es la segunda excepción acotada del principio III**, "selección de membresía por enlace", que agregó la enmienda **1.2.0** de la constitución (2026-10-17); la versión 1.1.0 solo admitía lecturas por enlace. La justificación está en _Complexity Tracking_ del [plan de 002](../../specs/002-catalogo-citas-cliente/plan.md).
  6. **Matriz de módulos.** M02 puede llamar a M01 por su interfaz pública (`ClientesApi`: resolver el perfil del cliente de la sesión y leer nombre y teléfono para la agenda; `PersonalApi`: comprobar que un usuario es personal activo de la barbería para vincularlo a un barbero; `BarberiasApi`: zona horaria, antelación de cancelación, datos públicos de la barbería y resolución del `slug` público a su tenant). M01 sigue sin llamar a M02 (sin ciclos), por eso el horario de atención (`business_hours`) vive en M02. PR14 lo verifica. _(Precisión del 2026-10-17, al generar las tareas de 002: se agregan `BarberiasApi` y la ubicación del horario de atención, sin cambiar la decisión.)_
- **Justificación:** respeta la unicidad del correo y el token de un solo tenant de 001, y deja los datos del cliente bajo RLS por barbería. Cada barbería ve solo su perfil del cliente (FR-028). El cambio de barbería reutiliza la emisión de sesión de 001 sin estados nuevos.
- **Ventajas:** sin datos personales fuera de RLS; una sola contraseña para el cliente; el modelo de sesión no cambia; la agenda obtiene el nombre del cliente por una interfaz pública y no por SQL entre módulos.
- **Desventajas:** el nombre, el correo y el teléfono se repiten en cada barbería (cada una trata sus datos y puede corregirlos); un cliente no puede listar sus barberías sin abrir el enlace de cada una (una función de sistema para listarlas queda como mejora); una cuenta no puede ser personal y cliente a la vez.
- **Riesgos:** R01 si el `slug` llegara a usarse en una operación autenticada; creación de perfiles basura en barberías ajenas mediante registros automatizados. **Mitigación:** las operaciones autenticadas ignoran el `slug` y PR09 lo prueba; límite de solicitudes por IP en registro, ingreso y unión; auditoría `CLIENTE_REGISTRADO` y `CLIENTE_UNIDO`.
- **Pruebas:** PR09 (cliente con membresía en A y B: con el token de A no ve nada de B; el `slug` de B en una solicitud con el token de A no cambia la barbería; el cambio de barbería sin membresía ni aceptación no emite sesión); `auth_resolver_cuenta` sigue devolviendo como máximo una fila y sin parámetro de tenant; integración de registro, ingreso con y sin enlace, unión, cambio de barbería, rechazo de personal como cliente; el límite de usuarios no cuenta clientes; PR14 con la matriz nueva.
- **Revisión obligatoria:** el cambio de `auth_resolver_cuenta` toca una función de ADR-015 y requiere la revisión que ese ADR exige.
- **Drivers:** DA01, DA11.
- **Consecuencias:** se actualizan la matriz de dependencias de [estilo arquitectónico](../02-arquitectura-software/estilo-arquitectonico.md), [multi-tenancy y datos](../02-arquitectura-software/multi-tenancy-y-datos.md), la matriz rol × operación de [seguridad y privacidad](../02-arquitectura-software/seguridad-y-privacidad.md) y la [trazabilidad](../trazabilidad.md).

## ADR-021 Lecturas públicas por enlace (`slug`)

- **Estado:** Aceptado (decisión del responsable, 2026-10-17).
- **Contexto:** RF10 y RF11 exigen ver el catálogo y los horarios libres de una barbería **sin iniciar sesión**. La constitución (principio III, desde la versión 1.1.0) admite esa excepción solo para lectura, con columnas públicas, sin datos personales ni escrituras, y "con un mecanismo acotado y probado que no otorgue al rol de la aplicación la capacidad de omitir RLS". Las tablas implicadas (`service`, `barber`, `barber_service`, `business_hours`, `working_hours`, `time_off`, `appointment`) tienen RLS con `FORCE`, y `appointment` y `time_off` guardan datos privados (cliente, motivo del bloqueo). `tenant` es global.
- **Problema:** ¿Cómo leer, sin token, las filas públicas de una barbería identificada por su enlace, sin omitir RLS y sin que un error de código pueda devolver columnas privadas?
- **Alternativas:**
  - (a) Funciones `SECURITY DEFINER` cuyo dueño sea un rol `NOLOGIN BYPASSRLS` (patrón de ADR-015) que reciben el `slug` y devuelven solo columnas públicas: funciona, pero agrega otro rol `BYPASSRLS` (su creación en Amazon RDS sigue **por validar**), cada función filtra el tenant a mano en lugar de RLS, y el cálculo de horarios necesitaría varias funciones con listas que crecen.
  - (b) Usar la conexión de la aplicación (`barberias_app`) fijando el tenant del `slug`: RLS filtraría las filas, pero ese rol puede leer todas las columnas (incluido `customer_id`) y escribir; la protección dependería solo del código.
  - (c) Vistas públicas con `security_barrier` cuyo dueño omite RLS: mismo problema que (a), sin parámetros que acoten la consulta.
  - (d) Copiar el catálogo a tablas públicas desnormalizadas: duplica datos y su sincronización, y aun así la ocupación necesita las citas.
  - (e) **Un rol de base de datos propio para la vía pública, `barberias_publico` (`LOGIN NOBYPASSRLS`), con `SELECT` solo sobre las columnas públicas, en transacciones de solo lectura con el tenant del enlace fijado, sujeto a la misma RLS.**
- **Decisión:** opción (e).
  1. **Rol.** `barberias_publico`: `LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`, sin propiedad de objetos, sin `EXECUTE` sobre las funciones de ADR-015 ni sobre otras funciones `SECURITY DEFINER`. Conexión y pool propios (`DATABASE_URL_PUBLICO`), con contraseña del gestor de secretos.
  2. **Permisos por columna (la lista de columnas públicas).** `business_hours (tenant_id, weekday, start_time, end_time)`; `service (tenant_id, id, name, description, price, duration_min, active)`; `barber (tenant_id, id, display_name, active)`; `barber_service (tenant_id, barber_id, service_id)`; `working_hours (tenant_id, barber_id, weekday, start_time, end_time)`; `time_off (tenant_id, barber_id, starts_at, ends_at)`, **sin** `reason`; `appointment (tenant_id, barber_id, starts_at, ends_at, status)`, **sin** `customer_id`, precio, historial ni autores. Ningún permiso sobre `user_account`, `membership`, `customer_profile`, `consent_record`, `auth_session`, `audit_log` ni las demás tablas. Ningún `INSERT`, `UPDATE` ni `DELETE`.
  3. **Transacción.** M01 resuelve el `slug` con `BarberiasApi.resolverSlugPublico(slug)` sobre su tabla global `tenant`: devuelve el `tenantId` de una barbería `ACTIVA`, y si no existe, cambió o está suspendida, da "barbería no disponible". Los datos públicos de la barbería (nombre, dirección, teléfono, descripción, zona) los da `BarberiasApi.datosPublicos`. Después, `LecturaPublica.ejecutar(tenantId, fn)` (M06) **solo** abre `BEGIN READ ONLY`, fija `app.tenant_id` con `set_config(..., true)` y ejecuta la lectura; no lee ninguna tabla por sí misma. Las políticas `tenant_isolation` existentes filtran las filas sin cambios, porque aplican a todo rol. _Precisión del 2026-10-17 (análisis de la funcionalidad 002, hallazgo C1):_ la versión anterior resolvía el `slug` dentro de la transacción pública, lo que hacía que M06 leyera una tabla de M01 (principio I). Por eso `tenant` sale también de la lista de la decisión 2. La decisión no cambia.
  4. **Código.** Solo `catalogo-citas/catalogo/infrastructure/publico/` usa el pool público, mediante un repositorio de solo lectura (`CatalogoPublicoRepository`) que devuelve DTO con las columnas públicas. El cálculo de horarios libres es el mismo del dominio que usa la vía autenticada. Los controladores públicos (`/publico/{slug}/…`) solo exponen `GET`, no leen el token aunque llegue, y ninguna operación autenticada acepta `slug`. PR14 prohíbe importar el pool público fuera de esa carpeta.
  5. **Abuso.** Límite de solicitudes por IP en la vía pública; la ocupación se consulta como máximo para un día por solicitud y dentro del horizonte de reserva (30 días).
- **Justificación:** no se otorga `BYPASSRLS` a nadie nuevo: las filas las sigue filtrando RLS, las columnas las limita PostgreSQL con permisos por columna (un `SELECT` de una columna privada falla con error de permisos aunque el código tenga un error) y la escritura la impiden los permisos y el modo de solo lectura. Es más estricto que (a) y no depende de la validación pendiente en RDS. Que el rol pueda fijar el tenant de cualquier barbería es intencional: todo lo que ve es público por definición.
- **Ventajas:** tres barreras independientes (permisos por columna, RLS y solo lectura) más el filtro del repositorio; sin SQL de sistema que mantener; el mismo código de dominio para la vía pública y la autenticada.
- **Desventajas:** un rol y un pool más (otra credencial que custodiar y conexiones que dimensionar); cada columna nueva pública exige un `GRANT` explícito en su migración.
- **Riesgos:** R01 si una migración futura concede de más; exposición de la ocupación de un barbero (qué horas tiene tomadas, sin saber quién). **Mitigación:** las pruebas de abajo comparan los permisos con la lista cerrada y fallan ante cualquier permiso nuevo; la ocupación ya se deduce de los horarios libres que RF11 obliga a mostrar.
- **Pruebas (parte de PR09):** (1) los permisos de `barberias_publico` en `information_schema.column_privileges` y `table_privileges` coinciden **exactamente** con la lista de la decisión 2 (sin `INSERT`, `UPDATE`, `DELETE`); (2) `barberias_publico` no tiene `BYPASSRLS`, no es dueño de nada y no puede ejecutar las funciones de ADR-015; (3) con el pool público, `SELECT customer_id FROM appointment` y `SELECT reason FROM time_off` fallan por permisos; (4) con el tenant de A fijado no aparece ninguna fila de B, y sin tenant, ninguna; (5) una escritura en la transacción pública falla; (6) HTTP: con datos "canario" (correos y teléfonos únicos de clientes, del personal y motivos de bloqueo) sembrados en A y B, ninguna respuesta de `/publico/*` los contiene; un `slug` inexistente y uno suspendido dan la misma respuesta; `POST`, `PUT`, `PATCH` y `DELETE` sobre `/publico/*` se rechazan; un token de B enviado a `/publico/{slug-de-A}` no cambia nada.
- **Drivers:** DA01, DA03, DA11.
- **Consecuencias:** se crea el rol en `db/init/01-roles.sql` y en el entorno de pruebas; se actualizan [multi-tenancy y datos](../02-arquitectura-software/multi-tenancy-y-datos.md) (control 1 y casos especiales), [API REST](../02-arquitectura-software/api-rest.md) (rutas públicas) y la [trazabilidad](../trazabilidad.md). La caché del catálogo de la funcionalidad 006 (ADR-029) se alimentará de esta misma vía, con claves por tenant.

## ADR-029 Caché compartida con claves por barbería y límite general compartido

- **Estado:** Aceptado (decisión del responsable, 2026-10-19). Registrado el 2026-10-18 con la funcionalidad 006.
- **Contexto:** con dos réplicas del backend (ADR-030), una caché en memoria de cada proceso no se comparte y el límite general de solicitudes por IP se duplica, porque cada réplica cuenta por su cuenta. La medición de 002 dio un p95 de 935–1 011 ms en horarios libres con 50 consultas simultáneas, frente a la meta de 800 ms (EQ-01). Cada consulta pública abre tres transacciones. La constitución exige que toda clave de caché incluya el tenant (principio III), que Redis solo guarde caché y contadores no críticos y que el sistema funcione sin él (principio VIII). El responsable fijó Redis como herramienta.
- **Problema:** ¿qué se guarda, con qué claves, cómo se invalida sin dejar datos viejos y cómo se comparte el límite general sin hacer de Redis una pieza imprescindible?
- **Alternativas:**
  - (a) Caché en memoria de cada réplica: no se comparte y las invalidaciones de una réplica no llegan a la otra.
  - (b) Guardar la respuesta HTTP completa por `slug`: la clave no puede incluir el tenant (principio III); un enlace cambiado o reutilizado por otra barbería serviría datos ajenos; M01 tendría que invalidar entradas de M02.
  - (c) Invalidar con `DEL` y confiar en el TTL: una lectura que empezó antes del cambio puede volver a guardar el dato viejo.
  - (d) Contar el límite en Nginx (`limit_req`): no conoce las rutas por nombre y duplica la configuración.
  - (e) **Redis para el catálogo público por barbería y para los contadores por IP, detrás de un puerto de M06, con fábrica única de claves, invalidación tras confirmar con contador de generación y respaldo por instancia.**
- **Decisión:** opción (e).
  1. **Puerto y adaptador.** `CacheCompartida` (M06) con un adaptador `ioredis`, que es el único lugar que lo importa (regla `redis-confinado` de PR14). Sin `REDIS_URL`, se usa `CacheInactiva`.
  2. **Claves.** Solo `ClavesCache` construye claves de datos de barbería. Exige un `TenantId` y produce `bp:v1:t:{tenantId}:…`. **Ninguna clave se deriva del `slug`:** el enlace y los datos de la barbería se leen en cada solicitud en **una** transacción de M01 (`BarberiasApi.barberiaPublicaPorEnlace`). Así, un cambio de enlace, una barbería suspendida o un enlace reutilizado se reflejan al instante.
  3. **Qué se guarda.** `bp:v1:t:{tenantId}:catalogo-publico`: horario de atención, servicios activos y barberos activos con sus servicios. Son solo columnas públicas de ADR-021, con TTL de 120 s (configurable, como máximo 300 s). La disponibilidad semanal, los bloqueos y las citas del día se leen **siempre** de PostgreSQL.
  4. **Invalidación.** Después de confirmar, mediante `UnitOfWork.alConfirmar`, la operación hace `INCR` de `…:catalogo-publico:gen` y `DEL` de la entrada, en los casos de uso de servicios, barberos y horario de atención. El lector guarda con un script Lua **solo si** la generación no cambió durante su lectura. La matriz completa está en `specs/006-escalado-cache-balanceo/contracts/cache-claves.md`.
  5. **Límite general.** `ThrottlerStorage` propio: contadores `rl:v1:{hash}` por IP (Lua: `INCR` + `PEXPIRE`), sin tenant porque el límite es por IP. El principio III pide el tenant en toda clave de caché, pero estos contadores no son caché de datos de una barbería: los regula el principio VIII, más específico, que exige el tenant solo en límites por barbería o por usuario. Si Redis no responde, se usa el almacenamiento en memoria de cada instancia. Los intentos de inicio de sesión y la futura cuota de IA siguen en PostgreSQL.
  6. **Fallos.** Cada operación tiene un tiempo límite de 100 ms. Un interruptor deja de usar Redis 10 s tras 5 fallos seguidos y registra una sola línea `CACHE_NO_DISPONIBLE`. Al recuperarse, registra `CACHE_RECUPERADA`. Redis corre sin persistencia (`--save ""`, sin AOF), con `maxmemory` y expulsión LRU.
  7. **Ajuste condicionado (FR-013b).** Si la medición con el catálogo en caché no cumple los 800 ms, se evalúa guardar los horarios calculados 30 s, con una generación por barbería que suben las reservas, cancelaciones, cambios de estado, bloqueos y disponibilidad. La reserva sigue comprobando en PostgreSQL. El resultado se agregará a este ADR.
- **Justificación:** cumple el principio III sin usar sus excepciones para la caché, porque toda clave lleva el tenant y nada se guarda por enlace. Cumple el principio VIII: Redis solo guarda caché con TTL y contadores tolerantes a pérdida, y el sistema funciona sin él. La generación cierra la carrera entre lectura e invalidación con un costo mínimo. Resolver el enlace en cada solicitud cuesta una consulta por índice y elimina casos límite enteros.
- **Ventajas:** caché y límite iguales con una o varias réplicas; claves imposibles de construir sin tenant; invalidación visible desde cualquier réplica; degradación probada.
- **Desventajas:** una dependencia (`ioredis`) y un servicio más que operar; el catálogo puede quedar viejo hasta el TTL si una invalidación se pierde con Redis caído; con Redis caído, el límite real es el configurado por cada réplica.
- **Riesgos:** R01 (mezcla entre barberías) y R05 (datos desactualizados). **Mitigación:** fábrica única de claves y PR09 `aislamiento-cache` (claves con el tenant de su dueña, sin datos canario en Redis, enlace reutilizado); prueba de la matriz de invalidación desde la otra réplica y prueba de la carrera; TTL corto.
- **Pruebas:** unitarias de claves, interruptor y almacenamiento de límites; integración `cache-catalogo`, `aislamiento-cache` (PR09), `limite-compartido`, `redis-caido` (PR05); PR14 `redis-confinado`; medición PR01 con y sin caché.
- **Drivers:** DA01, DA03, DA05.
- **Consecuencias:** actualiza ADR-005 y la [estrategia de caché](../02-arquitectura-software/estrategia-de-cache.md). Con el código se actualizan [tecnologías](../02-arquitectura-software/tecnologias.md) (`ioredis`, imagen de Redis) y la [trazabilidad](../trazabilidad.md).

## ADR-030 Balanceo local con Nginx como representación de ADR-006

- **Estado:** Aceptado (decisión del responsable, 2026-10-19). Registrado el 2026-10-18 con la funcionalidad 006.
- **Contexto:** ADR-006 define como objetivo un Application Load Balancer de AWS con varias instancias del mismo monolito, pero el despliegue en AWS está documentado y no se ejecuta. El curso pide demostrar el balanceo y la tolerancia a la caída de una instancia. El entorno es Docker Compose en un equipo con Windows y 8 GB de RAM. El responsable fijó Nginx.
- **Problema:** ¿cómo representar localmente el balanceador de ADR-006 de forma que lo demostrado (reparto, caída, IP real, migraciones) se traslade a la nube sin cambiar el código?
- **Alternativas:**
  - (a) `deploy.replicas: 2` sobre un solo servicio: Nginx resuelve el nombre solo al arrancar; la demo no puede detener una réplica concreta; dos `npm ci` o dos compiladores comparten volúmenes.
  - (b) HAProxy o Traefik, que tienen comprobación activa de salud: el responsable fijó Nginx, y la comprobación pasiva cumple la medida de EQ-04.
  - (c) Nginx con `resolver` y variables en `proxy_pass`: pierde el bloque `upstream` (`max_fails`, reparto).
  - (d) **Nginx de código abierto con dos réplicas explícitas de IP fija, comprobación pasiva y un servicio de preparación que instala, compila y migra una sola vez.**
- **Decisión:** opción (d).
  1. **Servicios.**
     - `preparar-backend` es de una sola ejecución: `npm ci`, build y migraciones.
     - `backend-1` y `backend-2` ejecutan el build compilado, sin puertos publicados.
     - `nginx` publica el 3000.
     - Todos están en una red con subred fija. Cada contenedor tiene un límite de memoria (unos 1,9 GB de uso estable).
  2. **Salud.** `GET /api/v1/salud/listo` comprueba que PostgreSQL responde y que la última migración aplicada coincide con la del código. La usan el healthcheck de Docker y, en la nube, el ALB. Nginx usa la comprobación pasiva:
     - `max_fails=1 fail_timeout=10s`;
     - `proxy_connect_timeout 1s`;
     - reintento en la otra réplica solo de GET y HEAD.
  3. **Migraciones una sola vez.** Las aplica `preparar-backend`. Si dos procesos las lanzan a la vez, el bloqueo de PostgreSQL que toma el `Migrator` de Kysely las serializa, y una prueba lo demuestra.
  4. **IP real.** Nginx **sobrescribe** `X-Forwarded-For` con `$remote_addr`. El backend confía solo en la IP de Nginx (`PROXIES_CONFIABLES`; por defecto `loopback`, en lugar de cualquier red privada).
  5. **Sin réplicas.** Nginx responde 503 JSON `SERVICIO_NO_DISPONIBLE` con `Retry-After`.
  6. **Equivalencias en la nube:** Nginx → ALB, con comprobación activa sobre `/salud/listo`; réplicas → tareas o instancias; `preparar-backend` → tarea de migración previa; `PROXIES_CONFIABLES` → subred del ALB.
- **Justificación:** las IP fijas evitan que Nginx dependa del DNS de Docker. Los servicios con nombre permiten demostrar la caída de una réplica concreta. La comprobación pasiva detecta la falla con la primera solicitud fallida, dentro de los 15 s de EQ-04. Sobrescribir el encabezado impide falsear la IP para el límite y la auditoría.
- **Ventajas:** demuestra EQ-04 y PR16 a través de un balanceador real; la misma plantilla de Nginx se usa en las pruebas de CI; no cuesta nada.
- **Desventajas:** sin recarga en caliente en el entorno escalado (un cambio exige recrear la preparación y las réplicas); Nginx local es un punto único de falla; detrás de Docker Desktop todas las solicitudes del equipo comparten IP; las réplicas comparten CPU, así que no demuestran más capacidad (EQ-03 queda pendiente).
- **Aclaración:** como en ADR-006, **esto no es alta disponibilidad**: el balanceador, PostgreSQL y Redis siguen siendo únicos.
- **Riesgos:** R03 (caída del backend) y R04. **Mitigación:** PR04 en CI (Nginx en contenedor delante de dos instancias) y demo con el entorno real; PR16 a través de Nginx.
- **Pruebas:** integración `balanceador` (reparto, caída de una réplica con ≤ 2 % de errores en la transición, encabezado falso ignorado, 503 sin réplicas, PR16 por Nginx) y `salud-listo` (migraciones en paralelo); `demo:caida --objetivo replica`.
- **Drivers:** DA03, DA04, DA05.
- **Consecuencias:** se reescribe `docker-compose.yml` y se agrega `nginx/templates/`. Con el código se actualizan [despliegue y escalabilidad](../02-arquitectura-software/despliegue-y-escalabilidad.md) (equivalencias), [API REST](../02-arquitectura-software/api-rest.md) (`/salud/listo`, 503), el README de la aplicación y la [trazabilidad](../trazabilidad.md).
