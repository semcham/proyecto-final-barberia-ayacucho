<!--
Sync Impact Report
==================
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

**Razón:** ADR-003 y ADR-010; `tenant_id` por sí solo no basta. Una fuga entre barberías (R01)
es el riesgo más grave del sistema. La primera excepción existe porque RF10 exige mostrar el
catálogo sin iniciar sesión; se limita a lo que la barbería publica y no puede escribir. La segunda
existe porque el cliente es quien indica en qué barbería quiere reservar, y eso ocurre antes de
tener la sesión de esa barbería; se limita a crear o elegir su propia membresía.

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
- Los mensajes MUST contener solo los datos mínimos (barbería, servicio, fecha y hora).
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

**Version**: 1.2.0 | **Ratified**: 2026-10-15 | **Last Amended**: 2026-10-17
