# Plataforma de barberías: aplicación

Código de la plataforma, construido con desarrollo guiado por especificaciones (Spec Kit). Hoy contiene las
funcionalidades:

- [001 · Registro de barbería, acceso con roles y aislamiento](../../specs/001-registro-acceso-barberia/spec.md);
- [002 · Catálogo, citas y cuenta de cliente](../../specs/002-catalogo-citas-cliente/spec.md);
- [003 · Suscripciones y pagos](../../specs/003-suscripciones-pagos/spec.md) (con una pasarela simulada:
  ningún cobro real);
- [004 · Notificaciones y reprogramación](../../specs/004-notificaciones-reprogramacion/spec.md) (correo
  contra Mailpit y WhatsApp simulado: ningún proveedor real);
- [006 · Escalabilidad: balanceador Nginx, dos réplicas y Redis](../../specs/006-escalado-cache-balanceo/spec.md).

Las guías completas (requisitos, escenarios manuales, criterios de cierre y registro de ejecuciones) están en
[quickstart de 001](../../specs/001-registro-acceso-barberia/quickstart.md),
[quickstart de 002](../../specs/002-catalogo-citas-cliente/quickstart.md),
[quickstart de 003](../../specs/003-suscripciones-pagos/quickstart.md),
[quickstart de 004](../../specs/004-notificaciones-reprogramacion/quickstart.md) y
[quickstart de 006](../../specs/006-escalado-cache-balanceo/quickstart.md). Este archivo es el resumen.

## Contenido

| Carpeta o archivo          | Qué es                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/`                 | API REST en NestJS 11: módulos M01, M02, M03, M05 y M06, 4 capas, PostgreSQL 16 con RLS (Kysely)                                       |
| `backend/simulador-pagos/` | Simulador de la pasarela de pagos (servicio `pasarela-simulada`, ADR-022); fuera del monolito                                          |
| `backend/simulador-whatsapp/` | Simulador de WhatsApp (servicio `whatsapp-simulado`, ADR-026); fuera del monolito                                                   |
| `frontend/`                | Aplicación web en React 19 + Vite 6 con sistema de diseño propio y Radix UI (ADR-014, ADR-016)                                         |
| `db/init/`                 | Roles de PostgreSQL que crea el contenedor de la base al iniciar por primera vez                                                       |
| `docker-compose.yml`       | Entorno de desarrollo escalado: `db`, `redis`, `preparar-backend`, `backend-1`, `backend-2`, `nginx`, `pasarela-simulada`, `mailpit`, `whatsapp-simulado` y `frontend` |
| `nginx/`                   | Configuración del balanceador local (`nginx.conf` y la plantilla del upstream, ADR-030)                                                |
| `.env.example`             | Variables de entorno de desarrollo (copiar a `.env`)                                                                                   |

## Ejecutar con Docker Compose

Requisitos: Docker Desktop con Compose v2, **3 GB de memoria asignados a Docker** y los puertos 5433, 6380,
3000, 3100, 3200, 1025, 8025 y 5173 libres.

```powershell
cd tecnologia/plataforma-barberias
Copy-Item .env.example .env      # completar las claves JWT de desarrollo (ver comentarios del archivo)
docker compose up -d             # preparar-backend compila y migra una vez; luego arrancan las dos réplicas
```

| Servicio            | Puerto en el equipo | Memoria | Qué hace                                                                                                                          |
| ------------------- | ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `nginx`             | **3000**            | 32 MB   | Balanceador: la API entra siempre por aquí y se reparte entre las dos réplicas                                                    |
| `backend-1`, `-2`   | — (sin publicar)    | 384 MB  | Réplicas del backend; responden con `X-Instancia` para ver cuál atendió                                                           |
| `preparar-backend`  | —                   | 1 GB    | Una sola vez: `npm ci`, build y migraciones; copia el build a un volumen que leen las réplicas                                    |
| `redis`             | 6380 (para depurar) | 64 MB   | Caché del catálogo público y contadores del límite por IP; sin persistencia                                                       |
| `db`                | 5433                | 512 MB  | PostgreSQL 16                                                                                                                     |
| `pasarela-simulada` | **3100**            | 64 MB   | Pasarela de pagos simulada (003): página de pago con "Aprobar" y "Rechazar", notificaciones firmadas a Nginx y rutas `/control/*` |
| `mailpit`           | 1025 y **8025**     | 32 MB   | Buzón de desarrollo (004): recibe los correos por SMTP (1025); interfaz y API en <http://localhost:8025>                         |
| `whatsapp-simulado` | 3200                | 64 MB   | WhatsApp simulado (004): guarda los mensajes en memoria (`GET /mensajes?para=`) y tiene modos de falla en `/control/*`           |
| `frontend`          | 5173                | 512 MB  | Vite; reenvía `/api` a Nginx                                                                                                      |

- Aplicación web: <http://localhost:5173> · API (por Nginx): <http://localhost:3000/api/v1/salud> y
  `/api/v1/salud/listo`. Para ver el reparto: `curl.exe -si http://localhost:3000/api/v1/salud` dos veces y
  mirar `X-Instancia`.
- **Aplicar un cambio de código del backend:** `docker compose up -d --force-recreate preparar-backend
backend-1 backend-2` (vuelve a compilar y migrar una vez, y reinicia las réplicas). Lo mismo tras cambiar
  dependencias del backend.
- **Reiniciar una sola réplica:** siempre con `--no-deps`, p. ej. `docker compose up -d --no-deps backend-2`.
  Sin él, Compose vuelve a ejecutar `preparar-backend` (unos 2 minutos) y reescribe `node_modules` con la
  otra réplica en marcha.
- **Sin Redis:** las réplicas arrancan igual (no dependen de `redis`), quedan listas y funcionan sin caché y
  con el límite por instancia; cuando Redis responde, lo vuelven a usar solas, sin reiniciar.
- **Esto no es alta disponibilidad:** Nginx, PostgreSQL y Redis son únicos (ADR-006, ADR-030).
- **Página pública de una barbería (002):** <http://localhost:5173/b/{slug}> muestra el catálogo y los
  horarios libres sin sesión; desde ahí el cliente se registra (`/b/{slug}/registro`), ingresa
  (`/b/{slug}/ingresar`) y reserva (`/b/{slug}/reservar`). El `slug` es el enlace que el propietario ve y
  cambia en la pantalla Barbería del panel. Sus citas están en `/mis-citas`.
- **Migraciones:** las aplica `preparar-backend`, una sola vez antes de las réplicas; si una falla, las
  réplicas no arrancan y el error queda en `docker compose logs preparar-backend`. **Si llega una migración
  nueva** (por ejemplo, al bajar cambios), aplica el cambio de código como arriba. Mientras falten
  migraciones, `/salud/listo` responde 503 y Nginx no envía tráfico a esa réplica.
- La base se publica en `localhost:5433` (`DB_PUERTO` en `.env`); dentro de Compose es `db:5432`.
- `VITE_SONDEO` (por defecto `true`) hace que Vite revise los archivos periódicamente: en Windows y macOS
  el volumen montado no avisa los cambios. En Linux se puede poner `VITE_SONDEO=false` en `.env` para
  ahorrar CPU.
- **Tras agregar o actualizar dependencias** (`package.json`), reinicia el contenedor para que vuelva a
  ejecutar `npm ci` en su volumen de `node_modules`: `docker compose restart frontend` (el backend, con el
  comando de cambio de código de arriba). Si no, el contenedor sigue con las dependencias anteriores y la
  interfaz puede no reflejar los cambios.

## Ejecutar sin Docker (backend y frontend locales)

Con PostgreSQL 16 propio (o solo la base de Compose: `docker compose up -d db`) y Node.js 22:

```powershell
cd tecnologia/plataforma-barberias/backend
npm ci
npx tsx --env-file=../.env src/shared/persistence/migrate.ts   # migraciones con DATABASE_URL_OWNER
npm run build
node --env-file=../.env dist/src/main.js         # API en http://localhost:3000

cd ../frontend
npm ci
$env:VITE_API_PROXY = 'http://localhost:3000'    # por defecto el proxy apunta a http://nginx:80 (Compose)
npm run dev                                      # http://localhost:5173
```

`DATABASE_URL_APP`, `DATABASE_URL_OWNER` y `DATABASE_URL_PUBLICO` en `.env` deben usar el mismo puerto que
la base (5433 si es la de Compose).

**Redis es opcional en local:** con `REDIS_URL=redis://localhost:6380` usa el Redis de Compose
(`docker compose up -d redis`); con `REDIS_URL` vacía, el backend funciona sin caché y con el límite de
solicitudes en memoria, sin alertas.

## Funcionalidad 002: rol de base, variables y migraciones

- **Migraciones `0009`–`0012`:** cuenta de cliente (`customer_profile`, `consent_record`, membresía
  `CLIENTE`), catálogo (`business_hours`, `service`, `barber`, `working_hours`, `time_off` y RLS de
  `tenant`), citas (`appointment` con sus dos restricciones de exclusión e historial) y permisos por
  columna del rol público. En Compose las aplica `preparar-backend`; sin Compose, con el comando de
  migraciones de arriba.
- **Rol `barberias_publico`** (ADR-021, lecturas públicas por enlace): `LOGIN NOBYPASSRLS`, sin
  privilegios por defecto; la migración `0012` le concede `SELECT` solo sobre las columnas públicas. El
  contenedor de la base lo crea al iniciar **por primera vez** (`db/init/01-roles.sql`). En una base que ya
  existía (volumen de datos anterior a 002), créalo una vez como superusuario **antes** de migrar:

  ```sql
  CREATE ROLE barberias_publico LOGIN PASSWORD 'barberias_publico_dev'
    NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE;
  GRANT CONNECT ON DATABASE barberias TO barberias_publico;
  GRANT USAGE ON SCHEMA public TO barberias_publico;
  ```

  Con Compose: `docker compose exec db psql -U postgres -d barberias` y pegar esas líneas. La contraseña
  es solo de desarrollo.

- **`DATABASE_URL_PUBLICO`:** conexión del rol público (pool propio de la vía pública). Con Compose la
  define `docker-compose.yml`; sin Compose, en `.env`, por ejemplo
  `postgres://barberias_publico:barberias_publico_dev@localhost:5433/barberias`.
- **Otras variables nuevas** (`.env.example`): `HORARIOS_PASO_MINUTOS` (15), `RESERVA_HORIZONTE_DIAS` (30)
  y `PUBLICO_LIMITE_POR_MINUTO` (120 solicitudes por IP a la vía pública).
- **Medición de horarios (fuera de CI):** `npm run medir:horarios` en `backend/` (ver
  [quickstart de 002](../../specs/002-catalogo-citas-cliente/quickstart.md) §5).

## Funcionalidad 006: caché, límite compartido y balanceo

- **Decisiones:** ADR-029 (caché compartida con claves por barbería y límite general compartido) y ADR-030
  (balanceo local como representación de ADR-006). Contratos:
  [entorno de Compose](../../specs/006-escalado-cache-balanceo/contracts/entorno-compose.md) y
  [claves de caché](../../specs/006-escalado-cache-balanceo/contracts/cache-claves.md).
- **Migración `0013`:** permite al rol de la aplicación leer la tabla de migraciones para `/salud/listo`.
- **Variables nuevas** (`.env.example`): `REDIS_URL`, `REDIS_PUERTO`, `CACHE_CATALOGO_ACTIVA` (true),
  `CACHE_HORARIOS_ACTIVA` (false), `CACHE_CATALOGO_TTL_SEGUNDOS` (120), `CACHE_TIMEOUT_MS` (100),
  `CACHE_FALLOS_PARA_ABRIR` (5), `CACHE_PAUSA_MS` (10000), `PROXIES_CONFIABLES` (loopback en local; la IP
  de Nginx en Compose), `INSTANCIA_ID`, `DB_POOL_APP_MAX` y `DB_POOL_PUBLICO_MAX` (10), y la red de Compose
  (`RED_SUBRED`, `IP_NGINX`, `IP_BACKEND_1`, `IP_BACKEND_2`, `IP_REDIS`).
- **Medición de horarios (fuera de CI):** con el límite de la vía pública subido solo en la terminal,
  `$env:PUBLICO_LIMITE_POR_MINUTO='100000'; docker compose up -d`, y en `backend/`:
  `npm run medir:horarios -- --etiqueta D-2r-con-cache --salida ../../../tmp/medicion.json` (opciones
  `--url`, `--etiqueta`, `--salida` y `--no-precargar`). Variantes A–D en el
  [quickstart de 006](../../specs/006-escalado-cache-balanceo/quickstart.md) §4.3.
- **Demostración de caída (fuera de CI):** `npm run demo:caida -- --objetivo replica` o `--objetivo redis`
  (opciones `--url`, `--duracion`, `--parada`, `--arranque`, `--salida` y `--manual`). Detiene y vuelve a
  iniciar `backend-2` o `redis` con tráfico continuo e informa errores, reparto y p95. Fijar
  `PUBLICO_LIMITE_POR_MINUTO` en la **misma terminal**: la réplica que se reinicia toma sus variables.

## Comprobaciones

| Dónde       | Comandos                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/`  | `npx prettier --check .` · `npm run lint` · `npm run build` · `npm test` · `npm run test:int` (Testcontainers) · `npm run test:arch` |
| `frontend/` | `npx prettier --check .` · `npm run lint` · `npm run build` (incluye `tsc --noEmit`) · `npm test`                                    |

Son los mismos pasos que ejecuta el CI ([`.github/workflows/plataforma-barberias.yml`](../../.github/workflows/plataforma-barberias.yml)).

## Funcionalidad 003: suscripciones y pagos

- **Decisiones:** ADR-022 (pasarela en sandbox o simulada detrás de `PaymentGateway`, y transferencia con
  comprobante), ADR-023 (comprobantes privados), ADR-024 (tareas programadas sin duplicados entre réplicas)
  y ADR-031 (administrador de la plataforma, sin barbería y con segundo factor), con la enmienda 1.3.0 de la
  constitución. Contratos: [openapi de 003](../../specs/003-suscripciones-pagos/contracts/openapi.yaml),
  [rbac de 003](../../specs/003-suscripciones-pagos/contracts/rbac.md),
  [pasarela simulada](../../specs/003-suscripciones-pagos/contracts/pasarela-simulada.md) y
  [restricciones por estado](../../specs/003-suscripciones-pagos/contracts/restricciones-estado.md).
- **Pasarela simulada:** el servicio `pasarela-simulada` (puerto 3100) hace de proveedor. Pasar al ambiente de
  pruebas del proveedor o a producción es solo configuración (`PAGOS_PROVEEDOR` y sus credenciales); el
  adaptador real está condicionado a obtener credenciales y a confirmar Yape (riesgo R15).
- **Administrador de la plataforma** (`/plataforma` en la interfaz): se crea **solo** con la orden
  `npm run plataforma:crear-admin -- --correo <correo> --nombre "<Nombre Apellido>"` en `backend/`, que pide la
  contraseña dos veces sin eco y muestra **una sola vez** la URI `otpauth://` (para la aplicación de
  autenticación) y los 10 códigos de recuperación. Usa `DATABASE_URL_OWNER` y la misma
  `PLATAFORMA_LLAVE_TOTP` que el servidor. Sin terminal, con `--contrasena-desde-entorno` toma la contraseña de
  `PLATAFORMA_ADMIN_CONTRASENA` (que se borra del proceso al leerla); nunca como argumento.
- **Scripts de demostración** (en `backend/`, fuera de CI):
  - `npm run simulador:modo -- <modo> [parámetro]`: cambia el comportamiento del simulador (`normal`,
    `lento <ms>`, `caido [ms]`, `colgado`, `duplicar <veces>`, `firma_invalida`, `sin_firma`, `fuera_de_orden`,
    `importe_distinto`, `aprobar_despues <ms>`, `rechazar` o `reiniciar`). Necesita `SIMULADOR_TOKEN_CONTROL`;
    `SIMULADOR_URL` es `http://localhost:3100` por defecto.
  - `npm run demo:vencimiento -- --barberias 50`: siembra 50 barberías con la prueba vencida hace una hora
    para ver el vencimiento con las dos réplicas; `--verificar` muestra el resultado y las corridas de la
    tarea, y `--limpiar` borra lo sembrado. Usa el superusuario de desarrollo (`MEDIR_DB_SUPERUSUARIO`).
- **Tareas programadas:** vencimiento, conciliación y expiración de transferencias, cada
  `TAREAS_INTERVALO_MS` (5 minutos por defecto; para la demostración, 60000). Corren en las dos réplicas y
  solo una procesa cada ciclo. `TAREAS_ACTIVAS=false` las apaga (lo usan las pruebas).
- **Nginx** acepta hasta 6 MB solo en la ruta de subida de comprobantes; en el resto, 16 KB.

- **Rol `barberias_plataforma`** (ADR-031, lecturas entre barberías del administrador de la plataforma, de
  las notificaciones de la pasarela y de las tareas programadas): `LOGIN NOBYPASSRLS`, sin privilegios por
  defecto y **sin ninguna escritura**; la migración `0016` le concede `SELECT` solo sobre las columnas
  permitidas. El contenedor de la base lo crea al iniciar **por primera vez** (`db/init/01-roles.sql`). En
  una base que ya existía (volumen de datos anterior a 003), créalo una vez como superusuario **antes** de
  migrar:

  ```sql
  CREATE ROLE barberias_plataforma LOGIN PASSWORD 'barberias_plataforma_dev'
    NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE;
  GRANT CONNECT ON DATABASE barberias TO barberias_plataforma;
  GRANT USAGE ON SCHEMA public TO barberias_plataforma;
  ```

  Con Compose: `docker compose exec db psql -U postgres -d barberias` y pegar esas líneas. La contraseña
  es solo de desarrollo.

- **Variables nuevas** (`.env.example`): `PAGOS_PROVEEDOR`, `PAGOS_URL_BASE`, `PAGOS_LLAVE_SECRETA`,
  `PAGOS_SECRETO_FIRMA`, `PAGOS_CUENTA_*` (datos bancarios para la transferencia: sin ellos, la
  transferencia no se ofrece), `PLATAFORMA_LLAVE_TOTP` (32 bytes en base64), `DATABASE_URL_PLATAFORMA`,
  `SIMULADOR_TOKEN_CONTROL`, `TAREAS_ACTIVAS` y `TAREAS_INTERVALO_MS`. Con Compose, `docker-compose.yml` da
  valores **solo de desarrollo** a las que falten en `.env`.
- **Limitaciones conocidas:**
  - las notificaciones del proveedor que no corresponden a ningún pago (`SIN_PAGO`) se listan 30 días en
    "Pagos por revisar", pero no se pueden marcar resueltas (no hay ruta en el contrato y el rol de la
    aplicación solo inserta en `provider_event`);
  - cambiar `PLATAFORMA_LLAVE_TOTP` deja ilegibles los secretos TOTP guardados: no hay rotación, hay que
    volver a dar de alta al administrador;
  - Jest avisa a veces, al terminar `npm test`, que un proceso no cerró a tiempo ("A worker process has
    failed to exit gracefully"); todas las pruebas pasan y el aviso no cambia el resultado.

## Funcionalidad 004: notificaciones y reprogramación

- **Decisiones:** ADR-013 (notificaciones multicanal, revisada), ADR-025 (salida transaccional de eventos),
  ADR-026 (correo y WhatsApp detrás de `NotificationChannel`) y ADR-032 (acciones por enlace firmado, con la
  enmienda 1.4.0 de la constitución). Contratos:
  [openapi de 004](../../specs/004-notificaciones-reprogramacion/contracts/openapi.yaml),
  [rbac de 004](../../specs/004-notificaciones-reprogramacion/contracts/rbac.md),
  [eventos](../../specs/004-notificaciones-reprogramacion/contracts/eventos.md),
  [puerto de envío](../../specs/004-notificaciones-reprogramacion/contracts/notification-channel.md) y
  [enlaces de acción](../../specs/004-notificaciones-reprogramacion/contracts/enlaces-de-accion.md).
- **Migraciones `0021`–`0027`:** salida de eventos (`outbox_event`), canal y consentimiento de WhatsApp
  (`customer_notification_preference`, `whatsapp_consent`), reprogramación de citas y usos de enlaces
  (`appointment_reschedule`, `appointment_link_use`), avisos (`notification`), intentos de enlaces
  (`action_link_attempt`), permiso de purga de los avisos y cambios de estado por enlace sin usuario
  (`appointment_status_history.changed_by` admite nulo).
- **Cómo llegan los avisos:** cada operación de la cita publica un evento en su misma transacción; la tarea
  `despachar-eventos` crea los avisos y `enviar-avisos` los envía (las dos cada `EVENTOS_INTERVALO_MS`, 15 s,
  con el candado de las tareas). Un fallo del correo o de WhatsApp nunca bloquea la cita: el aviso se
  reintenta y, si WhatsApp falla, sale por correo.
- **Ver los avisos:** los correos en <http://localhost:8025> (Mailpit); los mensajes de WhatsApp con
  `GET http://localhost:3200/mensajes?para=<número>` y el encabezado `X-Control` (`WHATSAPP_TOKEN_CONTROL`).
- **Variables nuevas** (`.env.example`): `SMTP_HOST`, `SMTP_PUERTO`, `SMTP_TLS`, `SMTP_USUARIO`, `SMTP_CLAVE`,
  `CORREO_REMITENTE`, `CORREO_TIEMPO_LIMITE_MS` (5000), `WHATSAPP_PROVEEDOR` (`simulado`, o `ninguno` si
  falta: los avisos van por correo), `WHATSAPP_URL_BASE`, `WHATSAPP_TOKEN`, `WHATSAPP_TOKEN_CONTROL`,
  `WHATSAPP_TIEMPO_LIMITE_MS` (3000), `ENLACES_LLAVE` (llave de los enlaces del recordatorio, 32 bytes en
  base64), `ENLACES_SAL_IP` (sal del hash de la IP de los intentos de enlaces), `URL_PUBLICA` (base de los
  enlaces del recordatorio), `EVENTOS_INTERVALO_MS` (15000) y la red de Compose (`IP_MAILPIT`,
  `IP_WHATSAPP`). `MAILPIT_IMAGEN` permite usar la etiqueta de Mailpit que ya esté descargada. Con Compose,
  `docker-compose.yml` da valores **solo de desarrollo** a las que falten en `.env`.
- **Scripts de demostración** (en `backend/`, fuera de CI, con `docker compose up -d` en marcha):
  - `npm run demo:avisos`: siembra una barbería y un cliente, registra una cita (un correo de confirmación
    en Mailpit), detiene `mailpit`, reprograma (la cita responde igual) y lo vuelve a iniciar (llega un solo
    correo de reprogramación). Con `--caida`, detiene `backend-1` justo después de registrar la cita y la
    confirmación llega igual, enviada por `backend-2`. Opciones `--url`, `--mailpit`, `--espera`, `--salida`
    y `--manual`; usa el superusuario de desarrollo (`MEDIR_DB_SUPERUSUARIO`).
  - `npm run whatsapp:modo -- <modo> [parámetro]`: cambia el comportamiento del WhatsApp simulado (`normal`,
    `lento <ms>`, `caido [ms]`, `colgado`, `rechazar`, `limite`, `fallar_n <veces>` o `reiniciar`). Necesita
    `WHATSAPP_TOKEN_CONTROL`; `WHATSAPP_SIMULADO_URL` es `http://localhost:3200` por defecto.
- **Pantallas nuevas:** reprogramar desde Mis citas y desde la Agenda, la página del enlace del recordatorio
  (`/e`) y "Cómo recibo mis avisos" (`/mis-avisos`, solo cliente).

## Referencias

- Plan técnico: [plan de 001](../../specs/001-registro-acceso-barberia/plan.md),
  [plan de 002](../../specs/002-catalogo-citas-cliente/plan.md),
  [plan de 003](../../specs/003-suscripciones-pagos/plan.md) y
  [plan de 004](../../specs/004-notificaciones-reprogramacion/plan.md) · contratos:
  [openapi de 001](../../specs/001-registro-acceso-barberia/contracts/openapi.yaml),
  [openapi de 002](../../specs/002-catalogo-citas-cliente/contracts/openapi.yaml),
  [openapi de 003](../../specs/003-suscripciones-pagos/contracts/openapi.yaml) y
  [openapi de 004](../../specs/004-notificaciones-reprogramacion/contracts/openapi.yaml) · permisos:
  [rbac de 001](../../specs/001-registro-acceso-barberia/contracts/rbac.md),
  [rbac de 002](../../specs/002-catalogo-citas-cliente/contracts/rbac.md),
  [rbac de 003](../../specs/003-suscripciones-pagos/contracts/rbac.md) y
  [rbac de 004](../../specs/004-notificaciones-reprogramacion/contracts/rbac.md).
- Decisiones: [ADR-014 a ADR-021](../../docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md)
  (frontend, autenticación sin tenant, sistema de diseño, indicador de sesión, carga diferida, período de
  gracia en la renovación, cuenta de cliente en varias barberías y lecturas públicas por enlace), y
  ADR-029 y ADR-030 (caché compartida y balanceo local, funcionalidad 006), ADR-022 a ADR-024 y ADR-031
  (pagos, comprobantes, tareas programadas y administrador de la plataforma, funcionalidad 003), y ADR-013,
  ADR-025, ADR-026 y ADR-032 (notificaciones, eventos, canales y enlaces de acción, funcionalidad 004).
- Librerías, versiones, licencias y mediciones: [tecnologias.md](../../docs/02-arquitectura-software/tecnologias.md).
- Imágenes de marca (formato, peso máximo, licencia y autoría): [frontend/public/img/README.md](frontend/public/img/README.md).
