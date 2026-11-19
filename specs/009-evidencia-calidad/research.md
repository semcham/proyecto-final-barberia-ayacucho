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

El formato está en [data-model.md](data-model.md) y en [contracts/evidencia.md](contracts/evidencia.md).

**Por qué:** FR-004 exige que cada cifra tenga fecha, comando, configuración y equipo. Una sola raíz facilita
enlazarla desde `docs/` (SC-002: el 100 % de las cifras citadas tienen su archivo). Está dentro de
`tecnologia/plataforma-barberias/` (principio XII).

**Alternativas:**
- `carga/resultados/` junto a los scripts: obligaría a seis lugares distintos.
- `docs/evidencia/`: `docs/` es para documentación y no para salidas de herramientas.

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
    guardar ni imprimir ningún valor, e informa qué nombres de `.env.example` le faltan.
  - Nunca imprime un secreto completo: solo dice "generada".
- **Pruebas:** una prueba de Node (`node --test`, sin dependencias) ejecuta el `.mjs` en un directorio temporal y
  comprueba lo siguiente:
  - crea el archivo con claves que firman y verifican un JWT;
  - un `.env` que ya existe queda idéntico byte a byte (por hash) y la salida no contiene ningún valor;
  - las dos sales son distintas.

  La prueba corre en el CI. Los dos envoltorios se prueban a mano en Linux y en Windows (tarea del responsable o
  manual, SC-001).

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
  una sola vez.
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
    - si no, con `vite build` y `vite preview`, que usa el mismo proxy de `/api`.
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
- **Prueba existente:** la prueba `balanceador` copia **solo** `default.conf.template`, así que no ve la plantilla
  nueva.
- **Tercera instancia (PR03):**
  - `backend-3` (IP fija `172.28.0.18`) con el perfil `escalado`.
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
    4. escribe `server 172.28.0.18:3000 …;` en `upstream-extra/`;
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
    `log_buffers=on` y `log_format=json`;
  - mientras corren los escenarios de k6 (con poca carga) y los recorridos que tocan las consultas críticas,
    PostgreSQL registra el plan **de las consultas que de verdad envía la aplicación**;
  - `evidencia/scripts/extraer-planes` filtra en el registro las de horarios libres, agenda, reserva, reportes e
    indicadores, y guarda cada plan con el índice usado (FR-024).
  - Por el costo de `log_analyze`, esa ejecución **nunca** se usa para las cifras de US1.
- **Volumen mayor:**
  - `semilla/volumen.mjs` genera por la API barberías `volumen-*`, como el de `indicadores-plataforma` pero
    **diez veces mayor en citas**: 520 000 citas en total, frente a las 52 000 de la prueba.
  - Si por la API tarda demasiado (se mide con una muestra), el plan permite una variante con `COPY` desde un
    script con el rol `barberias_app` y el tenant fijado por barbería (`SET LOCAL`), nunca con `BYPASSRLS`. La
    decisión se toma en la fase y queda escrita.
  - Las consultas críticas se miden con k6 (escenarios de US1 apuntando a una barbería grande) y con los planes de
    arriba (FR-026).
- **Pool** (FR-025): se documentan los pools configurados (`DB_POOL_APP_MAX`, `DB_POOL_PUBLICO_MAX`, plataforma y
  dueño) y la fórmula `N × Σ pools + migraciones + reserva ≤ max_connections (100)`. Se calcula para 2 y 3
  instancias y se mide `pg_stat_activity` durante la carga.
- **Simulacro PR22** (FR-027), con `evidencia/scripts/simulacro-respaldo.(sh|ps1)`:
  1. `pg_dump -Fc` de la base de la demo, con el superusuario del contenedor, desde el propio contenedor `db`;
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
  - Servicio de Compose con el perfil `publicacion`, IP fija `172.28.0.17`.
  - **Gestionado localmente:** las reglas de entrada se versionan en `publicacion/cloudflared/config.yml`.
    `ayacuchobarber.shop` y `www.ayacuchobarber.shop` van a `http://nginx:8081`. Con US8 se agrega
    `*.ayacuchobarber.shop` hacia el mismo destino, y al final va el `http_status:404`.
  - El **archivo de credenciales del túnel** (contiene el secreto) vive **fuera del repositorio**, en la carpeta
    `publicacion/secretos/`, que el `.gitignore` excluye.
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
  - Una prueba del CI (en el trabajo `preparar-entorno`) ejecuta `git check-ignore` sobre esas rutas y falla si
    alguna dejara de estar ignorada.
  - No se usa el nombre `.env.publicacion`, porque la regla actual `.env.*` lo ocultaría y también ocultaría su
    ejemplo.
- **Nginx para el túnel:**
  - plantilla nueva `nginx/templates/publicacion.conf.template`, puerto 8081, **sin publicar en el equipo** (solo
    lo alcanza `cloudflared` dentro de la red);
  - sirve `frontend-dist` como el 8080 y reenvía `/api/` al `upstream api`;
  - con el módulo `real_ip`: `set_real_ip_from 172.28.0.17; real_ip_header CF-Connecting-IP;`.
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
    5173) y la subred, y el equipo tiene 8 GB. Los scripts de la publicación lo comprueban antes de arrancar.
  - Las mediciones de US1, US4 y US5 se hacen siempre sobre la demo local, nunca sobre la publicada.
- **Cuentas de la demo publicada:** contraseñas al azar en `publicacion/secretos/cuentas-publicadas.json`, no
  versionado (R04). El sitio, el README y `docs/` nunca las muestran. El responsable las comparte por su cuenta con
  quien evalúa.
- **Configuración de la publicación:** `docker-compose.publicacion.yml` sobrescribe en las réplicas solo valores no
  secretos: `CORS_ORIGIN`, `FRONTEND_BASE_URL`, `URL_PUBLICA` y `PAGOS_URL_RETORNO`, con
  `https://ayacuchobarber.shop`. `environment` tiene prioridad sobre `env_file`, así que no se toca el `.env`.
- **CD por extracción:**
  1. La CI agrega el trabajo `artefacto-frontend`: `needs: [backend, frontend]`, solo `push` a `main`; ejecuta
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
  - Una **prueba de arquitectura** nueva en `test/architecture/` falla si `backend/src` llega a leer `req.hostname`,
    `req.host`, `headers.host` o `x-forwarded-host`, para que no se pueda volver dependiente del host sin que el CI
    lo detecte.
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
   queda como alternativa descartada (R09).
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
4. el commit y el push del responsable;
5. la CI en verde.

La fase 9 solo cambia estados y totales.

**Por qué:** cumple FR-005 y la condición del responsable de "un commit por fase".
