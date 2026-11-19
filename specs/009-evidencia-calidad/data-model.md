# Data Model: Evidencia de calidad y despliegue (009)

009 **no agrega tablas, columnas, migraciones, roles ni políticas** a la base de datos. Las "entidades" de la spec
son archivos versionados (evidencia y configuración) y datos que se crean **por la API pública**, como haría un
usuario.

## 1. Resultado de medición (archivos en `evidencia/`)

Ruta: `tecnologia/plataforma-barberias/evidencia/<tipo>/<AAAA-MM-DD-HHMM>-<nombre>/`.

| Archivo | Contenido | Quién lo escribe |
| --- | --- | --- |
| `entorno.json` | Ver el esquema abajo | El script de la medición, nunca a mano |
| `crudo.*` | Salida completa de la herramienta: `summary.json` de k6, informe de axe, JSON de Lighthouse, `coverage-summary.json`, planes JSON y registro del simulacro | La herramienta |
| `resumen.md` | Tabla con la cifra, la meta, "cumple" o "no cumple" y las notas (por ejemplo, "réplicas comparten CPU") | Generado a partir de `crudo.*` |

`entorno.json`:

```json
{
  "fecha": "ISO 8601 con zona",
  "comando": "línea exacta ejecutada",
  "git": { "sha": "…", "sucio": false },
  "equipo": { "cpu": "…", "nucleos": 0, "memoriaGB": 0, "cargaPromedio": [0, 0, 0], "so": "…" },
  "herramienta": { "nombre": "k6 | playwright | lighthouse | axe | jest | vitest | pg_dump", "version": "…", "imagen": "…:etiqueta" },
  "configuracion": { "VARIABLE_DE_LISTA_BLANCA": "valor" },
  "objetivo": "nginx:80 | nginx:8080 | vite-preview | dominio publicado"
}
```

**Reglas:**

- `configuracion` solo contiene variables de una **lista blanca** sin secretos, leídas con `printenv <VAR>` desde el
  contenedor: réplicas, límites de solicitudes, caché, tamaño de los pools, `IA_PROVEEDOR` e `IA_FALSO_MODO`. Nunca
  contiene llaves, sales, contraseñas, tokens ni el contenido del `.env`.
- Un resultado no se edita después de generarse. Si se repite una medición, se guarda **otra carpeta**, y el resumen
  de la fase cita todas las corridas (borde "umbral no cumplido").
- Si la medición no cumple, `resumen.md` dice "no cumple" con la cifra real.

**Tipos y nombres:**

| Tipo | Ejecuciones previstas |
| --- | --- |
| `carga/` | `catalogo`, `horarios`, `reserva` (US1), `escalado-pr03` (US4), `volumen` (US5) |
| `e2e/` | `corrida-N` (5 locales), `ci-N` (3 en el CI, con el enlace a la corrida), `evaluacion.md` |
| `accesibilidad/` | 4 pantallas × 2 tamaños = 8 informes |
| `rendimiento-web/` | 4 pantallas × 2 configuraciones = 8 informes |
| `base-de-datos/` | `planes`, `pool`, `volumen`, `simulacro-pr22` |
| `cobertura/` | `backend`, `frontend` |
| `pruebas-fragiles/` | Repeticiones de las metas, cuando se ejecuta con `MEDIR_METAS=1` |
| `despliegue/` | `cabeceras`, `dns`, `certificado`, `publicaciones.jsonl` |

## 2. Escenario de carga (`carga/escenarios/*.js`)

| Campo | Catálogo | Horarios | Reserva |
| --- | --- | --- | --- |
| Ruta | `GET /api/v1/publico/…/catalogo` por slug | `GET` de horarios libres por slug, servicio, barbero y fecha | `POST` de reserva con `Idempotency-Key` |
| Modelo | 50 VU, 2 min | 50 VU, 2 min | `constant-arrival-rate` 20/s, 5 min |
| Umbral de latencia | p95 < 800 ms | p95 < 800 ms | p95 < 1 500 ms |
| Umbral de error | 5xx = 0 | 5xx = 0 | `error_tecnico` < 1 % |
| Fuera del error | — | — | 409 (horario ocupado), contado en `ocupado` |
| Datos | Barbería `carga-<sello>` creada en `setup()` | Ídem | Ídem, con clientes y horarios suficientes para 6 000 reservas distintas |

Las rutas exactas se toman de los contratos OpenAPI de 002 al escribir los scripts. Las métricas propias son
`error_tecnico` (Rate), `ocupado` (Counter) y `por_instancia` (Counter con la etiqueta `instancia` de
`X-Instancia`).

## 3. Recorrido de extremo a extremo (`e2e/recorridos/*.spec.ts`)

| Recorrido | Datos propios | Comprueba al final |
| --- | --- | --- |
| Registro y activación | Barbería `e2e-<sufijo>` | Panel del propietario visible tras activar con el enlace de Mailpit |
| Reserva y cancelación | Cliente `e2e-<sufijo>@ejemplo.test` en una barbería de la semilla | La cita aparece en "Mis citas"; tras cancelar, el horario vuelve a estar libre |
| Agenda del propietario | Cuenta de demostración de la barbería A | Ve las citas de A; una cita conocida de B no aparece |
| Asistente (proveedor falso) | Cliente de la semilla | La respuesta lista los servicios del catálogo |
| Pago de suscripción | Barbería `e2e-<sufijo>` | Suscripción activa con el período nuevo tras aprobar en la pasarela simulada |
| (US8) Subdominio | Barbería A | `a.ayacuchobarber.shop` (resuelto hacia Nginx) muestra la página pública de A |

## 4. Semilla de demostración (`semilla/datos.json`)

| Elemento | Barbería A | Barbería B |
| --- | --- | --- |
| Slug | `barberia-demo-centro` | `barberia-demo-huamanga` |
| Propietario | `propietario.centro@ejemplo.test` | `propietario.huamanga@ejemplo.test` |
| Servicios | 4 (corte, barba, corte y barba, niño) | 3 |
| Barberos | 3 (uno con usuario vinculado) | 2 |
| Horario | Lunes a sábado | Martes a domingo |
| Clientes | 6 (`cliente.N@ejemplo.test`) | 4 |
| Citas | 12 futuras: pendientes, confirmadas y canceladas | 8 futuras |

**Reglas:**

- **Contraseñas, en dos casos** (research R04):
  - **Demo local** (`--modo local`, por defecto): valores de desarrollo fijos de `datos.json`, documentados en
    `semilla/README.md`. Solo sirven en el equipo de quien clona.
  - **Demo publicada** (`--modo publicacion`): generadas **al azar** para cada cuenta. Se guardan solo en
    `publicacion/secretos/cuentas-publicadas.json`, que no se versiona. Nunca se imprimen ni van al repositorio, a la
    documentación, a la evidencia ni a la CI. Se reinician con `reiniciar-publicacion`, que recrea solo la base del
    proyecto `barberias-publicacion`.
  - Los correos son los mismos en los dos casos. La carga normal no cambia ninguna contraseña.
- Los teléfonos `+51 900 000 0NN` están marcados como ficticios.
- No se siembra un administrador de la plataforma.
- Idempotencia por clave natural: el slug para las barberías, el correo para las cuentas, y la tupla barbero, fecha y
  hora para las citas (un 409 cuenta como existente).
- Los nombres de las personas son inventados y no corresponden a nadie.

## 5. Configuración versionada nueva

| Archivo | Qué es | Secretos |
| --- | --- | --- |
| `nginx/templates/web.conf.template` | `server` 8080: interfaz de producción y `/api/` (US4) | No |
| `nginx/templates/publicacion.conf.template` | `server` 8081: túnel, `real_ip` y el subdominio de US8 | No |
| `nginx/upstream-extra/` (vacío; `.gitkeep`) | Instancias extra para PR03 | No |
| `docker-compose.medicion.yml` | `auto_explain` en PostgreSQL (US5) | No |
| `docker-compose.publicacion.yml` | `cloudflared`, `actualizador-frontend` y los orígenes públicos de las réplicas | No; lee `publicacion/publicacion.env` |
| `publicacion/cloudflared/config.yml` | Reglas de entrada del túnel (hostnames → `http://nginx:8081`) | No; las credenciales van en `publicacion/secretos/` (no versionado) |
| `publicacion/publicacion.env.example` | Nombres de las variables del túnel y del actualizador, sin valores | No |
| `publicacion/cuentas-publicadas.example.json` | Forma del archivo de cuentas de la demo publicada (rol, barbería, correo), con la contraseña como marcador `"<generada>"` | No; el archivo real, `publicacion/secretos/cuentas-publicadas.json`, no se versiona |
| `publicacion/levantar.sh` · `levantar.ps1` | Levanta la demo publicada como el proyecto `barberias-publicacion`; antes comprueba que la demo de desarrollo no esté corriendo | No |

## 6. Mapa de nombres de host (US7 y US8)

| Host | Destino | Comportamiento |
| --- | --- | --- |
| `ayacuchobarber.shop`, `www.ayacuchobarber.shop` | túnel → `nginx:8081` | Interfaz y `/api/` |
| `<slug>.ayacuchobarber.shop` (slug válido, sin reservar, ≤ 63 caracteres) | túnel → `nginx:8081` | `GET /` → 302 a `/b/<slug>`; el resto, igual que el raíz |
| Reservados (`api`, `app`, `admin`, `plataforma`, `mail`, `correo`, `estado`, `cdn`, `static`, `assets`, `demo`) | túnel → `nginx:8081` | 301 al dominio raíz; nunca `/b/<reservado>` |
| Cualquier otro host | `cloudflared` | `http_status:404` |

El host **nunca** llega a la lógica de negocio: el backend no lo lee, y una prueba de arquitectura lo vigila.
