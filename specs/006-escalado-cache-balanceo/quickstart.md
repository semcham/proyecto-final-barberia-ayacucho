# Guía de validación: Escalabilidad y rendimiento de la plataforma

**Funcionalidad**: [spec.md](spec.md) · **Entorno**: [contracts/entorno-compose.md](contracts/entorno-compose.md) ·
**Claves de caché**: [contracts/cache-claves.md](contracts/cache-claves.md) · **Datos**: [data-model.md](data-model.md)

Comprueba de punta a punta que la funcionalidad cumple la especificación. Parte del entorno de 002
([quickstart de 002](../002-catalogo-citas-cliente/quickstart.md)).

## 1. Preparación

1. **Docker Desktop** con al menos 3 GB asignados a WSL 2 (equipo de 8 GB). Docker guarda sus
   imágenes en D:. Las imágenes nuevas, `nginx:1.27-alpine` y `redis:7.4-alpine`, se descargan ahí.
2. **Variables nuevas** en `.env` (copiar de `.env.example`): `REDIS_URL`, `CACHE_*`,
   `PROXIES_CONFIABLES` e `INSTANCIA_ID` ([data-model.md](data-model.md) §4). Compose fija las de
   las réplicas; no hace falta editarlas para el uso normal.
3. **Levantar todo:**

   ```powershell
   cd tecnologia/plataforma-barberias
   docker compose up -d
   docker compose ps     # preparar-backend "exited (0)"; backend-1, backend-2 y nginx "healthy"
   ```

4. **Esperado:**
   - la migración `0013` aparece aplicada una sola vez en `docker compose logs preparar-backend`;
   - `http://localhost:3000/api/v1/salud/listo` responde `{"estado":"listo"}`;
   - la aplicación funciona en `http://localhost:5173`.

## 2. Pruebas automáticas (deben quedar en verde, también en CI)

```powershell
cd tecnologia/plataforma-barberias/backend
npm test           # claves-cache, interruptor, almacen-limites, entrada-catalogo
npm run test:int   # Testcontainers (PostgreSQL, Redis y Nginx)
npm run test:arch  # PR14 con la regla redis-confinado
cd ../frontend
npx vitest run --maxWorkers=1 --minWorkers=1   # incluye el mensaje SERVICIO_NO_DISPONIBLE
```

| Prueba                     | Qué demuestra                                                                                                                                                                                                                                                                                                                               | Resultado esperado                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `cache-catalogo`           | Acierto y fallo; invalidación por cada fila de la matriz, vista desde la otra instancia; cambio revertido; carrera de lectura e invalidación; TTL                                                                                                                                                                                           | Todo en verde                            |
| `aislamiento-cache` (PR09) | Claves con el tenant de su dueña; sin datos canario en Redis; nombres iguales en dos barberías; enlace reutilizado por otra barbería                                                                                                                                                                                                        | 0 fugas                                  |
| `limite-compartido`        | N aceptadas en total con dos instancias; otra IP no afectada; respaldo por instancia sin Redis; intentos de inicio de sesión sin claves en Redis                                                                                                                                                                                            | Todo en verde                            |
| `redis-caido` (PR05)       | Redis detenido: catálogo, horarios y reservas correctos; una sola alerta; recuperación sin reiniciar                                                                                                                                                                                                                                        | Todo en verde                            |
| `salud-listo`              | 503 antes de migrar y 200 después; dos migraciones en paralelo aplican cada una una vez                                                                                                                                                                                                                                                     | Todo en verde                            |
| `balanceador`              | Reparto entre réplicas; sesión entre instancias; `X-Forwarded-For` falso ignorado; **PR16 a través de Nginx**. La caída de una réplica (PR04) y el 503 sin réplicas se verifican con Docker Compose (§4.1 y §6): por el túnel de Testcontainers una instancia caída no se comporta como en el entorno real ([research.md](research.md) R15) | 1 × 201, 199 × 409 y 0 × 5xx             |
| Suites de 001 y 002        | Sin regresiones                                                                                                                                                                                                                                                                                                                             | Mismos totales que en 002 más las nuevas |

## 3. Recorrido manual con el entorno real

1. **Reparto.**

   ```powershell
   1..6 | % { (Invoke-WebRequest http://localhost:3000/api/v1/salud).Headers['X-Instancia'] }
   ```

   **Esperado:** aparecen `backend-1` y `backend-2`.

2. **Caché del catálogo.**
   - Abrir `http://localhost:5173/b/<slug>` dos veces.
   - Ver las claves con `docker compose exec redis redis-cli --scan --pattern 'bp:v1:*'`.
   - **Esperado:** `bp:v1:t:<uuid-de-la-barbería>:catalogo-publico` y su `:gen`; ninguna clave con
     el `slug`.
3. **Invalidación.**
   - Como propietario, cambiar el precio de un servicio.
   - Recargar la página pública varias veces, de modo que la atiendan ambas réplicas.
   - **Esperado:** el precio nuevo aparece en la primera recarga y en todas las siguientes.
4. **Cambio de enlace.**
   - Cambiar el enlace en **Barbería**.
   - **Esperado:** el enlace nuevo muestra el catálogo y el anterior, "barbería no disponible", desde
     la primera visita.
5. **IP falsa.**

   ```powershell
   curl.exe -s -H "X-Forwarded-For: 203.0.113.9" http://localhost:3000/api/v1/publico/<slug>
   ```

   **Esperado:** la IP registrada (auditoría o registros de la réplica) no es `203.0.113.9`.

6. **Sin réplicas.**
   - `docker compose stop backend-1 backend-2` y abrir la página pública.
   - **Esperado:** 503 `SERVICIO_NO_DISPONIBLE` y el mensaje en la interfaz.
   - `docker compose up -d --no-deps backend-1 backend-2` para volver (sin `--no-deps`, Compose repite `preparar-backend`).

## 4. Demos y prueba de carga (fuera de CI)

Todas desde `tecnologia/plataforma-barberias/backend`, con el entorno levantado. Los archivos de
resultados van a `tmp/`, que se borra al terminar.

### 4.1 Caída de una réplica (PR04, EQ-04)

```powershell
npm run demo:caida -- --objetivo replica
```

- **Qué hace:** tráfico continuo por Nginx durante 60 s; a los 15 s, `docker compose stop backend-2`;
  a los 40 s, `docker compose up -d --no-deps backend-2`.
- **Esperado:** `backend-2` deja de recibir solicitudes en 15 s o menos; como máximo el 2 % de
  errores en la transición y 0 % después; vuelve a recibir tráfico tras volver a levantarla.
- **A mano (línea de corte 2):** los mismos dos comandos `docker compose` en otra terminal, con el
  tráfico corriendo.

### 4.2 Caída de Redis (PR05, EQ-05)

```powershell
npm run demo:caida -- --objetivo redis
```

- **Esperado:** p95 de lecturas de 2 s o menos durante la caída; 0 reservas duplicadas (comprobado
  en la base); una línea `CACHE_NO_DISPONIBLE` en `docker compose logs backend-1`; al volver Redis,
  `CACHE_RECUPERADA` y de nuevo claves `bp:v1:*`.

### 4.3 Prueba de carga de horarios libres (PR01, EQ-01)

Se sube el límite de la vía pública solo para la medición: todas las solicitudes del equipo
comparten IP detrás de Docker Desktop.

```powershell
cd ..
$env:PUBLICO_LIMITE_POR_MINUTO = '100000'
# Variante A: 1 réplica, sin caché
$env:CACHE_CATALOGO_ACTIVA = 'false'; docker compose up -d --no-deps backend-1 backend-2; docker compose stop backend-2
cd backend; npm run medir:horarios -- --etiqueta A-1r-sin-cache --salida ../../../tmp/medicion-A.json; cd ..
# Variante B: 1 réplica, con caché
$env:CACHE_CATALOGO_ACTIVA = 'true'; docker compose up -d --no-deps backend-1; docker compose stop backend-2
cd backend; npm run medir:horarios -- --etiqueta B-1r-con-cache --salida ../../../tmp/medicion-B.json; cd ..
# Variante C: 2 réplicas, sin caché
$env:CACHE_CATALOGO_ACTIVA = 'false'; docker compose up -d --no-deps backend-1 backend-2
cd backend; npm run medir:horarios -- --etiqueta C-2r-sin-cache --salida ../../../tmp/medicion-C.json; cd ..
# Variante D: 2 réplicas, con caché
$env:CACHE_CATALOGO_ACTIVA = 'true'; docker compose up -d --no-deps backend-1 backend-2
cd backend; npm run medir:horarios -- --etiqueta D-2r-con-cache --salida ../../../tmp/medicion-D.json
```

- **Repetir cada variante dos veces** y registrar ambas ejecuciones.
- **En B y D** el script hace una precarga (`GET /publico/{slug}`) antes de las rondas. **En A y C**
  los horarios usan la fuente completa en una transacción ([research.md](research.md) R07 y R13).
- **Esperado:** la variante D cumple p95 ≤ 800 ms con 0 % de 5xx (SC-001).
- **Si D no la cumple:** se evalúa FR-013b (`CACHE_HORARIOS_ACTIVA=true`, [research.md](research.md)
  R10), se mide una variante E y se registran D y E.
- **Al terminar:** quitar las variables de la sesión (`Remove-Item Env:PUBLICO_LIMITE_POR_MINUTO,
Env:CACHE_CATALOGO_ACTIVA`), ejecutar `docker compose up -d` para volver a los valores normales y
  borrar `tmp/`.

## 5. Criterios de éxito y dónde se miden

| SC     | Medición                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------ |
| SC-001 | §4.3, variantes A–D (y E si hace falta)                                                          |
| SC-002 | §4.1 y §6 con Docker Compose (por el túnel de Testcontainers la caída no es representativa, R15) |
| SC-003 | `cache-catalogo` (matriz desde la otra instancia) y §3.3–3.4                                     |
| SC-004 | `aislamiento-cache` (PR09)                                                                       |
| SC-005 | `redis-caido` (CI) y §4.2                                                                        |
| SC-006 | `limite-compartido`                                                                              |
| SC-007 | `balanceador` (PR16 por Nginx)                                                                   |
| SC-008 | §1                                                                                               |
| SC-009 | §6                                                                                               |

## 6. Registro de ejecuciones

### 2026-10-22 · US1 con Docker Compose (T028; PR04 y FR-007)

Equipo de desarrollo: Windows 11, 8 GB de RAM, 8 procesadores lógicos, Docker Desktop 29.8 (WSL 2).
Entorno levantado con `docker compose up -d` (dos réplicas, Nginx, Redis, PostgreSQL y frontend). Las
mediciones se hicieron con un script temporal de tráfico (el definitivo es `demo:caida`, T047).

| Comprobación                                | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Arranque                                    | `preparar-backend` termina con 0; réplicas y Nginx `healthy`; `/salud/listo` 200; la interfaz en 5173 y la API a través de Vite pasan por Nginx                                                                                                                                                                                                                                                                                                                          |
| Reparto                                     | 6 solicitudes seguidas: `backend-1`, `backend-2`, alternadas                                                                                                                                                                                                                                                                                                                                                                                                             |
| Memoria estable                             | Réplicas 40–49 MB, Nginx 3 MB, Redis 4–11 MB, PostgreSQL 23–27 MB, Vite 136–149 MB (unos 260 MB en total, muy por debajo de los límites)                                                                                                                                                                                                                                                                                                                                 |
| **Caída de una réplica con tráfico (PR04)** | 20 solicitudes por segundo durante 60 s; `docker compose stop -t 1 backend-2` a los 15 s. Durante la caída, **0 errores en 514 solicitudes**; `backend-2` dejó de recibir tráfico **3,2 s** después de la orden (lo que tarda en detenerse). Tras `docker compose up -d --no-deps backend-2` volvió a recibir tráfico a los **17,8 s** (arranque de unos 14 s más la reincorporación), con **0 errores en 1 251 solicitudes**. Meta de SC-002 (≤ 15 s y ≤ 2 %): cumplida |
| **Sin réplicas (FR-007)**                   | Con las dos detenidas: **503** `SERVICIO_NO_DISPONIBLE` en **2,4 s** (dos intentos con `proxy_connect_timeout 1s` hacia IP de contenedores detenidos), con `Retry-After: 5` y `application/json`. Meta (< 3 s): cumplida                                                                                                                                                                                                                                                 |
| **IP falsa (FR-006)**                       | 300 solicitudes a la vía pública, cada una con un `X-Forwarded-For` distinto: 240 aceptadas (120 por réplica, límite todavía por instancia hasta US3) y **60 × 429**. Si el encabezado falso se aceptara, cada solicitud contaría como otra IP y no habría ningún 429                                                                                                                                                                                                    |
| Arranque sin Redis                          | Con `redis` detenido, las dos réplicas recreadas quedaron `healthy` y `/salud/listo` respondió 200                                                                                                                                                                                                                                                                                                                                                                       |

**Ajustes que salieron de esta verificación** (ya aplicados en `docker-compose.yml`, en la plantilla de
Nginx y en [research.md](research.md) R01 y R02):

1. **Las réplicas leen el build de un volumen de Docker** (`backend-dist`), no de la carpeta del equipo:
   desde la carpeta montada, un arranque tardó más de 2 minutos; ahora, unos 14 s.
2. **`max_fails=3` en lugar de 1:** con 1, mientras una réplica arrancaba con el equipo cargado, un único
   fallo pasajero de la otra dejó a Nginx sin réplicas y respondió 503 durante 10 s (335 errores en una
   corrida). Con 3, la corrida de la tabla dio 0 errores.
3. **`start_period` de 60 s y 5 reintentos** en el healthcheck: con 20 s y 3, el primer arranque se
   marcó como fallido.
4. **Reiniciar réplicas siempre con `--no-deps`:** `docker compose start backend-2` volvió a ejecutar
   `preparar-backend` (unos 2 minutos de `npm ci` y build) y reescribió `node_modules` con la otra réplica
   en marcha.

**PR16 a través de Nginx** se verifica en CI (`balanceador.spec.ts`): 1 × 201, 199 × 409
`HORARIO_NO_DISPONIBLE`, 0 × 5xx y 1 cita activa, repartidas entre las dos instancias (3 corridas
iguales).

### 2026-10-24 · US4 con Docker Compose (T047; PR05)

Mismo equipo. Entorno con `$env:PUBLICO_LIMITE_POR_MINUTO='100000'; docker compose up -d` y el frontend
detenido. Tráfico con `npm run demo:caida` (unas 17 solicitudes por segundo por Nginx, catálogo y horarios).

| Comprobación                                        | Resultado                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Redis detenido con tráfico** (`--objetivo redis`) | `docker compose stop redis` a los 15 s y `up -d --no-deps redis` a los 40 s: **0 errores en 1 010 solicitudes** (0 en los 10 s de la transición). p95 durante la caída **962 ms**, todo desde PostgreSQL (meta de §4.2: ≤ 2 s); p95 de la corrida, 567 ms |
| **Reservas durante la caída**                       | 20 reservas, cada una enviada dos veces con la misma `Idempotency-Key`: 20 × 201 y 20 × 200 con la misma cita; en la base **20 citas y 0 solapadas**                                                                                                      |
| **Alerta y recuperación**                           | En cada caída, **una** línea `CACHE_NO_DISPONIBLE` y **una** `CACHE_RECUPERADA` por réplica (tres caídas: dos corridas y la pausa); al volver Redis, de nuevo claves `bp:v1:*` sin reiniciar las réplicas                                                 |
| **Redis lento** (`docker pause`)                    | Catálogo por Nginx: las primeras lecturas tardan 0,86, 0,49, 0,28 y 0,23 s (tiempos límite de 100 ms hasta 5 fallos), y luego 16–28 ms con el interruptor abierto, todas 200. Tras `docker unpause` y la pausa de 10 s, se recupera                       |
| Caída de una réplica (`--objetivo replica`)         | 0 errores en 980 solicitudes; `backend-2` volvió al reparto 13,7 s después de iniciarlo                                                                                                                                                                   |
| Memoria                                             | Réplicas 52–66 MB, PostgreSQL 57 MB, Redis 4 MB, Nginx 5 MB                                                                                                                                                                                               |

**Ojo con las variables:** `docker compose up -d --no-deps backend-2`, que ejecuta el script, toma las
variables de la terminal desde la que se lanzó `npm run demo:caida`. Si `PUBLICO_LIMITE_POR_MINUTO` no está
fijada ahí, la réplica vuelve con el límite de 120 y aparecen 429 (el script lo avisa). Fijarla en la misma
terminal antes de lanzar la demostración.

### Pendiente (fuera del alcance de 006)

- **EQ-02 / PR02 · carga de reservas** (20 por segundo durante 5 min, p95 ≤ 1 500 ms): no se mide en
  esta funcionalidad.
- **EQ-03 / PR03 · escalado de una a dos instancias** (throughput ≥ 1,6×, 0 solicitudes perdidas):
  no se mide en esta funcionalidad. En un solo equipo las réplicas comparten CPU, así que la medida
  no sería representativa.
