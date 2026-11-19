# Contrato: comandos de 009

Cada comando se ejecuta desde `tecnologia/plataforma-barberias/`. Todos tienen su equivalente para bash y para
PowerShell, y el README los documenta (FR-014, FR-020). Ninguno lee ni imprime el contenido del `.env`.

| Comando | Historia | Entrada | Salida | Código de salida |
| --- | --- | --- | --- | --- |
| `./scripts/preparar-entorno.sh` · `.\scripts\preparar-entorno.ps1` | US3 | `.env.example` | Crea `.env` si no existe; si existe, lista los **nombres** que faltan | 0 si creó o no faltaba nada; 2 si faltan nombres (sin tocar el archivo); 1 si hubo un error |
| `docker compose --profile herramientas run --rm semilla` (modo `local` por defecto) | US3 | `semilla/datos.json` (contraseñas de desarrollo documentadas en `semilla/README.md`), API y Mailpit | "N creadas, M existentes" por tipo; **no cambia ninguna contraseña** | 0 si todo existe o se creó; 1 si hubo un error; 3 si se pasa `--reiniciar-contrasenas` en el modo local (rechazado) |
| `docker compose -p barberias-publicacion … --profile herramientas run --rm semilla --modo publicacion` | US7 | `semilla/datos.json` (sin sus contraseñas), API y Mailpit del proyecto publicado | Crea las cuentas con contraseñas al azar y las escribe **solo** en `publicacion/secretos/cuentas-publicadas.json`; no las imprime | 0; 1 si hubo un error; 4 si una cuenta existe y la contraseña guardada no sirve (indica `--reiniciar-contrasenas`) |
| `./semilla/reiniciar-publicacion.sh` · `.\semilla\reiniciar-publicacion.ps1` | US7 | Proyecto `barberias-publicacion` | Borra **solo** el volumen de datos de ese proyecto, lo levanta, migra y siembra con `--modo publicacion --reiniciar-contrasenas`; escribe un `cuentas-publicadas.json` nuevo | 0; 1 si hubo un error; 5 si el proyecto no es exactamente `barberias-publicacion` (no borra nada) |
| `docker compose --profile carga run --rm k6 run /carga/escenarios/<escenario>.js` | US1 | Escenario y variables `K6_*` | `evidencia/carga/<fecha>-<escenario>/` | 0 si cumple; 99 si no cumple los umbrales (el resultado se guarda igual) |
| `./carga/medir.sh <escenario>` · `.\carga\medir.ps1 <escenario>` | US1 | Envoltorio que recrea las réplicas con el límite de medición, ejecuta k6, escribe `entorno.json` y restaura el límite | Ídem | El de k6 |
| `docker compose --profile e2e run --rm e2e npx playwright test` | US2 | Demo y semilla | `evidencia/e2e/<fecha>-corrida/` | 0 si todos pasan |
| `./e2e/estabilidad.sh 5` · `.\e2e\estabilidad.ps1 5` | US2 | Número de corridas | Una carpeta por corrida y `evaluacion.md` | 0 si todas pasan |
| `docker compose --profile e2e run --rm e2e npm run calidad-web` | US2 | Pantallas y tamaños | 8 informes de axe y 8 de Lighthouse | 0 siempre que se midió (las cifras no hacen fallar) |
| `docker compose --profile produccion up -d preparar-frontend nginx` | US4 | `frontend/` | Interfaz en `http://localhost:8080` | — |
| `./carga/escalado/agregar-instancia.sh` · `.ps1` | US4 | Demo con dos réplicas | `evidencia/carga/<fecha>-escalado-pr03/` | 0 si se midió |
| `docker compose -f docker-compose.yml -f docker-compose.medicion.yml up -d db` y `./evidencia/scripts/extraer-planes.sh` | US5 | Registro de `auto_explain` | `evidencia/base-de-datos/<fecha>-planes/` | 0 |
| `node semilla/volumen.mjs --citas 520000` | US5 | API | Barberías `volumen-*` | 0 |
| `./evidencia/scripts/simulacro-respaldo.sh` · `.ps1` | US5 | Base de la demo | Acta en `evidencia/base-de-datos/<fecha>-simulacro-pr22/`; la base restaurada se borra al terminar | 0 si los conteos coinciden y RLS sigue activa |
| `npm run test:cobertura` (backend y frontend) | US6 | Suites | `evidencia/cobertura/<fecha>-<lado>/` | El de la suite |
| `docker compose -p barberias-publicacion -f docker-compose.yml -f docker-compose.publicacion.yml --profile produccion --profile publicacion up -d` (envuelto en `publicacion/levantar.sh` · `.ps1`, que antes comprueba que la demo local no está corriendo) | US7 | `publicacion/publicacion.env` y `publicacion/secretos/` (del responsable) | Demo en `https://ayacuchobarber.shop`, con volúmenes propios del proyecto | — |
| `./evidencia/scripts/evidencia-despliegue.sh` · `.ps1` | US7 | Dominio publicado | `evidencia/despliegue/<fecha>/` (sin cookies ni tokens) | 0 |

**Reglas comunes:**

- Las imágenes llevan etiquetas exactas, con al menos dos semanas de antigüedad.
- Los perfiles de Compose (`herramientas`, `carga`, `e2e`, `produccion`, `escalado` y `publicacion`) no arrancan con
  un `docker compose up -d` simple, así que la demo de desarrollo sigue igual.
- Un script que necesita la demo levantada lo comprueba antes, con `GET /api/v1/salud/listo`, y si no, termina con
  un mensaje claro.
- Ningún comando imprime una contraseña de la demo publicada. Las contraseñas de la demo local son las documentadas
  en `semilla/README.md`.
- **Una demo a la vez:** la demo de desarrollo y la demo publicada (`barberias-publicacion`) no se levantan a la vez,
  por el consumo de memoria de un equipo de 8 GB (cada una ronda los 1,9 GB, 006 R12) y porque comparten puertos y
  subred. `publicacion/levantar` se niega a arrancar si la demo de desarrollo está corriendo, y se detiene con
  `docker compose stop`, nunca con `down -v`.
- Ningún script de 009 borra el volumen del proyecto local. Solo `reiniciar-publicacion` borra un volumen, y solo el
  de `barberias-publicacion`, nombrado de forma explícita.
