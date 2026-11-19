# Contrato: comandos de 009

Cada comando se ejecuta desde `tecnologia/plataforma-barberias/`. Todos tienen su equivalente para bash y para
PowerShell, y el README los documenta (FR-014, FR-020). Ninguno lee ni imprime los valores del `.env`
(FR-003): `preparar-entorno` solo lee los **nombres** de las variables de un `.env` existente.

| Comando | Historia | Entrada | Salida | Código de salida |
| --- | --- | --- | --- | --- |
| `./scripts/preparar-entorno.sh [--subred a.b.c]` · `.\scripts\preparar-entorno.ps1 [-Subred a.b.c]` | US3 | `.env.example` | Crea `.env` si no existe, con `RED_SUBRED` y las IP fijas de la subred indicada (por defecto, las de `.env.example`); si existe, lista solo los **nombres** que faltan, sin escribir | 0 si creó o no faltaba nada; 2 si faltan nombres (sin tocar el archivo); 1 si hubo un error o la subred no es válida |
| `docker compose --profile herramientas run --rm semilla` (modo `local` por defecto) | US3 | `semilla/datos.json` (contraseñas de desarrollo documentadas en `semilla/README.md`), API y Mailpit | "N creadas, M existentes" por tipo; **no cambia ninguna contraseña** | 0 si todo existe o se creó; 1 si hubo un error; 3 si se pasa `--reiniciar-contrasenas` en el modo local (rechazado) |
| `docker compose -p barberias-publicacion … --profile herramientas run --rm semilla --modo publicacion` | US7 | `semilla/datos.json` (sin sus contraseñas), API y Mailpit del proyecto publicado | Crea las cuentas con contraseñas al azar y las escribe **solo** en `publicacion/secretos/cuentas-publicadas.json`; no las imprime | 0; 1 si hubo un error; 4 si una cuenta existe y la contraseña guardada no sirve (indica `--reiniciar-contrasenas`) |
| `./semilla/reiniciar-publicacion.sh` · `.\semilla\reiniciar-publicacion.ps1` | US7 | Proyecto `barberias-publicacion` y `publicacion/red-publicacion.env` | Exporta la subred `172.30.0.0/24`; borra **solo** el volumen de datos de ese proyecto, lo levanta, migra y siembra con `--modo publicacion --reiniciar-contrasenas`; escribe un `cuentas-publicadas.json` nuevo | 0; 1 si hubo un error; 5 si el proyecto no es exactamente `barberias-publicacion` (no borra nada) |
| `docker compose --profile carga run --rm k6 run /carga/escenarios/<escenario>.js` | US1 | Escenario y variables `K6_*` (`K6_HUMO=1` para la prueba de humo) | `evidencia/carga/<fecha>-<escenario>/` | 0 si cumple; 99 si no cumple los umbrales (el resultado se guarda igual) |
| `./carga/medir.sh <escenario>` · `.\carga\medir.ps1 <escenario>` | US1 | `COMPOSE_PROJECT_NAME` (obligatorio). Envoltorio que recrea las réplicas con el límite de medición, ejecuta k6, escribe `entorno.json` y restaura el límite | Ídem | El de k6; 6 si el proyecto falta o es el del responsable |
| `docker compose --profile e2e run --rm e2e npx playwright test` | US2 | Demo y semilla | `evidencia/e2e/<fecha>-corrida/` (JSON filtrado); trazas e informe HTML en `evidencia/e2e/no-versionado/` | 0 si todos pasan |
| `./e2e/estabilidad.sh 5` · `.\e2e\estabilidad.ps1 5` | US2 | Número de corridas y `COMPOSE_PROJECT_NAME` | Una carpeta por corrida y `evaluacion.md` | 0 si todas pasan; 6 (guardián) |
| `docker compose --profile e2e run --rm e2e npm run calidad-web` | US2 | Pantallas, tamaños y objetivo (`vite preview` o el 8080) | 8 informes de axe y 8 de Lighthouse | 0 siempre que se midió (las cifras no hacen fallar) |
| `docker compose --profile produccion up -d preparar-frontend nginx` | US4 | `frontend/` | Interfaz en `http://localhost:${WEB_PUERTO:-8080}` | — |
| `./carga/escalado/agregar-instancia.sh` · `.ps1` | US4 | Demo con dos réplicas y `COMPOSE_PROJECT_NAME` | `evidencia/carga/<fecha>-escalado-pr03/` (PR02 se cita de `reserva` de US1) | 0 si se midió; 6 (guardián) |
| `docker compose -f docker-compose.yml -f docker-compose.medicion.yml up -d db` y `./evidencia/scripts/extraer-planes.sh` | US5 | Registro de `auto_explain` sin parámetros (`log_parameter_max_length=0`) | `evidencia/base-de-datos/<fecha>-planes/` (texto con `$1`, `$2`…) | 0; 6 (guardián) |
| `./semilla/volumen.sh --citas 260000` · `.ps1` | US5 | API (barberías `volumen-*`) y `semilla/volumen.sql` (citas por conjuntos como `barberias_app`) | `evidencia/base-de-datos/<fecha>-volumen/` con el tiempo de la muestra y la proyección | 0; 6 (guardián); 7 si la proyección supera los 45 min (no carga y propone el tamaño menor) |
| `./evidencia/scripts/simulacro-respaldo.sh` · `.ps1` | US5 | Base de la demo; superusuario `postgres` **solo dentro del contenedor `db`** (excepción acotada) | Acta en `evidencia/base-de-datos/<fecha>-simulacro-pr22/`; la base restaurada se borra al terminar | 0 si los conteos coinciden y RLS sigue activa; 6 (guardián) |
| `npm run test:cobertura` (backend y frontend) | US6 | Suites. En el backend, con `COBERTURA=1`: sin exigir las metas de tiempo | `evidencia/cobertura/<fecha>-<lado>/` | El de la suite |
| `node evidencia/scripts/revisar-secretos.mjs` | Todas | `evidencia/` | Lista de archivos con patrones sospechosos (JWT, `otpauth://`, `Bearer`, `set-cookie`, `-----BEGIN`, tokens de GitHub, credenciales del túnel) | 0 si no hay ninguno; 1 si hay alguno |
| `./publicacion/levantar.sh` · `.ps1` | US7 | `publicacion/publicacion.env`, `publicacion/secretos/tunel.json` (del responsable; solo se comprueba que existen) y `publicacion/red-publicacion.env` | Exporta la subred `172.30.0.0/24` y ejecuta `docker compose -p barberias-publicacion -f docker-compose.yml -f docker-compose.publicacion.yml --profile produccion --profile publicacion up -d` | 0; 8 si la demo de desarrollo está corriendo |
| `./evidencia/scripts/evidencia-despliegue.sh` · `.ps1` | US7 | Dominio publicado | `evidencia/despliegue/<fecha>/` (sin cookies ni tokens) | 0 |

**Reglas comunes:**

- Las imágenes llevan etiquetas exactas, con al menos dos semanas de antigüedad.
- Los perfiles de Compose (`herramientas`, `carga`, `e2e`, `produccion`, `escalado` y `publicacion`) no arrancan con
  un `docker compose up -d` simple, así que la demo de desarrollo sigue igual.
- Un script que necesita la demo levantada lo comprueba antes, con `GET /api/v1/salud/listo`, y si no, termina con
  un mensaje claro.
- **Proyecto obligatorio** (research R01b): todo script de 009 que llama a `docker compose`, salvo `levantar` y
  `reiniciar-publicacion`, que fijan `barberias-publicacion`, exige `COMPOSE_PROJECT_NAME`. Si falta o vale
  `plataforma-barberias` (el proyecto por defecto del responsable), termina con **código 6** sin ejecutar nada. Quien
  clone el proyecto y quiera medir fija su propio nombre.
- **Subredes** (research R01b): el desarrollo usa `172.28.0.0/24`, la copia de verificación `172.29.0.0/24` (su `.env`
  con `--subred 172.29.0`) y la demo publicada `172.30.0.0/24` (`publicacion/red-publicacion.env`). Así una red
  conservada por `docker compose stop` no choca con la de otro proyecto.
- Ningún comando imprime una contraseña de la demo publicada. Las contraseñas de la demo local son las documentadas
  en `semilla/README.md`.
- **Una demo a la vez:** la demo de desarrollo, la copia de verificación y la demo publicada (`barberias-publicacion`)
  no se levantan a la vez, por el consumo de memoria de un equipo de 8 GB (cada una ronda los 1,9 GB, 006 R12) y
  porque comparten los puertos del equipo. `publicacion/levantar` se niega a arrancar si la demo de desarrollo está
  corriendo (código 8). Se detienen con `docker compose stop`, nunca con `down -v`.
- Ningún script de 009 borra el volumen del proyecto del responsable. Solo `reiniciar-publicacion` borra un volumen, y
  solo el de `barberias-publicacion`, nombrado de forma explícita.
- `revisar-secretos` se ejecuta antes de cada commit de fase y en el trabajo `herramientas` de la CI.
