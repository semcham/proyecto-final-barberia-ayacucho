# Tasks: Evidencia de calidad y despliegue (009)

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md) y los [borradores/](borradores/).

**Rutas**: salvo que empiecen por `docs/`, `specs/`, `.github/`, `.specify/` o `README.md` (el raíz), las rutas son
relativas a `tecnologia/plataforma-barberias/`. El `.gitignore` que se cambia es `tecnologia/plataforma-barberias/.gitignore`.

**Pruebas**: son obligatorias (principio X). En cada fase se escriben primero y se comprueba que fallan por la razón
correcta antes de implementar. Todo lo que toque la IA usa el proveedor falso (`IA_PROVEEDOR=falso`, FR-002).

**Reglas para quien implementa**:

- **Nunca leer, abrir, mostrar ni copiar el `.env` del responsable**, ni `publicacion/publicacion.env`,
  `publicacion/secretos/*` o `cuentas-publicadas.json`. Un script solo puede leer los **nombres** de las variables de un
  `.env` existente (FR-003).
- **Ningún secreto real** (tokens de Cloudflare o de GitHub, credenciales del túnel, identificadores de cuenta, zona
  o túnel, contraseñas de la demo publicada) en el repositorio ni en ningún archivo que se genere. Solo marcadores.
- **Copia de verificación** (research R01b): toda verificación o medición que ejecute el agente se hace en una copia,
  nunca en la carpeta ni en el proyecto de Compose del responsable. Pasos:
  1. copiar `tecnologia/plataforma-barberias/` a una carpeta del directorio temporal llamada **`barberias-verificacion`**,
     **excluyendo** `.env`, `node_modules/`, `dist/`, `publicacion/secretos/` y `publicacion/publicacion.env`;
  2. exportar `COMPOSE_PROJECT_NAME=barberias-verificacion` y `EVIDENCIA_GIT_SHA=$(git rev-parse HEAD)` del
     repositorio original;
  3. crear su `.env` con `./scripts/preparar-entorno.sh --subred 172.29.0` (subred propia; desde la fase 1);
  4. traer de vuelta **solo** `evidencia/`, después de `revisar-secretos`.

  Todos los scripts de 009 que llaman a `docker compose` se niegan (código 6) si `COMPOSE_PROJECT_NAME` falta o vale
  `plataforma-barberias`. La demo del responsable debe estar detenida mientras tanto: una demo a la vez, porque
  comparten los puertos del equipo y hay 8 GB.
- **Verificación por fase** (research R14):
  - las fases con cambios en `backend/` (4, 5, 7 y 8) ejecutan en local solo las pruebas que tocan (`test:int --
    escalado`, `test:arch`), salvo la fase 5, que ejecuta la suite completa;
  - las demás se verifican en local con sus pruebas de Node y del frontend, si lo tocan, y dejan la suite completa del
    backend a la CI.
  - **Nunca** se mide (k6, Lighthouse, PR03, volumen) mientras corre una suite.
- Antes de cada commit de fase: `node evidencia/scripts/revisar-secretos.mjs` en verde.
- Una prueba que falle de forma intermitente se ejecuta **sola** antes de tocar nada, y se informa.
- Las tareas de verificación se marcan `[X]` solo si se comprobaron de verdad. **Las tareas "Del responsable" no
  las marca el agente.**
- **No hacer commit, push ni `git stash`.**

**Formato**: `- [ ] Tnnn [P] [USn] descripción`. `[P]` significa que se puede hacer en paralelo (archivos distintos y
sin dependencias pendientes).

## Mapa de fases

| Fase | Historia | Prioridad | ¿Recortable? | Orden de recorte | Criterios | Tiempo local aproximado (R14) |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Gobierno (borradores) | — | No | — | 12 (habilita la CI ampliada y el CD), 13 (ADR-034) | 0 h |
| 1 | US3 · Arranque y semilla | P1 | **No** | — | **14** | 0,5 h |
| 2 | US1 · Carga con k6 | P1 | **No** | — | **13**, 8 (PR02) | 1 h |
| 3 | US2 · E2E, axe y Lighthouse | P1 | **No** | — | **6**, 8, 12 (trabajo `e2e`) | 1,5 h |
| 4 | US4 · Interfaz de producción y PR03 | P2 | Sí | 5.º (último en recortarse) | **8** | 1 h |
| 5 | US6 · Cobertura, insignia y pruebas frágiles | P2 | Sí | 4.º | **12**, 6 | **7 h** |
| 6 | US5 · Base de datos | P2 | Sí | 3.º | **9** | 1,5 h |
| 7 | US7 · Dominio, CDN y CD por extracción | P3 | Sí | 2.º | **10**, **12** | 1 h |
| 8 | US8 · Subdominio por barbería | P3 | Sí | **1.º (primero en recortarse)** | **10** | 0,5 h |
| 9 | Cierre | — | No | — | Todos (estados y totales) | 1,5 h |

- **Tiempo:** en total, unas 15,5 h de máquina en local, más la espera de la CI de cada push (su duración se mide en
  la fase 1).
- **Orden de recorte:** US8, luego US7, US5, US6 y US4. Si se recorta una fase, se registra como desviación en
  `spec.md` ("Desviaciones") y en `docs/trazabilidad.md`, y lo no construido se documenta como no construido
  (FR-005).
- **Si se recorta US6**, una CI roja en las fases 6 a 8 solo se acepta si la falla es de una de las 11 pruebas
  frágiles, pasa sola en local y pasa al relanzar la corrida (research R13).

---

## Fase 0: Gobierno (borradores)

**Objetivo:** que el responsable revise y apruebe la aclaración PATCH del principio XII, ADR-034 y ADR-035 antes de
construir lo que depende de ellos. Los ADR se aplican después, en su fase: ADR-034 en la fase 2 (T045) y ADR-035 en
la fase 7 (T151).

**Bloquea:**
- T004 bloquea los trabajos `e2e` (T063) y `artefacto-frontend` (T141) de la CI.
- T002 bloquea T045.
- T003 bloquea la fase 7.

- [X] T001 **Del responsable** (aprobado el 2026-11-19): revisar y aprobar (o corregir) la aclaración PATCH 1.7.2 del principio XII y las dos
  aclaraciones de "Restricciones" (publicación de demostración, y superusuario solo para el respaldo) en
  [borradores/enmienda-xii-y-adr-publicacion.md](borradores/enmienda-xii-y-adr-publicacion.md) §1.
- [X] T002 **Del responsable** (aprobado el 2026-11-19): aprobar ADR-034 en [borradores/adr-034-k6.md](borradores/adr-034-k6.md), que ya está
  marcado como revisado.
- [X] T003 **Del responsable** (aprobado el 2026-11-19): revisar y aprobar ADR-035 en
  [borradores/enmienda-xii-y-adr-publicacion.md](borradores/enmienda-xii-y-adr-publicacion.md) §2.
- [X] T004 Tras T001, y **solo con el aviso al responsable**, aplicar la aclaración PATCH (aplicada el 2026-11-19;
  también se actualizó la versión en `docs/05-gestion/03-sdd-spec-kit.md`, por ser un documento afectado):
  - en `.specify/memory/constitution.md`: el texto de §1 en el principio XII y las dos aclaraciones en "Restricciones
    tecnológicas y de alcance" ("Despliegue objetivo" y "Privacidad"); el Sync Impact Report; la versión **1.7.2** y
    la fecha de "Last Amended";
  - en `.specify/templates/plan-template.md`: la puerta XII ("workflows may keep the built frontend artifact (main,
    after tests) and have manual test jobs; may use only ephemeral test databases; never deploy or hold deploy
    credentials").

  Si T001 no se aprueba, no se aplica nada, y T063 y T141 quedan como no construidos.
- [X] T005 [P] En los dos borradores, actualizar la cabecera de estado ("aprobado el AAAA-MM-DD; se aplica en la fase
  N") según T001 a T003. No cambiar nada más.
- [X] T006 Verificación de la fase 0:
  - las referencias a "1.7.1" que deban pasar a "1.7.2" están actualizadas (por ejemplo, la puerta del plan de 009);
  - `git diff` solo toca la constitución, la plantilla y los borradores.

  **Resultado (2026-11-19):**
  - Las menciones vigentes pasaron a 1.7.2: la versión, la puerta de la plantilla, las 5 de `03-sdd-spec-kit.md` y el
    Constitution Check del plan de 009.
  - Las 1.7.1 que quedan son historia: el historial del Sync Impact Report, `trazabilidad` y `04-pruebas` sobre 007, el
    backlog y los archivos de 007.
  - `git status` muestra la constitución, la plantilla, los dos borradores, `docs/05-gestion/03-sdd-spec-kit.md` y
    `specs/009-evidencia-calidad/plan.md` y `tasks.md`. Los tres últimos son documentos afectados (la versión, y el
    estado de la fase). No se tocó código ni `07-decisiones-arquitectonicas.md`.
- [ ] T007 **Del responsable:** commit y push de la fase 0: `docs(009): aclaración PATCH 1.7.2 del principio XII y
  borradores de ADR-034 y ADR-035 aprobados (fase 0)`.

---

## Fase 1: US3 · Arranque reproducible y semilla (P1, no recortable) · Criterio 14

**Objetivo:** que un tercero clone el repositorio, genere `.env` con un script (bash o PowerShell) y cargue una
semilla idempotente por la API. Además, dejar listas las herramientas comunes de 009: el guardián del proyecto,
`revisar-secretos`, Prettier y ESLint de las carpetas nuevas, y el trabajo `herramientas` de la CI.

**Prueba independiente:** en una copia limpia, el README completo termina con las dos barberías visibles en
`/b/<slug>`, y una segunda carga de la semilla dice "0 creadas".

### Pruebas (primero; deben fallar)

- [X] T008 [P] [US3] Crear `scripts/test/preparar-entorno.test.mjs` (`node --test`, sin dependencias; FR-003,
  FR-017, FR-018; research R03). Cada caso usa un directorio temporal con una copia de `.env.example` y comprueba:
  - sin `.env`: crea el archivo con código 0;
  - `JWT_PRIVATE_KEY` y `JWT_PUBLIC_KEYS["dev-1"]` firman y verifican un JWT ES256 con `node:crypto`;
  - `PLATAFORMA_LLAVE_TOTP` y `ENLACES_LLAVE` decodifican a 32 bytes;
  - `ENLACES_SAL_IP` e `INTENTOS_SAL_IP` tienen 32 caracteres o más y son distintas;
  - con `--subred 172.29.0`: `RED_SUBRED=172.29.0.0/24` y `IP_NGINX=172.29.0.10` … `IP_BACKEND_3=172.29.0.18`;
    un prefijo inválido da código 1 sin crear nada;
  - con un `.env` existente al que le falta una variable: el hash SHA-256 no cambia (también con `--subred`), el
    código es 2, la salida contiene el **nombre** que falta y **ningún** valor del archivo;
  - con un `.env` completo: código 0 y "no falta ninguna variable";
  - ninguna salida contiene `BEGIN PRIVATE KEY` ni un valor generado.
- [X] T009 [P] [US3] Crear `scripts/test/proyecto.test.mjs` (guardián, research R01b):
  - con `COMPOSE_PROJECT_NAME` vacío, el código es 6;
  - con `plataforma-barberias`, el código es 6;
  - con `barberias-verificacion`, la comprobación pasa;
  - el mensaje explica cómo fijar el proyecto.
  - Además, los envoltorios `.sh` y `.ps1` devuelven lo mismo que el `.mjs`.
- [X] T010 [P] [US3] Crear `semilla/test/semilla.test.mjs` (`node --test`, con un `fetch` falso; FR-019; research
  R04). Comprueba:
  - una barbería cuyo slug ya responde en la vía pública se salta;
  - un correo ya registrado inicia sesión en vez de registrarse;
  - un 409 en una cita cuenta como "existente";
  - una segunda corrida informa "0 creadas";
  - `--reiniciar-contrasenas` en el modo local termina con código 3 sin llamar a la API;
  - `datos.json` tiene solo correos `@ejemplo.test`, teléfonos `+51 900 000 0NN`, ningún administrador de la
    plataforma, dos barberías y los conteos de [data-model.md](data-model.md) §4;
  - la carga normal nunca llama a una ruta que cambie contraseñas.
- [X] T011 [P] [US3] Crear `evidencia/scripts/test/revisar-secretos.test.mjs` (research R01). Comprueba que se
  detectan, cada uno en un archivo de prueba:
  - un JWT;
  - `otpauth://`;
  - `Bearer x`;
  - `set-cookie:`;
  - `-----BEGIN`;
  - `ghp_…` y `github_pat_…`;
  - `TunnelSecret` y `AccountTag`.

  También comprueba que `evidencia/**/no-versionado/` se ignora, que el código es 1 con hallazgos y 0 sin ellos, y que
  la salida muestra la ruta y el patrón, pero **nunca** el valor encontrado.

### Implementación

- [X] T012 [US3] Crear `scripts/preparar-entorno.mjs` (Node 22, solo `node:crypto` y `node:fs`), según R03:
  - genera las claves EC P-256 en PEM PKCS#8 y SPKI, escapadas con `\n`, y `JWT_ACTIVE_KID=dev-1`;
  - 32 bytes en base64 para `PLATAFORMA_LLAVE_TOTP` y `ENLACES_LLAVE`;
  - sales distintas para `ENLACES_SAL_IP` e `INTENTOS_SAL_IP`;
  - `--subred` (solo al crear);
  - escritura atómica (temporal y renombrado, con `wx`);
  - si `.env` existe, compara **solo los nombres**, sin guardar ni imprimir valores;
  - códigos de salida 0, 1 y 2.

  Debe hacer pasar T008.
- [X] T013 [P] [US3] Crear `scripts/preparar-entorno.sh` (bash):
  - si hay `node` (versión 22 o mayor), ejecuta el `.mjs`;
  - si no, ejecuta `docker run --rm -v "$PWD":/w -w /w node:22 node scripts/preparar-entorno.mjs "$@"`;
  - propaga el código de salida.
- [X] T014 [P] [US3] Crear `scripts/preparar-entorno.ps1` (PowerShell 5.1 y 7), con el mismo comportamiento que T013
  y el parámetro `-Subred`.
- [X] T015 [US3] Crear `scripts/lib/proyecto.mjs`, `proyecto.sh` y `proyecto.ps1` (`exigirProyectoAparte`, código 6),
  según research R01b. Debe hacer pasar T009.
- [X] T016 [US3] Crear `evidencia/scripts/revisar-secretos.mjs` (Node 22, sin dependencias), con los patrones de T011.
  Recorre `evidencia/` salvo `**/no-versionado/`. Debe hacer pasar T011.
- [X] T017 [P] [US3] Crear `semilla/datos.json` según [data-model.md](data-model.md) §4:
  - `barberia-demo-centro` y `barberia-demo-huamanga`;
  - servicios, barberos (uno con usuario vinculado), horarios y clientes;
  - citas futuras, expresadas como días relativos a la fecha de carga;
  - contraseñas de desarrollo **solo para el modo local**.
- [X] T018 [US3] Crear `semilla/lib/`:
  - `api.mjs`: cliente `fetch` con la URL base, manejo de errores e `Idempotency-Key`;
  - `buzon.mjs`: lee el enlace de activación de la API HTTP de Mailpit, con espera acotada y un mensaje claro si no
    llega;
  - `idempotencia.mjs`;
  - `contrasenas.mjs`: genera contraseñas al azar con `node:crypto`, 20 caracteres que cumplen la política de 001.
    Lo usa la fase 7.

  Las rutas exactas salen de `specs/001-*/contracts/openapi.yaml` y `specs/002-*/contracts/openapi.yaml`.
- [X] T019 [US3] Crear `semilla/cargar-semilla.mjs` (`--api`, `--buzon`, `--modo local`, por defecto):
  - registro y activación de cada barbería;
  - inicio de sesión;
  - servicios, barberos, horario;
  - clientes por `/b/<slug>`;
  - citas, algunas canceladas y otras confirmadas;
  - resumen "N creadas, M existentes";
  - rechaza `--reiniciar-contrasenas` en el modo local con código 3.

  Debe hacer pasar T010.
- [X] T020 [US3] En `docker-compose.yml`, agregar el servicio `semilla`:
  - perfil `herramientas`, `node:22`, red `plataforma`;
  - monta `./semilla:/semilla:ro`;
  - `SEMILLA_API=http://nginx/api/v1` y `SEMILLA_BUZON=http://${IP_MAILPIT:-172.28.0.15}:8025`;
  - **sin** `env_file`.

  Comentario con el uso.
- [X] T021 [P] [US3] Crear `semilla/README.md`:
  - cuentas de la **demo local** con sus contraseñas de desarrollo, que solo sirven en el equipo de quien clona;
  - aviso de que la demo publicada usa otras contraseñas, que no están en el repositorio;
  - qué no se siembra (historial atendido, administrador) y por qué.
- [X] T022 [US3] Crear `herramientas.eslint.config.mjs` (ESLint 9, configuración plana) y `.prettierignore`:
  - ESLint cubre `scripts/`, `semilla/`, `carga/`, `e2e/`, `publicacion/` y `evidencia/scripts/`, con los globales de
    Node y, solo para `carga/`, los de k6 (`__ENV`, `__VU`, `__ITER`);
  - el `.prettierignore` excluye `evidencia/**` salvo `evidencia/scripts/**`, `node_modules/`, `dist/` y
    `publicacion/secretos/`.

  Sin dependencias nuevas en `backend/` ni en `frontend/` (análisis A2 y M9).
- [X] T023 [US3] En `.github/workflows/plataforma-barberias.yml`, agregar el trabajo `herramientas`:
  - `ubuntu-latest` y Node 22;
  - `working-directory: tecnologia/plataforma-barberias`;
  - `node --test "scripts/test/*.test.mjs" "semilla/test/*.test.mjs" "evidencia/scripts/test/*.test.mjs"` (desde Node 22, `node --test` recibe patrones, no carpetas);
  - `npx prettier@3.9.10 --check scripts semilla evidencia/scripts herramientas.eslint.config.mjs`;
  - `npx eslint@9.39.5 -c herramientas.eslint.config.mjs scripts semilla evidencia/scripts`;
  - `node evidencia/scripts/revisar-secretos.mjs`;
  - `node scripts/validar-compose.mjs docker-compose.yml` (claves duplicadas) y `docker compose config -q`, sin y con
    el perfil `herramientas`, con un `.env` del runner copiado de `.env.example` (agregado el 2026-11-19);
  - sin secretos y sin base de datos;
  - agregarlo a `needs` de `notificar_telegram`.

  Comentario: cabe en "verificar" y "probar" (principio XII). Cada fase siguiente amplía este trabajo con sus
  carpetas y pruebas.
- [X] T024 [US3] Actualizar **en este commit** los documentos (FR-042):
  - `README.md` raíz y `README.md` de la plataforma: arranque con `preparar-entorno` en bash y PowerShell, semilla,
    cuentas locales, "una demo a la vez" y `COMPOSE_PROJECT_NAME` para los scripts de medición;
  - `docs/05-gestion/04-pruebas.md`: pruebas nuevas y el trabajo `herramientas`;
  - `docs/trazabilidad.md`: fila de 009, fase 1;
  - `docs/05-gestion/02-backlog-y-sprints.md`.
- [X] T025 [US3] Verificación de la fase 1, con la copia aislada. **Hecha el 2026-11-19 con Docker real:**
  - la copia `barberias-verificacion` (sin `.env`, `node_modules` ni `dist`) con su `.env` generado por
    `preparar-entorno --subred 172.29.0`;
  - el guardián se negó (código 6) con `plataforma-barberias` y sin proyecto, y aceptó `barberias-verificacion`;
  - red `172.29.0.0/24`; dos réplicas sanas; `IA_PROVEEDOR=falso`;
  - semilla contra la API real: la primera carga creó 47 elementos (2 barberías, 2 horarios, 7 servicios, 1 usuario
    barbero, 5 barberos, 10 clientes y 20 citas) y la segunda dio "0 creadas" con código 0. **No hizo falta corregir
    la semilla:** rutas y cuerpos coinciden con el backend;
  - `/b/barberia-demo-centro` y `/b/barberia-demo-huamanga` responden 200, y sus catálogos públicos, 4 y 3 servicios;
  - aislamiento: cada propietario ve solo sus barberos y sus clientes (6 y 4); la disponibilidad de un barbero de la
    otra barbería da 404; en 10 días, las agendas tienen 12 y 8 citas y ninguna ajena; un cliente de A ve solo sus
    citas de A, y desde el enlace de B recibe 409 `UNIRSE_REQUIERE_CONSENTIMIENTO`, sin sesión en B;
  - los cuatro volúmenes `plataforma-barberias_*` del responsable conservan su fecha de creación antes y después;
  - la copia se bajó con `down -v` tras confirmarla el guardián; no quedaron contenedores, red ni volúmenes de la copia,
    y su carpeta temporal se borró.

  Pasos previstos de la tarea:
  - `node --test scripts/test/ semilla/test/ evidencia/scripts/test/` en verde, y Prettier y ESLint en verde con la
    configuración de T022;
  - crear la **copia de verificación** según las reglas, con la carpeta `barberias-verificacion`, `--subred 172.29.0`
    y `COMPOSE_PROJECT_NAME=barberias-verificacion`;
  - **antes** de levantarla, anotar la fecha de creación (`docker volume inspect -f '{{.CreatedAt}}'`) de los
    volúmenes del proyecto `plataforma-barberias`, sin leer su contenido;
  - en la copia:
    1. una segunda ejecución de `preparar-entorno` da código 0 con el hash igual;
    2. `docker compose up -d`;
    3. la semilla dice "creadas" y luego "0 creadas";
    4. `/b/barberia-demo-centro` y `/b/barberia-demo-huamanga` responden;
    5. el propietario de una barbería no ve datos de la otra (US3-5);
  - `docker network inspect` de la copia muestra `172.29.0.0/24`, y los volúmenes de la copia llevan el prefijo
    `barberias-verificacion_`;
  - al terminar, los volúmenes del responsable conservan su fecha de creación;
  - `preparar-entorno.ps1` se ejecuta en esta máquina, solo en la copia;
  - `revisar-secretos` en verde.
- [ ] T026 [US3] **Del responsable:** cronometrar el arranque desde el README en una copia limpia, en **bash** (Linux
  o WSL) y en **PowerShell**, sin contar descargas. Anotar los dos tiempos (SC-001: menos de 30 minutos).
- [ ] T027 [US3] Verificación de la CI: en la corrida del push de la fase, `herramientas`, `backend` y `frontend`
  están en verde. Anotar la duración del trabajo `backend` y de la corrida completa: se escribe en
  `docs/05-gestion/04-pruebas.md` en el commit de la fase 2 (research R14).
- [ ] T028 [US3] **Del responsable:** commit y push de la fase 1: `feat(009): arranque reproducible, semilla
  idempotente por la API y herramientas comunes (fase 1, US3)`.

---

## Fase 2: US1 · Carga con k6 (P1, no recortable) · Criterios 13 y 8

**Objetivo:** tres escenarios de k6 en la imagen oficial, con umbrales de EQ-01 y EQ-02 y resultados medidos y
guardados. La medición `reserva` es también PR02.

**Prueba independiente:** `carga/medir` deja por escenario `crudo.json`, `entorno.json` y un `resumen.md` con
"cumple" o "no cumple".

**Depende de:** US3 (`semilla/lib`, `preparar-entorno`, el guardián y `revisar-secretos`) y de T002 para T045.

### Pruebas (primero)

- [ ] T029 [P] [US1] Crear `carga/test/resumen.test.mjs` (`node --test`):
  - la función pura de `carga/lib/resumen.mjs`, aplicada a un `summary.json` de ejemplo, genera la tabla con la meta,
    la cifra y "cumple" o "no cumple";
  - un 409 se cuenta en `ocupado` y no en `error_tecnico`;
  - un 429 o un 5xx sí cuentan como error técnico;
  - el reparto por `instancia` suma el total;
  - un umbral incumplido produce "no cumple" y nunca se omite.
- [ ] T030 [P] [US1] Crear `evidencia/scripts/test/entorno.test.mjs`:
  - `registrar-entorno` solo escribe variables de la lista blanca, y una variable sensible simulada
    (`JWT_PRIVATE_KEY`, `INTENTOS_SAL_IP`) no aparece en `entorno.json`;
  - sin `.git`, toma `EVIDENCIA_GIT_SHA`;
  - sin `.git` y sin esa variable, escribe `"desconocido"` (análisis M2);
  - con el proyecto por defecto, termina con el código 6.

### Implementación

- [ ] T031 [US1] Crear `evidencia/scripts/registrar-entorno.mjs` y sus envoltorios `.sh` y `.ps1` (R01). Primero
  ejecuta el guardián (T015). Registra:
  - fecha, SHA (git o `EVIDENCIA_GIT_SHA`) y si el árbol está sucio;
  - `proyecto`;
  - CPU, núcleos, memoria y carga (`docker info` y `os`);
  - imagen y versión de la herramienta;
  - las variables de la **lista blanca**, leídas con `docker compose exec -T <servicio> printenv <VAR>` una por una:
    `PUBLICO_LIMITE_POR_MINUTO`, `CACHE_CATALOGO_ACTIVA`, `CACHE_HORARIOS_ACTIVA`, `DB_POOL_APP_MAX`,
    `DB_POOL_PUBLICO_MAX`, `IA_PROVEEDOR`, `IA_FALSO_MODO` e `INSTANCIA_ID`.

  Nunca `docker compose config` ni el `.env`. Debe hacer pasar T030.
- [ ] T032 [P] [US1] Crear `carga/lib/opciones.js` (análisis B2): con `K6_HUMO=1`, 1 VU durante 10 s en los tres
  escenarios. Lee también `K6_API`, `K6_BUZON` y `K6_SLUG`. Ningún escenario define opciones de humo propias.
- [ ] T033 [P] [US1] Crear `carga/lib/preparar.js` (k6). `setup()` crea por la API la barbería `carga-<sello>`:
  registro, activación leyendo Mailpit con `http.get`, inicio de sesión, servicios, barberos, horario amplio y
  suficientes clientes con su token para 6 000 reservas en horarios distintos. Si algo falla, aborta antes de medir.
- [ ] T034 [P] [US1] Crear `carga/lib/metricas.js`:
  - `error_tecnico` (Rate): 5xx, error de red, 429 o un estado no previsto;
  - `ocupado` (Counter): 409;
  - `por_instancia` (Counter con la etiqueta `instancia` de `X-Instancia`).
- [ ] T035 [US1] Crear `carga/lib/resumen.mjs` (función pura, la que prueba T029) y `handleSummary`. Escriben
  `crudo.json` y `resumen.md` en `/evidencia/carga/<fecha>-<escenario>/`, se cumplan o no los umbrales.
- [ ] T036 [P] [US1] Crear `carga/escenarios/catalogo.js`: 50 VU durante 2 minutos, `GET` del catálogo público por
  slug, umbrales `p(95)<800` y 5xx = 0 (EQ-01). Usa `carga/lib/opciones.js`.
- [ ] T037 [P] [US1] Crear `carga/escenarios/horarios.js`: 50 VU durante 2 minutos, horarios libres de días
  distintos, umbrales `p(95)<800` y 5xx = 0 (EQ-01).
- [ ] T038 [P] [US1] Crear `carga/escenarios/reserva.js`: `constant-arrival-rate` de 20 por segundo durante 5
  minutos, horarios distintos con `Idempotency-Key`, umbrales `p(95)<1500` y `error_tecnico<0.01` (EQ-02). Es también
  la medición de PR02 (FR-023).
- [ ] T039 [US1] En `docker-compose.yml`, agregar el servicio `k6`:
  - perfil `carga`, imagen `grafana/k6:<etiqueta exacta con al menos dos semanas de antigüedad>`, red `plataforma`;
  - monta `./carga:/carga:ro` y `./evidencia/carga:/evidencia/carga`;
  - **sin** `env_file`.
- [ ] T040 [US1] Crear `carga/medir.sh` y `carga/medir.ps1`:
  1. el guardián del proyecto (código 6);
  2. comprueban `/salud/listo`;
  3. recrean `backend-1` y `backend-2` con `PUBLICO_LIMITE_POR_MINUTO` de medición, por la variable del shell que
     Compose interpola (`--no-deps`);
  4. ejecutan `registrar-entorno`, k6 y el escenario;
  5. restauran el límite **siempre**, también si falla (`trap` y `finally`);
  6. propagan el código de k6.
- [ ] T041 [US1] Ampliar el trabajo `herramientas` de la CI con `carga/test/` en `node --test`, y con `carga` en
  Prettier y ESLint (globales de k6).
- [ ] T042 [US1] **Comprobación antes de la primera medición** (análisis C1):
  - en la copia de verificación, `COMPOSE_PROJECT_NAME= ./carga/medir.sh horarios` y
    `COMPOSE_PROJECT_NAME=plataforma-barberias ./carga/medir.sh horarios` terminan con el código 6 sin crear
    contenedores (`docker ps -a` sin cambios);
  - con `barberias-verificacion`, `docker volume ls` y `docker network ls` muestran solo recursos con ese prefijo y la
    subred `172.29.0.0/24`;
  - los volúmenes de `plataforma-barberias` conservan su fecha de creación (T025).

  Si algo falla, no se mide.
- [ ] T043 [US1] Prueba de humo en la copia de verificación: los tres escenarios con `K6_HUMO=1` terminan, escriben
  sus tres archivos y crean solo barberías `carga-*`. Comprobar que el usuario de la imagen de k6 puede escribir en
  `evidencia/carga/`; si no, agregar `user:` al servicio y documentarlo (análisis B3).
- [ ] T044 [US1] Medición real en la copia de verificación, con la semilla cargada, dos réplicas y ninguna otra
  suite ni medición en marcha: `catalogo`, `horarios` y `reserva`.
  - Guardar las tres carpetas en `evidencia/carga/` **tal como salgan**.
  - Si una no cumple, no se repite hasta que cumpla. Si se repite, se guardan todas las corridas.
  - Comprobar que después el límite volvió a 120 y que las citas de la prueba están solo en barberías `carga-*`
    (US1-5).
- [ ] T045 [US1] Tras T002, aplicar ADR-034 en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`: la
  fila de la tabla resumen y la sección, con el texto aprobado. Comprobar que el número sigue libre.
- [ ] T046 [US1] Actualizar **en este commit**:
  - `docs/05-gestion/04-pruebas.md`: PR01 y PR02 con su cifra, su enlace y la comparabilidad con 006 (FR-012); la
    duración de la CI anotada en T027;
  - `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md`: EQ-01 y EQ-02 medidos, con su enlace;
  - `docs/02-arquitectura-software/despliegue-y-escalabilidad.md` §2.1: el límite durante la medición;
  - `docs/02-arquitectura-software/tecnologias.md`: k6;
  - `docs/trazabilidad.md`;
  - README de la plataforma: el comando `medir` y `COMPOSE_PROJECT_NAME`.
- [ ] T047 [US1] Verificación de la fase 2:
  - `node --test` en verde;
  - cada cifra citada en `docs/` enlaza su carpeta de `evidencia/carga/` (SC-002);
  - `revisar-secretos`, Prettier y ESLint en verde;
  - CI en verde tras el push.
- [ ] T048 [US1] **Del responsable:** commit y push de la fase 2: `feat(009): pruebas de carga con k6 en contenedor
  y resultados medidos (fase 2, US1)`.

---

## Fase 3: US2 · E2E, accesibilidad y rendimiento de la interfaz (P1, no recortable) · Criterios 6, 8 y 12

**Objetivo:** 5 recorridos con Playwright contra la demo, 8 informes de axe, 8 de Lighthouse (con `vite preview`) y
la evaluación de estabilidad (5 corridas locales y 3 en el CI). De Playwright solo se versiona el JSON filtrado.

**Prueba independiente:** el comando de E2E informa 5 de 5 recorridos, y existen 16 informes.

**Depende de:** US3. T063 depende de T004.

- [ ] T049 [US2] Crear el paquete `e2e/`:
  - `package.json`, con `@playwright/test`, `@axe-core/playwright` y `lighthouse` en versiones exactas con al menos
    dos semanas de antigüedad, y la misma versión de Playwright que la imagen;
  - `package-lock.json` (`npm install` en la imagen de Playwright);
  - `tsconfig.json`;
  - `playwright.config.ts`:
    - `retries: 0` y `workers: 1`;
    - `baseURL` de `E2E_BASE_URL` (por defecto `http://frontend:5173`);
    - `trace: 'retain-on-failure'`, capturas y videos solo en las fallas;
    - `outputDir` y el informe HTML en `/evidencia/e2e/no-versionado/<fecha>/`;
    - el informe JSON crudo también en `no-versionado/`, para que `informe-filtrado.mjs` genere el versionado
      (análisis A6).
- [ ] T050 [US2] En `.gitignore`, agregar `evidencia/**/no-versionado/`. Comprobar con `git check-ignore` que una
  traza de ejemplo queda ignorada.
- [ ] T051 [US2] En `docker-compose.yml`, agregar el servicio `e2e`:
  - perfil `e2e`, imagen `mcr.microsoft.com/playwright:v<misma versión>-noble`, red `plataforma`;
  - monta `./e2e`, `./semilla:ro` y `./evidencia`;
  - volumen `e2e-node-modules`;
  - variables de las URL de la API, del buzón y del frontend;
  - **sin** `env_file`.
- [ ] T052 [P] [US2] Crear `e2e/informe-filtrado.mjs` y `e2e/test/informe-filtrado.test.mjs` (`node --test`).
  - A partir del JSON crudo, el versionado conserva solo el título, el archivo, el estado, la duración y el mensaje de
    error.
  - Enmascara los JWT, `Bearer …`, `otpauth://…` y los correos.
  - Quita los adjuntos, las cabeceras, los cuerpos, `stdout` y `stderr`.
  - Escribe en `evidencia/e2e/<fecha>-corrida/informe.json`.

### Recorridos (cada uno es su propia prueba; FR-013)

- [ ] T053 [P] [US2] Crear `e2e/recorridos/registro-activacion.spec.ts`:
  1. registra una barbería `e2e-<sufijo>`;
  2. lee el enlace en Mailpit;
  3. activa la cuenta;
  4. comprueba que el propietario ve su panel (US2-1).
- [ ] T054 [P] [US2] Crear `e2e/recorridos/reserva-cancelacion.spec.ts`:
  1. un cliente `e2e-<sufijo>@ejemplo.test` se registra en `/b/barberia-demo-centro`;
  2. reserva y ve la cita en "Mis citas";
  3. cancela, y el horario vuelve a estar libre (US2-2).
- [ ] T055 [P] [US2] Crear `e2e/recorridos/agenda-propietario.spec.ts`: con la cuenta local de la barbería A, ve
  sus citas del día, y una cita conocida de B no aparece (US2-3).
- [ ] T056 [P] [US2] Crear `e2e/recorridos/asistente-falso.spec.ts`: un cliente pregunta por los servicios y la
  respuesta lista los del catálogo. Primero comprueba `IA_PROVEEDOR=falso` en la réplica con `printenv` (US2-4,
  FR-002).
- [ ] T057 [P] [US2] Crear `e2e/recorridos/pago-suscripcion.spec.ts`: el propietario de `e2e-<sufijo>` paga en la
  pasarela simulada, el simulador aprueba, y la suscripción queda activa con el período nuevo (US2-5).

### Accesibilidad y rendimiento (FR-016)

- [ ] T058 [P] [US2] Crear `e2e/calidad-web/axe.spec.ts`:
  - las 4 pantallas (catálogo público, reserva, panel del propietario y panel de la plataforma), a 360 × 800 y a
    1 366 × 768;
  - etiquetas `wcag2a`, `wcag2aa`, `wcag21a` y `wcag21aa`;
  - guarda el JSON completo por pantalla y tamaño en `evidencia/accesibilidad/<fecha>/`;
  - **no** falla por incumplimientos: los lista.
  - Para el panel de la plataforma, crea un administrador con `npm run plataforma:crear-admin --
    --contrasena-desde-entorno` (en la réplica, con `docker compose exec`) y calcula el TOTP desde la URI impresa. La
    URI solo vive en memoria: nunca se registra, nunca se adjunta y nunca se guarda.
- [ ] T059 [P] [US2] Crear `e2e/calidad-web/lighthouse.mjs`:
  - Playwright lanza Chromium con `--remote-debugging-port`, inicia la sesión donde haga falta y ejecuta Lighthouse
    (solo `performance`) con `disableStorageReset`;
  - configuración móvil (`screenEmulation` a 360 px, con limitación simulada) y `desktop`;
  - las 4 pantallas;
  - guarda el JSON completo en `evidencia/rendimiento-web/<fecha>-<objetivo>/`. Si un archivo supera los 5 MB, lo
    guarda como `.json.gz` (análisis B5);
  - objetivo: `http://nginx:8080` si responde (existe a partir de la fase 4); si no, `vite preview`, levantado con
    `docker compose exec frontend sh -c "npm run build && npx vite preview --host --port 4173"` (el proxy de `/api`
    de `preview` toma el de `server`). **Nunca** el servidor de desarrollo. Lo registra en `entorno.json`.
- [ ] T060 [US2] Crear `e2e/calidad-web/resumen.mjs`: genera un `resumen.md` con los incumplimientos de axe por
  gravedad y las puntuaciones de Lighthouse **tal como salieron**. Agregar el script `calidad-web` al
  `package.json` de `e2e/`.
- [ ] T061 [US2] Crear `e2e/estabilidad.sh` y `e2e/estabilidad.ps1` (argumento N):
  - primero, el guardián del proyecto (código 6);
  - ejecutan N corridas seguidas y guardan cada una con su JSON filtrado;
  - escriben `evidencia/e2e/<fecha>-evaluacion.md` con las pasadas, las fallas y su motivo.

### CI y evaluación

- [ ] T062 [US2] Ampliar el trabajo `herramientas` de la CI (análisis A2 y M9):
  - `node --test e2e/test/`;
  - `e2e` en Prettier y ESLint;
  - un paso con `working-directory: tecnologia/plataforma-barberias/e2e`, `npm ci` y `npm audit --audit-level=high`;
  - `tsc --noEmit` del paquete `e2e`.
- [ ] T063 [US2] Tras T004 (aclaración aprobada), agregar a `.github/workflows/plataforma-barberias.yml` el trabajo
  `e2e`, **solo con `workflow_dispatch`**, que hace lo siguiente:
  1. `preparar-entorno.sh` crea `.env` en el runner;
  2. `docker compose up -d`, con espera de `/salud/listo`;
  3. carga la semilla;
  4. `docker compose --profile e2e run --rm e2e npx playwright test`;
  5. `informe-filtrado`;
  6. `upload-artifact` **solo** del informe JSON filtrado;
  7. `docker compose down -v` en el runner (base efímera).

  Sin secretos. Si T001 no se aprueba, esta tarea no se hace y se documenta en T068.
- [ ] T064 [US2] Ejecutar los 5 recorridos en la copia de verificación hasta que pasen. Corregir solo los recorridos
  o los datos de prueba, **nunca** el comportamiento de la aplicación.
- [ ] T065 [US2] Ejecutar `e2e/estabilidad.sh 5` en la copia de verificación y guardar las 5 corridas y la
  evaluación.
- [ ] T066 [US2] Ejecutar `calidad-web` (objetivo `vite preview`) y guardar los 16 informes.
  - Si hay incumplimientos `serious` o `critical`, corregir en `frontend/src` **solo** marcado accesible (etiquetas,
    contraste, roles, nombres), sin cambiar el comportamiento, con la prueba de Vitest que corresponda. Después,
    medir otra vez y guardar las dos corridas.
  - Lo que no se corrija queda en `resumen.md` con su motivo (SC-004).
- [ ] T067 [US2] **Del responsable:** lanzar a mano 3 veces el trabajo `e2e` en GitHub Actions y anotar los enlaces
  y el resultado de cada corrida en `evidencia/e2e/<fecha>-evaluacion.md`.
- [ ] T068 [US2] Escribir la decisión en `evidencia/e2e/<fecha>-evaluacion.md` y en `docs/05-gestion/04-pruebas.md`:
  - si las 5 corridas locales y las 3 del CI pasaron, preparar el cambio (en un commit aparte del responsable) que
    agrega `push` a los disparadores del trabajo `e2e`;
  - si no, explicar el motivo, y los recorridos quedan como comando manual (FR-015).
- [ ] T069 [US2] Actualizar **en este commit**:
  - `docs/05-gestion/04-pruebas.md`: PR23, PR29 y PR30, estabilidad, comandos y qué se versiona;
  - `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md`: AC05 y AC06, con sus enlaces y el objetivo
    medido (`vite preview`);
  - `docs/02-arquitectura-software/tecnologias.md`: Playwright, axe y Lighthouse;
  - `docs/trazabilidad.md`;
  - README de la plataforma: comandos de E2E y de calidad web.
- [ ] T070 [US2] Verificación de la fase 3:
  - 5 de 5 recorridos;
  - 16 informes;
  - `git status` no muestra nada de `no-versionado/`;
  - `revisar-secretos` en verde (sin JWT, `otpauth` ni `Bearer` en `evidencia/`);
  - si se tocó `frontend/src`: `npm run lint`, `npm run build` y `npm test` del frontend en verde;
  - Prettier y ESLint en verde;
  - CI en verde tras el push.
- [ ] T071 [US2] **Del responsable:** commit y push de la fase 3: `feat(009): recorridos E2E con Playwright,
  accesibilidad y rendimiento de la interfaz (fase 3, US2)`.

---

## Fase 4: US4 · Interfaz de producción y PR03 (P2, recortable, el 5.º y último en recortarse) · Criterio 8

**Objetivo:** Nginx sirve el build en el 8080 con las cabeceras de §4.1. Se mide PR03 (agregar una tercera
instancia), PR02 se cita de US1, y Lighthouse se mide otra vez contra el 8080.

**Prueba independiente:** las cabeceras esperadas con `curl`, `balanceador` en verde, y la carpeta de PR03 con el
throughput con 2 y 3 instancias y las solicitudes perdidas.

**Depende de:** US1 (k6). **Si se recorta:** Lighthouse queda solo con `vite preview`, y US7 no puede servir la
interfaz, así que se recorta con ella.

### Pruebas (primero)

- [ ] T072 [P] [US4] Crear `backend/test/helpers/nginx-web.ts`, con el patrón de `test/helpers/nginx.ts`: copia
  `nginx.conf`, `default.conf.template` y `web.conf.template`, más un `dist` de prueba con `index.html` y
  `assets/app-<hash>.js`.
- [ ] T073 [US4] Crear `backend/test/integration/escalado/web-estaticos.spec.ts` (FR-021):
  - `/assets/app-<hash>.js` responde con `public, max-age=31536000, immutable`;
  - `/` y `/index.html` responden con `no-cache`;
  - `/app/agenda` responde con el `index.html`;
  - gzip si se acepta;
  - `/api/v1/salud/listo` pasa al `upstream`.

### Implementación

- [ ] T074 [US4] Crear `nginx/templates/web.conf.template` según
  [contracts/nginx-y-publicacion.md](contracts/nginx-y-publicacion.md) §1: escucha en el 8080 dentro del contenedor,
  con el mismo bloque `/api/` que `default.conf.template` (las cabeceras de IP, los tiempos y `@sin_servicio`) y un
  comentario de cabecera.
- [ ] T075 [US4] En `nginx/templates/default.conf.template`, agregar **solo** la línea
  `include /etc/nginx/upstream-extra/*.conf;` dentro de `upstream api`, con un comentario (R06). Crear
  `nginx/upstream-extra/.gitkeep`.
- [ ] T076 [US4] Ejecutar **sola** la prueba `escalado/balanceador.spec.ts`. Debe seguir en verde con la línea nueva,
  lo que confirma el "por verificar" de R06.
  - Si nginx no acepta un comodín sin coincidencias, montar en la prueba un directorio vacío y documentarlo, sin
    cambiar las aserciones.
- [ ] T077 [US4] En `docker-compose.yml`:
  - servicio `preparar-frontend` (perfil `produccion`, `node:22`, `npm ci && npm run build`, copia `dist/` al
    volumen `frontend-dist`);
  - en `nginx`: monta `frontend-dist:/usr/share/nginx/html:ro` y `./nginx/upstream-extra:/etc/nginx/upstream-extra`,
    y publica `${WEB_PUERTO:-8080}:8080`, con un comentario sobre el posible choque de puertos (análisis B4);
  - servicio `backend-3` (perfil `escalado`, `<<: *backend`, `INSTANCIA_ID: backend-3`, IP
    `${IP_BACKEND_3:-172.28.0.18}`);
  - declarar los volúmenes;
  - `IP_BACKEND_3` y `WEB_PUERTO` en `.env.example`, **sin tocar el `.env`**.

  El modo de desarrollo (5173) no cambia (FR-022).
- [ ] T078 [US4] Hacer pasar T073, y en la copia de verificación comprobar las cabeceras de `http://localhost:8080`
  con `curl -sI`. Guardar la salida en `evidencia/despliegue/<fecha>-cabeceras-local/`, sin cookies.
- [ ] T079 [US4] Crear `carga/escalado/agregar-instancia.sh` y `.ps1`:
  1. el guardián del proyecto;
  2. k6 con carga constante (escenario `horarios` en el modo `constant-arrival-rate`, por variable);
  3. a los 60 s, `docker compose --profile escalado up -d --no-deps backend-3`;
  4. espera a que `/salud/listo` responda en `${IP_BACKEND_3}`;
  5. escribe `nginx/upstream-extra/backend-3.conf`;
  6. `docker compose exec nginx nginx -s reload`;
  7. al terminar, borra el `.conf`, recarga y detiene `backend-3`;
  8. guarda el throughput antes y después, las solicitudes perdidas (errores de red y 5xx) durante el alta y el
     reparto por instancia en `evidencia/carga/<fecha>-escalado-pr03/`, con la nota "las instancias comparten la
     CPU de un solo equipo" (US4-2).
- [ ] T080 [US4] Medir PR03 en la copia de verificación, sin ninguna suite en marcha, y guardar el resultado tal como
  salga, frente a EQ-03 (≥ 1,6 veces y 0 perdidas).
  - **PR02 no se mide otra vez** (análisis M11): el resumen de PR03 y la documentación citan la carpeta `reserva` de
    T044, porque `/api/` va al mismo `upstream api`. Una medición a través del 8080 mediría lo mismo con otro puerto.
- [ ] T081 [US4] Volver a ejecutar `calidad-web` con el objetivo `http://nginx:8080` (análisis M6) y guardar los 8
  informes de Lighthouse en una carpeta nueva, junto a los de `vite preview` de T066. Comparar las dos en
  `resumen.md`.
- [ ] T082 [US4] Confirmar que la CI incluye lo nuevo: `web-estaticos` corre en `test:int` (sin cambios en el flujo),
  y `carga/escalado` en Prettier y ESLint del trabajo `herramientas` (ampliar las rutas si hace falta).
- [ ] T083 [US4] Actualizar **en este commit**:
  - `docs/02-arquitectura-software/despliegue-y-escalabilidad.md`: §2.1 (8080, `WEB_PUERTO`, `backend-3`,
    `upstream-extra`), §4.1 (implementado en local) y §8;
  - `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md`: EQ-03, y EQ-02/PR02 citado de US1;
  - `docs/05-gestion/04-pruebas.md`: PR03, la prueba nueva y la segunda medición de Lighthouse;
  - `docs/04-modelo-c4/Nivel2-DiagramadeContenedores.md`: Nginx sirve los estáticos;
  - `docs/trazabilidad.md`;
  - README de la plataforma: el modo de producción local y el aviso del puerto 8080.
- [ ] T084 [US4] Verificación de la fase 4:
  - `npm run test:int -- escalado` en verde, incluidos `balanceador` y `web-estaticos`;
  - `npm run test:arch` en verde;
  - `revisar-secretos`, Prettier y ESLint en verde;
  - CI en verde tras el push.
- [ ] T085 [US4] **Del responsable:** commit y push de la fase 4: `feat(009): interfaz de producción en Nginx y
  escalado medido con una tercera instancia (fase 4, US4)`.

---

## Fase 5: US6 · Cobertura, insignia y pruebas frágiles (P2, recortable, el 4.º en recortarse) · Criterios 12 y 6

**Objetivo:** un informe de cobertura guardado (la de integración, en una corrida aparte sin metas), la insignia de la
CI, y las 11 pruebas frágiles estables sin quitar aserciones de comportamiento, con las metas medidas como mediana
(FR-034).

**Prueba independiente:** 3 corridas completas seguidas sin fallas de tiempo, y `evidencia/cobertura/` con los
porcentajes y las exclusiones.

**Tiempo:** unas 7 h de máquina. Las suites largas se pueden dejar corriendo de noche, sin mediciones en paralelo.

### Cobertura e insignia

- [ ] T086 [P] [US6] En `backend/package.json`, agregar el script `test:cobertura`: Jest con `--coverage`, los
  reportes `json-summary`, `text-summary` y `lcov`, y `collectCoverageFrom` sobre `src/**/*.ts`, excluyendo
  `**/*.d.ts`. Declarar las exclusiones (simuladores, scripts, migraciones y pruebas) en `jest.config.ts` y en
  `jest.int.config.ts`, o en un archivo de cobertura compartido. Sin umbral (FR-030).
- [ ] T087 [P] [US6] En `frontend/package.json`, agregar `@vitest/coverage-v8` en la versión exacta que corresponde
  a `vitest@3.2.7` y el script `test:cobertura` (`vitest run --coverage`). En `vite.config.ts`, agregar
  `test.coverage` con `provider: 'v8'`, los reportes `json-summary`, `text-summary` y `lcov`, y las exclusiones
  `src/api/schema*.d.ts` y `test/**`. Sin umbral.
- [ ] T088 [US6] En `.github/workflows/plataforma-barberias.yml`:
  - el trabajo `backend` usa `npm test -- --coverage` en lugar de `npm test`;
  - el trabajo `frontend` usa `npm run test:cobertura` en lugar de `npm test`;
  - cada uno hace `upload-artifact` del `coverage-summary.json`;
  - sin secretos y sin umbral.

  La integración no lleva cobertura en la CI.
- [ ] T089 [P] [US6] Crear `evidencia/scripts/test/guardar-cobertura.test.mjs`: a partir de un `coverage-summary.json`
  de ejemplo, el resumen tiene las líneas y ramas, las exclusiones y la fecha, y no inventa un total si falta un
  lado.
- [ ] T090 [US6] Crear `evidencia/scripts/guardar-cobertura.mjs`: copia el `coverage-summary.json` y escribe
  `resumen.md` con las líneas y ramas por backend y frontend, más las exclusiones y si la corrida fue con
  `COBERTURA=1`, en `evidencia/cobertura/<fecha>-<lado>/`. Debe hacer pasar T089.
- [ ] T091 [US6] Insignia del flujo
  (`https://github.com/<dueño>/<repo>/actions/workflows/plataforma-barberias.yml/badge.svg?branch=main`, con el
  dueño y el repositorio tomados de `git remote get-url origin`) en el `README.md` raíz y en el de la plataforma
  (FR-031).
- [ ] T092 [US6] Confirmar que el trabajo `herramientas` de la CI ejecuta `guardar-cobertura.test.mjs` (lo cubre
  `evidencia/scripts/test/`) y que Prettier y ESLint cubren `guardar-cobertura.mjs`.

### Pruebas frágiles (FR-032 a FR-034): primero se confirma la causa

- [ ] T093 [US6] Ejecutar **sola**, 3 veces, cada una de las 11 pruebas frágiles y anotar la duración y el resultado
  en una tabla de trabajo. Confirmar que cada falla es de tiempo, y no de comportamiento, antes de tocarla. Si una
  falla por comportamiento, detenerse e informar.

#### Metas de un requisito (mediana de 5 repeticiones; la meta no cambia)

- [ ] T094 [US6] Crear `backend/test/helpers/medir-meta.ts`:
  - `medirMeta(fn, { repeticiones: 5, meta, techo: 2 * meta, percentil })` devuelve la mediana (o el p95) y cada
    repetición;
  - aserciones: mediana ≤ meta (o p95 ≤ meta) y cada repetición ≤ techo;
  - con `COBERTURA=1`, **no** comprueba los tiempos (solo los registra), porque la instrumentación los falsea. Las
    aserciones de comportamiento de cada prueba siguen activas;
  - con `MEDIR_METAS=1`, guarda las repeticiones en `evidencia/pruebas-fragiles/<fecha>-<prueba>.json`.

  Prueba unitaria en `backend/test/unit/helpers/medir-meta.spec.ts`, que incluye el caso `COBERTURA=1`.
- [ ] T095 [P] [US6] `backend/test/integration/asistente/degradacion-asistente.spec.ts`: la meta ≤ 3 s (005 FR-008,
  SC-003) pasa a medirse con `medirMeta` (mediana de 5 y techo de 6 s). Conservar **todas** las aserciones de
  comportamiento (mensaje "no disponible", alternativa manual, el resto de la plataforma igual, el circuito).
- [ ] T096 [P] [US6] `backend/test/integration/pagos/proveedor-caido.spec.ts`: la meta ≤ 3 s (003 FR-044, SC-005)
  pasa a `medirMeta`. Conservar la cota inferior de ≥ 1 900 ms, la respuesta inmediata con el circuito abierto
  (< 100 ms; subir su margen solo si T093 lo muestra frágil) y la anulación del pago.
- [ ] T097 [P] [US6] `backend/test/integration/plataforma/indicadores-plataforma.spec.ts`: la meta ≤ 3 s con volumen
  (007 SC-005) pasa a `medirMeta`. Conservar los conteos exactos, el borde del mes y el mínimo de citas del volumen.
- [ ] T098 [P] [US6] `backend/test/integration/escalado/redis-caido.spec.ts`:
  - el límite de 2 s con la caché caída (006 SC-005, p95 ≤ 2 s) pasa a `medirMeta` con `percentil: 95`;
  - los límites de 1 s y los derivados de `CACHE_TIMEOUT_MS` son márgenes: se suben según T093 sin quitar el
    `>= limiteMs * 0.9`;
  - conservar el TTL ≤ 10 y "0 reservas incorrectas".

#### Resto de las frágiles (solo márgenes; se registra el valor anterior, el nuevo y el motivo)

- [ ] T099 [P] [US6] `backend/test/integration/escalado/balanceador.spec.ts`: subir solo los `AbortSignal.timeout` y
  las esperas que T093 señale. Conservar el reparto, la caída de una réplica y `cortadas.length >= 1`.
- [ ] T100 [P] [US6] `backend/test/integration/adelantos/confirmacion-adelanto.spec.ts` (y
  `confirmacion-adelanto-concurrencia.spec.ts` si T093 lo señala): solo las esperas y el `testTimeout`. Conservar los
  estados de la cita y del adelanto y el recordatorio.
- [ ] T101 [P] [US6] `backend/test/integration/pagos/conciliacion.spec.ts`: solo las esperas. Conservar
  `fallidos >= 1` y "el dinero recibido nunca se ignora".
- [ ] T102 [P] [US6] `backend/test/integration/escalado/cache-catalogo.spec.ts`: solo las esperas. Conservar el TTL
  `> 0` y `≤ 10` y los casos de invalidación.
- [ ] T103 [P] [US6] `backend/test/integration/shared/cache-compartida.spec.ts`: subir los márgenes de respuesta
  (`< 50` ms y `< 600` ms) solo si T093 lo muestra. Conservar los TTL (110 a 120, > 86 000, 50 000 a 60 000).
- [ ] T104 [P] [US6] `frontend/test/pages/historial-pagos.spec.tsx`: solo las esperas de Testing Library y el
  tiempo límite por prueba, si T093 lo muestra. `vite.config.ts` ya tiene `testTimeout: 30_000`: comprobar si eso ya
  lo resolvió. Conservar las aserciones de los textos de estado.
- [ ] T105 [P] [US6] `frontend/test/pages/transferencia.spec.tsx`: igual que T104. Conservar el flujo "elegir un plan
  y pagar por transferencia".
- [ ] T106 [US6] Comprobar que ninguna aserción de comportamiento se quitó. Comparar con `git diff` el número de
  `expect(` por archivo, antes y después: solo puede igualarse o subir, salvo los `expect` de tiempo reemplazados por
  `medirMeta`, que se anotan uno por uno.
- [ ] T107 [US6] Tres corridas completas seguidas, **sin cobertura**, del backend (`test`, `test:int` y `test:arch`) y
  del frontend. Las 11 no fallan por tiempo (SC-009). Una de ellas, con `MEDIR_METAS=1`, guarda las repeticiones.
  - Si una meta sigue inestable con la mediana, pasarla a la suite aparte `test:metas` (un `jest.metas.config.ts` y
    un paso `continue-on-error` en la CI) y documentarlo. **La meta no cambia.**
- [ ] T108 [US6] **Corrida aparte de cobertura** (análisis A4): `test:cobertura` del backend (unidad e integración) con
  `COBERTURA=1`, sin exigir las metas de tiempo, y la del frontend. Guardar con T090 en `evidencia/cobertura/`. Esta
  corrida no cuenta para SC-009, y así se escribe.
- [ ] T109 [US6] Actualizar **en este commit**:
  - `docs/05-gestion/04-pruebas.md`:
    - cobertura con su enlace y la nota de la corrida aparte;
    - tabla de las 11 pruebas con el valor anterior, el nuevo, el motivo y si es meta o margen (FR-033);
    - totales;
  - `docs/trazabilidad.md`;
  - README: la insignia.
- [ ] T110 [US6] Verificación de la fase 5:
  - las 3 corridas de T107 en verde;
  - `revisar-secretos` en verde;
  - la CI en verde, con la cobertura subida como artefacto;
  - la insignia muestra la corrida de `main` tras el push.
- [ ] T111 [US6] **Del responsable:** commit y push de la fase 5: `test(009): cobertura, insignia de CI y pruebas de
  tiempo estabilizadas sin quitar aserciones (fase 5, US6)`.

---

## Fase 6: US5 · Base de datos con evidencia (P2, recortable, el 3.º en recortarse) · Criterio 9

**Objetivo:** guardar los planes reales de las consultas críticas (sin valores de parámetros), el pool calculado,
mediciones con 52 000, 130 000 y 260 000 citas (con la extrapolación marcada como estimación) y el simulacro de
respaldo y restauración (PR22), con la excepción acotada del superusuario.

**Prueba independiente:** `evidencia/base-de-datos/` con los planes, el pool, el volumen y el acta, con sus
fechas, comandos y tiempos.

**Depende de:** US1 (k6 con poca carga).

### Pruebas (primero)

- [ ] T112 [P] [US5] Crear `evidencia/scripts/test/planes.test.mjs`: `extraer-planes`, con un registro de ejemplo de
  `auto_explain` en JSON:
  - separa las consultas críticas por patrón (horarios libres, agenda, reserva, reportes e indicadores);
  - indica el índice usado o "Seq Scan";
  - **nunca** descarta un plan sin índice;
  - **descarta** cualquier `Query Parameters` o valor literal que aparezca, y conserva solo el texto con `$1`, `$2`…
    (análisis A7).
- [ ] T113 [P] [US5] Crear `evidencia/scripts/test/simulacro.test.mjs`: la comparación de conteos detecta una
  diferencia de una fila, y el acta marca "no cumple" si RLS no está activa o si los conteos difieren.
- [ ] T114 [P] [US5] Crear `semilla/test/volumen.test.mjs`:
  - el generador de franjas no solapa las citas de un mismo barbero ni de un mismo cliente dentro de un tenant
    (restricciones de exclusión de la migración 0011);
  - reparte el total pedido entre las barberías;
  - con una muestra cuyo ritmo proyecta más de 45 minutos, termina con el código 7 y propone el mayor múltiplo de
    52 000 que quepa (análisis M4).
- [ ] T115 [P] [US5] Crear `evidencia/scripts/test/superusuario.test.mjs`: `revisar-superusuario` falla si `postgres`
  aparece como usuario de conexión (`-U postgres`, `postgres://postgres:`, `PGUSER=postgres`) en un archivo que no sea
  `evidencia/scripts/simulacro-respaldo.*`, `docker-compose.yml` (servicio `db`) o `db/init/`. Pasa con el simulacro
  (análisis C2).

### Implementación

- [ ] T116 [US5] Crear `docker-compose.medicion.yml`, que sobrescribe el `command` de `db` con
  `shared_preload_libraries=auto_explain`, `auto_explain.log_min_duration=0`, `auto_explain.log_analyze=on`,
  `auto_explain.log_buffers=on`, `auto_explain.log_format=json`, **`auto_explain.log_parameter_max_length=0`** y
  `max_connections=100`. Comentario: nunca para medir las cifras de US1, y por qué no se registran los parámetros.
- [ ] T117 [US5] Crear `evidencia/scripts/extraer-planes.mjs` y `.sh`/`.ps1`:
  - primero, el guardián del proyecto;
  - leen `docker compose logs db`, extraen los planes y guardan cada uno en
    `evidencia/base-de-datos/<fecha>-planes/`, con el texto con marcadores;
  - escriben un `resumen.md` que dice qué índice usa cada consulta (FR-024).

  Debe hacer pasar T112.
- [ ] T118 [US5] Crear `semilla/volumen.mjs`, `semilla/volumen.sql` y `semilla/volumen.sh`/`.ps1` (research R07,
  análisis M4):
  - el guardián del proyecto;
  - crea por la API las barberías `volumen-*`, con sus barberos, servicios y clientes;
  - inserta las citas **dentro de la base, por conjuntos**, con `psql` en el contenedor `db` como `barberias_app`
    (con la URL de desarrollo de Compose; **nunca** `postgres` ni el dueño). Por cada barbería, en una transacción:
    - `select set_config('app.tenant_id', <tenant>, true)`;
    - `INSERT INTO appointment … SELECT … FROM generate_series(…)` en franjas que no se solapan;
    - el historial de estados, en `appointment_status_history`;
  - no usa `COPY FROM`, que no se admite con RLS;
  - mide primero una muestra de 10 000 citas y proyecta el tiempo. Si supera los 45 minutos, termina con el código 7.
  - `--citas` acumula: se llama con 52 000, luego hasta 130 000 y luego hasta 260 000.

  Debe hacer pasar T114.
- [ ] T119 [US5] Crear `evidencia/scripts/pool.mjs`:
  - el guardián del proyecto;
  - lee de la lista blanca los tamaños de los pools (`DB_POOL_APP_MAX`, `DB_POOL_PUBLICO_MAX`, los de plataforma y
    dueño, desde la configuración del backend);
  - calcula `N × Σ pools + migraciones + reserva` frente a `max_connections`, para 2 y 3 instancias;
  - muestrea `pg_stat_activity` (como `barberias_app`, solo los conteos por estado) durante un escenario de k6;
  - guarda en `evidencia/base-de-datos/<fecha>-pool/` (FR-025).
- [ ] T120 [US5] Crear `evidencia/scripts/simulacro-respaldo.sh` y `.ps1` (PR22, FR-027; research R07, excepción
  acotada C2):
  1. el guardián del proyecto;
  2. `docker compose exec db pg_dump -U postgres -Fc barberias` (superusuario **solo dentro del contenedor `db`**);
  3. `createdb barberias_restaurada`;
  4. `pg_restore`;
  5. conteos por tabla en las dos bases;
  6. `relrowsecurity` y `relforcerowsecurity` en las tablas de negocio;
  7. una consulta con `barberias_app` sin tenant devuelve 0 filas;
  8. tiempos de respaldo y de restauración frente a RPO ≤ 24 h y RTO ≤ 4 h;
  9. `dropdb barberias_restaurada` **siempre**;
  10. acta en `evidencia/base-de-datos/<fecha>-simulacro-pr22/`, con un apartado "Excepción acotada" que explica por
      qué se usa el superusuario y dónde no se usa.

  Nunca toca el volumen ni la base `barberias`, salvo para leerla. No crea roles. Debe hacer pasar T113.
- [ ] T121 [US5] Crear `evidencia/scripts/revisar-superusuario.mjs`, que debe hacer pasar T115.
- [ ] T122 [US5] Ampliar el trabajo `herramientas` de la CI: `semilla/test/volumen.test.mjs` (lo cubre
  `semilla/test/`), los tests nuevos de `evidencia/scripts/test/`, `node evidencia/scripts/revisar-superusuario.mjs`, y
  `semilla/volumen.*` en Prettier y ESLint.
- [ ] T123 [US5] En la copia de verificación, sin ninguna suite en marcha:
  1. planes con `docker-compose.medicion.yml` y un escenario de k6 con poca carga;
  2. volumen de 52 000 citas y medición de horarios y reportes (k6 apuntando a una barbería `volumen-*`), luego hasta
     130 000 y luego hasta 260 000, midiendo en cada punto;
  3. extrapolación a 1 000 000 en `resumen.md` (recta del p95 y del costo del plan, marcada "estimación, no
     medición");
  4. el pool;
  5. el simulacro.

  Guardar todo **tal como salga**. Volver a levantar `db` sin el archivo de medición.
- [ ] T124 [US5] Actualizar **en este commit**:
  - `docs/02-arquitectura-software/multi-tenancy-y-datos.md`: pool, respaldo y restauración (con la excepción acotada
    y su motivo), el volumen con su extrapolación, y lo no construido (réplicas de lectura, particionado, PgBouncer)
    con su motivo y la condición para construirlos, FR-028;
  - `docs/02-arquitectura-software/despliegue-y-escalabilidad.md`: §6, "respaldos restaurados con éxito", con el
    enlace; §8;
  - `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md`: EQ-22;
  - `docs/05-gestion/04-pruebas.md`: PR22;
  - `docs/trazabilidad.md`.
- [ ] T125 [US5] Verificación de la fase 6:
  - `node --test` de las carpetas de herramientas en verde;
  - `revisar-superusuario` y `revisar-secretos` en verde;
  - acta y planes guardados, sin valores de parámetros;
  - la base `barberias_restaurada` ya no existe;
  - Prettier y ESLint en verde;
  - CI en verde tras el push. Si US6 se recortó, se aplica la regla de R13.
- [ ] T126 [US5] **Del responsable:** commit y push de la fase 6: `feat(009): evidencia de escalabilidad de la base
  de datos y simulacro de respaldo (fase 6, US5)`.

---

## Fase 7: US7 · Dominio, CDN y CD por extracción (P3, recortable, el 2.º en recortarse) · Criterios 10 y 12

**Objetivo:** la demo en `https://ayacuchobarber.shop` por un túnel con nombre desde el Nginx de Compose (mismo
origen), con la CDN de Cloudflare, en el proyecto `barberias-publicacion` con la subred `172.30.0.0/24`, con
contraseñas al azar no versionadas y CD por extracción (pull-based).

**Prueba independiente:** HTTPS válido, `cf-cache-status: HIT` en `assets`, y una publicación medida desde el fin de
la CI verde hasta el nuevo `version.json`.

**Depende de:** US4 (8080 y `frontend-dist`), T003 (ADR-035) y T004 (aclaración PATCH, para T141).

### Viabilidad (tiempo limitado; decide el corte)

- [ ] T127 [US7] **Comprobación de viabilidad, con un límite de 3 horas** (las cuentas y el DNS los opera el
  responsable; el agente solo prepara y ejecuta pruebas sin secretos y documenta). Comprobar lo siguiente:
  1. que `cloudflared` **gestionado localmente** acepte una regla de entrada comodín (`*.ayacuchobarber.shop`) y el
     dominio raíz en `config.yml`;
  2. que el Universal SSL de la zona cubra `ayacuchobarber.shop` y `*.ayacuchobarber.shop` (se ve en el panel y con
     `openssl s_client` contra un subdominio una vez creado el DNS);
  3. cómo pasar el identificador del túnel **sin versionarlo**: por nombre con el archivo de credenciales
     `tunel.json` (nombre fijo), o por una variable de `publicacion/publicacion.env`.

  Resultado en `evidencia/despliegue/<fecha>-viabilidad.md`, sin identificadores ni secretos.
  - **Si 1 o 3 fallan** o se agota el tiempo, el corte queda **decidido en esta tarea**: US7 y US8 no se construyen.
    Se documenta el motivo en `spec.md` ("Desviaciones"), en `docs/trazabilidad.md` y en el despliegue, y la
    evidencia de despliegue es la demo local de US4 (FR-040). Se saltan T128 a T153 y toda la fase 8.
  - **Si solo falla 2**, US7 sigue con el raíz y `www`, y se recorta US8.
- [ ] T128 [US7] **Del responsable:** crear el túnel con nombre (con `cloudflared tunnel login` y `tunnel create`, en
  su equipo), guardar el archivo de credenciales como **`publicacion/secretos/tunel.json`** (nombre fijo, análisis
  M5) y no compartir su contenido.
- [ ] T129 [US7] **Del responsable:** crear un token de GitHub **de grano fino, de solo lectura (Actions: read) y
  limitado a este repositorio**, y guardarlo en `publicacion/publicacion.env` (a partir del ejemplo de T139).
- [ ] T130 [US7] **Del responsable:** en Cloudflare, crear los registros DNS **proxied** del dominio raíz y de `www`
  hacia el túnel, y activar **Always Use HTTPS**. El comodín `*` se crea en la fase 8 (T154).

### Pruebas (primero)

- [ ] T131 [P] [US7] Crear `backend/test/helpers/nginx-publicacion.ts`: levanta Nginx con `nginx.conf`,
  `default.conf.template`, `web.conf.template` y `publicacion.conf.template`, con un `dist` de prueba, delante de dos
  instancias en proceso. Simula `cloudflared` con la variable de plantilla `IP_CLOUDFLARED` apuntando al cliente de
  la prueba.
- [ ] T132 [US7] Crear `backend/test/integration/escalado/nginx-publicacion.spec.ts` (parte de US7):
  - con `CF-Connecting-IP: 203.0.113.7` desde la IP de `cloudflared`, el backend ve esa IP: el límite de
    solicitudes cuenta por ella, y dos IP distintas no comparten el contador;
  - desde otra IP, la cabecera se **ignora**;
  - un `Host` reservado (`api.`) responde 301 al raíz;
  - `/assets/*` sale con la caché inmutable y `/` con `no-cache`.
- [ ] T133 [P] [US7] Crear `publicacion/test/gitignore.test.mjs` (`node --test`, con `git check-ignore`):
  `publicacion/publicacion.env`, `publicacion/secretos/tunel.json` y `publicacion/secretos/cuentas-publicadas.json`
  están ignorados; `publicacion/publicacion.env.example`, `publicacion/cuentas-publicadas.example.json` y
  `publicacion/red-publicacion.env` **no** lo están.
- [ ] T134 [P] [US7] Ampliar `semilla/test/semilla.test.mjs` con el modo publicación:
  - genera contraseñas distintas por cuenta, que cumplen la política;
  - las escribe solo en la ruta de salida indicada, de forma atómica;
  - **no** las imprime (se captura `stdout` y `stderr`);
  - con una cuenta existente y una contraseña guardada que no sirve, termina con código 4;
  - `--reiniciar-contrasenas` sin `--modo publicacion` termina con código 3.
- [ ] T135 [P] [US7] Crear `publicacion/test/actualizador.test.mjs` con una API de GitHub falsa:
  - publica solo una corrida `success` de `push` en `main`;
  - rechaza un artefacto cuyo `version.json` no coincide con el `head_sha`;
  - copia `assets/` sin borrar los de las últimas 24 h;
  - escribe `index.html` y `version.json` al final;
  - registra la publicación;
  - si falla, conserva la versión anterior;
  - nunca registra el token;
  - **sin token, o con un 401 o un 403** (análisis M10): registra el error, no publica, y tras 3 errores seguidos
    espera 1 hora y lo registra una sola vez.
- [ ] T136 [P] [US7] Crear `publicacion/test/configuracion.test.mjs` (análisis M5 y A1):
  - `publicacion/cloudflared/config.yml` no contiene ningún UUID ni identificador de cuenta o zona, y su
    `credentials-file` termina en `/tunel.json`;
  - `publicacion/red-publicacion.env` define `RED_SUBRED=172.30.0.0/24` y todas las `IP_*` dentro de esa subred, sin
    repetirse.

### Implementación

- [ ] T137 [US7] Crear `nginx/templates/publicacion.conf.template` según
  [contracts/nginx-y-publicacion.md](contracts/nginx-y-publicacion.md) §2:
  - puerto 8081 (no publicado);
  - `set_real_ip_from ${IP_CLOUDFLARED}` y `real_ip_header CF-Connecting-IP`;
  - `server_name` para `${DOMINIO_PUBLICO}` y `www.${DOMINIO_PUBLICO}`, y para los reservados con un 301;
  - la misma interfaz y `/api/` que el 8080.

  Debe hacer pasar T132.
- [ ] T138 [US7] Crear `publicacion/cloudflared/config.yml`:
  - reglas para el raíz y `www` hacia `http://nginx:8081`, y al final `http_status:404`;
  - `credentials-file: /etc/cloudflared/secretos/tunel.json`;
  - **sin** identificadores: el modo de pasar el túnel sale de T127.
- [ ] T139 [US7] Crear:
  - `publicacion/publicacion.env.example`: los nombres sin valores (token de GitHub de solo lectura, dueño y
    repositorio, nombre del túnel y, si T127 lo exige, la variable del identificador);
  - `publicacion/cuentas-publicadas.example.json`: con marcadores `"<generada>"`;
  - `publicacion/red-publicacion.env`: `RED_SUBRED=172.30.0.0/24` y `IP_NGINX=172.30.0.10` …
    `IP_CLOUDFLARED=172.30.0.17` e `IP_BACKEND_3=172.30.0.18`.

  En `.gitignore`, agregar `publicacion/publicacion.env`, `publicacion/secretos/` y `**/cuentas-publicadas.json`.
  Debe hacer pasar T133 y T136.
- [ ] T140 [US7] Crear `docker-compose.publicacion.yml`:
  - servicio `cloudflared` (perfil `publicacion`, `cloudflare/cloudflared:<etiqueta exacta>`, IP
    `${IP_CLOUDFLARED:-172.30.0.17}`, monta `config.yml` y `publicacion/secretos/` de solo lectura, `env_file:
    publicacion/publicacion.env`, **nunca** `.env`);
  - servicio `actualizador-frontend` (perfil `publicacion`, `node:22`, monta `publicacion/actualizador`, el volumen
    `frontend-dist` y `evidencia/despliegue`, `env_file: publicacion/publicacion.env`);
  - en `backend-1` y `backend-2`, `environment` con `CORS_ORIGIN`, `FRONTEND_BASE_URL`, `URL_PUBLICA` y
    `PAGOS_URL_RETORNO` igual a `https://${DOMINIO_PUBLICO:-ayacuchobarber.shop}`;
  - en `nginx`, las variables `DOMINIO_PUBLICO`, `DOMINIO_PUBLICO_REGEX` (`ayacuchobarber\.shop`) e
    `IP_CLOUDFLARED`.

  Comentario: siempre con `-p barberias-publicacion` y `red-publicacion.env` exportado.
- [ ] T141 [US7] Tras T004, agregar a `.github/workflows/plataforma-barberias.yml` el trabajo `artefacto-frontend`:
  - `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`;
  - `needs: [backend, frontend, herramientas]`;
  - `npm ci && npm run build` en `frontend/`;
  - `version.json` con `${{ github.sha }}` y la fecha;
  - `actions/upload-artifact` con el nombre `frontend-dist` y 7 días de retención.

  Sin secretos y sin base de datos. Comentario con la referencia a la aclaración PATCH 1.7.2. Si T001 no se aprobó,
  no se hace: el CD queda como publicación manual con el mismo actualizador, y se documenta.
- [ ] T142 [US7] Crear `publicacion/actualizador/actualizar.mjs` (Node 22, sin dependencias) según
  [contracts/nginx-y-publicacion.md](contracts/nginx-y-publicacion.md) §5:
  - sondea cada 5 minutos (`ACTUALIZADOR_INTERVALO_MS`);
  - descomprime con `node:zlib` o con el `unzip` de la imagen;
  - aplica la espera por errores de autenticación (M10);
  - escribe `evidencia/despliegue/publicaciones.jsonl`.

  Debe hacer pasar T135.
- [ ] T143 [US7] Completar en `semilla/cargar-semilla.mjs` el modo `--modo publicacion` y `--salida-cuentas`, con
  contraseñas al azar de `semilla/lib/contrasenas.mjs`, escritura atómica con permisos de solo el usuario, ninguna
  impresión y los códigos 3 y 4. Debe hacer pasar T134.
- [ ] T144 [US7] Crear `semilla/reiniciar-publicacion.sh` y `.ps1` (R04):
  1. exportan `publicacion/red-publicacion.env`;
  2. se niegan si el proyecto no es exactamente `barberias-publicacion` (código 5);
  3. detienen ese proyecto;
  4. borran **solo** el volumen `barberias-publicacion_datos-postgres`, nombrado de forma explícita;
  5. lo levantan y esperan a `/salud/listo`;
  6. ejecutan la semilla con `--modo publicacion --reiniciar-contrasenas --salida-cuentas
     publicacion/secretos/cuentas-publicadas.json`.

  Nunca usan `down -v` ni tocan otro proyecto.
- [ ] T145 [US7] Crear `publicacion/levantar.sh` y `.ps1`:
  - exportan `publicacion/red-publicacion.env` y `COMPOSE_PROJECT_NAME=barberias-publicacion`;
  - se niegan (código 8) si la demo de desarrollo (el proyecto `plataforma-barberias`) tiene contenedores
    corriendo;
  - comprueban que existen `publicacion/publicacion.env` y `publicacion/secretos/tunel.json` **sin leer su
    contenido**;
  - ejecutan `docker compose -p barberias-publicacion -f docker-compose.yml -f docker-compose.publicacion.yml
    --profile produccion --profile publicacion up -d`.
- [ ] T146 [US7] Crear `evidencia/scripts/evidencia-despliegue.sh` y `.ps1`:
  - `curl -sI` a la raíz, a un `assets/*` (dos veces, para ver `MISS` y `HIT`), a `/api/v1/salud/listo` y a
    `/version.json`;
  - `nslookup` o `dig` del raíz y de `www`;
  - emisor y nombres del certificado (`openssl s_client`);
  - filtra `set-cookie`, `cf-ray` y cualquier cabecera con un token antes de guardar en
    `evidencia/despliegue/<fecha>/`.
- [ ] T147 [US7] Ampliar el trabajo `herramientas` de la CI: `node --test publicacion/test/` (incluido
  `gitignore.test.mjs` con `git check-ignore`), y `publicacion` en Prettier y ESLint.
- [ ] T148 [US7] Hacer pasar T131 a T136 y `test:arch`. En la copia de verificación, sin túnel real, levantar la
  publicación con el perfil, salvo `cloudflared`, y comprobar el 8081 desde la red con `docker compose exec` y un
  `Host` de prueba.
- [ ] T149 [US7] **Del responsable:** con la demo de desarrollo detenida, ejecutar `publicacion/levantar` y la
  semilla en el modo publicación. Comprobar que `https://ayacuchobarber.shop` responde y que entra con una cuenta de
  `publicacion/secretos/cuentas-publicadas.json`. Ejecutar una vez `reiniciar-publicacion` y comprobar que las
  contraseñas anteriores dejan de servir.
- [ ] T150 [US7] Con el sitio publicado por el responsable, ejecutar `evidencia-despliegue` y guardar la evidencia.
  Tras el siguiente push a `main` con la CI en verde, comprobar en `publicaciones.jsonl` el tiempo **desde el fin de
  la corrida verde** hasta la publicación (SC-010), y que una corrida roja no publicó nada.
- [ ] T151 [US7] Actualizar **en este commit**:
  - `docs/02-arquitectura-software/despliegue-y-escalabilidad.md`: nueva §2.3, "Publicación de demostración":
    - el diagrama;
    - **el análisis de FR-035** (análisis M7): las alternativas (a) a (d) de ADR-035 y la tabla de research R09
      (Pages frente al túnel), con costos, secretos, RLS y datos personales fuera del país;
    - las limitaciones tal cual (equipo encendido, no es producción, producción real necesita un backend alojado y
      una base administrada);
    - "una demo a la vez" y las subredes;
    - el CD por extracción (pull-based);
    - además, §5 HTTPS;
  - `docs/02-arquitectura-software/seguridad-y-privacidad.md`: túnel, IP real, lo no expuesto, contraseñas no
    publicadas, datos fuera del país;
  - `docs/04-modelo-c4/Nivel1-DiagramadeContextodelSistema.md` y `Nivel2-DiagramadeContenedores.md`: Cloudflare (DNS,
    CDN y túnel);
  - ADR-035 aplicado en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`, tras T003;
  - `docs/05-gestion/05-riesgos.md`: equipo apagado, demo pública, credenciales;
  - `docs/trazabilidad.md`;
  - README raíz y de la plataforma: la URL, las limitaciones y que las contraseñas de la demo publicada no están en
    el repositorio.
- [ ] T152 [US7] Verificación de la fase 7:
  - `npm run test:int -- escalado`, `test:arch` y `node --test` en verde;
  - `git status` sin `publicacion/publicacion.env`, `publicacion/secretos/` ni `cuentas-publicadas.json`;
  - `config.yml` sin ningún UUID (T136);
  - `revisar-secretos` en verde, y una búsqueda en el repositorio de los patrones de token y de identificadores de
    Cloudflare sin resultados;
  - Prettier y ESLint en verde;
  - CI en verde tras el push, con `artefacto-frontend` subido. Si US6 se recortó, se aplica la regla de R13.
- [ ] T153 [US7] **Del responsable:** commit y push de la fase 7: `feat(009): demo publicada en ayacuchobarber.shop
  por túnel con CDN y CD por extracción (fase 7, US7)`.

---

## Fase 8: US8 · Subdominio por barbería (P3, recortable, el 1.º en recortarse) · Criterio 10

**Objetivo:** `slug.ayacuchobarber.shop` abre la página pública de la barbería por medio de una redirección a
`/b/slug`, solo en Nginx. El aislamiento no depende del host.

**Prueba independiente:** la prueba de sesión cruzada y la prueba de arquitectura en verde, y el subdominio
publicado muestra la barbería.

**Depende de:** US7 y del punto 2 de T127 (certificado comodín).

- [ ] T154 [US8] **Del responsable:** en Cloudflare, crear el registro DNS **proxied comodín `*`** hacia el túnel.
  Comprobar con T127 que el certificado lo cubre.

### Pruebas (primero)

- [ ] T155 [P] [US8] Crear `backend/test/architecture/sin-host.spec.ts` (FR-045; análisis M3): recorre
  `backend/src/**/*.ts` y falla si encuentra lecturas del host **de la solicitud**, con los patrones acotados de
  research R11: `(req|request|solicitud)\.(hostname|host)\b`, `headers\.host\b`, `headers\[['"]host['"]\]`,
  `['"]x-forwarded-host['"]` y `\.get\(['"]host['"]\)`.
  - **No** busca `.host` a secas.
  - Incluye casos de control con dos textos de ejemplo en la propia prueba: el `host` de SMTP (como en
    `canal-correo-smtp.ts` y `configuracion.ts`) **no** da falso positivo, y `req.hostname` **sí** falla.
- [ ] T156 [US8] Ampliar `backend/test/integration/escalado/nginx-publicacion.spec.ts` con la sesión cruzada
  (FR-045, FR-046; SC-011):
  1. se crean las barberías A y B y se inicia sesión como propietario de A;
  2. con `Host: <slug-b>.ayacuchobarber.shop` y el token de A, la agenda, los clientes y los reportes devuelven solo
     datos de A y nunca de B;
  3. con ese host y sin token, la ruta privada responde 401;
  4. `GET /` con `Host: <slug>.ayacuchobarber.shop` responde 302 a `/b/<slug>`;
  5. un reservado (`api`, `www`, `admin`) **no** redirige a `/b/`;
  6. un host con mayúsculas o con puerto no rompe nada;
  7. un slug de 64 caracteres o más no coincide;
  8. `ayacuchobarberXshop` (un punto reemplazado) no coincide (análisis B1);
  9. `/b/<slug>` en el raíz responde igual que antes.
- [ ] T157 [P] [US8] Crear `e2e/recorridos/subdominio.spec.ts`: Chromium con
  `--host-resolver-rules="MAP *.ayacuchobarber.shop nginx"` hacia el 8081; el subdominio de
  `barberia-demo-centro` muestra su página pública.

### Implementación

- [ ] T158 [US8] En `nginx/templates/publicacion.conf.template`:
  - un `server` con
    `server_name ~^(?![a-z0-9-]{64})(?<slug>[a-z0-9]+(-[a-z0-9]+)*)\.${DOMINIO_PUBLICO_REGEX}$;`, con los puntos
    del dominio ya escapados en la variable (análisis B1) y la etiqueta limitada a 63 caracteres;
  - `location = / { return 302 /b/$slug; }`;
  - el resto, igual que el raíz;
  - los reservados ya tienen su `server_name` exacto (T137).

  Debe hacer pasar T156.
- [ ] T159 [US8] En `publicacion/cloudflared/config.yml`, agregar la regla `*.ayacuchobarber.shop` hacia
  `http://nginx:8081` antes del `http_status:404`. T136 sigue en verde: sin UUID.
- [ ] T160 [US8] Confirmar que la CI incluye lo nuevo: `sin-host` en `test:arch`, el recorrido del subdominio en el
  paquete `e2e` (Prettier, ESLint y `tsc` del trabajo `herramientas`) y `nginx-publicacion` en `test:int`.
- [ ] T161 [US8] Hacer pasar T155 a T157. Tras el push y con el túnel del responsable activo, comprobar con `curl -sI`
  que `https://barberia-demo-centro.ayacuchobarber.shop/` responde 302 a `/b/barberia-demo-centro` y que
  `https://api.ayacuchobarber.shop/` redirige al raíz. Guardar en `evidencia/despliegue/<fecha>-subdominios/`.
- [ ] T162 [US8] Actualizar **en este commit**:
  - `docs/02-arquitectura-software/multi-tenancy-y-datos.md`: el host no es el tenant; la prueba de arquitectura;
  - `docs/02-arquitectura-software/seguridad-y-privacidad.md`: host falsificado y reservados;
  - `docs/02-arquitectura-software/despliegue-y-escalabilidad.md` §2.3;
  - `docs/02-arquitectura-software/api-rest.md`: nota de los subdominios;
  - `docs/trazabilidad.md`;
  - README.
- [ ] T163 [US8] Verificación de la fase 8:
  - `test:arch` (incluida `sin-host`) y `npm run test:int -- escalado` en verde;
  - el recorrido del subdominio en verde;
  - `revisar-secretos`, Prettier y ESLint en verde;
  - CI en verde tras el push. Si US6 se recortó, se aplica la regla de R13.
- [ ] T164 [US8] **Del responsable:** commit y push de la fase 8: `feat(009): subdominio por barbería resuelto en
  Nginx sin depender del host para el aislamiento (fase 8, US8)`.

---

## Fase 9: Cierre (solo estados y totales)

- [ ] T165 Corrida completa final del backend (`test`, `test:int` y `test:arch`) y del frontend, sin cobertura ni
  mediciones en paralelo, con totales reales (archivos y pruebas, omitidas y fallas con su motivo). Una prueba
  intermitente se ejecuta sola antes de reportar.
- [ ] T166 Actualizar **solo estados y totales**:
  - `docs/trazabilidad.md`: fila de 009 con lo construido y lo recortado, y su motivo;
  - `docs/05-gestion/04-pruebas.md`: totales;
  - `docs/05-gestion/06-mvp-y-evolucion.md`, `docs/05-gestion/03-sdd-spec-kit.md`,
    `docs/05-gestion/07-guion-exposicion-y-defensa.md` y `docs/05-gestion/02-backlog-y-sprints.md`;
  - `specs/009-evidencia-calidad/spec.md`: estado y "Desviaciones";
  - la tabla de [contracts/evidencia.md](contracts/evidencia.md) §2, con los criterios marcados "construido" o "no
    construido", con su enlace.
- [ ] T167 Revisar:
  - que ningún documento presente como construido o desplegado lo que no lo está (FR-039);
  - que cada cifra citada enlaza su carpeta de `evidencia/` (SC-002);
  - que todos los enlaces Markdown de los documentos cambiados se resuelven;
  - que `revisar-secretos`, `revisar-superusuario`, Prettier y ESLint están en verde.
- [ ] T168 Verificación del cierre: CI en verde tras el push.
- [ ] T169 **Del responsable:** commit y push del cierre: `docs(009): cierre de la documentación de evidencia de
  calidad y despliegue (fase 9)`.

---

## Dependencias

```text
Fase 0 (gobierno) ─┬─ T002 → T045 (ADR-034 en la fase 2)
                   ├─ T004 → T063 (e2e en la CI) y T141 (artefacto)
                   └─ T003 → fase 7 (ADR-035 en T151)
Fase 1 US3 (guardián, revisar-secretos, herramientas) ──→ todas las demás
Fase 1 US3 ──→ Fase 2 US1 ──→ Fase 4 US4 ──→ Fase 7 US7 ──→ Fase 8 US8
         └──→ Fase 3 US2            └──→ Fase 6 US5
Fase 5 US6: independiente (después de la 4 por el orden de construcción)
Fase 9: al final, con lo que se haya construido
```

- Dentro de cada fase, las pruebas van antes que la implementación. Los documentos van en el mismo commit que la
  fase. La verificación (con `revisar-secretos`) va antes del commit del responsable.
- Recortar una fase posterior nunca rompe una anterior: cada fase solo agrega archivos o servicios con perfil, y los
  únicos cambios a archivos existentes son aditivos (una línea en `default.conf.template`, servicios con perfil en
  Compose y trabajos o pasos nuevos en la CI).
- **Espera de la CI en paralelo** (R14): mientras corre la CI de la fase N, se puede escribir la fase N+1 (la 1 con
  la 2, la 2 con la 3, la 4 con las pruebas de la 5, y la 6 con T127). No se hace push de N+1 hasta que N esté en
  verde, y nunca se mide mientras corre una suite.

## Paralelismo (ejemplos)

- **Fase 1:** T008 ∥ T009 ∥ T010 ∥ T011, luego T013 ∥ T014 ∥ T017 ∥ T021.
- **Fase 2:** T029 ∥ T030, luego T032 ∥ T033 ∥ T034 y T036 ∥ T037 ∥ T038.
- **Fase 3:** T052 a T059 en paralelo (archivos distintos).
- **Fase 5:** T086 ∥ T087 ∥ T089, y T095 a T105 en paralelo después de T093 y T094.
- **Fase 6:** T112 ∥ T113 ∥ T114 ∥ T115.
- **Fase 7:** T131, T133, T134, T135 y T136 en paralelo.

## Estrategia

1. **Mínimo entregable:** fases 0 a 3 (US3, US1 y US2). Cubren los criterios 6, 13 y 14, que hoy son "no".
2. Luego, en orden de construcción: US4 (8), US6 (12), US5 (9), US7 (10 y 12) y US8 (10).
3. Si el plazo aprieta, se recorta desde el final (US8, luego US7, US5, US6 y US4), y la fase 9 documenta el
   recorte.
