# Despliegue, balanceo y escalabilidad

Decisión: [ADR-006](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-006-balanceador-de-carga-y-escalado-horizontal). Escenarios EQ-03 y EQ-04. Este documento distingue la **arquitectura objetivo** de la **implementación inicial**. El despliegue se planifica en la nube de **Amazon Web Services (AWS)**, y el balanceador de carga es el **Application Load Balancer (ALB)** del proveedor. Los servicios, la región y los costos son una **propuesta por validar** (ver [tecnologías](tecnologias.md)).

## 1. Diagrama de despliegue (arquitectura objetivo)

![1. Diagrama de despliegue (arquitectura objetivo)](../../img/despliegue-escalabilidad.png)

_Figura. 1. Diagrama de despliegue (arquitectura objetivo)._

<details>
<summary>Código fuente del diagrama (Mermaid)</summary>

```mermaid
flowchart TB
    USR["Usuarios (navegador web)"]
    DNS["Route 53: nombre de dominio"]
    subgraph EDGE["Entrada (AWS)"]
        CF["CloudFront + S3: archivos estáticos de la interfaz web"]
        ALB["Application Load Balancer (HTTPS, certificado ACM)"]
    end
    subgraph AZ["Subredes privadas en dos zonas de disponibilidad"]
        I1["Instancia 1: backend modular (contenedor)"]
        I2["Instancia 2: backend modular (contenedor)"]
        I3["Instancia N: backend modular (contenedor)"]
    end
    subgraph DATA["Datos (servicios gestionados)"]
        PGP[("Amazon RDS PostgreSQL primario")]
        PGR[("Réplica o Multi-AZ: futuro")]
        RDS[("ElastiCache for Redis: caché")]
    end
    subgraph EXT["Servicios externos"]
        PAY["Proveedor de pagos"]
        AI["Proveedor de IA"]
        MAIL["Servicio de correo"]
        WA["Servicio de mensajería WhatsApp"]
    end
    USR --> DNS
    DNS --> CF
    DNS --> ALB
    ALB -->|"verificación de salud"| I1
    ALB --> I2
    ALB --> I3
    I1 --> PGP
    I2 --> PGP
    I3 --> PGP
    I1 --> RDS
    I2 --> RDS
    I3 --> RDS
    I1 --> PAY
    I1 --> AI
    I1 --> MAIL
    I1 --> WA
    PAY -->|"webhook"| ALB
    PGP -.-> PGR
```

</details>

## 2. Implementación inicial frente a arquitectura objetivo

| Elemento               | Implementación inicial (MVP)                                                                          | Arquitectura objetivo                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Instancias del backend | **1**                                                                                                 | 2 o más, sin estado                                                              |
| Balanceador            | **ALB** delante de una instancia (el ALB se configura desde el inicio en dos zonas de disponibilidad) | ALB con grupo de destino, verificación de salud y varias instancias en dos zonas |
| Cómputo                | Un contenedor del backend (servicio de contenedores de AWS o máquina virtual; por decidir)            | Varias réplicas con escalado automático según carga                              |
| PostgreSQL             | Amazon RDS for PostgreSQL, una instancia con respaldos automáticos                                    | Multi-AZ y réplica de lectura a evaluar                                          |
| Redis                  | Amazon ElastiCache for Redis, un nodo                                                                 | Réplica y conmutación a evaluar                                                  |
| Interfaz web           | Archivos estáticos en S3                                                                              | S3 con CloudFront (CDN)                                                          |
| Estado                 | Planificado                                                                                           | Planificado                                                                      |

Se empieza con una instancia y se evoluciona cuando una **necesidad justificada** (medida en pruebas de carga) lo requiera.

### 2.1 Entorno escalado local (funcionalidad 006)

La arquitectura objetivo se **representa localmente** con Docker Compose ([ADR-030](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md); contrato en [entorno-compose.md](../../specs/006-escalado-cache-balanceo/contracts/entorno-compose.md)). No se despliega nada en la nube.

```mermaid
flowchart LR
    NAV["Navegador o script de medición"]
    VITE["frontend (Vite, 5173)"]
    subgraph RED["Red plataforma 172.28.0.0/24"]
        NGX["nginx (172.28.0.10)<br/>puerto 3000 del equipo<br/>salud pasiva: max_fails=3, fail_timeout=10s"]
        B1["backend-1 (172.28.0.11)<br/>384 MB"]
        B2["backend-2 (172.28.0.12)<br/>384 MB"]
        RDS[("redis (172.28.0.13)<br/>64 MB, sin persistencia")]
        PG[("db: PostgreSQL 16<br/>512 MB")]
        PREP["preparar-backend<br/>(una vez: npm ci, build, migraciones)"]
    end
    NAV -->|"/api/*"| NGX
    NAV --> VITE
    VITE -->|"proxy /api"| NGX
    NGX --> B1
    NGX --> B2
    B1 --> PG
    B2 --> PG
    B1 -.->|"caché del catálogo y límite por IP (opcional)"| RDS
    B2 -.-> RDS
    PREP --> PG
```

| Local                     | Nube (equivalente)                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Nginx                     | Application Load Balancer, con comprobación activa de salud sobre `/api/v1/salud/listo` |
| `backend-1` y `backend-2` | Tareas o instancias del mismo contenedor                                                |
| Redis                     | ElastiCache for Redis (sin persistencia)                                                |
| `preparar-backend`        | Tarea de migración previa al despliegue                                                 |
| `PROXIES_CONFIABLES`      | Subred del balanceador                                                                  |

- **Lo que demuestra** (registro en el [quickstart de 006](../../specs/006-escalado-cache-balanceo/quickstart.md) §6): la caída de una réplica con tráfico sin errores, el 503 `SERVICIO_NO_DISPONIBLE` sin réplicas, la caída y la lentitud de Redis sin errores (PR05), 200 reservas simultáneas por Nginx con una sola cita (PR16) y el p95 de horarios libres de 273–288 ms con dos réplicas y caché (PR01).
- **Lo que no es:** alta disponibilidad (FR-028). Nginx, PostgreSQL y Redis son únicos, y Nginx local es además un punto único de falla. La comprobación de salud de Nginx es **pasiva** (la activa es de Nginx Plus); el ALB la haría activa.
- **IP fijas:** Nginx resuelve el upstream una sola vez al iniciar, y las réplicas llegan a Redis por IP porque, con Redis detenido, resolver su nombre tardaba 3–4 s en cada reconexión.

## 3. Balanceo de carga

| Aspecto               | Diseño                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo                  | Application Load Balancer (capa 7, HTTP/HTTPS), con nodos en dos zonas de disponibilidad                                                                      |
| Reparto               | Grupo de destino con algoritmo de reparto del ALB; sin afinidad de sesión (no hace falta: el backend no guarda estado)                                        |
| Verificación de salud | El ALB consulta `GET /salud` en cada instancia; umbrales de intervalo y de fallos consecutivos configurables (propuesta: cada 10 s y 3 fallos para retirarla) |
| Tiempo límite         | Tiempo de inactividad del ALB y del backend definidos para no acumular solicitudes colgadas                                                                   |
| Despliegue sin corte  | Registrar la instancia nueva, esperar a que esté sana y drenar la anterior (vaciado de conexiones)                                                            |
| Webhooks              | Entran por el mismo ALB y se procesan por cualquier instancia (idempotencia en base de datos)                                                                 |

Varias instancias del mismo monolito **siguen siendo una arquitectura monolítica**; el balanceador pertenece al despliegue y no es una capa.

## 4. Sesiones sin estado, conexiones y configuración

- **Sin estado:** autenticación con token firmado; nada de sesión en memoria del proceso. Los trabajos en segundo plano (conciliación, recordatorios y envío de correos y WhatsApp, vencimientos) se ejecutan con un mecanismo que evita duplicados entre instancias (por ejemplo, bloqueo con `pg_advisory_lock` o una sola instancia con rol de planificador).
- **Conexiones a PostgreSQL:** pool por instancia; límite total controlado. Si crecen las instancias, usar un agrupador de conexiones.
- **Redis:** cliente con tiempos límite cortos y circuit breaker.
- **Configuración y secretos:** variables de entorno o AWS Secrets Manager; nunca en el repositorio (EQ-11).
- **Migraciones de base de datos:** en producción se ejecutan como un **paso separado del despliegue, antes** de registrar las instancias nuevas, con el rol `barberias_owner` y una sola vez por versión; **no** al arrancar cada réplica. Con varias instancias, migrar al arrancar haría que todas intentaran aplicar las mismas migraciones a la vez, mezclaría los permisos de dueño con los de la aplicación (que se conecta como `barberias_app`, sin privilegios de esquema) y haría que un fallo de migración tumbara instancias en serie. Las migraciones deben ser compatibles con la versión anterior en ejecución (agregar columnas antes de usarlas, borrar después) para que el despliegue sin corte siga funcionando. En el entorno de desarrollo se sigue el mismo principio: el servicio `preparar-backend` de Docker Compose aplica las migraciones **una sola vez**, antes de que arranquen las dos réplicas, y estas no migran (006, R03). Cada réplica responde `GET /salud/listo` 200 solo si la base está al día con las migraciones de su versión.
- **Monitoreo y registro:** logs estructurados con identificador de correlación enviados a Amazon CloudWatch; métricas de latencia, errores, circuit breakers y conexiones (incluidas las del ALB); alertas (EQ-21).

### 4.1 Aplicación web (archivos estáticos)

La interfaz se publica como archivos estáticos (`npm run build` en `frontend/` genera `dist/`) en un servidor de estáticos o CDN, por ejemplo Amazon S3 con CloudFront (**por validar**), separado de las instancias del backend.

| Tema                            | Diseño                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mismo sitio que la API          | Servir la interfaz y `/api/*` bajo el mismo dominio (la CDN reenvía `/api/*` al ALB). La cookie de renovación `rt` es `SameSite=Strict` con `Path=/api/v1/auth` y el indicador `hay_sesion` (ADR-017) se lee desde la interfaz: ambos necesitan el mismo sitio |
| Caché de archivos con hash      | `assets/*` llevan un hash en el nombre: `Cache-Control: public, max-age=31536000, immutable`                                                                                                                                                                   |
| `index.html`                    | Sin caché (`no-cache`): cada visita descubre los archivos de la versión vigente                                                                                                                                                                                |
| Rutas de la aplicación          | Cualquier ruta que no sea un archivo (`/app/usuarios`, `/registro`) responde con `index.html`                                                                                                                                                                  |
| Versión anterior (ADR-018, R19) | Conservar los `assets/*` de la versión anterior al menos un día, para que una pestaña abierta antes del despliegue pueda seguir navegando                                                                                                                      |
| `robots.txt` y `favicon.svg`    | Se publican en la raíz; `robots.txt` excluye `/app` y `/activar`                                                                                                                                                                                               |
| Compresión                      | Brotli o gzip para JS, CSS y SVG (las fuentes `woff2` ya vienen comprimidas)                                                                                                                                                                                   |

## 5. CORS y HTTPS

| Tema           | Diseño                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTPS          | Terminación TLS en el ALB con certificado de AWS Certificate Manager; redirección de HTTP a HTTPS; cabecera HSTS                                                                                                                                             |
| CORS           | El backend acepta únicamente los orígenes de la interfaz web (lista explícita); métodos y cabeceras limitados; no se usa `*` con credenciales                                                                                                                |
| Cookies/Tokens | Token de acceso en cabecera `Authorization` (solo en memoria del navegador); renovación con cookie `rt` `Secure`, `HttpOnly`, `SameSite=Strict`; indicador no secreto `hay_sesion` (ADR-017). Detalle en [seguridad y privacidad](seguridad-y-privacidad.md) |
| Webhooks       | Ruta pública con verificación de firma y límite de tasa (AWS WAF opcional frente al ALB)                                                                                                                                                                     |

## 6. Alta disponibilidad: lo que NO se afirma

**Incluir un balanceador no significa alta disponibilidad.** Para afirmarla serían necesarias, además:

| Condición                                                          | Estado                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Balanceador redundante (no ser punto único de falla)               | El ALB reparte entre nodos de varias zonas; se debe **configurar y probar** con dos zonas                       |
| PostgreSQL con Multi-AZ o réplica y conmutación automática probada | Futuro                                                                                                          |
| Redis tolerante a fallos o degradación probada                     | Degradación probada en local (PR05, 006): sin errores con Redis caído o lento; Redis sigue siendo un nodo único |
| Respaldos restaurados con éxito (simulacro)                        | Planificado (EQ-22)                                                                                             |
| Pruebas de falla de instancia y de base de datos                   | Falla de una réplica probada en local (PR04, EQ-04, 006); falla de base de datos: planificado                   |
| Monitoreo con alertas                                              | Planificado (EQ-21)                                                                                             |

Hasta cumplirlas, se habla de **tolerancia a la falla de una instancia del backend**, no de alta disponibilidad.

## 7. Consideraciones de la nube (por validar)

| Tema              | Nota                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Región            | Elegir una región cercana a Perú (por ejemplo, São Paulo) según latencia y costo. **Por validar**                                                   |
| Datos personales  | Los datos se alojarían fuera del país: revisar lo que exige la Ley N.° 29733 sobre flujo transfronterizo. **Por validar; no es asesoría legal**     |
| Costos            | El ALB, RDS y ElastiCache tienen costo mensual aun con poco tráfico: estimar con la calculadora de precios de AWS antes de decidir. **Por validar** |
| Alcance del curso | La documentación describe el despliegue; no se exige desplegarlo en AWS para este entregable                                                        |

## 8. Escalado

| Cuándo                                                               | Acción                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Latencia p95 supera la meta de EQ-01/EQ-02 con CPU de instancia alta | Agregar instancias al grupo de destino del ALB (escalado automático) |
| Lecturas pesadas (reportes)                                          | Réplica de lectura                                                   |
| Un tenant domina la carga                                            | Evaluar esquema o base dedicada (ADR-003)                            |
| Un módulo (p. ej. IA) tiene carga muy distinta                       | Evaluar su extracción (opción futura condicionada)                   |
