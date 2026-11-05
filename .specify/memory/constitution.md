<!--
Sync Impact Report
==================
Version change: 1.4.0 → 1.4.1
Bump rationale: PATCH. Tres aclaraciones que corrigen el texto de la 1.4.0 para que coincida con
el sistema y con la especificación de 004, sin ampliar lo que se permite. Aprobada por el
responsable el 2026-11-04 tras el análisis de consistencia de la funcionalidad 004 (hallazgos C1 a
C3).

Modified principles:
  - III. Aislamiento por barbería (NO NEGOCIABLE):
    - "Tablas técnicas de intentos" (C1): la 1.4.0 decía que ambas tablas guardan solo un resumen
      criptográfico del origen, pero login_attempt (migración 0006) guarda la IP en claro y no
      tiene purga programada. Ahora se describe tal como es (SHA-256 del correo, IP en claro y
      fecha; borrado oportunista de lo mayor a 24 h al registrar un fallo y borrado de los fallos
      del par al ingresar bien), y action_link_attempt guarda el origen solo como hash con sal
      (ENLACES_SAL_IP). Pasar login_attempt a hash de IP queda como mejora planificada para 007; el
      código de inicio de sesión no cambia en 004.
    - Tercera excepción (C3): se aclara que los trabajos en segundo plano pueden listar los
      pendientes de sus propias tablas leyendo solo columnas técnicas (identificador, tenant_id,
      estado y fechas), sin leer su contenido, y procesar cada uno con su tenant y RLS. Es lo que ya
      hace ADR-024 en 003 y lo que necesitan el despacho y el envío de avisos de 004 (ADR-025).
  - VII. Notificaciones con consentimiento y sin bloqueo (C2): la lista de datos mínimos de los
    mensajes pasa a ser la real de la especificación de 004: barbería, servicio, nombre visible del
    barbero, fecha y hora, hora anterior y enlaces de acción; en los avisos al propietario, además,
    plan, período y motivo. Se aclara que el cuerpo nunca lleva teléfonos, correos ni datos de pago.
Added principles: ninguno
Added sections: ninguna
Removed sections: ninguna

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — puertas III y VII (versión 1.4.1)
  ✅ .specify/templates/spec-template.md y tasks-template.md — revisados; sin cambios necesarios
  ✅ docs/02-arquitectura-software/multi-tenancy-y-datos.md — casos especiales: tablas técnicas
     de intentos y trabajos en segundo plano
  ✅ docs/05-gestion/02-backlog-y-sprints.md — mejora "login_attempt con hash de IP" asignada a 007
  ✅ specs/004-notificaciones-reprogramacion/ — plan (Constitution Check con la 1.4.1), spec
     (FR-012, FR-035, SC-005), tasks y la propuesta decisiones/enmienda-constitucion-1.4.1.md
  ✅ specs/001, 002, 003 y 006 — sin cambios: la 1.4.1 describe lo que ya hacen

Follow-up TODOs: login_attempt con hash de IP (funcionalidad 007).

--- Historial: informe de la versión 1.4.0 ---
Version change: 1.3.1 → 1.4.0
Bump rationale: MINOR. Se amplía materialmente la guía del principio III con una cuarta excepción
acotada, "acciones por enlace de la cita", y se nombran las tablas técnicas de intentos, sin eliminar
ni redefinir nada: todo lo que cumplía la 1.3.1 (funcionalidades 001, 002, 003 y 006) sigue
cumpliendo. Enmienda aprobada por el responsable el 2026-11-04, junto con ADR-032, al aprobar el
plan de la funcionalidad 004.

Modified principles:
  - III. Aislamiento por barbería (NO NEGOCIABLE) — se añade la excepción acotada "acciones por
    enlace de la cita": el recordatorio (RF34) puede incluir enlaces para confirmar, reprogramar o
    cancelar UNA cita sin sesión; la barbería y la cita salen solo del dato firmado del enlace,
    verificado antes de leer nada; la acción usa el rol de la aplicación sin BYPASSRLS, con el
    tenant fijado y RLS; un enlace sirve para una cita, una acción y un uso, vence a la hora de
    inicio, deja de valer si la cita cambia y no puede reconstruirse a partir de lo guardado; los
    rechazos se limitan por origen con un contador en PostgreSQL. Se agrega el párrafo "Tablas
    técnicas de intentos" (login_attempt, de 001, y action_link_attempt, de 004), que regulariza
    login_attempt, ausente de la lista cerrada de la 1.3.1. Origen:
    specs/004-notificaciones-reprogramacion/research.md R06 a R08 y Complexity Tracking del plan.
Added principles: ninguno
Added sections: ninguna
Removed sections: ninguna

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — puerta III (versión 1.4.0, cuarta excepción)
  ✅ .specify/templates/spec-template.md y tasks-template.md — revisados; sin cambios necesarios
  ✅ docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md — ADR-032, ADR-025 y ADR-026
     Aceptados; ADR-013 revisado y Aceptado (con M05 → M01 de solo lectura)
  ✅ docs/02-arquitectura-software/multi-tenancy-y-datos.md — §1.3 con las cuatro excepciones y las
     tablas técnicas de intentos
  ✅ docs/02-arquitectura-software/estilo-arquitectonico.md y componentes-arquitectonicos.md —
     matriz de dependencias con M05 → M01
  ✅ specs/004-notificaciones-reprogramacion/plan.md — puertas III y XI en verde
  ✅ specs/001, 002, 003 y 006 — sin cambios: no usan la excepción nueva

Follow-up TODOs: ninguno. La excepción solo puede usarse dentro de lo que describe ADR-032; PR28 y
PR09 (aislamiento-avisos) la verifican al implementar 004.

--- Historial: informe de la versión 1.3.1 ---
Version change: 1.3.0 → 1.3.1
Bump rationale: PATCH. Aclaración del alcance de la excepción "operaciones de la plataforma" del
principio III, sin ampliar lo que permite: nombra las tablas de la plataforma (sin barbería y sin
datos de negocio), admite la auditoría del acceso del administrador sin barbería y prohíbe al rol de
la aplicación leer `provider_event` y `platform_admin`. Aprobada por el responsable el 2026-10-24
tras el análisis de consistencia de la funcionalidad 003 (hallazgos C1 a C3).

Modified principles:
  - III. Aislamiento por barbería (NO NEGOCIABLE) — en la excepción "operaciones de la plataforma"
    se agrega el párrafo "Tablas de la plataforma": `provider_event`, `scheduled_job_run`,
    `platform_session`, `platform_challenge`, `platform_admin` y `platform_audit_log` pueden no
    tener `tenant_id` ni RLS por barbería porque no contienen datos de negocio; el acceso del
    administrador se audita sin barbería; el rol de la aplicación solo inserta en `provider_event` y
    no lee `platform_admin`. El rol de lectura de la plataforma queda de solo lectura de verdad: las
    sesiones y desafíos del administrador los escribe el rol de la aplicación.
Added principles: ninguno
Added sections: ninguna
Removed sections: ninguna

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — puerta III (versión 1.3.1, tablas de la plataforma)
  ✅ .specify/templates/spec-template.md y tasks-template.md — revisados; sin cambios necesarios
  ✅ docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md — ADR-031 (y ADR-022, ADR-024)
     con los roles y tablas corregidos
  ✅ docs/02-arquitectura-software/multi-tenancy-y-datos.md — rol barberias_plataforma de solo
     lectura y tablas de la plataforma
  ✅ specs/003-suscripciones-pagos/ — spec, plan, research, data-model, contratos y tasks

Follow-up TODOs: ninguno.

--- Historial: informe de la versión 1.3.0 ---
Version change: 1.2.0 → 1.3.0
Bump rationale: MINOR. Se amplía materialmente la guía del principio III con una tercera excepción
acotada, sin eliminar ni redefinir nada: todo lo que cumplía la versión 1.2.0 (funcionalidades 001,
002 y 006) sigue cumpliendo. Enmienda aprobada por el responsable el 2026-10-24, junto con ADR-031,
al aprobar el plan de la funcionalidad 003.

Modified principles:
  - III. Aislamiento por barbería (NO NEGOCIABLE) — se añade la excepción acotada "operaciones de
    la plataforma": el administrador de la plataforma, que no pertenece a ninguna barbería, opera
    sobre barberías, suscripciones, pagos y comprobantes con una cuenta y una sesión propias de la
    plataforma, con segundo factor obligatorio y un token sin tenant que no sirve en operaciones de
    una barbería. Sus lecturas entre barberías usan un rol sin `BYPASSRLS`, de solo lectura y con
    permisos por columna. Cada escritura afecta a una sola barbería, identificada en la ruta, con su
    tenant fijado, RLS y auditoría en esa barbería. No ve citas, clientes, catálogo ni usuarios. Las
    notificaciones del proveedor de pagos y los trabajos en segundo plano pueden localizar el tenant
    con esa lectura, por clave exacta, nunca con datos del cliente. Origen:
    specs/003-suscripciones-pagos/research.md R06 y Complexity Tracking del plan de 003.
Added principles: ninguno
Added sections: ninguna
Removed sections: ninguna

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — puerta III de la Constitution Check (versión 1.3.0)
  ✅ .specify/templates/spec-template.md — revisado; sin cambios necesarios
  ✅ .specify/templates/tasks-template.md — revisado; sin cambios necesarios
  ✅ .claude/skills/speckit-*/SKILL.md — revisados; sin referencias al principio III
  ✅ docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md — ADR-022, ADR-023, ADR-024 y
     ADR-031 Aceptados
  ✅ docs/02-arquitectura-software/multi-tenancy-y-datos.md — control 1 con las tres excepciones,
     rol barberias_plataforma y casos especiales del administrador, del webhook y de las tareas
  ✅ specs/003-suscripciones-pagos/plan.md — puerta III en verde
  ✅ specs/001-registro-acceso-barberia/plan.md, specs/002-catalogo-citas-cliente/plan.md y
     specs/006-escalado-cache-balanceo/plan.md — sin cambios: no usan la excepción nueva

Follow-up TODOs: ninguno. ADR-031 (operaciones de la plataforma) está Aceptado desde el
2026-10-24; la excepción no puede usarse fuera de lo que ese ADR describe.

--- Historial: informe de la versión 1.2.0 ---
Version change: 1.1.0 → 1.2.0
Bump rationale: MINOR. Se amplía materialmente la guía del principio III con una segunda
excepción acotada, sin eliminar ni redefinir nada: todo lo que cumplía la versión 1.1.0
(incluida la funcionalidad 001) sigue cumpliendo. Enmienda aprobada por el responsable el
2026-10-17 al aprobar el plan de la funcionalidad 002.

Modified principles:
  - III. Aislamiento por barbería (NO NEGOCIABLE) — se añade la excepción acotada "selección de
    membresía por enlace": el registro de cliente, el inicio de sesión desde el enlace, la unión a
    otra barbería y el cambio de barbería pueden usar el `slug` antes de tener la sesión de esa
    barbería, solo tras comprobar la identidad o al crear la cuenta, solo para escribir filas de la
    propia persona, y nunca en operaciones de negocio con sesión. Origen:
    specs/002-catalogo-citas-cliente/research.md R04 y Complexity Tracking del plan de 002.
Added principles: ninguno
Added sections: ninguna
Removed sections: ninguna

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — puerta III de la Constitution Check (versión 1.2.0)
  ✅ .specify/templates/spec-template.md — revisado; sin cambios necesarios
  ✅ .specify/templates/tasks-template.md — revisado; sin cambios necesarios
  ✅ .claude/skills/speckit-*/SKILL.md — revisados; sin referencias al principio III
  ✅ docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md — ADR-020 y ADR-021 Aceptados
  ✅ docs/02-arquitectura-software/multi-tenancy-y-datos.md — control 1 con las dos excepciones
  ✅ docs/trazabilidad.md — fila de 002 sin la decisión pendiente
  ✅ specs/002-catalogo-citas-cliente/plan.md y research.md — puerta III en verde y R04 resuelta
  ✅ specs/001-registro-acceso-barberia/plan.md — sin cambios: no usa ninguna excepción

Follow-up TODOs: ninguno. ADR-020 (selección de membresía por enlace) y ADR-021 (lecturas
públicas por enlace) están Aceptados desde el 2026-10-17. ADR-029 (Redis) sigue pendiente para la
funcionalidad 006, como registró la versión 1.1.0.

--- Historial: informe de la versión 1.1.0 ---
Version change: 1.0.1 → 1.1.0
Bump rationale: MINOR. Se amplía materialmente la guía de dos principios con excepciones acotadas,
sin eliminar ni redefinir de forma incompatible ninguno: todo lo que cumplía la versión 1.0.1
(incluida la funcionalidad 001) sigue cumpliendo. Enmienda aprobada por el responsable el
2026-10-17, junto con la hoja de ruta de las funcionalidades 002 a 006.

Modified principles:
  - III. Aislamiento por barbería (NO NEGOCIABLE) — se añade la excepción acotada de lecturas
    públicas por enlace (slug) para el catálogo y los horarios libres (RF10, RF11): solo lectura,
    solo columnas públicas, sin datos personales de clientes ni de contacto o cuenta del personal,
    sin escrituras y sin dar al rol de la aplicación la capacidad de omitir RLS. Las operaciones
    autenticadas siguen tomando el tenant solo del token.
  - VIII. Redis solo como caché — Redis puede guardar contadores no críticos (límite general de
    solicitudes, tolerantes a pérdida, con tenant en la clave cuando corresponde). Los contadores de
    seguridad o costo (intentos de inicio de sesión, cuota de IA) y todo estado de seguridad quedan
    en PostgreSQL. Sin Redis, el límite general se aplica por instancia.
Added principles: ninguno
Added sections: ninguna
Removed sections: ninguna

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — puertas III y VIII de la Constitution Check
  ✅ .specify/templates/spec-template.md — revisado; sin cambios necesarios
  ✅ .specify/templates/tasks-template.md — revisado; sin cambios necesarios
  ✅ .claude/skills/speckit-*/SKILL.md — revisados; sin referencias a los principios III ni VIII
  ✅ README.md — fila "Caché" de la vista rápida
  ✅ docs/02-arquitectura-software/estrategia-de-cache.md — principio, contadores no críticos y
     lista de revocación (que pasa a PostgreSQL, como ya hace la funcionalidad 001)
  ✅ docs/02-arquitectura-software/multi-tenancy-y-datos.md — control 1 con la excepción
  ✅ specs/001-registro-acceso-barberia/plan.md — sin cambios: su Constitution Check sigue
     cumpliendo (001 no usa lecturas públicas por enlace ni Redis)

Follow-up TODOs:
  - ADR-021 (lecturas públicas por enlace) se escribirá al especificar la funcionalidad 002, y
    ADR-029 (Redis para límites compartidos), al especificar la 006. La gobernanza pide registrar
    el ADR con la enmienda si afecta la arquitectura; el responsable decidió diferirlos a esas
    especificaciones, y ninguna de las dos excepciones puede usarse antes de que exista su ADR.
  - ADR-005 (Redis como caché selectiva) se actualizará con ADR-029.
-->

# Constitución de la Plataforma SaaS de Barberías de Ayacucho

Plataforma web SaaS multi-tenant para que muchas barberías de Ayacucho gestionen servicios,
barberos, horarios y citas, con los datos de cada barbería aislados de las demás.

## Core Principles

### I. Monolito modular de seis módulos

- El backend MUST ser un único desplegable organizado en exactamente seis módulos:
  M01 Acceso y barberías, M02 Catálogo y citas, M03 Suscripciones y pagos,
  M04 Asistente IA y reportes, M05 Notificaciones y M06 Núcleo compartido.
- MUST NOT crearse módulos nuevos. Una capacidad nueva MUST ubicarse en uno de los seis módulos,
  como submódulo cuando lo justifique la cohesión.
- Un módulo MUST llamar a otro solo a través de su interfaz pública (`index`) y solo si la
  matriz de dependencias permitidas lo autoriza; MUST NOT acceder a sus tablas ni a sus clases
  internas. Los efectos secundarios entre módulos MUST ir por eventos del bus de M06.
- M06 MUST NOT contener reglas de negocio ni depender de módulos de negocio.
- Microservicios MUST NOT introducirse en el MVP.

**Razón:** ADR-001 y RC06/RC10; un equipo pequeño opera una sola unidad con límites claros.
Cambiar el número de módulos exige enmendar esta constitución y registrar un ADR (principio XI).

### II. Cuatro capas con Clean Architecture

- Cada submódulo (o módulo sin submódulos) MUST tener cuatro capas: `presentation`,
  `application`, `domain` e `infrastructure`.
- Las dependencias MUST apuntar hacia el dominio. `domain` MUST NOT importar frameworks, ORM,
  PostgreSQL, Redis ni SDK de proveedores; `infrastructure` MUST implementar los puertos
  definidos en `application`.
- Los puertos (abstracciones) MUST crearse donde hay riesgo real de cambio (pagos, IA,
  notificaciones, repositorios); en submódulos simples se usan casos de uso delgados.
- Una prueba de arquitectura (PR14) MUST fallar si se viola la regla de dependencia o la matriz
  de módulos.

**Razón:** ADR-002 y ADR-011; el dominio se prueba sin infraestructura y los proveedores son
intercambiables.

### III. Aislamiento por barbería (NO NEGOCIABLE)

- El `tenant_id` MUST obtenerse del token firmado y fijarse en el contexto de la solicitud.
  MUST NOT aceptarse desde el cuerpo, la ruta, la consulta ni los encabezados del cliente.
- Toda tabla de negocio MUST tener `tenant_id` y una política de Row-Level Security activa en
  PostgreSQL. El rol de base de datos de la aplicación MUST NOT poder omitir RLS.
- Los repositorios MUST filtrar además por tenant (defensa en profundidad).
- Toda clave de caché, evento, registro de auditoría y trabajo en segundo plano MUST incluir el
  tenant.
- **Excepción acotada: lecturas públicas por enlace.** Las consultas sin sesión del catálogo
  público y de los horarios libres de una barbería (RF10, RF11) MAY identificar la barbería por
  su enlace público (`slug`) en la ruta. Esa vía MUST ser de solo lectura y MUST exponer solo
  columnas públicas: MUST NOT devolver datos personales de clientes ni datos de contacto o de
  cuenta del personal (el nombre visible con el que la barbería presenta a cada barbero se
  considera dato público de la barbería). MUST NOT escribir, MUST NOT usarse en operaciones
  autenticadas y MUST resolverse con un mecanismo acotado y probado que no otorgue al rol de la
  aplicación la capacidad de omitir RLS. Toda operación autenticada MUST seguir tomando el tenant
  solo del token. La decisión se registra en ADR-021.
- **Excepción acotada: selección de membresía por enlace.** Antes de que exista la sesión de una
  barbería, el registro de cliente, el inicio de sesión desde el enlace de la barbería, la unión
  de un cliente a otra barbería y el cambio de barbería del cliente (RF05) MAY identificar la
  barbería por su enlace público (`slug`), solo para decidir en qué barbería se crea o se elige la
  membresía de cliente. Esa vía MUST usarse solo después de comprobar la identidad (contraseña o
  sesión vigente) o al crear la cuenta nueva, MUST escribir únicamente filas de la propia persona
  (cuenta, membresía, perfil de cliente, consentimiento y sesión) y MUST NOT leer ni modificar
  otros datos de negocio. Una vez emitida la sesión, el tenant MUST salir solo del token; ninguna
  operación de negocio con sesión MUST aceptar el `slug`. La decisión se registra en ADR-020.
- **Excepción acotada: operaciones de la plataforma.** El administrador de la plataforma, que no
  pertenece a ninguna barbería, MAY operar sobre barberías, suscripciones, pagos y comprobantes de
  cualquier barbería. Su cuenta y su sesión MUST ser propias de la plataforma, con segundo factor
  obligatorio, y su token MUST NOT llevar tenant ni servir en operaciones de una barbería. Sus
  lecturas entre barberías MUST hacerse con un rol de base de datos sin `BYPASSRLS`, de solo
  lectura y con permisos por columna sobre esas tablas. Cada escritura MUST afectar a una sola
  barbería, identificada por el administrador en la ruta, en una transacción con ese tenant fijado
  y con RLS, y MUST auditarse en esa barbería. MUST NOT ver ni modificar citas, clientes, catálogo
  ni usuarios. Las notificaciones del proveedor de pagos y los trabajos en segundo plano MAY
  localizar el tenant con esa misma lectura, por una clave exacta, nunca con datos del cliente.
  Los trabajos en segundo plano MAY además **listar** los elementos pendientes de sus propias tablas
  leyendo solo columnas técnicas (identificador, `tenant_id`, estado y fechas), sin leer su
  contenido (por ejemplo, el cuerpo de un evento o los datos de un aviso), y MUST procesar cada
  elemento en una transacción con su tenant fijado y con RLS.
  **Tablas de la plataforma:** `provider_event`, `scheduled_job_run`, `platform_session`,
  `platform_challenge`, `platform_admin` y `platform_audit_log` no pertenecen a ninguna barbería ni
  contienen datos de negocio; por eso MAY no tener `tenant_id` ni RLS por barbería, y MUST NOT
  guardar datos personales de clientes ni datos de negocio de las barberías. El acceso del
  administrador (ingreso, segundo factor y salida) MAY auditarse en `platform_audit_log` sin
  barbería. El rol de la aplicación MUST NOT leer `provider_event` (solo insertar eventos) ni
  `platform_admin`. La decisión se registra en ADR-031.
  **Tablas técnicas de intentos:** `login_attempt` (desde 001) y `action_link_attempt` (004) no
  pertenecen a ninguna barbería; MAY no tener `tenant_id` ni RLS, y MUST NOT guardar correos en
  claro ni datos de negocio. `login_attempt` guarda, tal como está hoy, el SHA-256 del correo, la
  IP **en claro** y la fecha; sus filas de más de 24 h se borran de forma oportunista al registrar
  un fallo nuevo, y un ingreso correcto borra los fallos de ese par cuenta e IP (sin una purga
  programada). `action_link_attempt` MUST guardar el origen solo como hash con sal
  (`ENLACES_SAL_IP`), nunca la IP en claro, con purga a las 24 h. Pasar `login_attempt` a un hash
  de la IP queda como mejora planificada para la funcionalidad 007.
- **Excepción acotada: acciones por enlace de la cita.** El recordatorio de una cita (RF34) MAY
  incluir enlaces que permitan al cliente, sin sesión, confirmar su asistencia, reprogramar o
  cancelar **esa** cita. La barbería y la cita MUST obtenerse **solo** del dato firmado del enlace,
  después de verificar su firma, y MUST NOT tomarse de la ruta, la consulta, el cuerpo ni otros
  encabezados. Antes de verificar la firma, el sistema MUST NOT leer datos de ninguna barbería. La
  acción MUST ejecutarse con el rol de la aplicación, sin `BYPASSRLS`, en una transacción con el
  tenant del enlace fijado y con RLS, y MUST aplicar las mismas reglas que la operación equivalente
  con sesión. Cada enlace MUST servir para una sola cita, una sola acción y un solo uso, MUST vencer
  como máximo a la hora de inicio de la cita, MUST dejar de valer si la cita cambia y MUST guardarse
  solo de forma que no pueda reconstruirse a partir de lo guardado. Las respuestas MUST mostrar solo
  los datos mínimos de la cita y MUST NOT revelar datos del cliente ni si una cita existe. Los
  intentos rechazados MUST limitarse por origen, con su contador en PostgreSQL. La decisión se
  registra en ADR-032.

**Razón:** ADR-003 y ADR-010; `tenant_id` por sí solo no basta. Una fuga entre barberías (R01)
es el riesgo más grave del sistema. La primera excepción existe porque RF10 exige mostrar el
catálogo sin iniciar sesión; se limita a lo que la barbería publica y no puede escribir. La segunda
existe porque el cliente es quien indica en qué barbería quiere reservar, y eso ocurre antes de
tener la sesión de esa barbería; se limita a crear o elegir su propia membresía. La tercera existe
porque el administrador de la plataforma cobra y revisa pagos de todas las barberías sin pertenecer
a ninguna, y porque los pagos confirmados por el proveedor y los vencimientos llegan sin sesión; se
limita a metadatos de pago y estado, sin `BYPASSRLS`, y toda escritura sigue protegida por la RLS de
la barbería afectada. La cuarta existe porque el recordatorio del día debe poder responderse desde el
celular sin iniciar sesión (HU28), incluso por un cliente presencial sin cuenta; se limita a una
cita, una acción y un uso, verifica la firma antes de leer nada y no omite RLS.

### IV. Citas sin duplicados garantizadas por la base de datos

- La no superposición de citas activas de un mismo barbero MUST garantizarse con una
  restricción de exclusión en PostgreSQL (`EXCLUDE USING gist` sobre barbero y rango de tiempo).
- La reserva y la reprogramación MUST ejecutarse en una transacción; el conflicto MUST
  traducirse a "horario no disponible".
- Ninguna comprobación en la aplicación, en la interfaz ni en la caché MUST considerarse
  garantía suficiente.

**Razón:** ADR-009; es la única garantía que no depende del orden de ejecución entre varias
instancias.

### V. Pagos solo de suscripciones, desacoplados y seguros

- Los pagos MUST limitarse a la suscripción de las barberías. El pago de citas por clientes
  queda fuera del alcance.
- M03 MUST acceder al proveedor solo mediante el puerto `PaymentGateway` y un adaptador de
  infraestructura.
- La plataforma MUST NOT almacenar, registrar ni transportar datos de tarjeta (PAN, CVV); MUST
  usarse el flujo alojado del proveedor.
- La confirmación MUST llegar por un webhook cuya firma se verifica (lo no firmado se rechaza) y
  que es idempotente por identificador de evento. La suscripción MUST actualizarse de forma
  atómica y los pagos pendientes MUST conciliarse periódicamente.
- La confirmación MUST NOT depender del navegador del usuario.

**Razón:** ADR-007, RC05 y RC12; cambiar de proveedor no toca la suscripción y no se asume
PCI DSS.

### VI. IA con herramientas cerradas por rol

- M04 MUST acceder al modelo solo mediante el puerto `AIProvider`.
- La IA MUST actuar exclusivamente a través de herramientas cerradas, autorizadas por rol, que
  invocan casos de uso de otros módulos.
- La IA MUST NOT ejecutar SQL libre, MUST NOT acceder directamente a la base de datos ni a
  repositorios y MUST NOT confirmar reservas fuera de los casos de uso. La disponibilidad MUST
  comprobarla siempre el backend.
- El uso de IA MUST tener límites, registro y degradación al flujo manual si el proveedor falla.

**Razón:** ADR-008; la IA no puede inventar horarios ni saltarse permisos si solo usa casos de
uso autorizados.

### VII. Notificaciones con consentimiento y sin bloqueo

- M05 MUST enviar correo o WhatsApp mediante el puerto `NotificationChannel`, reaccionando a
  eventos (no a llamadas directas desde M02).
- El envío por WhatsApp MUST requerir consentimiento previo registrado; sin él, o si el canal
  falla, MUST usarse el correo como respaldo.
- El envío MUST ser asíncrono, con reintentos y circuit breaker. Un fallo de notificación MUST
  NOT bloquear ni revertir la reserva ni ninguna otra operación.
- Los mensajes MUST contener solo los datos mínimos. Sobre una cita: nombre de la barbería,
  servicio, nombre visible del barbero, fecha y hora, la hora anterior si se reprogramó y los
  enlaces de acción del recordatorio. En los avisos al propietario sobre su suscripción: además, el
  plan, el período y el motivo (de un rechazo o de una activación manual). El cuerpo de un mensaje
  MUST NOT incluir teléfonos, correos ni datos de pago (de tarjeta, de cuentas, números de
  operación completos ni datos de comprobantes).
- Los recordatorios MUST ejecutarse sin duplicados entre instancias.

**Razón:** ADR-012, ADR-013, RC08 y RC16.

### VIII. Redis solo como caché

- Redis MUST usarse únicamente como caché selectiva de datos de lectura frecuente y tolerantes
  a retraso, con TTL e invalidación tras confirmar la escritura, y para **contadores no
  críticos**: los del límite general de solicitudes, tolerantes a pérdida (si se pierden, el
  límite se reinicia sin afectar la seguridad ni los costos). Sus claves MUST incluir el tenant
  cuando el límite sea por barbería o por usuario.
- Los contadores de seguridad o de costo (intentos de inicio de sesión, cuota de IA) MUST
  guardarse en PostgreSQL, igual que todo estado de seguridad (sesiones y revocación).
- Redis MUST NOT ser fuente de verdad de reservas, pagos, suscripciones ni usuarios, y MUST NOT
  decidir disponibilidad.
- Si Redis no está disponible, el sistema MUST seguir funcionando: lee de PostgreSQL y aplica el
  límite general de solicitudes por instancia.

**Razón:** ADR-005; PostgreSQL es la fuente de verdad (ADR-004). Con varias instancias, el límite
general de solicitudes necesita un contador compartido; perderlo no compromete nada crítico. La
decisión se registra en ADR-029.

### IX. Solo web responsive

- La plataforma MUST entregarse como aplicación web responsive que se usa desde el navegador
  y consume la API REST sobre HTTPS.
- MUST NOT diseñarse ni construirse una aplicación móvil nativa; queda como evolución futura.
- La interfaz MUST ser liviana y tolerante a reintentos por la conectividad variable (RC15).

**Razón:** RC01, RC03 y alcance del MVP.

### X. Pruebas obligatorias

- Toda funcionalidad MUST incluir pruebas automatizadas; ninguna se considera terminada sin
  ellas.
- MUST existir y mantenerse en verde, como mínimo:
  - una prueba de aislamiento entre barberías que demuestre que un tenant no puede leer ni
    modificar datos de otro (PR09);
  - una prueba de concurrencia en reservas que lance solicitudes simultáneas sobre el mismo
    horario y verifique que solo una cita se crea (PR16);
  - la prueba de arquitectura de capas y módulos (PR14);
  - pruebas de idempotencia del webhook de pagos y de fallo de proveedores externos con
    simuladores.
- Las reglas de dominio MUST probarse sin infraestructura.
- La integración continua (GitHub Actions) MUST ejecutar la suite y bloquear la fusión si falla.

**Razón:** las garantías de los principios III, IV, V y VII solo valen si una prueba las
demuestra.

### XI. Decisiones de arquitectura registradas como ADR

- Todo cambio de arquitectura (estilo, módulos, capas, almacenamiento, proveedores, seguridad,
  despliegue o cualquier excepción a esta constitución) MUST registrarse como ADR en
  `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md` antes de implementarse.
- Cada ADR MUST indicar estado, contexto, alternativas, decisión, justificación, consecuencias y
  drivers relacionados.
- Los documentos afectados en `docs/` y `docs/trazabilidad.md` MUST actualizarse en el mismo
  cambio.

**Razón:** RC09; cada decisión debe poder defenderse con su justificación.

### XII. Ubicación del código

- Todo el código de la aplicación (backend, frontend, migraciones, pruebas y configuración de
  contenedores) MUST ubicarse en `tecnologia/plataforma-barberias/`.
- MUST NOT colocarse código de la aplicación fuera de esa carpeta; `docs/` e `img/` quedan para
  documentación y diagramas.
- **Excepción:** los flujos de integración continua MUST ubicarse en `.github/workflows/`, única
  ruta que GitHub Actions lee. Esos archivos MUST limitarse a definir la CI (instalar, verificar,
  probar y construir ejecutando comandos dentro de `tecnologia/plataforma-barberias/`) y MUST NOT
  contener lógica de la aplicación.

**Razón:** separa la documentación de arquitectura del código y deja una única raíz para la
implementación. La excepción existe solo porque la plataforma de CI impone la ruta.

## Restricciones tecnológicas y de alcance

- **Datos:** PostgreSQL como base principal (RC04), con migraciones versionadas; Redis como
  caché.
- **Comunicación:** API REST sobre HTTPS con backend sin estado; CORS restringido y límites de
  solicitudes.
- **Seguridad:** JWT de corta vida con refresco y con usuario, rol y `tenant_id`; RBAC en la
  capa de aplicación; contraseñas con hash lento (Argon2id o bcrypt); secretos fuera del código.
- **Privacidad:** Ley N.° 29733 y su reglamento: consentimiento, minimización, auditoría y
  respaldo.
- **Despliegue objetivo:** AWS con Application Load Balancer y varias instancias idénticas del
  monolito; se empieza con una instancia. Un balanceador MUST NOT presentarse como alta
  disponibilidad (ADR-006).
- **Stack propuesto:** TypeScript con NestJS en el backend; Angular o React en el frontend
  (pendiente de confirmar por el equipo); Docker / Docker Compose. Las versiones se fijan al
  iniciar la implementación.
- **Integraciones externas:** toda llamada externa MUST tener tiempo límite, circuit breaker y
  respuesta degradada; los reintentos solo en operaciones idempotentes (ADR-012).

## Flujo de desarrollo y puertas de calidad

- **Control de versiones:** Git y GitHub; ramas por funcionalidad y commits convencionales
  (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`).
- **SDD con Spec Kit:** constitución → especificación → plan → tareas → implementación. Cada
  plan MUST pasar la "Constitution Check" antes de la investigación y otra vez tras el diseño.
- **Trazabilidad:** cada funcionalidad MUST identificar su cadena HU → RF → AC/EQ → DA → ADR →
  componente → prueba.
- **Honestidad documental:** todo componente MUST etiquetarse como implementado, prototipado,
  planificado o futuro; los datos de Perú o Ayacucho MUST llevar fuente y nivel, y las
  condiciones de proveedores MUST marcarse "por verificar" hasta confirmarlas.
- **Documentación:** Markdown con diagramas Mermaid; citas en APA 7.
- **Puertas de fusión:** CI en verde, pruebas obligatorias presentes (X), sin violaciones de
  capas ni de la matriz de módulos (I, II) y ADR registrado si hubo cambio de arquitectura (XI).

## Governance

- Esta constitución prevalece sobre cualquier otra práctica, plantilla o guía del proyecto.
- **Enmiendas:** se proponen con un cambio a este archivo que actualice el Sync Impact Report,
  propague los cambios a `.specify/templates/` y, si afecta la arquitectura, registre el ADR
  correspondiente. Requieren aprobación del equipo del proyecto.
- **Versionado semántico:** MAJOR para eliminar o redefinir principios de forma incompatible;
  MINOR para añadir un principio o sección o ampliar materialmente su guía; PATCH para
  aclaraciones y redacción.
- **Cumplimiento:** cada plan, revisión de código y entrega de sprint MUST verificar el
  cumplimiento. Toda excepción MUST justificarse en "Complexity Tracking" del plan, indicando la
  alternativa más simple descartada, y registrarse como ADR.
- La guía de ejecución del proyecto está en `README.md` y en `docs/`.

**Version**: 1.4.1 | **Ratified**: 2026-10-15 | **Last Amended**: 2026-11-04
