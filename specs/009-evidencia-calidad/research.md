# Research: Evidencia de calidad y despliegue (009)

**Fecha:** 2026-11-19 · **Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

Cada decisión se tomó después de leer el código actual: `docker-compose.yml`, `nginx/` (plantilla y
`nginx.conf`), `backend/scripts/`, `backend/package.json`, `frontend/package.json`, `frontend/vite.config.ts`,
`frontend/src/api/client.ts`, `frontend/src/auth/indicadorSesion.ts`, `backend/src/main.ts`, la cookie de
renovación, `.env.example`, `test/helpers/nginx.ts` y `.github/workflows/plataforma-barberias.yml`. Las condiciones de
proveedores (Cloudflare, GitHub) se marcan **por verificar** hasta comprobarlas en la fase que las usa
(constitución, "Honestidad documental").

---

## R01 · Dónde se guardan los resultados medidos

**Decisión:** una sola raíz, `tecnologia/plataforma-barberias/evidencia/`, con una carpeta por tipo
(`carga/`, `e2e/`, `accesibilidad/`, `rendimiento-web/`, `base-de-datos/`, `cobertura/`, `despliegue/`) y una
subcarpeta por ejecución `AAAA-MM-DD-HHMM-<nombre>/`. Cada ejecución guarda:

- los datos crudos de la herramienta (JSON);
- un `resumen.md` generado por el script, nunca escrito a mano;
- un `entorno.json` con la fecha, el SHA de git, la CPU, la memoria y la carga del equipo, la versión de la
  imagen de cada herramienta y **solo** las variables de configuración de una lista blanca, leídas del contenedor
  con `printenv` una por una. Nunca se lee el `.env` ni se vuelca `docker compose config`, que imprimiría sus
  secretos.
- **SHA de git** (análisis M2): la copia de verificación no tiene `.git`, así que el SHA se toma de la variable
  `EVIDENCIA_GIT_SHA`, que se fija desde el repositorio original al crear la copia. Si falta, `entorno.json` dice
  `"sha": "desconocido"` y nunca inventa uno.

**Qué se versiona y qué no** (análisis A6 y B5):

- Se versionan los JSON de k6, de axe y de Lighthouse completos (FR-016 pide los informes completos), los planes, la
  cobertura y las actas.
- Se versiona el informe JSON **filtrado** de Playwright: título, estado, duración y mensaje de error, sin adjuntos,
  cabeceras, cuerpos ni salida estándar.
- **No se versionan** las trazas de Playwright, su informe HTML, las capturas ni los videos: guardan cabeceras
  `Authorization`, cuerpos de inicio de sesión y salida de consola. Quedan en `evidencia/**/no-versionado/`, que el
  `.gitignore` excluye.
- Antes de cada commit, `evidencia/scripts/revisar-secretos.mjs` busca en `evidencia/` lo siguiente, y falla si
  encuentra algo:
  - patrones de JWT (`eyJ…`.`…`.`…`);
  - `otpauth://`;
  - `Bearer `;
  - `set-cookie`;
  - `-----BEGIN`;
  - tokens de GitHub (`ghp_`, `github_pat_`);
  - la forma de las credenciales del túnel (`TunnelSecret`, `AccountTag`).

  También corre en el trabajo `herramientas` de la CI.
- Tamaño: unos 30 MB por todo 009. Si un JSON de Lighthouse supera los 5 MB, se guarda comprimido con gzip (`.json.gz`).

El formato está en [data-model.md](data-model.md) y en [contracts/evidencia.md](contracts/evidencia.md).

**Por qué:** FR-004 exige que cada cifra tenga fecha, comando, configuración y equipo. Una sola raíz facilita
enlazarla desde `docs/` (SC-002: el 100 % de las cifras citadas tienen su archivo). Está dentro de
`tecnologia/plataforma-barberias/` (principio XII).

**Alternativas:**
- `carga/resultados/` junto a los scripts: obligaría a seis lugares distintos.
- `docs/evidencia/`: `docs/` es para documentación y no para salidas de herramientas.

---

## R01b · Copia de verificación aislada del proyecto del responsable (análisis C1 y A1)

**Decisión:**

- **Nombre del proyecto obligatorio:** todos los scripts de 009 que llaman a `docker compose` lo hacen con
  `COMPOSE_PROJECT_NAME`. Se niegan a correr (código 6) si la variable está vacía o vale `plataforma-barberias`, el
  proyecto por defecto del responsable, porque Compose deriva ese nombre de la carpeta.
  - La comprobación vive en `scripts/lib/proyecto.(mjs|sh|ps1)` y tiene su prueba.
  - Esto incluye `carga/medir`, `carga/escalado/agregar-instancia`, `e2e/estabilidad`,
    `evidencia/scripts/registrar-entorno`, `extraer-planes`, `pool`, `simulacro-respaldo` y `semilla/volumen`.
  - Quien clone el proyecto y quiera medir fija su propio `COMPOSE_PROJECT_NAME`, y así lo dice el README.
- **La copia se crea con otro nombre de carpeta:** `barberias-verificacion`, en el directorio temporal, con
  `COMPOSE_PROJECT_NAME=barberias-verificacion`. Así sus volúmenes (`barberias-verificacion_datos-postgres`) y su red
  nunca coinciden con los del responsable.
- **Otra subred** (análisis A1): `docker compose stop` conserva la red, y dos proyectos con la misma subred
  `172.28.0.0/24` chocan ("Pool overlaps"). Se usan las variables que ya existen (`RED_SUBRED`, `IP_NGINX`,
  `IP_BACKEND_1`, `IP_BACKEND_2`, `IP_REDIS`, `IP_SIMULADOR`, `IP_MAILPIT`, `IP_WHATSAPP`), más `IP_BACKEND_3` (US4) e
  `IP_CLOUDFLARED` (US7):

  | Proyecto | Subred | De dónde salen las variables |
  | --- | --- | --- |
  | Responsable (desarrollo) | `172.28.0.0/24` (sin cambios) | Su `.env` |
  | `barberias-verificacion` | `172.29.0.0/24` | El `.env` de la copia, generado con `preparar-entorno --subred 172.29.0` |
  | `barberias-publicacion` | `172.30.0.0/24` | `publicacion/red-publicacion.env` (versionado, sin secretos), que exportan `levantar` y `reiniciar-publicacion` en el entorno del shell. En la interpolación de Compose, el entorno del shell tiene prioridad sobre el `.env` |

- **Los puertos del equipo siguen siendo los mismos** (3000, 5173, 8080, 3100, 3200, 1025, 8025): las demos siguen
  levantándose **de una en una**, también por la memoria de un equipo de 8 GB.
- **Comprobación antes de la primera medición:** una tarea de la fase 2 confirma que:
  - el guardián rechaza el proyecto por defecto y el valor vacío;
  - `docker volume ls` muestra volúmenes distintos para la copia;
  - la red de la copia tiene `172.29.0.0/24`;
  - los volúmenes del responsable conservan su fecha de creación, sin leer su contenido.

**Por qué:** `env_file: .env` y los nombres de los volúmenes dependen de la carpeta y del proyecto. Con el nombre
obligatorio y otra subred, ningún script de 009 puede tocar el `.env` ni el volumen del responsable por accidente.

**Alternativas:**
- Un `-p` escrito en cada comando: basta con olvidarlo una vez.
- Un `git worktree`: no lleva los cambios sin commit, y `.git` del responsable quedaría compartido.

---

## R02 · US1: k6 en contenedor, escenarios y umbrales

**Decisión:**

- **Contenedor:** k6 corre con la imagen oficial `grafana/k6`, con una etiqueta exacta y de al menos dos semanas de
  antigüedad que se fija en la fase. Corre como un servicio de Compose con el perfil `carga` y entra a la red
  `plataforma`, así llega a `http://nginx/api/v1`, como un cliente, a través del balanceador. Comando:
  `docker compose --profile carga run --rm k6 run /carga/escenarios/<escenario>.js`. No se instala nada en el
  repositorio ni en el equipo.
- **Scripts:** `tecnologia/plataforma-barberias/carga/`, que contiene:
  - `escenarios/catalogo.js`, `escenarios/horarios.js` y `escenarios/reserva.js`;
  - `lib/` con la preparación de datos, las métricas y `handleSummary`.
- **Datos:**
  - Cada escenario prepara en su `setup()` una **barbería de carga propia**, con el prefijo `carga-` en el slug, usando
    la API: registro, activación con el enlace leído del buzón de Mailpit por su API HTTP, servicios, barberos,
    horario y clientes.
  - Así las citas de la prueba se distinguen siempre de la semilla de la demo (US1-5) y no se usa ningún rol de base
    de datos.
  - Si la preparación falla, la ejecución se detiene antes de medir.
- **Opciones comunes** (análisis B2): `carga/lib/opciones.js` lee `K6_HUMO=1` (1 VU durante 10 s en los tres
  escenarios) y los demás parámetros. Ningún escenario define opciones propias de humo.
- **Permisos** (análisis B3): la imagen de k6 corre con un usuario sin privilegios. La prueba de humo comprueba que
  puede escribir en `evidencia/carga/`; si no, el servicio usa `user:` con el UID del equipo en Linux, y en Docker
  Desktop no hace falta.
- **Umbrales** (`thresholds`; k6 termina con un código distinto de 0 si no se cumplen, pero `handleSummary` guarda
  el resultado igual, US1-4):

  | Escenario | Carga | Umbral de latencia | Umbral de error |
  | --- | --- | --- | --- |
  | `catalogo` | 50 VU, 2 min, catálogo público por slug | p95 < 800 ms (EQ-01) | 5xx = 0 % |
  | `horarios` | 50 VU, 2 min, horarios libres de días distintos | p95 < 800 ms (EQ-01) | 5xx = 0 % |
  | `reserva` | 20 llegadas/s (`constant-arrival-rate`), 5 min, horarios distintos | p95 < 1 500 ms (EQ-02) | error técnico < 1 % |

- **Error técnico** (métrica propia de tipo `Rate`): cuenta un 5xx, un error de red, un 429 o cualquier respuesta
  no prevista. Un **409 por horario ocupado no cuenta** y va a su propio contador (FR-009).
- **Reparto entre réplicas:** un `Counter` etiquetado con el valor de la cabecera `X-Instancia`, que ya envía cada
  réplica (FR-010).
- **Límites de solicitudes:** el límite por IP de 006 (`PUBLICO_LIMITE_POR_MINUTO`) se sube **solo durante la
  medición**, con una variable que se pasa a las réplicas al recrearlas, igual que en 006 R13. El valor usado queda
  en `entorno.json`.
- **Comparabilidad con 006** (FR-012):
  - Los scripts de 006 (`medir:horarios`) miden desde Node y en secuencias fijas. k6 mide con usuarios virtuales
    concurrentes y una tasa de llegada.
  - Se comparan solo las **metas** (p95 frente a EQ-01). Las cifras absolutas no se comparan entre sí, y así se dice
    en el resumen.

**Por qué:** el criterio 13 pide k6 de forma explícita. Correr la imagen oficial en un contenedor mantiene el
espíritu de R13 de 006 (no instalar otra herramienta en el equipo) y cambia solo la decisión de "no descargar k6".
El cambio se registra en ADR-034 (borrador). Preparar los datos por la API evita roles con `BYPASSRLS` y prueba el
mismo camino que usa un cliente.

**Alternativas:**
- Seguir con los scripts propios: no cumple el criterio 13.
- k6 instalado en el equipo: va contra FR-007.
- Sembrar los datos de carga por SQL: exigiría un rol con permisos de dueño y dejaría la carga fuera del camino real.

---

## R03 · US3: script de arranque reproducible

**Decisión:**

- **Dos scripts equivalentes:** `tecnologia/plataforma-barberias/scripts/preparar-entorno.sh` (bash) y
  `preparar-entorno.ps1` (PowerShell 5.1 y 7). El trabajo criptográfico lo hace **un solo programa**,
  `scripts/preparar-entorno.mjs` (Node 22, sin dependencias, solo `node:crypto`). Cada envoltorio lo ejecuta con el
  Node del equipo si existe, o si no con `docker run --rm node:22`, la misma imagen que ya usa Compose. Así bash y
  PowerShell generan exactamente lo mismo.
- **Qué genera:**
  - el par de claves ES256 (`generateKeyPairSync('ec', { namedCurve: 'P-256' })`, en PEM PKCS#8 y SPKI, escapado en
    una sola línea con `\n`), con `JWT_ACTIVE_KID=dev-1`;
  - 32 bytes en base64 para `PLATAFORMA_LLAVE_TOTP` y `ENLACES_LLAVE`;
  - sales de 32 caracteres en base64url para `ENLACES_SAL_IP` e `INTENTOS_SAL_IP`, distintas entre sí.
- **Reglas** (FR-018):
  - Si `.env` **no existe**, lo crea copiando `.env.example` y reemplaza solo esas variables. La escritura es atómica
    (archivo temporal y renombrado) y crea el archivo con `wx`, que falla si apareció mientras tanto.
  - Si `.env` **existe**, **no lo abre para escribir**. Lo lee solo para obtener los **nombres** de las variables, sin
    guardar ni imprimir ningún valor, e informa qué nombres de `.env.example` le faltan (FR-003, reescrito a partir
    del análisis A3).
  - Nunca imprime un secreto completo: solo dice "generada".
  - **`--subred <a.b.c>`** (análisis A1): al **crear** un `.env` nuevo, fija `RED_SUBRED=<a.b.c>.0/24` y las IP fijas
    con los mismos sufijos que hoy (`.10` Nginx, `.11` y `.12` las réplicas, `.13` Redis, `.14` la pasarela, `.15`
    Mailpit, `.16` WhatsApp, `.17` cloudflared, `.18` la tercera réplica). Rechaza un prefijo inválido. Con un `.env`
    existente no hace nada (sigue sin escribir).
- **Pruebas:** una prueba de Node (`node --test`, sin dependencias) ejecuta el `.mjs` en un directorio temporal y
  comprueba lo siguiente:
  - crea el archivo con claves que firman y verifican un JWT;
  - un `.env` que ya existe queda idéntico byte a byte (por hash) y la salida no contiene ningún valor;
  - las dos sales son distintas.

  La prueba corre en el trabajo `herramientas` de la CI. Los dos envoltorios se prueban a mano en Linux y en Windows
  (tarea del responsable o manual, SC-001).
- **Trabajo `herramientas` de la CI** (análisis A2 y M9), creado en la fase 1 y ampliado en cada fase:
  - `node --test` sobre las pruebas de `scripts/`, `semilla/`, `carga/`, `evidencia/scripts/` y `publicacion/`;
  - Prettier (`npx prettier@3.9.10 --check`) y ESLint (`npx eslint@9.39.5` con
    `herramientas.eslint.config.mjs`, que incluye los globales de k6 para `carga/`) sobre las carpetas nuevas,
    excluyendo `evidencia/` salvo `evidencia/scripts/` (`.prettierignore` y `ignores`);
  - `npm audit --audit-level=high` en `e2e/` (todas sus dependencias son de prueba);
  - `revisar-secretos` sobre `evidencia/`.

  Sin secretos y sin base de datos.

**Por qué:**
- Hoy un tercero necesita openssl y pegar PEM a mano (README, `.env.example`).
- Node ya es requisito del proyecto, y si falta, Docker lo suple.
- Un solo generador evita que las versiones de bash y PowerShell den resultados distintos.
- Leer solo los nombres del `.env` existente es lo mínimo para cumplir US3-2. El responsable pidió no leer ni mostrar
  su `.env`: el script solo lee nombres y nunca muestra valores, y en esta sesión nadie lo ejecuta contra su `.env`
  real.

**Alternativas:**
- Generar con openssl en bash y con .NET en PowerShell: dos implementaciones, y openssl falta en Windows.
- Un servicio de Compose que escriba `.env`: un contenedor con permiso de escritura sobre la carpeta podría tocar un
  `.env` existente.

---

## R04 · US3: semilla idempotente por la API

**Decisión:**

- **Dónde:** `tecnologia/plataforma-barberias/semilla/cargar-semilla.mjs` (Node 22, sin dependencias, `fetch`) y
  `semilla/datos.json`, versionado.
- **Cómo se ejecuta:** con `docker compose --profile herramientas run --rm semilla`, un servicio `node:22` en la red
  `plataforma`, o desde el equipo con `node semilla/cargar-semilla.mjs --api http://localhost:3000/api/v1 --buzon
  http://localhost:8025`.
- **Camino:** carga los datos **por la API pública, como un usuario**:
  - registro de la barbería y activación con el enlace leído de Mailpit;
  - inicio de sesión del propietario;
  - servicios, barberos, horario y clientes (registro por el enlace de la barbería);
  - citas reservadas por los clientes, algunas canceladas y otras confirmadas.

  No usa ningún rol de base de datos, así que el aislamiento y las reglas se cumplen solos (FR-019, US3-5).
- **Idempotencia** (US3-4), por clave natural:
  - una barbería cuyo slug ya responde en la vía pública se salta;
  - un cliente cuyo correo ya existe inicia sesión en vez de registrarse;
  - una cita ya reservada (409 por horario ocupado) se cuenta como existente.

  Una segunda corrida termina con "0 creadas, N existentes" y código 0.
- **Datos:** inventados, con correos `@ejemplo.test` (dominio reservado por la RFC 2606/6761) y teléfonos
  `+51 900 000 0NN`, que se marcan como ficticios.
- **Dos casos de contraseñas** (2026-11-19):
  - **Demo local** (`--modo local`, el modo por defecto): las contraseñas son valores de desarrollo fijos de
    `semilla/datos.json`, documentados en `semilla/README.md`. Solo sirven en el equipo de quien clona, igual que los
    demás valores de desarrollo.
  - **Demo publicada** (`--modo publicacion`): el script genera para cada cuenta una contraseña **al azar**
    (`node:crypto`, 20 caracteres que cumplen la política de 001). Las guarda **solo** en
    `publicacion/secretos/cuentas-publicadas.json`, que no se versiona (`.gitignore`). Ese archivo se crea con permisos
    de solo el usuario donde el sistema lo permite. Nunca se imprimen ni van a ninguna documentación, a la evidencia ni
    a la CI. El repositorio solo tiene `publicacion/cuentas-publicadas.example.json`, con la misma forma y marcadores
    (`"<generada>"`).
  - Los correos de las cuentas son los mismos en los dos casos (`@ejemplo.test`). Solo cambian las contraseñas.
- **Carga normal:** es idempotente y **no cambia ninguna contraseña**. Una cuenta que ya existe se usa tal cual.
  Si en el modo publicación no se puede iniciar sesión con la contraseña guardada (por ejemplo, porque el archivo se
  perdió), la carga se detiene con un mensaje e indica usar `--reiniciar-contrasenas`. No intenta nada más.
- **`--reiniciar-contrasenas`** (modo explícito):
  - **No se puede hacer por la API sin cambiar el comportamiento.** La API actual no tiene ninguna ruta para cambiar
    ni recuperar la contraseña de una cuenta activa: `POST /auth/activar` solo sirve con un token de activación, y
    `POST /usuarios/:id/activacion` solo regenera el enlace de un usuario `PENDIENTE` (verificado en
    `regenerar-activacion.ts`). Agregar esa ruta sería una conducta nueva, fuera de FR-001.
  - Tampoco se usan roles de base de datos (FR-019).
  - **Decisión:** el reinicio **recrea la base de la demo publicada y vuelve a sembrarla por la API**, con
    contraseñas nuevas al azar. Eso es posible porque la demo publicada corre en **su propio proyecto de Compose**
    (`-p barberias-publicacion`, R10), con su propio volumen de PostgreSQL, separado del volumen de desarrollo del
    responsable.
  - Pasos de `semilla/reiniciar-publicacion.(sh|ps1)`:
    1. comprueba que el proyecto es exactamente `barberias-publicacion` y se niega con cualquier otro;
    2. detiene ese proyecto y borra **solo** su volumen de datos (`barberias-publicacion_datos-postgres`), nombrado de
       forma explícita, nunca con `down -v` sobre otro proyecto;
    3. lo levanta (migraciones con `preparar-backend`);
    4. ejecuta `cargar-semilla.mjs --modo publicacion --reiniciar-contrasenas`, que escribe un
       `cuentas-publicadas.json` nuevo de forma atómica.
  - Efecto, que se documenta: el reinicio también borra lo que los visitantes hayan cambiado en la demo publicada,
    y así la deja limpia.
  - En el modo local, `--reiniciar-contrasenas` **se rechaza**: el volumen local es el del responsable y nunca se
    borra desde un script de 009.
- **Sin administrador:** la semilla **no** crea un administrador de la plataforma. Para eso sigue el script
  `plataforma:crear-admin`, que imprime el TOTP una sola vez.
- **Fechas:** las citas se crean **en el futuro**, relativas a la fecha de carga (la API no deja reservar en el
  pasado). Lo que exige el pasado (historial atendido) no se siembra, y así se documenta.
- **Carga:** con un **comando explícito** (aclaración del 2026-11-19), nunca al levantar Compose.

**Por qué:** la API es el único camino que garantiza las mismas reglas que la aplicación (Argon2, RLS, consentimiento,
auditoría) sin escribir SQL ni usar roles privilegiados. Por eso no cambia ningún comportamiento (FR-001) y no
necesita reglas nuevas de dependency-cruiser: no importa nada de `backend/src`. Los recorridos E2E y la preparación de
la carga usan el mismo mecanismo (`semilla/lib/`).

**Alternativas:**
- SQL con `barberias_owner`: es el dueño de las tablas, así que depende de FORCE RLS y de fijar el tenant, y además
  saltaría el hash de las contraseñas.
- Un script con el contexto de Nest que llame a los casos de uso: acopla la semilla a las capas internas y al
  `Configuracion` completo, y la activación seguiría necesitando el correo.

---

## R05 · US2: Playwright, axe y Lighthouse

**Decisión:**

- **Paquete propio:** `tecnologia/plataforma-barberias/e2e/` (con su `package.json` y su `package-lock.json`), con
  `@playwright/test`, `@axe-core/playwright` y `lighthouse` en versiones exactas.
  - No se mezcla con `frontend/`, así no cambian sus dependencias, su `audit-ci` ni su build.
  - Se ejecuta en la imagen oficial `mcr.microsoft.com/playwright:v<versión>-noble`, que trae Chromium, como servicio
    de Compose con el perfil `e2e` en la red `plataforma`. No se descargan navegadores en el equipo.
- **Recorridos** (FR-013), uno por archivo en `e2e/recorridos/`:
  1. `registro-activacion.spec.ts`: registra la barbería, lee el enlace en Mailpit, activa la cuenta y el propietario
     llega a su panel.
  2. `reserva-cancelacion.spec.ts`: un cliente se registra por `/b/slug`, reserva, ve la cita en "Mis citas" y la
     cancela; el horario vuelve a estar libre.
  3. `agenda-propietario.spec.ts`: el propietario ve sus citas del día y ninguna de otra barbería; se comprueba con
     una cita conocida de la otra barbería de la semilla.
  4. `asistente-falso.spec.ts`: el cliente pregunta por los servicios y la respuesta lista los del catálogo.
     Compose ya fija `IA_PROVEEDOR=falso` y vacía la llave de OpenRouter (FR-002).
  5. `pago-suscripcion.spec.ts`: el propietario paga en la pasarela simulada y la suscripción queda activa.
- **Datos:** cada recorrido crea sus propias barberías y clientes con un prefijo `e2e-` y un sufijo aleatorio, usando
  `semilla/lib`. No toca la semilla de la demo.
- **Plataforma:** el panel de la plataforma necesita un administrador con TOTP. El recorrido lo crea con
  `plataforma:crear-admin --contrasena-desde-entorno` y toma el secreto de la URI `otpauth://` que el script imprime
  una sola vez. La URI solo vive en memoria: nunca se registra, nunca se adjunta a un informe, y
  `revisar-secretos` comprueba que no aparece en `evidencia/` (análisis A6).
- **Informes de Playwright** (análisis A6):
  - las trazas (`trace: 'retain-on-failure'`), las capturas, los videos y el informe HTML se escriben en
    `evidencia/e2e/no-versionado/`, excluido por el `.gitignore`;
  - solo se versiona el informe JSON **filtrado** por `e2e/informe-filtrado.mjs`: título, archivo, estado, duración
    y el mensaje de error, con tokens y correos enmascarados. Sin adjuntos, cabeceras, cuerpos ni salida estándar.
- **Accesibilidad** (FR-016):
  - `@axe-core/playwright` revisa las cuatro pantallas (catálogo público, reserva, panel del propietario y panel de
    la plataforma), a 360 × 800 y a 1 366 × 768, con las etiquetas `wcag2a`, `wcag2aa`, `wcag21a` y `wcag21aa`.
  - El informe JSON completo se guarda en `evidencia/accesibilidad/`.
  - Un incumplimiento `serious` o `critical` **no** hace fallar la prueba. Se lista en `resumen.md` con su
    corrección o con el motivo para no corregirlo (SC-004). Corregirlo es trabajo de la fase y no puede cambiar el
    comportamiento.
- **Rendimiento:**
  - Lighthouse (solo la categoría `performance`) mide las mismas cuatro pantallas con dos configuraciones: móvil
    (`screenEmulation` a 360 px con limitación de red y CPU simuladas) y `desktop`.
  - Para las pantallas con sesión, Playwright inicia la sesión y Lighthouse se conecta al mismo Chromium por el puerto
    de depuración, con `disableStorageReset`.
  - Se guarda el JSON completo en `evidencia/rendimiento-web/`, con las puntuaciones **tal como salen**.
  - **Contra qué se mide:**
    - con la interfaz de producción de US4 (`http://nginx:8080`) si existe;
    - si no, con `vite build` y `vite preview`, que usa el mismo proxy de `/api`. Por el orden de construcción, en la
      fase 3 todavía no existe el 8080, así que la primera medición es con `vite preview`. En la fase 4 se vuelve a
      medir contra el 8080 (análisis M6), y se guardan las dos corridas.
    - **Nunca** se mide el servidor de desarrollo (sin empaquetar, las cifras no significan nada). `entorno.json`
      dice contra qué se midió.
- **Estabilidad** (FR-015, aclaración del 2026-11-19):
  - Un script `e2e/estabilidad` ejecuta los recorridos **5 veces seguidas** en local y guarda cada resultado.
  - En el CI, un trabajo `e2e` **solo manual** (`workflow_dispatch`) levanta Compose, crea `.env` con el script de
    US3, carga la semilla y ejecuta los recorridos. Se lanza 3 veces.
  - Solo si las 5 corridas locales y las 3 del CI pasan, el trabajo se agrega a los `push` de `main`, en un cambio
    aparte. Si no, la evaluación queda en `evidencia/e2e/` y en `docs/05-gestion/04-pruebas.md`, y se ejecuta con el
    comando manual.
- **Reintentos:** `retries: 0` en la evaluación, porque un reintento ocultaría la inestabilidad. Playwright conserva
  su espera automática.

**Por qué:**
- Un paquete propio aísla las dependencias de prueba del build de producción.
- La imagen oficial trae el Chromium que pide la versión exacta de Playwright.
- Lighthouse por el puerto de depuración es la forma documentada de medir páginas con sesión sin escribir la
  contraseña en la URL.
- El trabajo manual en el CI permite contar las 3 corridas sin poner un paso inestable en los `push` (FR-015).

**Alternativas:**
- Cypress: no lo pidió el responsable.
- `playwright-lighthouse`: otra dependencia para algo que Lighthouse ya permite.
- Medir Lighthouse sobre Vite en desarrollo: da cifras engañosas.
- Pa11y: el responsable pidió axe.

---

## R06 · US4: interfaz servida como en producción y escalado medido (PR03)

**Decisión:**

- **Compilación de la interfaz:** un servicio de una sola ejecución, `preparar-frontend` (`node:22`, perfil
  `produccion`), ejecuta `npm ci && npm run build` y copia `dist/` al volumen `frontend-dist`. Sigue el mismo patrón
  que `preparar-backend` (sin Dockerfile).
- **El mismo Nginx** (una sola instancia y 32 MB) monta `frontend-dist` en solo lectura y agrega una **plantilla
  nueva**, `nginx/templates/web.conf.template`, con un `server` en el puerto 8080, publicado en el equipo como
  `8080`:
  - `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`;
  - `index.html`: `Cache-Control: no-cache`;
  - `try_files $uri /index.html` para las rutas de la aplicación;
  - `/api/` hacia el mismo `upstream api`, con las mismas cabeceras de IP que la plantilla actual;
  - gzip para JS, CSS y SVG (despliegue §4.1).
- **Lo que no cambia:** la API sigue en el 3000 y Vite en el 5173. El modo de desarrollo queda igual (FR-022).
- **Puerto 8080** (análisis B4): Nginx lo publica siempre, también en la demo de desarrollo, y sirve 403 o 404
  mientras `frontend-dist` esté vacío. Si otro programa del equipo ocupa el 8080, `nginx` no arranca. El README lo
  avisa, y la variable `WEB_PUERTO` (por defecto 8080) permite cambiarlo.
- **PR02** (análisis M11): no se mide otra vez en US4. Se cita la medición de `reserva` de US1, porque el 8080 solo
  agrega los archivos estáticos: `/api/` va al mismo `upstream api`, con las mismas réplicas y la misma
  configuración. Una segunda medición a través del 8080 mediría lo mismo con otro puerto.
- **Prueba existente:** la prueba `balanceador` copia **solo** `default.conf.template`, así que no ve la plantilla
  nueva.
- **Tercera instancia (PR03):**
  - `backend-3` (IP fija `${IP_BACKEND_3}`, por defecto `172.28.0.18`, y `.18` de la subred de cada proyecto) con el
    perfil `escalado`.
  - Nginx necesita conocer la tercera réplica sin reescribir la plantilla que usa la prueba. Para eso se agrega
    **una sola línea** en el bloque `upstream api` de `default.conf.template`:
    `include /etc/nginx/upstream-extra/*.conf;`.
  - El directorio está vacío salvo durante la medición. La línea no cambia nada mientras no haya archivos, y la
    prueba `balanceador` lo confirma: nginx acepta un `include` con comodín sin coincidencias (**por verificar** en
    la fase, con esa prueba).
  - La medición (`carga/escalado/agregar-instancia.(sh|ps1)`) sigue estos pasos:
    1. carga constante con k6;
    2. arranca `backend-3`;
    3. espera a que `/salud/listo` responda;
    4. escribe `server ${IP_BACKEND_3}:3000 …;` en `upstream-extra/`;
    5. `nginx -s reload`, una recarga ordenada que termina las conexiones en curso;
    6. registra el throughput antes y después y las solicitudes perdidas (errores de red y 5xx) durante el alta.
- **Pool con tres instancias:** 3 × (10 + 10 + plataforma) conexiones frente a `max_connections=100`. El cálculo
  queda en US5.

**Por qué:**
- Reutilizar Nginx evita un contenedor más (el equipo tiene 8 GB, 006 R12).
- Una plantilla aparte no toca el contrato que prueba `balanceador`.
- El `include` es el cambio mínimo para agregar una instancia sin cortar el tráfico.
- La aclaración de que las réplicas comparten la CPU va en el resumen (US4-2).

**Alternativas:**
- Un segundo contenedor de Nginx para los estáticos: más memoria.
- Un Dockerfile multietapa: el proyecto no usa Dockerfiles, y agregarlos solo para esto rompe el patrón.
- Una tercera réplica fija en el `upstream`: la prueba `balanceador` y Compose fallarían sin ella.

---

## R07 · US5: planes de ejecución, pool, volumen y simulacro de respaldo

**Decisión:**

- **Planes reales sin copiar SQL:**
  - un archivo de Compose solo para medir, `docker-compose.medicion.yml`, arranca PostgreSQL con
    `shared_preload_libraries=auto_explain`, `auto_explain.log_min_duration=0`, `log_analyze=on`,
    `log_buffers=on`, `log_format=json` y **`auto_explain.log_parameter_max_length=0`** (análisis A7: en
    PostgreSQL 16 el valor por defecto, -1, registra los valores ligados completos, como correos, hashes y tokens);
  - mientras corren los escenarios de k6 (con poca carga) y los recorridos que tocan las consultas críticas,
    PostgreSQL registra el plan **de las consultas que de verdad envía la aplicación**;
  - `evidencia/scripts/extraer-planes` filtra en el registro las de horarios libres, agenda, reserva, reportes e
    indicadores, y guarda cada plan con el índice usado (FR-024). Del texto de la consulta guarda solo la forma con
    los marcadores `$1`, `$2`…, y descarta cualquier línea `Query Parameters` que apareciera.
  - Por el costo de `log_analyze`, esa ejecución **nunca** se usa para las cifras de US1.
- **Volumen mayor** (análisis M4; se siembra en **menos de una hora**):
  - **Tamaño elegido: 260 000 citas** (5 veces las 52 000 de `indicadores-plataforma`), en 50 barberías
    `volumen-*`.
  - **Cómo se siembra:**
    1. las 50 barberías, sus barberos, servicios y clientes se crean **por la API** con `semilla/lib`. El límite de
       10 registros por minuto da unos 5 minutos.
    2. Las citas se insertan **dentro de la base, por conjuntos**, con `semilla/volumen.sql`, ejecutado con
       `psql` en el contenedor `db` como **`barberias_app`** (sin `BYPASSRLS`, con su URL de desarrollo de
       Compose). Por cada barbería, en una transacción:
       - `select set_config('app.tenant_id', <tenant>, true)`, el mismo mecanismo que `kysely-unit-of-work.ts`;
       - `INSERT INTO appointment (…) SELECT … FROM generate_series(…)`;
       - el historial de estados, en `appointment_status_history`.

       `barberias_app` tiene `INSERT` sobre las dos tablas (migración 0011), y RLS comprueba el tenant con `WITH
       CHECK`.
  - **No se usa `COPY FROM`:** PostgreSQL no lo admite en tablas con RLS para un rol sin `BYPASSRLS`.
  - **Restricciones de exclusión** (migración 0011): no puede haber dos citas solapadas del mismo barbero ni del
    mismo cliente en un tenant. La generación reparte las citas en franjas que no se solapan: barbero × día ×
    franja de 30 min, y los clientes rotan de modo que ninguno coincida consigo mismo.
  - **Tiempo:** antes de la carga completa se mide una muestra de 10 000 citas y se proyecta. Si la proyección supera
    los 45 minutos, el tamaño baja al mayor múltiplo de 52 000 que quepa en ese tiempo, y así se escribe.
  - **Extrapolación** (FR-026): se miden las consultas críticas con 52 000, 130 000 y 260 000 citas (tres puntos,
    agregando volumen en el mismo proyecto). Se ajusta una recta del p95 y del costo del plan frente al número de
    citas, y se extrapola a 1 000 000 con la advertencia explícita: "estimación, no medición; un cambio de plan del
    optimizador invalidaría la recta".
  - Las consultas críticas se miden con k6 (escenarios de US1 apuntando a una barbería `volumen-*`) y con los planes
    de arriba.
- **Pool** (FR-025): se documentan los pools configurados (`DB_POOL_APP_MAX`, `DB_POOL_PUBLICO_MAX`, plataforma y
  dueño) y la fórmula `N × Σ pools + migraciones + reserva ≤ max_connections (100)`. Se calcula para 2 y 3
  instancias y se mide `pg_stat_activity` durante la carga.
- **Excepción acotada para el simulacro** (análisis C2, aprobada por el responsable el 2026-11-19):
  - **Qué:** el respaldo (`pg_dump`), la creación y el borrado de la base de prueba (`createdb`, `dropdb`) y la
    restauración (`pg_restore`) usan el superusuario `postgres`.
  - **Por qué, con honestidad:** con FORCE RLS en todas las tablas de negocio, un rol sin `BYPASSRLS`, incluso el
    dueño `barberias_owner`, solo ve las filas del tenant de su sesión. Un `pg_dump` con ese rol sale **vacío o
    parcial**. Un respaldo completo exige un rol que no esté sujeto a RLS, y en PostgreSQL solo lo son el
    superusuario o un rol con `BYPASSRLS`. Es lo mismo que hacen los respaldos administrados (por ejemplo, los de
    RDS).
  - **Límites:**
    - solo dentro del contenedor `db` (`docker compose exec db …`), con la conexión local del contenedor; la
      contraseña nunca sale del contenedor ni del archivo de Compose;
    - solo en `simulacro-respaldo`;
    - **nunca** en la aplicación, en la semilla, en el volumen ni en ningún script que lea o escriba datos de
      negocio;
    - no crea ningún rol nuevo ni da `BYPASSRLS` a nadie.
  - **Comprobación:** una prueba (`git grep`) en el trabajo `herramientas` falla si `postgres` aparece como usuario
    de conexión fuera de `evidencia/scripts/simulacro-respaldo.*` y de la configuración ya existente (`db` y `db/init`).
  - **Constitución:** no la viola, porque el principio III habla de los roles de la aplicación. Para dejarlo
    registrado, se agrega una frase a la aclaración PATCH en borrador (sección "Restricciones", privacidad y
    respaldo).
- **Simulacro PR22** (FR-027), con `evidencia/scripts/simulacro-respaldo.(sh|ps1)`:
  1. `pg_dump -Fc` de la base de la demo, con el superusuario `postgres`, dentro del contenedor `db` (excepción de
     arriba);
  2. crea una base vacía `barberias_restaurada` en el mismo servidor; los roles son globales y ya existen;
  3. `pg_restore`;
  4. compara conteos por tabla y comprueba que RLS sigue activa (`relrowsecurity` y `relforcerowsecurity`) y que
     una consulta con `barberias_app` sin tenant devuelve 0 filas;
  5. mide los tiempos de respaldo y de restauración;
  6. borra la base restaurada.

  El acta se guarda en `evidencia/base-de-datos/`. El "restaurar en un servidor sin roles" se documenta como el
  paso previo de `db/init` (borde de la spec).
- **No construido** (FR-028): réplicas de lectura, particionado y PgBouncer, cada uno con su motivo y la condición
  para construirlo, en despliegue §8 y en multi-tenancy.

**Por qué:**
- `auto_explain` captura el SQL real (el de Kysely) sin duplicarlo en un script que podría quedar desfasado.
- El simulacro dentro del mismo contenedor no toca el volumen de datos: crea y borra una base aparte.

**Alternativas:**
- `EXPLAIN` sobre SQL copiado: puede no coincidir con lo que ejecuta la aplicación.
- Restaurar en otro contenedor: duplica la memoria, y el resultado en roles es el mismo.

---

## R08 · US6: cobertura, insignia y pruebas frágiles

**Decisión:**

- **Cobertura:**
  - Backend: Jest con `--coverage` (istanbul, ya incluido en Jest) y los reportes `json-summary`, `text-summary` y
    `lcov`.
  - Frontend: `@vitest/coverage-v8` en la versión exacta que acompaña a `vitest@3.2.7` (nueva dependencia de
    desarrollo).
  - **Exclusiones declaradas:** `test/`, `simulador-*`, `scripts/`, `migrations/` (se prueban por integración, pero
    no son lógica que se cubra), `*.d.ts` y `src/api/schema*.d.ts`. Se escriben en el informe (borde "cobertura
    engañosa").
  - **Sin umbral** (FR-030).
  - Se guardan en el repositorio: una corrida local completa (unidad e integración del backend; frontend), en
    `evidencia/cobertura/`.
  - **La cobertura de integración se mide en una corrida aparte, sin exigir las metas de tiempo** (análisis A4):
    istanbul instrumenta el código y lo hace más lento, lo que rompería justo las pruebas de tiempo. Con
    `COBERTURA=1`, `medirMeta` registra las repeticiones pero no comprueba la mediana ni el techo. **Todas las
    aserciones de comportamiento siguen activas.** Esa corrida no cuenta para SC-009.
  - En el CI: `npm test -- --coverage` (unidad) y `vitest run --coverage`, con el resumen como artefacto de la
    corrida. La integración ya tarda mucho; no se le agrega cobertura en el CI.
- **Insignia:** la de estado del flujo de GitHub Actions (`…/actions/workflows/plataforma-barberias.yml/badge.svg?branch=main`)
  en el README raíz y en el de la plataforma. No necesita secretos.
- **Pruebas frágiles** (FR-032 a FR-034, tabla de la spec):
  - **Metas de un requisito** (`degradacion-asistente`, `proveedor-caido`, `indicadores-plataforma` y el límite de
    2 s de `redis-caido`):
    - La meta se comprueba con la **mediana de 5 repeticiones**, en la misma prueba y bloqueante. Las cuatro metas
      siguen igual: ≤ 3 s, ≤ 3 s, ≤ 3 s y p95 ≤ 2 s. Para `redis-caido`, la meta de 006 es un p95 y se calcula
      como p95 sobre las repeticiones.
    - Cada repetición conserva un **techo** de 2 veces la meta, que detecta un cuelgue sin depender de un pico
      aislado.
    - Las repeticiones se guardan con `MEDIR_METAS=1` en `evidencia/pruebas-frágiles/`.
    - Si la mediana sigue siendo inestable en 3 corridas, se pasa a la suite aparte `test:metas`, no bloqueante
      (`continue-on-error`), que guarda "cumple" o "no cumple" (opción A, segunda forma).
  - **Resto:** se suben solo los márgenes de espera y los `testTimeout`. Se registra el valor anterior, el nuevo y
    el motivo en `docs/05-gestion/04-pruebas.md` (FR-033).
  - Antes de cambiar cada una, se ejecuta sola para confirmar que la falla es de tiempo, como en 007.
  - **Verificación:** 3 corridas completas seguidas sin fallas de tiempo (SC-009). Se cuenta con un script que
    guarda los totales.

**Por qué:** la mediana reduce el efecto de un pico de CPU sin relajar la meta, y el techo conserva la garantía de
"no se cuelga".

**Alternativas:**
- Subir los límites de las metas: se rechaza (aclaración del 2026-11-19).
- Quitar las pruebas de tiempo del CI: se perdería la evidencia.

---

## R09 · US7: ¿Cloudflare Pages o túnel desde el Nginx de Compose?

**Decisión: la interfaz y la API salen juntas por el túnel con nombre desde el Nginx de Compose, en el mismo
origen.** Cloudflare Pages **no se usa**.

Análisis (código actual):

| Tema | Pages + API por túnel (`api.`) | Todo por el túnel desde Nginx |
| --- | --- | --- |
| Origen de la API | Distinto (`ayacuchobarber.shop` → `api.ayacuchobarber.shop`) | El mismo: `/api/v1` relativo, como hoy |
| Código | `client.ts` y `plataforma.ts` fijan `BASE = '/api/v1'`, así que hay que volver configurable la URL de la API (cambio en el frontend) | **Ninguno** |
| CORS | `CORS_ORIGIN` admite un solo origen; con un subdominio por barbería harían falta orígenes dinámicos, y eso cambia el comportamiento del backend | Sin solicitudes entre orígenes |
| Cookie `rt` | `SameSite=Strict`, `Path=/api/v1/auth`, solo para el host de la API. Viaja por ser el mismo sitio, pero cada solicitud paga un preflight a través del túnel | Igual que en local |
| Diseño documentado | Despliegue §4.1 pide "servir la interfaz y `/api/*` bajo el mismo dominio" | Lo cumple |
| Subdominios comodín (US8) | Pages no admite un dominio propio comodín (**por verificar**). Las barberías tendrían que ir por el túnel de todos modos, con dos versiones de la interfaz en dos lugares | Un `server_name` con expresión regular en Nginx resuelve todos |
| HTTPS | Certificado de Pages | El Universal SSL de Cloudflare cubre el dominio raíz y `*.ayacuchobarber.shop` (un nivel), **por verificar** en el panel. De Cloudflare a `cloudflared` va cifrado por el túnel; de `cloudflared` a Nginx va en HTTP dentro de la red de Docker |
| CD | Real (subir a Pages desde la CI), con un token de Cloudflare y el identificador de la cuenta en GitHub | **CD por extracción:** la CI guarda el artefacto; un servicio local lo descarga y lo publica (R10) |
| Equipo apagado | La interfaz carga, pero la API no responde | No responde nada (borde de la spec) |
| Base de datos con RLS | Igual en las dos: queda en el equipo, sin cambios | Igual |
| Secretos | Token de la API de Cloudflare e identificador de la cuenta en GitHub, más la credencial del túnel en el equipo | Solo la credencial del túnel en el equipo y un token de GitHub de solo lectura (R10). **Ningún** secreto en la CI |

**Por qué:**
- Es la única opción que **no cambia código ni comportamiento** (FR-001), respeta el diseño de mismo origen
  (§4.1) y deja a US8 en una sola configuración de Nginx.
- La CDN existe igual: el proxy de Cloudflare guarda en caché los `assets/*` con su `Cache-Control` y deja pasar
  `index.html`. La evidencia es la cabecera `cf-cache-status`.
- El costo es un CD por extracción en lugar de por empuje (R10). Ese CD es honesto: automático, desde `main`, solo con
  las pruebas en verde y sin secretos en la CI.

**Alternativas:**
- Pages con una función que reenvíe `/api/*` al túnel: es lógica de la aplicación fuera del artefacto estático (va
  contra la enmienda propuesta) y obliga a confiar en una cabecera de IP puesta por esa función.
- Pages y un Worker: lo mismo.
- Pages solo como "vitrina" sin API: no demuestra nada.

**Consecuencia para la constitución:** la enmienda MINOR del borrador, que permitía publicar en la CDN desde la CI,
**ya no hace falta**. Basta una **aclaración PATCH** del principio XII, ya que conservar el artefacto compilado es
parte de "construir" y el flujo sigue sin desplegar. Ver
[borradores/enmienda-xii-y-adr-publicacion.md](borradores/enmienda-xii-y-adr-publicacion.md), versión 2, para la
revisión del responsable.

---

## R10 · US7: el túnel, la IP real y el CD por extracción

**Decisión:**

- **Túnel:**
  - `cloudflared`, imagen oficial `cloudflare/cloudflared` con una etiqueta exacta.
  - Servicio de Compose con el perfil `publicacion`, IP fija `${IP_CLOUDFLARED}` (`172.30.0.17` en el proyecto
    `barberias-publicacion`, R01b).
  - **Gestionado localmente:** las reglas de entrada se versionan en `publicacion/cloudflared/config.yml`.
    `ayacuchobarber.shop` y `www.ayacuchobarber.shop` van a `http://nginx:8081`. Con US8 se agrega
    `*.ayacuchobarber.shop` hacia el mismo destino, y al final va el `http_status:404`.
  - El **archivo de credenciales del túnel** (contiene el secreto) vive **fuera del repositorio**, en la carpeta
    `publicacion/secretos/`, que el `.gitignore` excluye. Siempre con el **nombre fijo `tunel.json`** (análisis
    M5): `cloudflared` lo nombra por defecto con el UUID del túnel, y ese nombre terminaría escrito en el
    `config.yml` versionado. La verificación de la fase comprueba que `config.yml` no contiene ningún UUID.
  - El túnel se nombra por su nombre lógico. Si `cloudflared` exige el identificador, se pasa desde una variable de
    un archivo no versionado (**por verificar** en la fase).
  - No se versiona ningún identificador de cuenta, de zona ni del túnel.
- **El `.env` del responsable no se usa para el túnel:** `env_file: .env` carga **todas** sus variables en las
  réplicas, así que un token allí llegaría al backend. El túnel y el actualizador leen un archivo propio,
  `publicacion/publicacion.env`, no versionado, con un `publicacion/publicacion.env.example` versionado y sin
  valores.
  - Para eso, `.gitignore` agrega `publicacion/publicacion.env`, `publicacion/secretos/` y, como respaldo por si el
    archivo se moviera, `**/cuentas-publicadas.json`. El ejemplo `publicacion/cuentas-publicadas.example.json` sí
    se versiona: no coincide con esas reglas y solo tiene marcadores.
  - Una prueba del CI (en el trabajo `herramientas`) ejecuta `git check-ignore` sobre esas rutas y falla si alguna
    dejara de estar ignorada.
  - No se usa el nombre `.env.publicacion`, porque la regla actual `.env.*` lo ocultaría y también ocultaría su
    ejemplo.
- **Nginx para el túnel:**
  - plantilla nueva `nginx/templates/publicacion.conf.template`, puerto 8081, **sin publicar en el equipo** (solo
    lo alcanza `cloudflared` dentro de la red);
  - sirve `frontend-dist` como el 8080 y reenvía `/api/` al `upstream api`;
  - con el módulo `real_ip`: `set_real_ip_from ${IP_CLOUDFLARED}; real_ip_header CF-Connecting-IP;`.
  - **Por qué hace falta:** sin esto, todas las visitas llegarían con la IP de `cloudflared`. El límite por IP de 006
    (120 por minuto) se volvería un límite global y la auditoría registraría la misma IP para todos.
  - Solo se confía en esa cabecera cuando viene de `cloudflared`, que solo recibe tráfico del borde de Cloudflare.
  - Después, `X-Forwarded-For $remote_addr` se sobrescribe como hoy, y el backend sigue confiando solo en Nginx
    (006 R04). **El backend no cambia.**
- **Lo que no se expone:** Mailpit, la pasarela simulada, WhatsApp simulado, el 3000 y el 8080 **no** pasan por el
  túnel. Consecuencias que se escriben tal cual (FR-039):
  - una persona externa no recibe el correo de activación (llega a Mailpit, en el equipo), así que no puede activar
    una barbería ni una cuenta nueva. Esto también limita el abuso;
  - el pago simulado y los avisos solo funcionan desde el equipo;
  - la demo publicada sirve para **navegar las barberías de ejemplo** y, para quien recibe del responsable las
    contraseñas de la demo publicada, para **entrar con esas cuentas**.
- **Proyecto de Compose propio para la demo publicada:** siempre se levanta con `-p barberias-publicacion`. Así tiene
  volúmenes propios (base de datos, `frontend-dist`) y nunca usa ni borra el volumen de desarrollo del responsable.
  - Se puede reiniciar con contraseñas nuevas (R04).
  - La demo local y la publicada **no corren a la vez**: comparten puertos del equipo (3000, 3100, 3200, 1025, 8025,
    5173, 8080) y el equipo tiene 8 GB. Los scripts de la publicación lo comprueban antes de arrancar.
  - **Subred propia** (análisis A1): `172.30.0.0/24`, con las variables de `publicacion/red-publicacion.env`
    (versionado y sin secretos), que `levantar` y `reiniciar-publicacion` exportan en el entorno del shell. Así la red
    del proyecto de desarrollo, que `docker compose stop` conserva, no choca con la de la publicación (R01b).
  - Las mediciones de US1, US4 y US5 nunca se hacen sobre la demo publicada: se hacen en la copia de verificación
    (R01b).
- **Cuentas de la demo publicada:** contraseñas al azar en `publicacion/secretos/cuentas-publicadas.json`, no
  versionado (R04). El sitio, el README y `docs/` nunca las muestran. El responsable las comparte por su cuenta con
  quien evalúa.
- **Configuración de la publicación:** `docker-compose.publicacion.yml` sobrescribe en las réplicas solo valores no
  secretos: `CORS_ORIGIN`, `FRONTEND_BASE_URL`, `URL_PUBLICA` y `PAGOS_URL_RETORNO`, con
  `https://ayacuchobarber.shop`. `environment` tiene prioridad sobre `env_file`, así que no se toca el `.env`.
- **CD por extracción:**
  1. La CI agrega el trabajo `artefacto-frontend`: `needs: [backend, frontend, herramientas]`, solo `push` a `main`; ejecuta
     `npm ci && npm run build` en `frontend/` y `actions/upload-artifact` con `dist/` y un `version.json` (SHA y
     fecha).
     - Sin secretos y sin acceso a la base de datos.
     - Si una prueba falló, `needs` impide que corra.
  2. El servicio `actualizador-frontend` (perfil `publicacion`, `node:22`, script
     `publicacion/actualizador/actualizar.mjs` sin dependencias) consulta cada 5 minutos la API de GitHub por la
     última corrida **exitosa** de `push` en `main`. Si el SHA es nuevo, hace lo siguiente:
     - descarga el artefacto con un token **de grano fino y solo lectura** sobre ese repositorio (Actions: read),
       guardado en `publicacion/publicacion.env`;
     - verifica que el artefacto pertenece a esa corrida;
     - lo copia a `frontend-dist`: primero los `assets/`, sin borrar los de la versión anterior durante 1 día (§4.1,
       ADR-018 R19), y al final `index.html`, de forma atómica.
     - Registra cada publicación en `evidencia/despliegue/publicaciones.jsonl` (SHA, corrida, hora y duración).
     - **Sin token o con el token vencido** (análisis M10): registra el error (nunca el token), conserva la versión
       publicada y espera al siguiente sondeo. Tras 3 errores seguidos de autenticación, espera 1 hora entre intentos
       y lo registra una sola vez, para no entrar en un bucle de reintentos.
- **SC-010:** se mide desde que termina la corrida verde hasta que `version.json` publicado muestra el nuevo SHA.
  Con un sondeo de 5 minutos, el peor caso es de unos 6 minutos. La duración total de la CI, larga por la
  integración, no entra en esa cifra, y así se dice.
- **Evidencia:** `evidencia/despliegue/`, con lo siguiente:
  - `curl -sI` a la raíz, a un `assets/*` (dos veces, para ver `cf-cache-status: MISS` y luego `HIT`) y a
    `/api/v1/salud/listo`;
  - la consulta DNS;
  - el certificado (emisor y nombres);
  - las publicaciones del actualizador.

  Nunca se guardan cabeceras con cookies ni con tokens.

**Por qué:** es la vía con menos secretos, cero cambios en la aplicación y la IP real preservada. El CD queda
automático y condicionado a las pruebas.

**Alternativas:**
- Túnel gestionado desde el panel (con un token en lugar de credenciales): las reglas de entrada no quedarían en el
  repositorio como evidencia.
- `real_ip` con los rangos de IP de Cloudflare: no aplica, porque el tráfico llega por `cloudflared`, no por esos
  rangos.
- Un `webhook` de GitHub hacia el equipo: expondría otro punto de entrada.

---

## R11 · US8: barbería por subdominio sin que el aislamiento dependa del host

**Decisión:** se resuelve **solo en Nginx** (plantilla de publicación). No cambia ni el backend ni el frontend.

- `server_name ~^(?<slug>[a-z0-9]+(-[a-z0-9]+)*)\.ayacuchobarber\.shop$;` usa la misma expresión que el `CHECK` de
  `tenant.slug` (migración 0001).
  - En la plantilla, el dominio entra como `${DOMINIO_PUBLICO_REGEX}` (por ejemplo, `ayacuchobarber\.shop`), con los
    puntos **ya escapados**, en `docker-compose.publicacion.yml` (análisis B1). `envsubst` no puede escapar.
    `${DOMINIO_PUBLICO}`, sin escapar, se usa solo en los `server_name` exactos y en las redirecciones.
  - La longitud de la etiqueta se limita a 63 en la propia expresión, con una anticipación negativa
    `(?![a-z0-9-]{64})`.
- `location = / { return 302 /b/$slug; }`. Toda otra ruta se sirve igual que en el dominio raíz: la interfaz y
  `/api/` en el mismo origen del subdominio. Así `slug.ayacuchobarber.shop` abre la misma página que `/b/slug`
  (FR-043), y `/b/slug` no cambia (FR-044).
- **Reservados** (FR-046): `www`, `api`, `app`, `admin`, `plataforma`, `mail`, `correo`, `estado`, `cdn`, `static`,
  `assets` y `demo` tienen un `server_name` exacto, que en Nginx gana a la expresión regular. Responden con una
  redirección al dominio raíz y nunca con `/b/<reservado>`.
  - Una barbería cuyo slug coincida con un reservado sigue abriéndose por `/b/slug`.
  - Un slug de más de 63 caracteres no cabe en una etiqueta DNS (el `CHECK` admite 140) y también se abre solo por
    `/b/slug`. Se documenta.
- **Desconocido o inactivo** (FR-046): la redirección lleva a `/b/<slug>`, donde la interfaz ya responde igual que con
  un slug desconocido, porque la vía pública no distingue estados (ADR-021). No hace falta nada más.
- **Aislamiento** (FR-045):
  - El backend **no lee** el host: no hay usos de `hostname` ni de `headers.host` en `backend/src` (verificado el
    2026-11-19). La barbería de una operación autenticada sale del token (principio III).
  - Una **prueba de arquitectura** nueva en `test/architecture/` falla si `backend/src` llega a leer el host **de la
    solicitud**, para que no se pueda volver dependiente del host sin que el CI lo detecte.
    - Los patrones se acotan al objeto de la solicitud (análisis M3): `(req|request|solicitud)\.(hostname|host)\b`,
      `headers\.host\b`, `headers\[['"]host['"]\]`, `['"]x-forwarded-host['"]` y `\.get\(['"]host['"]\)`.
    - **No** se busca `.host` a secas: hay usos legítimos de configuración (el `host` de SMTP en
      `canal-correo-smtp.ts` y `configuracion.ts`) y el directorio `src/host/`.
    - La prueba incluye un caso de control: un archivo de ejemplo con el `host` de SMTP no da falso positivo, y uno
      con `req.hostname` sí falla.
  - No hace falta una regla de dependency-cruiser: no hay módulos ni dependencias nuevas.
  - **Prueba de sesión cruzada**, de integración, con Testcontainers:
    1. un ayudante nuevo (`test/helpers/nginx-publicacion.ts`) levanta Nginx con `default.conf.template` y
       `publicacion.conf.template`, con un `index.html` de prueba, delante de dos instancias en proceso;
    2. se crean las barberías A y B y se inicia sesión como propietario de A;
    3. con `Host: b.ayacuchobarber.shop` y el token de A, se piden la agenda, los clientes y los reportes: solo
       aparecen datos de A, nunca de B;
    4. con `Host: b.ayacuchobarber.shop` y sin token, la ruta privada responde 401;
    5. `GET /` con ese host responde 302 hacia `/b/b`, los reservados no se redirigen a `/b/`, y un `Host` con un
       puerto o mayúsculas no rompe nada.
  - Un recorrido de Playwright con `--host-resolver-rules` hacia Nginx comprueba en el navegador que el subdominio
    muestra la página pública.
- **DNS** (tarea del responsable): un registro comodín proxied `*` hacia el túnel, además del raíz y de `www`.

**Por qué:** si el host solo produce una redirección a una ruta pública que ya existe, el subdominio no puede llegar a
la lógica de negocio. El aislamiento sigue dependiendo solo del token y de RLS.

**Alternativas:**
- Leer el host en el frontend y pintar el catálogo sin redirigir: cambia el código del frontend y agrega un
  comportamiento nuevo que hay que probar.
- Leer el host en el backend: va contra FR-045.

---

## R12 · Gobierno: enmienda, ADR-034 y ADR-035

**Decisión:** la fase 0 entrega, para la revisión del responsable y **sin aplicar nada**:

1. **Aclaración PATCH del principio XII** (propuesta 1.7.2), que reemplaza al borrador MINOR. Dice lo siguiente:
   - los flujos MAY conservar el artefacto compilado como artefacto de la corrida;
   - MAY tener trabajos manuales de prueba;
   - MUST NOT desplegar ni tener credenciales de despliegue.

   Se agrega la aclaración de "demo publicada ≠ despliegue objetivo" en "Restricciones". El texto MINOR anterior
   queda como alternativa descartada (R09). Además, en "Restricciones" (privacidad y respaldo), se registra la
   excepción acotada del superusuario para el simulacro de respaldo (R07, análisis C2).
2. **ADR-034:** pruebas de carga con k6 en contenedor, que cambia R13 de 006. Está redactado en
   [borradores/adr-034-k6.md](borradores/adr-034-k6.md).
3. **ADR-035:** publicación de la demo con dominio propio, la CDN de Cloudflare y un túnel con nombre desde Nginx, con
   CD por extracción. Revisa ADR-006 solo para decir que no es su despliegue objetivo. Está actualizado con R09 a R11
   en el borrador.

Ningún cambio a `.specify/memory/constitution.md` ni a `07-decisiones-arquitectonicas.md` se hace sin la aprobación
del responsable. Si la aclaración no se aprueba, el trabajo `artefacto-frontend` no se agrega y el CD queda como
publicación manual con el mismo actualizador (criterio de corte de US7).

---

## R13 · Fases, commits y orden de recorte

**Decisión:**

1. **Fase 0:** borradores.
2. **Fase 1:** US3.
3. **Fase 2:** US1.
4. **Fase 3:** US2.
5. **Fase 4:** US4.
6. **Fase 5:** US6.
7. **Fase 6:** US5.
8. **Fase 7:** US7.
9. **Fase 8:** US8.
10. **Fase 9:** cierre.

El orden de construcción es el inverso del orden de recorte (US8, US7, US5, US6, US4), así lo último en construirse
es lo primero que se recorta. Las P1 van primero, y US3 antes que US1 y US2, porque los dos usan su mecanismo de
datos (`semilla/lib`).

| Fase | Depende de | Si se recorta |
| --- | --- | --- |
| 0 | — | No se recorta (es solo revisión) |
| 1 · US3 | — | Nunca |
| 2 · US1 | US3 (`semilla/lib`) | Nunca |
| 3 · US2 | US3 | Nunca |
| 4 · US4 | US1 (k6 para PR03) | US2 mide Lighthouse con `vite preview`; US7 no puede servir la interfaz y se recorta con ella |
| 5 · US6 | — | Las 11 pruebas siguen como hoy y la cobertura queda sin medir |
| 6 · US5 | US1 (k6 con poca carga para los planes) | Los planes, el volumen y el simulacro quedan sin hacer y se documentan como planificados |
| 7 · US7 | US4, enmienda y ADR-035 aprobados | La evidencia de despliegue es la demo local de US4 (FR-040) |
| 8 · US8 | US7 | `/b/slug` sigue como única vía |

Cada fase cierra con estos pasos:
1. sus pruebas en verde en local;
2. **sus** documentos actualizados en el mismo cambio (FR-042);
3. la fila de 009 en `docs/trazabilidad.md`;
4. `revisar-secretos` sobre `evidencia/`;
5. el commit y el push del responsable;
6. la CI en verde.

La fase 9 solo cambia estados y totales.

**Recortar US6 y la CI en verde** (análisis M1): si US6 se recorta, las 11 pruebas frágiles siguen fallando a veces en
la CI. Desde ese momento, una CI roja en las fases 6 a 8 solo se acepta como "verde" si:
1. la falla está en una de esas 11 pruebas;
2. la prueba pasa al ejecutarla **sola** en local;
3. al relanzar la corrida en GitHub (*re-run failed jobs*), la prueba pasa.

Se anota en la tarea de verificación. Como `artefacto-frontend` depende de `backend`, en ese caso el CD de US7 publica
solo tras una corrida relanzada en verde.

**Por qué:** cumple FR-005 y la condición del responsable de "un commit por fase".

---

## R14 · Tiempo de la suite y espera de la CI (análisis A4)

**Datos:**
- La suite de integración tardó 77,5 minutos en local (2026-11-18, 157 archivos).
- La de unidad tarda unos minutos, la de arquitectura menos de uno y la del frontend unos minutos.
- La duración de la CI completa en GitHub **no está medida**: se mide en la primera corrida de la fase 1 y se anota
  en `docs/05-gestion/04-pruebas.md` para planificar las siguientes.

**Decisión:**

- **Verificación local por fase:**
  - las fases **con cambios en `backend/`** (4, 5, 7 y 8) ejecutan en local las pruebas que tocan: `test:int --
    escalado`, `test:arch` y, en la fase 5, la suite completa;
  - las fases **sin código del backend** (0, 1, 2, 3 y 6) se verifican en local con sus pruebas de Node y del
    frontend, si lo tocan, y la suite completa del backend la verifica **la CI**;
  - la suite completa local solo se ejecuta en la fase 5 (SC-009) y en el cierre.
- **Estimación de horas de suite y medición por fase** (en el equipo del responsable; la CI aparte):

  | Fase | Local: pruebas | Local: mediciones | Total local aproximado | ¿Suite completa local? |
  | --- | --- | --- | --- | --- |
  | 0 | — | — | 0 h | No |
  | 1 · US3 | Node, unos minutos | Copia y semilla, unos 20 min | 0,5 h | No (la CI) |
  | 2 · US1 | Node | Humo y 3 escenarios (2 + 2 + 5 min, más preparación), unos 45 min | 1 h | No (la CI) |
  | 3 · US2 | Node y frontend (unos 5 min) | 5 corridas de E2E (unos 10 min cada una) y calidad web (unos 20 min) | 1,5 h | No (la CI) |
  | 4 · US4 | `escalado` (unos 15 min) y `test:arch` | PR03 y Lighthouse contra el 8080, unos 30 min | 1 h | No |
  | 5 · US6 | 11 pruebas solas × 3 (unas 1,5 h), 3 suites completas (3 × 77 min, unas 4 h) | Cobertura de integración aparte (unas 1,5 h, sin metas) | **7 h** (se puede dejar corriendo de noche) | Sí |
  | 6 · US5 | Node | Volumen (< 1 h), planes, pool y simulacro (unos 30 min) | 1,5 h | No (la CI) |
  | 7 · US7 | `escalado` y `test:arch` | Publicación y evidencia (con el responsable) | 1 h | No |
  | 8 · US8 | `escalado` y `test:arch` | Subdominio | 0,5 h | No |
  | 9 · Cierre | Suite completa (77 min) y frontend | — | 1,5 h | Sí |

  En total, unas 15,5 h de máquina en local, de ellas 7 en la fase 5. A eso se suma la espera de la CI de cada push
  (10 corridas, con la duración que se mida en la fase 1).
- **Esperar la CI en paralelo:** mientras corre la CI del push de la fase N, se puede **escribir** la fase N+1. No se
  hace push de N+1 hasta que N esté en verde.
  - Se permite trabajar en paralelo en: la 1 con la 2 (archivos distintos); la 2 con la 3; la 4 con la 5 (solo
    escribir las pruebas de la 5); la 6 con la 7 (solo la tarea de viabilidad del inicio de la 7, que casi no usa la máquina).
  - **Nunca** se ejecuta una medición (k6, Lighthouse, PR03, volumen) mientras corre una suite local o la copia de otra
    medición: comparten la CPU y las cifras saldrían falseadas.
  - Las 3 suites completas de la fase 5 no se superponen con ninguna medición.

**Por qué:** el plazo (unos 11 días) no admite la suite completa en cada fase. La CI ya la ejecuta en cada push, y
el local se concentra en lo que cambia.
