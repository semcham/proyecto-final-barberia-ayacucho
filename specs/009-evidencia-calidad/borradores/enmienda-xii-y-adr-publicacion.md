# Borradores para revisión del responsable: enmienda del principio XII y ADR de la publicación de la demo

> **Estado (2026-11-19): BORRADOR, sin aprobar y sin aplicar.** Nada de este archivo está en
> `.specify/memory/constitution.md` ni en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`. Se aplica
> solo después de la aprobación del responsable y antes de construir la publicación de US7 (FR-038). Los números de
> versión y de ADR son provisionales.
>
> **Sin secretos:** este archivo no contiene ni debe contener tokens, claves, identificadores de cuenta ni de zona de
> Cloudflare o de Namecheap. Solo se nombran el dominio público y los servicios.

## 1. Enmienda MINOR del principio XII (US7)

**Versionado propuesto:** 1.7.1 → **1.8.0** (MINOR: amplía de forma material la excepción de `.github/workflows/`).
No elimina ni redefine nada.

**Texto actual** (principio XII, excepción):

> **Excepción:** los flujos de integración continua MUST ubicarse en `.github/workflows/`, única ruta que GitHub
> Actions lee. Esos archivos MUST limitarse a definir la CI (instalar, verificar, probar y construir ejecutando
> comandos dentro de `tecnologia/plataforma-barberias/`) y MUST NOT contener lógica de la aplicación.

**Texto propuesto** (se agrega después de "MUST NOT contener lógica de la aplicación."):

> **Publicación de la interfaz de demostración.** Un flujo de `.github/workflows/` MAY además publicar el
> **artefacto estático compilado del frontend** (y nada más) en la CDN del dominio de la demostración, con estas
> condiciones, todas obligatorias: (a) MUST ejecutarse solo desde la rama principal (`main`); (b) MUST ejecutarse
> solo si todos los trabajos de pruebas de la misma corrida terminaron en verde; (c) MUST NOT tener acceso a la base
> de datos, a Redis ni a ningún secreto de la aplicación (claves de firma, sales, credenciales de base); (d) los
> únicos secretos que usa MUST ser los mínimos para publicar en la CDN, con permiso limitado a esa publicación, y
> MUST guardarse en el almacén de secretos de la plataforma de CI, nunca en el repositorio; (e) si esos secretos
> faltan, el paso de publicación MUST omitirse e informarlo sin hacer fallar la CI de pruebas. El backend MUST NOT
> desplegarse desde la CI mientras no exista un ADR que lo apruebe.

**Aclaración que se agrega en "Restricciones tecnológicas y de alcance", después de "Despliegue objetivo":**

> La **publicación de demostración** (interfaz en una CDN y API por un túnel hacia el entorno local) MUST NOT
> presentarse como el despliegue objetivo ni como producción: funciona solo mientras el equipo del responsable está
> encendido, publica solo datos de ejemplo y no cambia ADR-006.

**Razón que se agrega al final del principio XII:**

> La publicación existe porque el curso pide evidencia de dominio, CDN y despliegue continuo; se limita al
> artefacto estático, desde `main` y tras las pruebas, para que la CI nunca toque datos ni secretos de la
> aplicación.

**Sync Impact Report (borrador):**

- _Modified principles:_ XII. Ubicación del código (excepción de `.github/workflows/`: publicación del artefacto
  estático); "Restricciones tecnológicas y de alcance" (aclaración de la publicación de demostración).
- _Templates requiring updates:_ `.specify/templates/plan-template.md`, puerta XII (agregar "workflows may publish
  only the static frontend artifact, from main, after tests pass, without DB access or app secrets").
- _Docs:_ `docs/02-arquitectura-software/despliegue-y-escalabilidad.md` (publicación de demostración),
  `docs/05-gestion/04-estrategia-de-pruebas.md` (CI) y el README.
- _Follow-up:_ si el análisis de US7 elige servir el frontend por el túnel desde el Nginx de Compose (y no desde la
  CDN de páginas), la publicación desde la CI **no se usa** y la enmienda puede quedar sin aplicar; la decisión se
  registra en el ADR de la sección 2.

## 2. ADR nuevo (número provisional ADR-035): publicación de demostración con dominio propio, CDN y túnel

> Revisa ADR-006 solo para aclarar que esta publicación **no** es su despliegue objetivo; no cambia su decisión.
> ADR-034 (provisional) queda para el cambio de la decisión R13 de 006 (pruebas de carga con k6 en contenedor).

- **Estado:** Propuesto (borrador, 2026-11-19).
- **Contexto:** los criterios de evaluación piden dominio, DNS, CDN y despliegue continuo. El responsable compró
  `ayacuchobarber.shop` (registrador Namecheap) y delegó su DNS a Cloudflare (plan gratuito: DNS, CDN y HTTPS).
  No hay presupuesto para alojar el backend ni una base administrada. La base usa seguridad por filas con varios
  roles, que un servicio de base gratuito puede no permitir.
- **Problema:** ¿cómo publicar la demo en un subdominio real, con CDN y HTTPS, sin costo de alojamiento, sin
  datos reales y sin presentar como producción lo que no lo es?
- **Alternativas:**
  - (a) solo análisis, sin publicar (la demo local de US4 como evidencia);
  - (b) interfaz en Cloudflare Pages con despliegue desde la CI y API por un **túnel con nombre** hacia el Compose
    local;
  - (c) interfaz y API por el túnel con nombre desde el Nginx de Compose (US4), con la CDN de Cloudflare delante y
    sin despliegue desde la CI;
  - (d) backend alojado y base administrada (producción real; con costo y fuera del plazo).
- **Decisión (a confirmar con el análisis de US7):** (b) o (c), según la viabilidad de los subdominios por
  barbería (US8): algunos servicios gratuitos de páginas no admiten un dominio propio comodín
  (`*.ayacuchobarber.shop`); si el elegido no lo admite y US8 se construye, se prefiere (c) o una combinación
  (dominio principal en páginas y comodín por el túnel). El criterio queda escrito en el análisis (FR-035).
- **Condiciones:** solo datos de ejemplo de la semilla de US3; proveedor de IA falso; pasarela, correo y WhatsApp
  simulados; los secretos del túnel y de la CDN solo en el equipo del responsable o en el almacén de secretos de la
  CI, nunca en el repositorio.
- **Limitaciones (se escriben tal cual):** la versión publicada **solo funciona mientras el equipo del responsable
  está encendido** con el Compose levantado; no es alta disponibilidad ni producción; la latencia incluye el túnel.
  Producción real necesita **backend alojado y base de datos administrada** (con los roles y la seguridad por
  filas de la constitución), fuera de alcance de 009.
- **Criterio de corte:** si el túnel, el DNS o la publicación no funcionan en el plazo, se documenta el motivo y la
  evidencia de despliegue es la demo local de producción de US4; nada se presenta como desplegado.
- **Relación con ADR-006 y ADR-030:** el despliegue objetivo sigue siendo AWS con ALB (ADR-006); el balanceo
  demostrado sigue siendo Nginx local (ADR-030). Esta publicación solo expone ese entorno local.
- **Drivers:** AC05, DA03.
