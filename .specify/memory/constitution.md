<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.0.1
Bump rationale: PATCH. Aclaración acotada del principio XII: los flujos de CI pueden vivir en
.github/workflows/ porque GitHub Actions solo los lee desde esa ruta. No cambia el sentido del
principio (el código de la aplicación sigue en tecnologia/plataforma-barberias/) ni afecta la
arquitectura, por lo que no requiere ADR.

Modified principles:
  - XII. Ubicación del código — se añade la excepción de .github/workflows/ (solo definiciones de
    CI; ejecutan comandos dentro de tecnologia/plataforma-barberias/ y no contienen lógica de la
    aplicación)
Added principles: ninguno
Added sections: ninguna
Removed sections: ninguna

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — puerta XII y comentario de estructura con la excepción
  ✅ .specify/templates/tasks-template.md — convención de rutas con la excepción
  ✅ .specify/templates/spec-template.md — revisado; sin cambios necesarios
  ✅ .claude/skills/speckit-*/SKILL.md — revisados; sin referencias al principio XII
  ✅ specs/001-registro-acceso-barberia/plan.md y tasks.md — puerta XII y tarea T009 alineadas
  ✅ README.md y docs/02-arquitectura-software/estilo-arquitectonico.md — los avisos de la
     versión 1.0.0 ya estaban resueltos (usan tecnologia/plataforma-barberias/ y docs/05-gestion/
     existe); sin contradicción con la excepción

Follow-up TODOs: ninguno.
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

**Razón:** ADR-003 y ADR-010; `tenant_id` por sí solo no basta. Una fuga entre barberías (R01)
es el riesgo más grave del sistema.

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
  a retraso, con TTL e invalidación tras confirmar la escritura.
- Redis MUST NOT ser fuente de verdad de reservas, pagos, suscripciones ni usuarios, y MUST NOT
  decidir disponibilidad.
- Si Redis no está disponible, el sistema MUST seguir funcionando leyendo de PostgreSQL.

**Razón:** ADR-005; PostgreSQL es la fuente de verdad (ADR-004).

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

**Version**: 1.0.1 | **Ratified**: 2026-10-15 | **Last Amended**: 2026-10-15
