# Borradores para revisión del responsable: aclaración del principio XII y ADR-035 de la publicación de la demo

> **Estado (2026-11-19, versión 2): BORRADOR, sin aprobar y sin aplicar.** Nada de este archivo está en
> `.specify/memory/constitution.md` ni en `docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md`. Se aplica
> solo después de la aprobación del responsable, en la fase 0 de 009, y antes de construir US7. Los números de
> versión y de ADR son provisionales.
>
> **Cambio respecto a la versión 1:** el plan decidió servir la interfaz por el túnel desde el Nginx de Compose, y no
> por Cloudflare Pages (research R09). La CI ya **no publica** en la CDN, así que la enmienda MINOR de la versión 1
> no hace falta. La reemplaza una **aclaración PATCH** (sección 1). El texto MINOR queda en la sección 3 como
> alternativa descartada, por si el responsable prefiere Pages.
>
> **Sin secretos:** este archivo no contiene ni debe contener tokens, claves ni identificadores de cuenta, de zona o
> del túnel de Cloudflare, ni de Namecheap.

## 1. Aclaración PATCH del principio XII (propuesta: 1.7.1 → 1.7.2)

**Versionado:** PATCH. Aclara qué significa "construir" en la excepción de `.github/workflows/`. No amplía lo que la
CI puede hacer fuera de la plataforma de CI.

**Texto actual** (principio XII, excepción):

> **Excepción:** los flujos de integración continua MUST ubicarse en `.github/workflows/`, única ruta que GitHub
> Actions lee. Esos archivos MUST limitarse a definir la CI (instalar, verificar, probar y construir ejecutando
> comandos dentro de `tecnologia/plataforma-barberias/`) y MUST NOT contener lógica de la aplicación.

**Texto propuesto** (se agrega después de "MUST NOT contener lógica de la aplicación."):

> "Construir" incluye conservar el **artefacto estático compilado del frontend** como artefacto de la propia
> corrida, solo en la rama principal y solo después de que todos los trabajos de pruebas terminaron en verde. Los
> flujos MAY tener trabajos de prueba que solo se lanzan a mano. Los flujos MUST NOT desplegar, MUST NOT tener
> credenciales de despliegue ni de la aplicación y MUST NOT acceder a la base de datos de un entorno real o
> publicado. **Única excepción:** la base efímera que las propias pruebas levantan y destruyen dentro de la corrida
> (Testcontainers en las pruebas de integración y el Docker Compose de los recorridos de extremo a extremo). Cualquier
> publicación se hace **fuera** de la CI, con código ubicado en `tecnologia/plataforma-barberias/`.

**Aclaración que se agrega en "Restricciones tecnológicas y de alcance", después de "Despliegue objetivo":**

> La **publicación de demostración** (dominio propio, CDN y túnel hacia el entorno local) MUST NOT presentarse
> como el despliegue objetivo ni como producción: funciona solo mientras el equipo del responsable está encendido,
> publica solo datos de ejemplo y no cambia ADR-006.

**Aclaración que se agrega en "Restricciones tecnológicas y de alcance", al final de "Privacidad"** (agregada el
2026-11-19 a partir del análisis C2, con la aprobación del responsable):

> El respaldo y la restauración de prueba MAY usar el superusuario de PostgreSQL **solo dentro del contenedor o
> servicio de base de datos**, porque con FORCE RLS ningún rol sin `BYPASSRLS` puede respaldar la base completa.
> MUST NOT usarse en la aplicación ni en ningún script que lea o escriba datos de negocio, y no se crea ni se concede
> ningún rol con `BYPASSRLS`.

**Sync Impact Report (borrador):**

- _Modified principles:_ XII. Ubicación del código, una aclaración de "construir"; "Restricciones tecnológicas y de
  alcance", una aclaración de la publicación de demostración y otra del superusuario solo para el respaldo.
- _Templates requiring updates:_ en `.specify/templates/plan-template.md`, la puerta XII agrega "workflows may keep
  the built frontend artifact (main, after tests) and have manual test jobs; never deploy or hold deploy
  credentials".
- _Docs:_ `docs/02-arquitectura-software/despliegue-y-escalabilidad.md`, `docs/05-gestion/04-pruebas.md` y el
  README.
- _Follow-up:_ ninguno.

## 2. ADR-035 (número provisional): publicación de la demo con dominio propio, CDN y túnel con nombre

> Revisa ADR-006 solo para aclarar que esta publicación **no** es su despliegue objetivo; no cambia su decisión.
> ADR-034 (k6) está en [adr-034-k6.md](adr-034-k6.md).

- **Estado:** Propuesto (borrador, 2026-11-19, versión 2).
- **Contexto:**
  - Los criterios de evaluación piden dominio, DNS, CDN y CI/CD.
  - El responsable compró `ayacuchobarber.shop` (registrador Namecheap) y delegó su DNS a Cloudflare (plan gratuito:
    DNS, CDN y HTTPS).
  - No hay presupuesto para alojar el backend ni una base administrada.
  - La base usa RLS con varios roles.
  - El diseño de la aplicación web pide servir la interfaz y `/api/*` en el mismo dominio (despliegue §4.1): la
    cookie de renovación es `SameSite=Strict` con `Path=/api/v1/auth`, y el frontend llama a `/api/v1` en forma
    relativa.
- **Problema:** ¿cómo publicar la demo en un dominio real, con CDN y HTTPS, sin costo de alojamiento, sin datos
  reales, sin cambiar la aplicación y sin presentar como producción lo que no lo es?
- **Alternativas:**
  - (a) solo análisis, sin publicar;
  - (b) la interfaz en Cloudflare Pages, con despliegue desde la CI, y la API por un túnel en `api.`. Exige volver
    configurable la URL de la API en el frontend y usar CORS entre orígenes, que con subdominios por barbería exige
    orígenes dinámicos. Pages no admite un dominio propio comodín (**por verificar**). Pone un token de Cloudflare y
    un identificador de cuenta en la CI;
  - (c) **la interfaz y la API por un túnel con nombre desde el Nginx de Compose**, en el mismo origen, con el proxy
    y la caché de Cloudflare delante y CD por extracción (pull-based) del artefacto de la CI;
  - (d) backend alojado y base administrada: producción real, con costo y fuera del plazo.
- **Decisión:** (c).
  - `ayacuchobarber.shop` y `www` (y `*` con US8) van por `cloudflared`, gestionado localmente con sus reglas de
    entrada versionadas, hacia un `server` de Nginx en el puerto 8081, que no se publica en el equipo.
  - Ese `server` sirve el build y reenvía `/api/` al mismo balanceo, y toma la IP real de `CF-Connecting-IP` solo
    cuando viene de `cloudflared`.
  - **CD por extracción (pull-based):** la CI guarda el artefacto del frontend solo desde `main` y con las pruebas en
    verde, y un actualizador que corre en el equipo del responsable lo descarga y lo publica en el Nginx local.
    No es un despliegue en la nube: la CI no despliega nada y nada se aloja fuera del equipo.
- **Condiciones:**
  - Solo datos de la semilla.
  - Las contraseñas de las cuentas de demostración **no se publican** (ni en el sitio, ni en el README público, ni
    en el repositorio para la versión publicada) y **se reinician con la semilla**.
  - El límite de solicitudes por IP de 006 sigue activo en la versión publicada, con la IP real del visitante.
  - Proveedor de IA falso; pasarela, correo y WhatsApp simulados y **sin exponer**.
  - El token de GitHub del actualizador es **de grano fino, de solo lectura (Actions: read) y limitado a este
    repositorio**.
  - Las credenciales del túnel y el token de GitHub van en un archivo no versionado y separado del `.env` de la
    aplicación.
  - Ningún secreto en la CI.
- **Limitaciones (se escriben tal cual):**
  - La versión publicada **solo funciona mientras el equipo del responsable está encendido**, con el Compose y el
    túnel levantados. No es alta disponibilidad ni producción.
  - La latencia incluye el túnel.
  - Desde fuera no se puede activar una cuenta nueva (el correo llega a Mailpit, en el equipo) ni pagar con el
    simulador.
  - Los datos pasan por la red de un proveedor fuera del país.
  - Producción real necesita un **backend alojado y una base de datos administrada** (con los roles y RLS de la
    constitución), fuera del alcance de 009.
- **Criterio de corte:** si el túnel, el DNS o la publicación no funcionan en el plazo, se documenta el motivo y la
  evidencia de despliegue es la demo local de producción de US4. Nada se presenta como desplegado.
- **Relación con ADR-006 y ADR-030:** el despliegue objetivo sigue siendo AWS con ALB (ADR-006), y el balanceo
  demostrado sigue siendo Nginx local (ADR-030). Esta publicación solo expone ese entorno local.
- **Drivers:** AC05, DA03.

## 3. Alternativa descartada: enmienda MINOR (versión 1 de este borrador)

Solo aplica si el responsable prefiere la alternativa (b), Cloudflare Pages con publicación desde la CI. El texto
permitía a un flujo publicar el artefacto estático del frontend en la CDN con estas condiciones:

- solo desde `main` y solo con las pruebas en verde;
- sin acceso a la base de datos ni a secretos de la aplicación;
- con secretos mínimos en el almacén de la CI, y el paso omitido si faltan.

Se descarta por los motivos de la alternativa (b) del ADR-035 y del research R09.
