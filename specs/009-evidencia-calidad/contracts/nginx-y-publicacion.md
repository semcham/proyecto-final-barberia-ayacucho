# Contrato: Nginx, túnel y CI (US4, US7 y US8)

## 1. `server` 8080: interfaz de producción (US4)

El puerto del equipo es `${WEB_PUERTO:-8080}`. Nginx lo publica siempre, también en la demo de desarrollo, y sirve
403 o 404 mientras `frontend-dist` esté vacío. Si el puerto está ocupado, se cambia con `WEB_PUERTO` (README).

| Solicitud | Respuesta |
| --- | --- |
| `GET /assets/<archivo-con-hash>` | 200 con `Cache-Control: public, max-age=31536000, immutable` y gzip si se acepta |
| `GET /` o `GET /index.html` | 200 con `Cache-Control: no-cache` |
| `GET /app/agenda` (ruta de la aplicación, no es archivo) | 200 con `index.html` y `no-cache` |
| `GET /favicon.svg`, `/robots.txt` | 200 con caché corta |
| `/api/…` | Igual que el puerto 80 de hoy: mismo `upstream api`, mismas cabeceras de IP, tiempos y `@sin_servicio`. Por eso PR02 se cita de la medición de US1 y no se repite a través del 8080 |

## 2. `server` 8081: entrada del túnel (US7 y US8)

- Mismo comportamiento que el 8080, más lo siguiente:
  - `set_real_ip_from ${IP_CLOUDFLARED}` y `real_ip_header CF-Connecting-IP`. Solo se confía en esa cabecera cuando
    la conexión viene de `cloudflared` (`172.30.0.17` en `barberias-publicacion`).
  - `proxy_set_header X-Forwarded-For $remote_addr` (ya con la IP real) y `X-Forwarded-Proto https`.
- No se publica en el equipo.
- `server_name` acepta:
  - el raíz y `www` (`${DOMINIO_PUBLICO}` y `www.${DOMINIO_PUBLICO}`);
  - los reservados (con un nombre exacto): 301 a `https://${DOMINIO_PUBLICO}$request_uri`;
  - con US8, la expresión regular de slug:
    `~^(?![a-z0-9-]{64})(?<slug>[a-z0-9]+(-[a-z0-9]+)*)\.${DOMINIO_PUBLICO_REGEX}$`, que agrega
    `location = / { return 302 /b/$slug; }`.
- `docker-compose.publicacion.yml` define las variables de plantilla:
  - `DOMINIO_PUBLICO=ayacuchobarber.shop`;
  - `DOMINIO_PUBLICO_REGEX=ayacuchobarber\.shop`, con los puntos ya escapados, porque `envsubst` no escapa;
  - `IP_CLOUDFLARED`.

## 3. `cloudflared` (US7)

- Reglas de entrada en `publicacion/cloudflared/config.yml`: raíz, `www` y, con US8, `*`, todas hacia
  `http://nginx:8081`. Al final, `http_status:404`.
- Credenciales: el archivo `publicacion/secretos/tunel.json`, con **nombre fijo** y montado de solo lectura, no
  versionado. `config.yml` nunca contiene el UUID del túnel ni ningún identificador de cuenta o de zona, y la
  verificación de la fase lo comprueba.
- La forma de pasar el túnel sin versionar su identificador (por nombre con el archivo de credenciales, o por una
  variable de `publicacion/publicacion.env`) la decide la tarea de viabilidad del inicio de la fase 7.

**Tareas del responsable** (fuera del repositorio):
1. crear el túnel;
2. dejar el archivo de credenciales como `publicacion/secretos/tunel.json`;
3. crear en Cloudflare los registros DNS proxied (raíz, `www` y, con US8, `*`) hacia el túnel;
4. activar "Always Use HTTPS";
5. comprobar que el Universal SSL cubre el raíz y `*`.

## 3.1 Demo publicada: proyecto propio, red y cuentas

- Siempre corre como el proyecto de Compose `barberias-publicacion`, con volúmenes propios y separado del de
  desarrollo. No corre a la vez que la demo local.
- **Red propia:** `172.30.0.0/24`, con las variables de `publicacion/red-publicacion.env` (versionado y sin secretos):
  `RED_SUBRED`, `IP_NGINX`, `IP_BACKEND_1`, `IP_BACKEND_2`, `IP_BACKEND_3`, `IP_REDIS`, `IP_SIMULADOR`, `IP_MAILPIT`,
  `IP_WHATSAPP` e `IP_CLOUDFLARED`. `levantar` y `reiniciar-publicacion` las exportan en el entorno del shell, que tiene
  prioridad sobre el `.env` en la interpolación de Compose.
- **Cuentas:** los mismos correos `@ejemplo.test` de la semilla, con contraseñas **generadas al azar** por
  `cargar-semilla.mjs --modo publicacion`.
  - Se guardan solo en `publicacion/secretos/cuentas-publicadas.json` (no versionado).
  - El repositorio tiene solo `publicacion/cuentas-publicadas.example.json`, con marcadores:

    ```json
    { "generado": "<fecha ISO>", "cuentas": [ { "rol": "propietario", "barberia": "barberia-demo-centro", "correo": "propietario.centro@ejemplo.test", "contrasena": "<generada>" } ] }
    ```
- **Reinicio:** `semilla/reiniciar-publicacion.(sh|ps1)` recrea **solo** la base del proyecto publicado y vuelve a
  sembrar con contraseñas nuevas. La API no tiene ninguna ruta para cambiar la contraseña de una cuenta activa, y no
  se agrega (FR-001). Tampoco se usan roles de base de datos.
- **`.gitignore`** (fase de US7): `publicacion/publicacion.env`, `publicacion/secretos/` y `**/cuentas-publicadas.json`.
  El trabajo `herramientas` de la CI comprueba con `git check-ignore` que esas rutas siguen ignoradas y que los
  ejemplos no lo están.

## 4. CI (`.github/workflows/plataforma-barberias.yml`)

| Trabajo | Cuándo | Qué hace | Secretos |
| --- | --- | --- | --- |
| `backend` (existe) | push, pull_request | `npm test -- --coverage` en lugar de `npm test` y sube el resumen como artefacto | Ninguno |
| `frontend` (existe) | push, pull_request | `npm run test:cobertura` (`vitest run --coverage`) y sube el resumen | Ninguno |
| `herramientas` (nuevo; se crea en la fase 1 y cada fase lo amplía) | push, pull_request | `node --test` de `scripts/`, `semilla/`, `carga/`, `evidencia/scripts/` y `publicacion/`; Prettier y ESLint en las carpetas nuevas (sin `evidencia/` salvo `evidencia/scripts/`); `npm audit --audit-level=high` en `e2e/`; `revisar-secretos`; `git check-ignore` de las rutas secretas; y la comprobación de que `postgres` solo se usa como usuario en el simulacro | Ninguno |
| `e2e` (nuevo) | **solo `workflow_dispatch`** mientras dura la evaluación; se agrega a `push` en un cambio aparte solo si pasa 5 + 3 corridas | Crea `.env` con el script de US3, levanta Compose (base efímera del runner), carga la semilla y ejecuta Playwright; sube solo el informe JSON filtrado como artefacto | Ninguno |
| `artefacto-frontend` (nuevo, requiere la aclaración del principio XII) | `push` a `main`, `needs: [backend, frontend, herramientas]` | `npm ci && npm run build` en `frontend/`, escribe `version.json` y ejecuta `upload-artifact` (retención de 7 días) | Ninguno |
| `notificar_telegram` (existe) | Igual | `needs` agrega `herramientas` | Los de hoy |

Ningún trabajo despliega ni tiene credenciales de despliegue. El único acceso a base de datos es la base efímera que las
propias pruebas levantan y destruyen (Testcontainers y el Compose del trabajo `e2e`).

## 5. Actualizador del frontend (CD por extracción, pull-based, US7)

- Cada 5 minutos, con `GET /repos/{dueño}/{repo}/actions/runs?branch=main&event=push&status=success&per_page=1`,
  busca el artefacto `frontend-dist` de esa corrida.
- Si el SHA es nuevo:
  1. lo descarga;
  2. comprueba que el `version.json` coincide con el `head_sha` de la corrida;
  3. copia `assets/` (sin borrar los de las versiones de las últimas 24 h) y después `index.html` y `version.json`,
     de forma atómica.
- Registra cada publicación en `evidencia/despliegue/publicaciones.jsonl`: SHA, corrida, hora de fin de la CI, hora
  de publicación y segundos transcurridos (SC-010 se mide desde el fin de la corrida verde).
- Si falla, conserva la versión anterior y lo registra.
- **Sin token, o con un 401 o un 403:** registra el error (nunca el token), conserva la versión publicada y espera al
  siguiente sondeo. Tras 3 errores seguidos de autenticación, espera 1 hora entre intentos y lo registra una sola vez.
- El token (de grano fino, solo lectura de Actions y limitado a este repositorio) se lee de
  `publicacion/publicacion.env`.
