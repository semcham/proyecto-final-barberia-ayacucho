# Implementation Plan: Evidencia de calidad y despliegue

**Branch**: `009-evidencia-calidad` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-evidencia-calidad/spec.md` (aclarada el 2026-11-19)

## Summary

009 produce **evidencia medida y guardada** de lo ya construido. No agrega reglas de negocio, tablas ni módulos.

- **US1:** k6 en su imagen oficial, como servicio de Compose, contra Nginx con dos réplicas.
- **US2:** Playwright, axe y Lighthouse en la imagen oficial de Playwright, desde un paquete `e2e/` propio.
- **US3:** un script de arranque (un solo generador en Node con envoltorios para bash y PowerShell) y una semilla
  idempotente **por la API pública**. La carga normal no cambia contraseñas. La demo local usa contraseñas de
  desarrollo documentadas; la demo publicada usa contraseñas al azar en un archivo no versionado, y se reinicia
  recreando solo su propia base (research R04).
- **US4:** la interfaz compilada servida por el mismo Nginx en el 8080, y una tercera instancia agregada con una
  recarga de Nginx.
- **US5:** planes reales con `auto_explain` (sin valores de parámetros), el pool, volúmenes de 52 000, 130 000 y
  260 000 citas sembrados en menos de una hora (con la extrapolación marcada como estimación) y un simulacro
  `pg_dump` / `pg_restore` con la excepción acotada del superusuario.
- **US6:** cobertura, insignia y metas medidas como mediana.
- **US7:** la interfaz y la API **en el mismo origen por un túnel con nombre desde Nginx**, con el proxy y la CDN de
  Cloudflare delante y CD por extracción (pull-based) del artefacto de la CI.
- **US8:** el subdominio por barbería resuelto **solo en Nginx**, con una redirección a `/b/slug`.

Todo lo medido queda en `tecnologia/plataforma-barberias/evidencia/`. Las decisiones están en
[research.md](research.md), de R01 a R14 (R01b: copia de verificación aislada; R14: tiempo de la suite).

## Technical Context

**Language/Version**: TypeScript 5.9.3 (backend NestJS 11 y frontend React 19 con Vite 6) y Node 22. Scripts nuevos
en JavaScript ESM sin dependencias (`node:crypto`, `fetch`) y envoltorios en bash y PowerShell 5.1/7. Escenarios de
k6 en JavaScript. Plantillas de Nginx 1.27.

**Primary Dependencies**: las de siempre, sin cambios en las de producción. Nuevas:
- imágenes `grafana/k6`, `mcr.microsoft.com/playwright` y `cloudflare/cloudflared`, con etiquetas exactas que se
  fijan en cada fase;
- en el paquete `e2e/` (de desarrollo): `@playwright/test`, `@axe-core/playwright` y `lighthouse`;
- en el frontend (de desarrollo): `@vitest/coverage-v8`, en la versión que acompaña a `vitest@3.2.7`.

**Storage**: PostgreSQL 16 sin cambios de esquema. Solo `auto_explain` en el archivo de Compose de medición. Archivos
de evidencia en el repositorio.

**Testing**: Jest (unidad, integración con Testcontainers y arquitectura), Vitest, `node --test` para el generador de
`.env`, Playwright para los recorridos y k6 para la carga.

**Target Platform**: Docker Compose en el equipo del responsable (Windows, 8 GB) y GitHub Actions (`ubuntu-latest`).
Publicación de demostración por Cloudflare (plan gratuito) con un túnel.

**Project Type**: aplicación web (monolito modular más una SPA). 009 agrega herramientas, configuración y evidencia.

**Performance Goals**: las de la spec, medidas y no cambiadas:
- EQ-01: p95 ≤ 800 ms con 50 usuarios y 0 % de 5xx;
- EQ-02: 20 reservas por segundo durante 5 minutos, p95 ≤ 1 500 ms y error técnico < 1 %;
- EQ-03: ≥ 1,6 veces y 0 solicitudes perdidas;
- EQ-22: RPO ≤ 24 h y RTO ≤ 4 h;
- metas de las pruebas frágiles: ≤ 3 s, ≤ 3 s, ≤ 3 s y p95 ≤ 2 s;
- publicación en menos de 15 minutos contados desde el fin de la corrida verde de la CI.

**Constraints**:
- Ningún cambio de comportamiento (FR-001). La única conducta nueva, la de US8, vive en Nginx.
- Ningún secreto en el repositorio ni en la CI.
- No se lee ni se muestra el `.env` del responsable.
- Proveedor de IA falso.
- 8 GB de RAM: Nginx sigue siendo uno solo y los perfiles evitan levantar todo junto. Una demo a la vez.
- **Ningún script toca el proyecto, el `.env` ni el volumen del responsable:** `COMPOSE_PROJECT_NAME` es obligatorio y
  distinto de `plataforma-barberias`, y cada proyecto tiene su propia subred (research R01b).
- Entrega a fines de noviembre: unos 11 días. Hay unas 15,5 h de máquina en local, 7 de ellas en la fase 5, además
  de la espera de la CI (research R14).

**Scale/Scope**: 3 escenarios de carga, 5 recorridos, 4 pantallas × 2 tamaños, 2 barberías de semilla, hasta 260 000
citas de volumen y 11 pruebas frágiles.

## Constitution Check

_GATE: antes del research y otra vez tras el diseño._ Se evaluó contra la constitución **v1.7.1**. **Desde la fase 0
(2026-11-19) rige la v1.7.2**: el responsable aprobó la aclaración PATCH del principio XII, con sus dos aclaraciones de
"Restricciones", y quedó aplicada. Los ✅ "pendientes de aprobación" de XI, XII y "Restricciones" quedan aprobados.
ADR-034 y ADR-035 están aprobados y se aplican en `07-decisiones` en las fases 2 y 7.

| Principio | Antes | Después del diseño | Nota |
| --- | --- | --- | --- |
| I. Seis módulos | ✅ | ✅ | No hay módulos ni dependencias nuevas en `backend/src`. La semilla, la carga y los recorridos usan la API pública, no el código interno |
| II. Cuatro capas | ✅ | ✅ | No se toca `backend/src`. Las pruebas frágiles cambian solo esperas y la forma de medir las metas |
| III. Aislamiento | ✅ | ✅ | La semilla y los datos de carga pasan por la API (RLS y token), sin `BYPASSRLS`. En US8 el host solo produce una redirección a una ruta pública (excepción 1, ADR-021). El backend no lee el host de la solicitud y una prueba de arquitectura lo vigila. Hay prueba de sesión cruzada. El volumen de US5 inserta citas como `barberias_app` con el tenant fijado por `set_config` (RLS con `WITH CHECK`). El simulacro verifica que RLS sigue activa tras restaurar. **Excepción acotada aprobada por el responsable:** el superusuario `postgres` solo dentro del contenedor `db` y solo para el simulacro (ver abajo) |
| IV. Citas sin duplicados | ✅ | ✅ | Sin cambios. La carga de reservas cuenta los 409 aparte |
| V. Pagos | ✅ | ✅ | Solo la pasarela simulada; no se expone por el túnel |
| VI. IA | ✅ | ✅ | `IA_PROVEEDOR=falso` en Compose, el CI y los recorridos |
| VII. Notificaciones | ✅ | ✅ | Sin cambios. Mailpit y WhatsApp simulado no se exponen |
| VIII. Redis | ✅ | ✅ | Sin cambios. La caché de la CDN es solo de estáticos públicos |
| IX. Solo web | ✅ | ✅ | Se mide a 360 px y en escritorio |
| X. Pruebas | ✅ | ✅ | Hay pruebas por historia: el generador de `.env`, la prueba de idempotencia de la semilla, los recorridos, la carga con umbrales, la prueba `nginx-publicacion` (sesión cruzada y reservados), la prueba de arquitectura del host y las 11 pruebas frágiles con sus aserciones intactas |
| XI. ADR | ⚠️ | ✅ (pendiente de aprobación) | ADR-034 (k6, cambia R13 de 006) y ADR-035 (publicación, aclara ADR-006) están en **borrador** ([borradores/](borradores/)). Se aprueban en la fase 0 y se aplican en `07-decisiones` en su fase: ADR-034 en la fase 2 y ADR-035 en la fase 7 |
| XII. Ubicación | ⚠️ | ✅ (pendiente de aprobación) | Todo el código nuevo va en `tecnologia/plataforma-barberias/`. En `.github/workflows/`: la cobertura y el trabajo `herramientas` (pruebas de Node, Prettier, ESLint, auditoría y revisión de secretos) caben en "probar" y "verificar". El trabajo manual `e2e` y el `artefacto-frontend` necesitan la **aclaración PATCH 1.7.2** en borrador. No hay despliegue desde la CI. Si la aclaración no se aprueba, esos dos trabajos no se agregan (ver "Contradicciones") |
| Restricciones · Despliegue objetivo AWS | ⚠️ | ✅ (pendiente de aprobación) | La publicación por el túnel no es el despliegue objetivo. La aclaración en borrador lo dice de forma explícita, y ADR-006 no cambia |

### Contradicciones con la constitución (aviso antes de seguir)

1. **El trabajo `artefacto-frontend` y el trabajo manual `e2e` en `.github/workflows/`.** Hoy la excepción del
   principio XII dice "instalar, verificar, probar y construir". El trabajo `e2e` es "probar" y el artefacto es parte
   de "construir", pero conservar el artefacto para que otro lo publique puede leerse como el primer paso de un
   despliegue. **No se construyen sin la aclaración PATCH aprobada.** Esa aclaración reemplaza a la enmienda MINOR
   de la versión 1 del borrador, que ya no hace falta porque la CI no publica en ninguna CDN (R09).
2. **La publicación fuera de AWS** frente a "Despliegue objetivo: AWS con ALB". No es una violación si la demo no se
   presenta como el despliegue objetivo. La aclaración de "Restricciones" y ADR-035 lo dejan escrito. **Sin la
   aprobación, US7 no se construye** y se aplica el criterio de corte (FR-040).

### Excepción acotada aprobada por el responsable (2026-11-19)

**Superusuario `postgres` solo para el simulacro de respaldo y restauración (PR22).**

- **Por qué:** con FORCE RLS en todas las tablas de negocio, ningún rol sin `BYPASSRLS` puede respaldar la base
  completa. Con `barberias_owner`, el respaldo sale vacío o parcial.
- **Límites:**
  - solo dentro del contenedor `db` (`docker compose exec db …`);
  - solo en `evidencia/scripts/simulacro-respaldo.*`;
  - nunca en la aplicación, en la semilla, en el volumen ni en ningún script que lea o escriba datos de negocio;
  - no se crea ni se concede ningún rol con `BYPASSRLS`.
- **Comprobación en la CI:** el trabajo `herramientas` falla si `postgres` aparece como usuario de conexión fuera de
  ese script y de la configuración que ya existe.
- **Constitución:** no la viola, porque el principio III regula los roles de la aplicación. Para dejarlo registrado, se
  agrega una frase en "Restricciones" (privacidad y respaldo) en la misma aclaración PATCH en borrador.
- **Detalle:** research R07.

### Aislamiento de la copia de verificación (research R01b)

- **Proyecto:** todo script de 009 que llama a `docker compose` exige `COMPOSE_PROJECT_NAME`, y se niega (código 6) si
  falta o vale `plataforma-barberias`. La copia se crea en una carpeta llamada `barberias-verificacion`.
- **Subredes:** la copia usa `172.29.0.0/24` y la demo publicada `172.30.0.0/24`, con las variables `RED_SUBRED` e
  `IP_*` que ya existen.
- **Antes de la primera medición:** una tarea comprueba que el volumen y la red del responsable no se tocan.

No hay otras contradicciones. **No se cambió la constitución.** Los textos están en
[borradores/enmienda-xii-y-adr-publicacion.md](borradores/enmienda-xii-y-adr-publicacion.md) (versión 2) y
[borradores/adr-034-k6.md](borradores/adr-034-k6.md).

## Project Structure

### Documentation (this feature)

```text
specs/009-evidencia-calidad/
├── spec.md
├── plan.md                 # este archivo
├── research.md             # R01–R14 (con R01b)
├── data-model.md           # evidencia, semilla, escenarios, nombres de host
├── quickstart.md           # validación por historia
├── contracts/
│   ├── comandos.md         # comandos, entradas, salidas y códigos de salida
│   ├── nginx-y-publicacion.md  # 8080, 8081, túnel, CI y actualizador
│   └── evidencia.md        # reglas y criterios 6, 8, 9, 10, 12, 13, 14 → evidencia
├── borradores/
│   ├── enmienda-xii-y-adr-publicacion.md   # aclaración PATCH 1.7.2 y ADR-035 (versión 2)
│   └── adr-034-k6.md
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks (no lo crea este comando)
```

### Source Code (repository root)

```text
tecnologia/plataforma-barberias/
├── herramientas.eslint.config.mjs · .prettierignore   # ESLint y Prettier de las carpetas nuevas (sin evidencia/)
├── scripts/                         # US3 (nuevo)
│   ├── preparar-entorno.mjs         # generador único (node:crypto), con --subred
│   ├── preparar-entorno.sh / .ps1   # envoltorios (Node del equipo o imagen node:22)
│   ├── lib/proyecto.mjs / .sh / .ps1 # guardián de COMPOSE_PROJECT_NAME (código 6)
│   └── test/ (preparar-entorno y guardián; node --test)
├── semilla/                         # US3 (nuevo); la usan US1, US2, US5 y US7
│   ├── datos.json · README.md (cuentas de la demo LOCAL, con contraseñas de desarrollo)
│   ├── cargar-semilla.mjs (--modo local|publicacion, --reiniciar-contrasenas)
│   ├── volumen.mjs · volumen.sql · volumen.sh / .ps1   # US5: barberías por la API y citas por conjuntos como barberias_app
│   ├── reiniciar-publicacion.sh / .ps1   # US7: recrea solo la base del proyecto barberias-publicacion
│   └── lib/ (cliente de la API, lectura de Mailpit, idempotencia, contraseñas al azar)
├── carga/                           # US1 y US4 (nuevo)
│   ├── escenarios/{catalogo,horarios,reserva}.js · lib/
│   ├── medir.sh / .ps1
│   └── escalado/agregar-instancia.sh / .ps1
├── e2e/                             # US2 y US8 (nuevo, paquete propio)
│   ├── package.json · package-lock.json · playwright.config.ts
│   ├── recorridos/*.spec.ts · calidad-web/ (axe y Lighthouse) · informe-filtrado.mjs
│   └── estabilidad.sh / .ps1
├── evidencia/                       # resultados medidos (R01); **/no-versionado/ fuera de git
│   ├── carga/ e2e/ accesibilidad/ rendimiento-web/ base-de-datos/ cobertura/ pruebas-fragiles/ despliegue/
│   └── scripts/ (registrar-entorno, revisar-secretos, extraer-planes, pool, simulacro-respaldo, guardar-cobertura, evidencia-despliegue, test/)
├── publicacion/                     # US7 (nuevo)
│   ├── cloudflared/config.yml       # reglas de entrada, sin identificadores
│   ├── actualizador/actualizar.mjs  # CD por extracción (pull-based)
│   ├── levantar.sh / .ps1           # proyecto -p barberias-publicacion y subred 172.30; comprueba que la demo local no corre
│   ├── red-publicacion.env          # RED_SUBRED=172.30.0.0/24 y las IP fijas (sin secretos)
│   ├── publicacion.env.example      # nombres sin valores
│   ├── cuentas-publicadas.example.json  # forma del archivo de cuentas, con marcadores "<generada>"
│   ├── test/ (gitignore, actualizador; node --test)
│   └── secretos/                    # NO versionado (.gitignore): tunel.json (nombre fijo) y cuentas-publicadas.json
├── nginx/
│   ├── templates/default.conf.template   # +1 línea: include upstream-extra (US4)
│   ├── templates/web.conf.template       # 8080 (US4, nuevo)
│   ├── templates/publicacion.conf.template # 8081, real_ip y US8 (US7 y US8, nuevo)
│   └── upstream-extra/.gitkeep
├── docker-compose.yml               # servicios con perfiles: semilla, k6, e2e, preparar-frontend, backend-3; nginx 8080 y volúmenes
├── docker-compose.medicion.yml      # US5 (nuevo): auto_explain con log_parameter_max_length=0
├── docker-compose.publicacion.yml   # US7 (nuevo)
├── backend/
│   ├── test/integration/escalado/web-estaticos.spec.ts       # US4 (nuevo)
│   ├── test/helpers/nginx-web.ts                             # US4 (nuevo)
│   ├── test/integration/escalado/nginx-publicacion.spec.ts   # US7 y US8 (nuevo)
│   ├── test/helpers/nginx-publicacion.ts                     # US7 (nuevo)
│   ├── test/architecture/sin-host.spec.ts                    # US8 (nuevo; patrones acotados a la solicitud)
│   ├── test/helpers/medir-meta.ts                            # US6 (nuevo; mediana y COBERTURA=1)
│   ├── test/integration/** (11 pruebas frágiles)            # US6: márgenes y medianas
│   └── package.json                 # US6: test:cobertura
└── frontend/package.json            # US6: test:cobertura y @vitest/coverage-v8
.github/workflows/plataforma-barberias.yml   # US3 (trabajo herramientas, que cada fase amplía), US6 (cobertura), US2 (e2e manual) y US7 (artefacto)
tecnologia/plataforma-barberias/.gitignore   # US2: evidencia/**/no-versionado/; US7: publicacion/publicacion.env, publicacion/secretos/ y **/cuentas-publicadas.json (comprobado en el CI con git check-ignore)
```

**Structure Decision**: todo el código y la evidencia nuevos van en `tecnologia/plataforma-barberias/` (principio
XII). `backend/src` y `frontend/src` **no cambian**: la única excepción posible son las correcciones de accesibilidad
que exija axe en US2, y esas no pueden cambiar el comportamiento. No hacen falta reglas nuevas de
dependency-cruiser: no hay módulos ni dependencias nuevas. US8 agrega una prueba de arquitectura en Jest
(`test:arch`) que prohíbe leer el host **de la solicitud** en `backend/src` (sin falsos positivos por el `host` de
SMTP), y PR14 sigue igual. Las carpetas nuevas (`scripts/`, `semilla/`, `carga/`, `e2e/`, `publicacion/` y
`evidencia/scripts/`) pasan por Prettier, ESLint y sus pruebas de Node en el trabajo `herramientas` de la CI. `e2e/`
pasa además por una auditoría de dependencias.

## Fases (una por commit; cada una con su CI en verde)

| Fase | Historia | Entregables | Documentos que actualiza en **su** commit | Verificación |
| --- | --- | --- | --- | --- |
| 0 | Gobierno | Revisión del responsable de la aclaración PATCH 1.7.2 (que incluye la frase del superusuario solo para el respaldo), ADR-034 y ADR-035. Al aprobarlos, solo con aviso: la constitución y la plantilla del plan. **Los ADR no se aplican aquí:** ADR-034 se aplica en la fase 2 y ADR-035 en la fase 7 | Constitución (Sync Impact Report), `plan-template.md` y los borradores (estado) | Revisión del responsable |
| 1 | US3 | `scripts/preparar-entorno.*`, `semilla/` en el modo local (idempotente, sin cambiar contraseñas), el servicio `semilla`, el guardián de `COMPOSE_PROJECT_NAME`, `revisar-secretos`, la configuración de Prettier y ESLint de las carpetas nuevas y el trabajo `herramientas` de la CI | README raíz y de la plataforma (arranque en bash y PowerShell, cuentas de demostración), `04-pruebas`, `trazabilidad` y `02-backlog` | Prueba del generador, segunda carga de la semilla con 0 creadas, CI en verde, y SC-001 con el cronómetro del responsable |
| 2 | US1 | `carga/`, el servicio `k6` y 3 resultados medidos | `04-pruebas` (PR01, PR02), `08-escenarios` (EQ-01, EQ-02 con su cifra y su enlace), `despliegue §2.1`, `tecnologias`, ADR-034 aplicado, `trazabilidad` y README | 3 carpetas en `evidencia/carga/` y CI en verde |
| 3 | US2 | `e2e/`, 5 recorridos, axe y Lighthouse, el trabajo `e2e` manual (si se aprobó la aclaración), 5 corridas locales y 3 en el CI | `04-pruebas` (PR23, PR29, PR30, evaluación de estabilidad), `08-escenarios` (AC05, AC06), `tecnologias`, `trazabilidad` y README | 5 + 3 corridas y 16 informes |
| 4 | US4 | `web.conf.template` (`WEB_PUERTO`), `preparar-frontend`, `include upstream-extra`, `backend-3`, la medición de PR03 (PR02 se cita de US1) y Lighthouse otra vez contra el 8080 | `despliegue §2.1, §4.1, §8`, `08-escenarios` (EQ-03), C4 Nivel 2, `trazabilidad` y README | `balanceador` en verde, cabeceras con `curl` y PR03 medido |
| 5 | US6 | Cobertura (CI y local), insignia, 11 pruebas frágiles y medianas | `04-pruebas` (cobertura, tabla de pruebas frágiles con el valor anterior, el nuevo y el motivo), `trazabilidad` y README (insignia) | 3 corridas completas seguidas sin fallas de tiempo y la CI en verde |
| 6 | US5 | `docker-compose.medicion.yml` (sin parámetros), planes, pool, volúmenes de 52 000, 130 000 y 260 000 citas (< 1 h, con la extrapolación) y simulacro PR22 (superusuario solo en `db`) | `multi-tenancy-y-datos` (pool, respaldo y lo no construido), `despliegue §6, §8`, `08-escenarios` (EQ-22), `04-pruebas` (PR22) y `trazabilidad` | Acta del simulacro y planes guardados |
| 7 | US7 | `docker-compose.publicacion.yml`, `publicacion.conf.template`, `publicacion/` (con `levantar` y el ejemplo de las cuentas), el modo `--modo publicacion` de la semilla y `reiniciar-publicacion`, las reglas de `.gitignore` con su comprobación en el CI, el trabajo `artefacto-frontend` y la evidencia del despliegue | `despliegue` (nueva §2.3, publicación de demostración, y §5 HTTPS), `seguridad-y-privacidad` (túnel, IP real, lo no expuesto, datos fuera del país), C4 Niveles 1 y 2 (Cloudflare), ADR-035 aplicado, `05-riesgos`, `trazabilidad` y README (limitaciones) | Dominio con HTTPS, `cf-cache-status: HIT` y una publicación medida |
| 8 | US8 | Subdominio en `publicacion.conf.template`, reglas `*` del túnel, `nginx-publicacion.spec.ts`, `sin-host.spec.ts` y un recorrido | `multi-tenancy-y-datos` (el host no es tenant), `seguridad-y-privacidad`, `despliegue`, `api-rest` (nota de los subdominios), `trazabilidad` y README | Pruebas de integración y de arquitectura en verde y subdominio publicado |
| 9 | Cierre | Solo estados y totales | `trazabilidad`, `03-requisitos` (si aplica), `06-mvp`, `03-sdd-spec-kit`, `07-guion`, `02-backlog`, `spec.md` (estado y desviaciones) y `tasks.md` | Totales de la última corrida completa |

**Orden de recorte** (spec): US8, luego US7, US5, US6 y US4. El orden de construcción es el inverso, así lo que se
recorta es lo último. US1, US2 y US3 no se recortan. Las dependencias y el efecto de cada recorte están en el
research R13. **Si se recorta US6**, una CI roja en las fases 6 a 8 solo se acepta si la falla es de una de las 11
pruebas frágiles, pasa sola en local y pasa al relanzar la corrida (R13, análisis M1).

**Cada fase, además:**
- amplía el trabajo `herramientas` de la CI con sus pruebas de Node y sus carpetas nuevas (Prettier y ESLint);
- ejecuta `revisar-secretos` sobre `evidencia/` antes del commit;
- verifica en local solo lo que toca y deja la suite completa a la CI, salvo las fases 5 y 9 (R14).

## Tiempo de suite y espera de la CI (research R14)

| Fase | Total local aproximado | Suite completa local |
| --- | --- | --- |
| 0 | 0 h | No |
| 1 · US3 | 0,5 h | No (la CI) |
| 2 · US1 | 1 h | No (la CI) |
| 3 · US2 | 1,5 h | No (la CI) |
| 4 · US4 | 1 h (`escalado` y `test:arch`, PR03 y Lighthouse contra el 8080) | No |
| 5 · US6 | **7 h** (11 pruebas solas × 3, 3 suites completas, cobertura de integración aparte sin metas) | Sí |
| 6 · US5 | 1,5 h (volumen < 1 h) | No (la CI) |
| 7 · US7 | 1 h | No |
| 8 · US8 | 0,5 h | No |
| 9 · Cierre | 1,5 h | Sí |

- **Total:** unas 15,5 h de máquina en local, más 10 esperas de la CI. La duración de la CI se mide en la fase 1.
- **En paralelo con la espera de la CI** se puede escribir la fase siguiente (la 1 con la 2, la 2 con la 3, la 4 con
  las pruebas de la 5, y la 6 con la viabilidad de la 7). No se hace push de la fase N+1 hasta que la N esté en
  verde.
- **Nunca** se mide (k6, Lighthouse, PR03, volumen) mientras corre una suite: comparten la CPU.

## Tareas del responsable (no las hace el agente)

- **Fase 0:** aprobar o corregir la aclaración PATCH del principio XII, ADR-034 y ADR-035.
- **Todas las fases:** commit y push de cada fase y revisión de la CI.
- **US3:** probar el README en una copia limpia en bash (Linux o WSL) y en PowerShell, con cronómetro (SC-001).
- **US2:** lanzar 3 veces el trabajo manual `e2e` en GitHub; revisar a ojo las correcciones de accesibilidad.
- **US7, fuera del repositorio:**
  - crear el túnel con nombre y guardar sus credenciales como `publicacion/secretos/tunel.json` (nombre fijo);
  - crear `publicacion/publicacion.env` con el token de GitHub de grano fino y solo lectura;
  - crear en Cloudflare los registros DNS proxied (raíz y `www`), activar "Always Use HTTPS" y revisar el Universal
    SSL;
  - levantar la demo publicada y ejecutar la semilla en el modo publicación, que genera las contraseñas al azar en
    `publicacion/secretos/cuentas-publicadas.json`. Compartirlas por su cuenta con quien evalúa y reiniciarlas con
    `reiniciar-publicacion` cuando haga falta;
  - dejar el equipo encendido durante la demostración.
  - El agente nunca ve, escribe ni pide esos valores, ni lee `cuentas-publicadas.json`.
- **US8:** agregar en Cloudflare el registro comodín `*` y la regla del túnel.

## Documentos de `docs/` que se actualizan (a lo largo de las fases; la fase 9 solo cambia estados y totales)

- `docs/trazabilidad.md`: la fila de 009, por fase.
- `docs/05-gestion/04-pruebas.md`: PR01, PR02, PR03, PR22, PR23, PR29 y PR30; cobertura; estabilidad de E2E; la tabla
  de las pruebas frágiles; los totales.
- `docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md`: EQ-01, EQ-02, EQ-03 y EQ-22, y AC05 y AC06, con
  la cifra medida y su enlace.
- `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`: ADR-034 y ADR-035 (tras la aprobación).
- `docs/02-arquitectura-software/despliegue-y-escalabilidad.md`: §2.1, §2.3 (nueva), §4.1, §5, §6 y §8.
- `docs/02-arquitectura-software/multi-tenancy-y-datos.md`: pool, respaldo y restauración, lo no construido, y el host
  no es tenant.
- `docs/02-arquitectura-software/seguridad-y-privacidad.md`: túnel, IP real, lo no expuesto y datos fuera del país.
- `docs/02-arquitectura-software/tecnologias.md`: k6, Playwright, axe, Lighthouse y cloudflared.
- `docs/02-arquitectura-software/api-rest.md`: nota de los subdominios de US8.
- `docs/04-modelo-c4/Nivel1-DiagramadeContextodelSistema.md` y `Nivel2-DiagramadeContenedores.md`: Cloudflare (DNS,
  CDN y túnel).
- `docs/05-gestion/02-backlog-y-sprints.md`, `05-riesgos.md`, `06-mvp-y-evolucion.md`, `03-sdd-spec-kit.md` y
  `07-guion-exposicion-y-defensa.md`.
- `README.md` raíz y `tecnologia/plataforma-barberias/README.md`.

## Criterios de evaluación → evidencia

Tabla completa en [contracts/evidencia.md](contracts/evidencia.md) §2. En resumen:

| Criterio | Evidencia principal |
| --- | --- |
| 6. E2E | `e2e/recorridos/` y `evidencia/e2e/` (5 corridas locales, 3 en el CI y la evaluación) |
| 8. Escalabilidad del frontend y backend | Caché inmutable en el 8080, PR03 (2 frente a 3 instancias), PR02 (citado de US1) y Lighthouse (con `vite preview` y contra el 8080) |
| 9. Escalabilidad de base de datos | Planes con índices (sin parámetros), pool calculado, volúmenes de 52 000, 130 000 y 260 000 citas con la extrapolación marcada como estimación, y simulacro PR22 |
| 10. Dominio, DNS y CDN | `config.yml` del túnel, plantilla 8081, DNS, certificado y `cf-cache-status`, y subdominios con US8 |
| 12. CI/CD | Cobertura e insignia en el CI, `artefacto-frontend` y actualizador con `publicaciones.jsonl` |
| 13. k6 | 3 escenarios con umbrales y resultados medidos, y ADR-034 |
| 14. GitHub (código y base) | Migraciones, semilla idempotente, `preparar-entorno` y el README probado en bash y PowerShell |

## Complexity Tracking

No hay violaciones que justificar si se aprueba la aclaración PATCH del principio XII. Si no se aprueba, los trabajos
`e2e` (manual) y `artefacto-frontend` **no** se agregan, en lugar de justificarlos. El CD queda como publicación
manual con el mismo actualizador, y así se documenta.

La excepción acotada del superusuario para el simulacro no es una violación de la constitución (el principio III
regula los roles de la aplicación), pero contradice la regla general del responsable de no usar roles que se salten
RLS. Por eso queda escrita arriba con su motivo, sus límites y su comprobación en la CI, y aprobada el 2026-11-19.
