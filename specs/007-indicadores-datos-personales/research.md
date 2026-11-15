# Research: Indicadores y datos personales (007)

Decisiones de diseño de la [especificación aclarada](spec.md), tomadas después de leer la constitución 1.6.0,
ADR-031, el backlog y el código de M01, M02, M03 y M06. Formato: decisión, razón y alternativas.

## R01. Dónde viven los indicadores de la plataforma (US2)

- **Decisión:**
  - **M06** define un registro sin reglas de negocio, `RegistroDeIndicadores` (`shared/indicadores/`). Cada
    módulo aporta una `FuenteDeIndicador` que cuenta **solo sus propios datos**:
    - M03, las barberías por estado;
    - M02, las citas por mes;
    - M01, los usuarios por tipo.
  - El **host** (`host/indicadores.ts`) registra esas fuentes al arrancar, como ya hace `host/tareas.ts` con el
    `EjecutorTareas`.
  - El caso de uso y la ruta están en **M01** (`identidad/application/plataforma/consultar-indicadores.ts` y un
    controlador `@Plataforma()`), porque M01 es dueño de `platform_audit_log`, donde se audita cada consulta
    (FR-015).
- **Razón:**
  - La matriz de dependencias no deja que ningún módulo llame a la vez a M01, M02 y M03: M01 no llama a M02, y
    M03 solo llama a M06.
  - Con el registro de M06, cada módulo cuenta sus tablas y nadie lee las tablas de otro (principio I).
  - M06 solo recoge resultados, sin reglas.
  - No cambia la matriz ni ninguna regla de módulos.
- **Alternativas descartadas:**
  - **Un controlador en el host que llame a los tres módulos:** saca lógica de aplicación a la raíz de
    composición, y la auditoría de M01 quedaría fuera de su módulo.
  - **Ponerlo en M03 (`plataforma`):** M03 no puede llamar a M01 ni a M02.
  - **Ponerlo en M02:** puede llamar a M01 y a M03, pero los indicadores de la plataforma no son del catálogo
    ni de las citas.
  - **Ampliar la matriz:** cambio de arquitectura mayor que el problema.

## R02. Cómo cuenta citas y usuarios el rol de la plataforma sin permisos sobre sus tablas (US2)

- **Decisión:**
  - **Dos vistas ya agregadas**, sin ninguna columna de barbería ni de persona:
    - `platform_appointment_counts (month, status, appointments)`: citas registradas por mes, en la zona de
      Lima, y por estado;
    - `platform_membership_counts (kind, users)`: membresías activas por tipo (`PERSONAL` o `CLIENTE`).
  - Su **dueño** es un rol nuevo **`barberias_conteos`**: `NOLOGIN NOBYPASSRLS NOINHERIT`, nadie se conecta
    con él. Tiene solo:
    - `SELECT` sobre `appointment (created_at, status)`;
    - `SELECT` sobre `membership (role_code, status)`;
    - una política `FOR SELECT TO barberias_conteos USING (true)` en esas dos tablas.
  - `barberias_plataforma` recibe **solo** `SELECT` sobre las dos vistas. Ningún permiso sobre `appointment`,
    `membership`, `customer_profile` ni `user_account`.
- **Razón:**
  - Todas las tablas tienen `FORCE ROW LEVEL SECURITY`. Una vista corre con los permisos y las políticas de su
    **dueño**, así que una vista de `barberias_owner` vería **cero filas** (sin tenant).
  - Con `security_invoker`, el rol de la plataforma necesitaría permisos sobre las tablas, lo que la aclaración
    prohíbe.
  - Un dueño propio sin inicio de sesión y sin `BYPASSRLS`, con permiso solo sobre las columnas que cuentan,
    deja la lectura entre barberías en un único objeto que **ya entrega números**.
  - Las vistas agregan más de lo que pidió la aclaración: no exponen ni la barbería. Así no se puede filtrar
    por una barbería (FR-013), y el texto de la enmienda lo permite ("como máximo barbería, fecha, estado y
    tipo").
- **Alternativas descartadas:**
  - **Permisos por columna sobre las tablas para `barberias_plataforma`:** contradice la aclaración.
  - **Una función `SECURITY DEFINER` con `barberias_auth`:** ese rol tiene `BYPASSRLS`.
  - **Contar barbería por barbería con el rol de la aplicación:** recorre todas las barberías y no es la opción
    elegida.
  - **Vistas con `tenant_id`:** permitirían filtrar por barbería.
- **Consecuencia:** el rol se crea en `db/init/01-roles.sql`, porque las migraciones corren con
  `barberias_owner`, que no puede crear roles. A `barberias_owner` se le da `GRANT barberias_conteos` para
  poder asignar la propiedad de las vistas, como se hizo con `barberias_auth` (ADR-015). En una base que ya
  existía, el rol se crea a mano una vez, como los demás roles (README de la plataforma).

## R03. Punto de corte de US2

- **Decisión:**
  - US2 empieza por la **fase de la enmienda**: los textos de la enmienda y de ADR-031 se escriben y se
    aprueban, y luego se actualiza la prueba de permisos exactos.
  - **Si la enmienda no se aprueba a tiempo o se complica**, US2 se construye **solo con las barberías por
    estado**, que salen de columnas que el rol ya lee (`tenant.status` y `subscription.status`). Así no hacen
    falta rol, vistas, enmienda ni cambio de ADR-031.
  - Las citas por mes y los usuarios se documentan como no construidos.
- **Razón:** el corte deja intacta la parte que no necesita cambiar la seguridad.
- **Cómo se decide:** la aprobación es una tarea del responsable que bloquea solo la fase de las vistas.

## R04. "Barberías activas"

- **Decisión:**
  - Por estado: los de `tenant.status` (`ACTIVA`, `SUSPENDIDA`) y los de `subscription.status` (`TRIAL`,
    `ACTIVE`, `PAST_DUE`, `EXPIRED`, `SUSPENDED`, `CANCELLED`).
  - **Activa** = barbería no suspendida con una suscripción que deja operar (`TRIAL`, `ACTIVE` o `PAST_DUE`).
- **Razón:** coincide con la política de operación de 003, que en `PAST_DUE` todavía deja reservar.
- **Alternativa descartada:** contar solo `ACTIVE`, porque deja fuera las pruebas gratuitas, que son la mayoría
  en la demostración.

## R05. Citas "por mes"

- **Decisión:**
  - Por mes de **registro** (`created_at`) en America/Lima, con su estado, de los últimos 12 meses.
  - Un mes sin citas se completa en cero en la aplicación.
- **Razón:**
  - La spec habla de "citas registradas por mes" para medir el uso de la plataforma.
  - Los reportes de 005, en cambio, cuentan por hora de inicio dentro de una barbería.
- **Alternativa descartada:** el mes de `starts_at`, porque mezcla el uso con la agenda futura.

## R06. Submódulo de las solicitudes (US1)

- **Decisión:**
  - Submódulo nuevo **`solicitudes-datos`** en M01 (`acceso-barberias/solicitudes-datos/`), con sus cuatro
    capas.
  - Usa dentro de M01 el actor y la autorización (`identidad`), el perfil del cliente (`clientes`) y la zona
    horaria de la barbería (`barberias`). Son llamadas internas permitidas entre submódulos del mismo módulo
    (estilo §3, regla 7).
- **Razón:**
  - Son datos de personas de M01 (cuentas, membresías y perfiles de cliente).
  - Un submódulo propio evita mezclarlo con el consentimiento de `clientes`.
- **Alternativa descartada:** ponerlo dentro de `clientes`, porque los barberos también registran.

## R07. Estados, plazo y unicidad de las solicitudes

- **Decisión:**
  - Estados `RECIBIDA → EN_ATENCION → ATENDIDA | RECHAZADA`, y también `RECIBIDA → ATENDIDA | RECHAZADA`
    directamente. Los dos últimos son finales.
  - Plazo: **10 días hábiles** (lunes a viernes) desde la fecha local de registro en la zona de la barbería,
    guardado como fecha (`due_on`). No se cuentan feriados: se documenta como limitación, junto con la
    validación pendiente contra el plazo legal.
  - "Vencida" se calcula al leer (abierta y `due_on` anterior a hoy). Nada se cierra solo.
  - Una sola solicitud abierta por titular y tipo en la barbería, con un índice único parcial. Si se intenta
    otra, 409 con la existente.
- **Razón:** es el mínimo de la spec (FR-004 y FR-011), y la base garantiza la unicidad aunque haya dos
  réplicas.

## R08. Auditoría sin texto y textos de la solicitud (US1)

- **Decisión:**
  - Auditoría en `audit_log` de la barbería, con cuatro acciones:
    - `SOLICITUD_DATOS_REGISTRADA`;
    - `SOLICITUD_DATOS_EN_ATENCION`;
    - `SOLICITUD_DATOS_ATENDIDA`;
    - `SOLICITUD_DATOS_RECHAZADA`.
  - El recurso es `solicitud_datos:<id>;<tipo>`, sin el detalle, la respuesta ni el motivo.
  - Los textos se guardan solo en la fila de la solicitud, con RLS:
    - el detalle, de hasta 500 caracteres, obligatorio en la rectificación;
    - la respuesta, de hasta 1 000;
    - el motivo del rechazo, de 5 a 300.
- **Razón:**
  - FR-009: la auditoría registra quién, qué y cuándo.
  - El texto puede traer datos personales y no debe salir de la barbería ni llegar a los registros.

## R09. Intentos de inicio de sesión con el origen derivado (US3)

- **Decisión:**
  - **Sal nueva** `INTENTOS_SAL_IP` (secreto de al menos 16 caracteres, distinta de `ENLACES_SAL_IP`). El
    origen se guarda como `ip_hash = SHA-256(sal ‖ ip)`, en el adaptador de infraestructura, igual que
    `KyselyIntentosEnlaceRepository`.
  - El puerto `IntentosRepository` y sus llamadores (el ingreso, `IntentosAdmin`) no cambian: siguen pasando
    la IP.
  - **Migración:**
    1. borra las filas existentes, que solo valen 24 h, porque la sal no está en la base;
    2. quita la columna `ip`;
    3. agrega `ip_hash char(64) NOT NULL`;
    4. rehace el índice `(email_hash, ip_hash, attempted_at)`.
- **Razón:**
  - La sal es un secreto del servidor y no debe pasar a SQL.
  - Borrar las filas es el único camino que no deja ninguna IP legible.
  - El efecto es reiniciar una vez los contadores de las últimas 24 h, al migrar.
- **Durante el despliegue:** si una réplica vieja sigue en marcha mientras se migra, sus ingresos fallan (500)
  en vez de saltarse el límite: **falla cerrada**, nunca sin límite. En Docker Compose, las réplicas se recrean
  después de `preparar-backend` con el comando que ya documenta el README.
- **Alternativas descartadas:**
  - **Derivar en SQL con la sal pasada a la migración:** la sal saldría a la base y a su registro, y la
    representación textual de `inet` puede no coincidir con la de la aplicación.
  - **Dos migraciones (columna nueva y luego borrar la vieja):** en Compose corren seguidas antes de las
    réplicas, así que no evitan nada.
  - **Reutilizar `ENLACES_SAL_IP`:** acopla dos secretos con fines distintos.

## R10. Permisos, rutas y reglas de PR14

- **Decisión:**
  - Operaciones nuevas en la matriz de M01:

    | Operación | Roles |
    |---|---|
    | `REGISTRAR_SOLICITUD_DATOS` | CLIENTE, BARBERO |
    | `VER_MIS_SOLICITUDES_DATOS` | CLIENTE, BARBERO |
    | `ATENDER_SOLICITUDES_DATOS` | PROPIETARIO |
    | `REGISTRAR_SOLICITUD_DATOS_EN_NOMBRE` | PROPIETARIO |

  - El propietario **no** registra sobre su propia cuenta (FR-005).
  - Rutas en [contracts/openapi.yaml](contracts/openapi.yaml) y matriz en [contracts/rbac.md](contracts/rbac.md).
  - **Reglas de dependency-cruiser:**
    - se amplía `lectura-plataforma-confinada` con `catalogo-citas/citas/infrastructure/plataforma/`, para la
      fuente de citas de M02;
    - regla nueva **`indicadores-solo-por-registro`**: solo `host/indicadores.ts` importa las fuentes de
      indicadores de los módulos;
    - regla nueva **`solicitudes-datos-sin-plataforma`**: el submódulo `solicitudes-datos` no importa
      `shared/lectura-plataforma.ts` ni nada de `infrastructure/plataforma/`, y ningún controlador
      `@Plataforma()` importa ese submódulo. Así el administrador nunca llega a las solicitudes.
  - **Política de la suscripción:** las operaciones nuevas no se agregan a §2 de
    `specs/003-suscripciones-pagos/contracts/restricciones-estado.md`, de modo que valen en todos los estados.
    Se suma una nota en su §1, sin cambiar ninguna regla existente.
- **Razón:** son las reglas mínimas para que las garantías de la spec las compruebe PR14 y no la revisión
  manual.
