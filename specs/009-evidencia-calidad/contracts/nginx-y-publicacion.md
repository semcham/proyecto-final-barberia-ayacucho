# Contrato: Nginx, túnel y CI (US4, US7 y US8)

## 1. `server` 8080: interfaz de producción (US4)

| Solicitud | Respuesta |
| --- | --- |
| `GET /assets/<archivo-con-hash>` | 200 con `Cache-Control: public, max-age=31536000, immutable` y gzip si se acepta |
| `GET /` o `GET /index.html` | 200 con `Cache-Control: no-cache` |
| `GET /app/agenda` (ruta de la aplicación, no es archivo) | 200 con `index.html` y `no-cache` |
| `GET /favicon.svg`, `/robots.txt` | 200 con caché corta |
| `/api/…` | Igual que el puerto 80 de hoy: mismo `upstream api`, mismas cabeceras de IP, tiempos y `@sin_servicio` |

## 2. `server` 8081: entrada del túnel (US7 y US8)

- Mismo comportamiento que el 8080, más lo siguiente:
  - `set_real_ip_from <IP_CLOUDFLARED>` y `real_ip_header CF-Connecting-IP`. Solo se confía en esa cabecera cuando
    la conexión viene de `cloudflared`.
  - `proxy_set_header X-Forwarded-For $remote_addr` (ya con la IP real) y `X-Forwarded-Proto https`.
- No se publica en el equipo.
- `server_name` acepta:
  - el raíz y `www`;
  - los reservados (con un nombre exacto): 301 a `https://ayacuchobarber.shop$request_uri`;
  - con US8, la expresión regular de slug, que agrega `location = / { return 302 /b/$slug; }`.
- El nombre del dominio entra como variable de plantilla (`DOMINIO_PUBLICO`), con el valor por defecto
  `ayacuchobarber.shop` en `docker-compose.publicacion.yml`.

## 3. `cloudflared` (US7)

- Reglas de entrada en `publicacion/cloudflared/config.yml`: raíz, `www` y, con US8, `*`, todas hacia
  `http://nginx:8081`. Al final, `http_status:404`.
- Credenciales: un archivo montado de solo lectura desde `publicacion/secretos/`, no versionado.

**Tareas del responsable** (fuera del repositorio):
1. crear el túnel;
2. dejar el archivo de credenciales;
3. crear en Cloudflare los registros DNS proxied (raíz, `www` y, con US8, `*`) hacia el túnel;
4. activar "Always Use HTTPS";
5. comprobar que el Universal SSL cubre el raíz y `*`.

## 3.1 Demo publicada: proyecto propio y cuentas

- Siempre corre como el proyecto de Compose `barberias-publicacion`, con volúmenes propios y separado del de
  desarrollo. No corre a la vez que la demo local.
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
  El trabajo `preparar-entorno` del CI comprueba con `git check-ignore` que esas rutas siguen ignoradas y que el
  ejemplo no lo está.

## 4. CI (`.github/workflows/plataforma-barberias.yml`)

| Trabajo | Cuándo | Qué hace | Secretos |
| --- | --- | --- | --- |
| `backend` (existe) | push, pull_request | Agrega `npm test -- --coverage` en lugar de `npm test` y sube el resumen como artefacto | Ninguno |
| `frontend` (existe) | push, pull_request | Agrega `vitest run --coverage` y sube el resumen | Ninguno |
| `preparar-entorno` (nuevo, pequeño) | push, pull_request | `node --test scripts/preparar-entorno.test.mjs` y la comprobación `git check-ignore` de las rutas secretas de `publicacion/` | Ninguno |
| `e2e` (nuevo) | **solo `workflow_dispatch`** mientras dura la evaluación; se agrega a `push` en un cambio aparte solo si pasa 5 + 3 corridas | Crea `.env` con el script de US3, levanta Compose, carga la semilla y ejecuta Playwright; sube el informe | Ninguno |
| `artefacto-frontend` (nuevo, requiere la aclaración del principio XII) | `push` a `main`, `needs: [backend, frontend, preparar-entorno]` | `npm ci && npm run build` en `frontend/`, escribe `version.json` y ejecuta `upload-artifact` (retención de 7 días) | Ninguno |
| `notificar_telegram` (existe) | Igual | Sin cambios | Los de hoy |

Ningún trabajo despliega, tiene credenciales de despliegue ni accede a una base de datos.

## 5. Actualizador del frontend (CD por extracción, US7)

- Cada 5 minutos, con `GET /repos/{dueño}/{repo}/actions/runs?branch=main&event=push&status=success&per_page=1`,
  busca el artefacto `frontend-dist` de esa corrida.
- Si el SHA es nuevo:
  1. lo descarga;
  2. comprueba que el `version.json` coincide con el `head_sha` de la corrida;
  3. copia `assets/` (sin borrar los de las versiones de las últimas 24 h) y después `index.html` y `version.json`,
     de forma atómica.
- Registra cada publicación en `evidencia/despliegue/publicaciones.jsonl`: SHA, corrida, hora de fin de la CI, hora
  de publicación y segundos transcurridos.
- Si falla, conserva la versión anterior y lo registra.
- El token (de grano fino, solo lectura de Actions en el repositorio) se lee de `publicacion/publicacion.env`.
