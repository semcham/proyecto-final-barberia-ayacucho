# Contrato del entorno: Docker Compose y balanceador

**Funcionalidad**: [spec.md](../spec.md) · **Decisiones**: [research.md](../research.md) R01, R02, R04 y R12

Describe lo que el entorno local garantiza a quien lo usa (desarrollo, demos, medición y la prueba
`balanceador`). La implementación está en `tecnologia/plataforma-barberias/docker-compose.yml` y en
`tecnologia/plataforma-barberias/nginx/templates/default.conf.template`.

## 1. Servicios

| Servicio           | Imagen              | Red (`plataforma`, 172.28.0.0/24) | Puerto en el equipo                    | Memoria                                                   | Arranca cuando                                               | Comprobación de salud                                                                 |
| ------------------ | ------------------- | --------------------------------- | -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `db`               | `postgres:16`       | dinámica                          | `${DB_PUERTO:-5433}`                   | 512 MB                                                    | —                                                            | `pg_isready` (como hoy)                                                               |
| `redis`            | `redis:7.4-alpine`  | dinámica                          | `${REDIS_PUERTO:-6380}` (para depurar) | 64 MB (`maxmemory 48mb`, `allkeys-lru`, sin persistencia) | —                                                            | `redis-cli ping`                                                                      |
| `preparar-backend` | `node:22`           | dinámica                          | —                                      | 1 GB                                                      | `db` sana                                                    | Es de una sola ejecución: `npm ci && npm run build && npm run migrate`; termina con 0 |
| `backend-1`        | `node:22`           | 172.28.0.11                       | — (sin publicar)                       | 384 MB                                                    | `preparar-backend` terminó bien; `db` sana; `redis` iniciado | `GET /api/v1/salud/listo` cada 5 s                                                    |
| `backend-2`        | `node:22`           | 172.28.0.12                       | — (sin publicar)                       | 384 MB                                                    | Igual que `backend-1`                                        | Igual que `backend-1`                                                                 |
| `nginx`            | `nginx:1.27-alpine` | 172.28.0.10                       | `3000` → 80                            | 32 MB                                                     | `backend-1` y `backend-2` sanas                              | `GET /nginx-salud`                                                                    |
| `frontend`         | `node:22`           | dinámica                          | `5173`                                 | 512 MB                                                    | `nginx` iniciado                                             | —                                                                                     |

- **Variables comunes de las réplicas** (ancla `x-backend`): `.env`, más `DATABASE_URL_*` hacia
  `db:5432`, `REDIS_URL=redis://redis:6379`, `PROXIES_CONFIABLES=172.28.0.10`,
  `NODE_ENV=production`, `NODE_OPTIONS=--max-old-space-size=256`, y además:
  - `CACHE_CATALOGO_ACTIVA=${CACHE_CATALOGO_ACTIVA:-true}`;
  - `PUBLICO_LIMITE_POR_MINUTO=${PUBLICO_LIMITE_POR_MINUTO:-120}`.
- **Variable propia de cada réplica:** `INSTANCIA_ID` (`backend-1` o `backend-2`).
- **Frontend:** `VITE_API_PROXY=http://nginx:80`.
- **Subred:** si choca con otra red del equipo, se cambia en un solo lugar (`.env`:
  `RED_SUBRED`, `IP_NGINX`, `IP_BACKEND_1`, `IP_BACKEND_2`) y `PROXIES_CONFIABLES` toma `IP_NGINX`.

## 2. Comportamiento garantizado del balanceador

| Aspecto                | Garantía                                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reparto                | Por turnos entre `backend-1` y `backend-2` (`/api/` → `upstream api`)                                                                                                                                                                        |
| Réplica caída          | Pasiva: `max_fails=1`, `fail_timeout=10s`, `proxy_connect_timeout 1s`. Las solicitudes idempotentes (GET, HEAD) se reintentan una vez en la otra réplica (`proxy_next_upstream error timeout http_502 http_503`); las no idempotentes, nunca |
| Reincorporación        | Automática: pasado `fail_timeout`, una solicitud de prueba; si responde, vuelve al reparto                                                                                                                                                   |
| IP del cliente         | `X-Forwarded-For` y `X-Real-IP` **sobrescritos** con `$remote_addr`; lo que envía el cliente se descarta                                                                                                                                     |
| Cuerpo                 | `client_max_body_size 16k` (igual que el backend)                                                                                                                                                                                            |
| Tiempos                | `proxy_read_timeout 30s`; `keepalive 16` hacia las réplicas                                                                                                                                                                                  |
| Sin réplicas           | 503 JSON `SERVICIO_NO_DISPONIBLE` con `Retry-After: 5` (ver [openapi.yaml](openapi.yaml)) en menos de 3 s                                                                                                                                    |
| Encabezados            | `X-Instancia` del backend pasa sin cambios; Nginx no agrega `Server` con versión (`server_tokens off`)                                                                                                                                       |
| Rutas fuera de `/api/` | 404 (el frontend lo sirve Vite en el puerto 5173)                                                                                                                                                                                            |

## 3. Plantilla de Nginx

`nginx/templates/default.conf.template` usa las variables `BACKEND_1` y `BACKEND_2` (`host:puerto`),
que la imagen oficial sustituye al arrancar (`envsubst`).

- **En Compose:** `172.28.0.11:3000` y `172.28.0.12:3000`.
- **En la prueba `balanceador`:** `host.testcontainers.internal:{puerto}` de cada instancia en
  proceso.

La prueba usa **la misma plantilla**, así lo que se prueba es lo que se ejecuta.

## 4. Comandos documentados

| Para                                    | Comando (en `tecnologia/plataforma-barberias/`)                                |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| Levantar todo                           | `docker compose up -d`                                                         |
| Aplicar un cambio de código del backend | `docker compose up -d --force-recreate preparar-backend backend-1 backend-2`   |
| Detener o reiniciar una réplica (demo)  | `docker compose stop backend-2` · `docker compose start backend-2`             |
| Detener o reiniciar Redis (demo)        | `docker compose stop redis` · `docker compose start redis`                     |
| Medir sin caché                         | `$env:CACHE_CATALOGO_ACTIVA='false'; docker compose up -d backend-1 backend-2` |
| Ver qué réplica respondió               | `curl.exe -si http://localhost:3000/api/v1/salud` → encabezado `X-Instancia`   |
| Uso de memoria                          | `docker stats --no-stream`                                                     |
