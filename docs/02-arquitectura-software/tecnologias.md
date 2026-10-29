# Tecnologías

Principio: **no se elige por popularidad**, sino por criterios (costo, curva de aprendizaje, gratuidad, integración con IA, mantenibilidad, compatibilidad con SaaS y con el estilo). Las versiones exactas están fijadas en los `package.json` de `tecnologia/plataforma-barberias/` (sección 5). Estado: el stack de la funcionalidad 001 está **implementado y probado en local** (backend, frontend y PostgreSQL); desde la 006, también **Redis y Nginx en local** con Docker Compose (sección 5.3); desde la 003, **los pagos con una pasarela simulada** detrás del puerto `PaymentGateway`, la transferencia con comprobante y el segundo factor del administrador (sección 5.4). AWS, el proveedor real de pagos, IA, correo y WhatsApp siguen **planificados**.

## 1. Criterios de evaluación

| Criterio                                          | Peso  | Por qué                                     |
| ------------------------------------------------- | ----- | ------------------------------------------- |
| Costo y licencia                                  | Alto  | RC06                                        |
| Curva de aprendizaje del equipo                   | Alto  | RC14 (por confirmar según experiencia real) |
| Mantenibilidad y soporte a módulos                | Alto  | DA06                                        |
| Compatibilidad con PostgreSQL y SaaS multi-tenant | Alto  | RC04, DA01                                  |
| Integración con IA y pagos (SDK/HTTP)             | Medio | DA07, DA08                                  |
| Documentación y comunidad                         | Medio | Riesgo de tiempo                            |

## 2. Evaluación por componente

| Componente           | Seleccionada (propuesta)                                                                                                          | Alternativas consideradas                                       | Justificación                                                                                                                                                                                                                                                                         | Decisión pendiente                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Frontend             | **React con Vite y TypeScript** (ADR-014)                                                                                         | Angular; Vue; páginas renderizadas en servidor                  | Aplicación web responsive de una sola página que consume la API REST (RC01, RC03). React arranca con poco código obligatorio, tiene amplio ecosistema de componentes (agenda, formularios, gráficos) y comparte TypeScript con el backend                                             | No (decidido); librerías de interfaz por definir                              |
| Backend              | **TypeScript con NestJS**                                                                                                         | Spring Boot (Java); Django (Python); Laravel (PHP); ASP.NET     | Módulos y inyección de dependencias nativos favorecen el monolito modular y Clean Architecture; TypeScript permite compartir tipos con el frontend                                                                                                                                    | No (decidido: NestJS)                                                         |
| Base de datos        | **PostgreSQL**                                                                                                                    | MySQL; MongoDB                                                  | Restricciones de exclusión, RLS y transacciones (ADR-004)                                                                                                                                                                                                                             | No                                                                            |
| Caché                | **Redis**                                                                                                                         | Memcached; caché en proceso                                     | Compartida entre instancias; estructuras para contadores (ADR-005)                                                                                                                                                                                                                    | No                                                                            |
| Nube y balanceador   | **AWS: Application Load Balancer** (con RDS for PostgreSQL, ElastiCache for Redis, S3 + CloudFront, Secrets Manager y CloudWatch) | Nginx propio; HAProxy; Traefik; otro proveedor de nube          | Balanceador gestionado: verificación de salud, TLS con ACM y reparto entre zonas sin administrar servidores (ADR-006)                                                                                                                                                                 | **Sí: región, costos y servicio de cómputo (contenedores o máquina virtual)** |
| Contenedores         | **Docker / Docker Compose**                                                                                                       | Despliegue directo en máquina virtual                           | Entornos reproducibles para el equipo                                                                                                                                                                                                                                                 | No                                                                            |
| Autenticación        | JWT de corta vida + refresco; hash **Argon2id o bcrypt**                                                                          | Sesiones en servidor; proveedor de identidad externo            | Sin estado, compatible con instancias múltiples (ADR-010)                                                                                                                                                                                                                             | No (decidido: Argon2id; ver sección 5)                                        |
| Pagos                | **Candidato: Culqi** (documentación leída: Yape, billeteras QR, webhooks, tokens de tarjeta)                                      | Otras pasarelas peruanas a evaluar con su documentación oficial | Documentación pública con Yape y webhook; **no se afirma compatibilidad ni condiciones de contratación hasta confirmarlas con el proveedor**. Implementado con el **simulador** detrás de `PaymentGateway` (ADR-022); el cambio al proveedor es por configuración (`PAGOS_PROVEEDOR`) | **Sí: proveedor, contrato, credenciales de pruebas y Yape real (R15)**        |
| IA                   | API de un proveedor de modelos de lenguaje detrás de `AIProvider`                                                                 | Modelo local de código abierto (mayor costo de infraestructura) | No se entrena un modelo propio (RC11); intercambiable                                                                                                                                                                                                                                 | **Sí: proveedor, límites y política de datos**                                |
| Correo               | Servicio de correo transaccional o SMTP                                                                                           | Servidor propio                                                 | Delegar la entregabilidad                                                                                                                                                                                                                                                             | **Sí**                                                                        |
| Mensajería WhatsApp  | **WhatsApp Business Platform** (API oficial) directamente o mediante un proveedor intermediario, detrás de `NotificationChannel`  | SMS; solo correo                                                | Alcance por celular (D-02, nacional). **Condiciones (consentimiento previo, plantillas aprobadas, costos) por verificar en la documentación oficial; no se afirman aquí**                                                                                                             | **Sí: proveedor, costos y viabilidad (ADR-013)**                              |
| Observabilidad       | Logs JSON + métricas con Prometheus/Grafana (opcional)                                                                            | Servicios gestionados                                           | Costo bajo; correlación de solicitudes                                                                                                                                                                                                                                                | Nivel de monitoreo                                                            |
| Pruebas              | Jest o equivalente; k6 o Locust para carga; Testcontainers para pruebas con PostgreSQL                                            | —                                                               | Cubre unitarias, integración y carga                                                                                                                                                                                                                                                  | Herramienta de carga                                                          |
| Control de versiones | **Git y GitHub**                                                                                                                  | —                                                               | RC02                                                                                                                                                                                                                                                                                  | No                                                                            |
| Documentación        | **Markdown + Mermaid**                                                                                                            | Draw.io                                                         | Versionable y renderizado por GitHub                                                                                                                                                                                                                                                  | Herramienta aceptada                                                          |
| SDD                  | **Spec Kit** (opcional)                                                                                                           | Especificaciones en Markdown propias                            | Flujo constitución → especificación → plan → tareas ([SDD](../05-gestion/03-sdd-spec-kit.md))                                                                                                                                                                                         | Verificar versión y comandos                                                  |
| CI                   | GitHub Actions                                                                                                                    | —                                                               | Integrada con el repositorio; ejecuta PR14                                                                                                                                                                                                                                            | No                                                                            |

## 3. Resumen

| Seleccionadas                                                                      | Alternativas consideradas                             | Decisiones pendientes                                                                              |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| PostgreSQL, Redis, AWS (ALB), Docker, Git/GitHub, Markdown+Mermaid, GitHub Actions | MySQL/MongoDB, Memcached, HAProxy/Traefik, VM directa | Proveedor de pagos, IA, correo y WhatsApp; herramienta de carga; herramienta de diagramas aceptada |

## 4. Nota sobre la integración de pagos

| Hecho en la documentación de Culqi (consultada, ver [evidencias](../00-contexto-negocio-y-evidencias.md#10-referencias-apa-7))                                     | Implicancia de diseño                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Cargos con Yape: máximo S/ 500, solo soles; el código de aprobación dura como máximo 2 minutos                                                                     | Los planes mensuales deben mantenerse por debajo del tope si se paga con Yape; flujo con tiempo límite |
| Billeteras móviles (QR) entre S/ 6 y S/ 500; en órdenes de pago es obligatorio usar webhooks (`order.status.changed`)                                              | La confirmación se basa en el webhook, no en el navegador                                              |
| El token de tarjeta vive 5 minutos y es de un solo uso; con API directa el comercio asume PCI DSS; con Checkout los datos no pasan por los servidores del comercio | Se usa el flujo alojado para no asumir PCI DSS (RC12)                                                  |

Estas condiciones son del proveedor candidato y pueden cambiar: se confirman con su documentación vigente antes de implementar.

## 5. Librerías elegidas para la funcionalidad 001 (registro, acceso y aislamiento)

Fuente: `specs/001-registro-acceso-barberia/research.md`. Versiones exactas (sin `^`) fijadas al implementar, en `tecnologia/plataforma-barberias/backend/package.json` y `frontend/package.json`.

| Capa                          | Librería o herramienta (versión fijada)                                                                                                                    | Para qué                                                                                                       | Decisión |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- |
| Plataforma                    | Node.js 22 LTS (CI y contenedores), TypeScript 5.9 en modo `strict`                                                                                        | Lenguaje y ejecución; backend con `module: node16`                                                             | R01      |
| Backend                       | NestJS 11.2, `@nestjs/cli` 11                                                                                                                              | Módulos e inyección de dependencias                                                                            | R01      |
| Acceso a datos                | Kysely 0.28 sobre `pg` 8, migraciones en SQL explícito                                                                                                     | Control de la transacción para fijar `tenant_id` con RLS                                                       | R02      |
| Hash de contraseñas           | `argon2` 0.45 (Argon2id, m = 19 MiB, t = 2, p = 1)                                                                                                         | Almacenar contraseñas; p95 del login medido entre 78 y 105 ms (SC-008)                                         | R06      |
| Tokens                        | `jose` 5.10 (5.x por compatibilidad con CommonJS), JWT ES256 de 15 min con `kid`                                                                           | Firmar y verificar el token de acceso                                                                          | R07      |
| Identificadores               | `uuid` 11 (UUID v7)                                                                                                                                        | Identificadores generados en la aplicación (sin `RETURNING`, ADR-015)                                          | R12      |
| Validación                    | `class-validator` 0.15 con `whitelist` y `forbidNonWhitelisted`                                                                                            | Rechazar campos no declarados, incluido `tenant_id`                                                            | R11      |
| Límite general de solicitudes | `@nestjs/throttler` 6                                                                                                                                      | Freno aproximado por instancia; el límite de login vive en PostgreSQL                                          | R10      |
| Pruebas del backend           | Jest 29, `supertest`, Testcontainers 12 (PostgreSQL 16)                                                                                                    | Unitarias, contrato y RLS real; sin Docker, `TEST_DATABASE_ADMIN_URL`                                          | R18      |
| Pruebas de contrato           | `yaml` 2, `ajv` 8 y `ajv-formats`                                                                                                                          | Validar cada respuesta contra el esquema de `contracts/openapi.yaml`                                           | R18      |
| Prueba de arquitectura        | `dependency-cruiser` 18                                                                                                                                    | PR14: matriz de módulos, regla de capas y Kysely solo en infraestructura                                       | R18      |
| Calidad de código             | ESLint 9 (`typescript-eslint`), Prettier 3                                                                                                                 | Estilo y reglas de importación entre módulos                                                                   | —        |
| Frontend                      | React 19, Vite 6, React Router 7, TanStack Query 5                                                                                                         | Interfaz y llamadas a la API                                                                                   | R19      |
| Formularios                   | `react-hook-form` 7 y `zod` 3                                                                                                                              | Validación de ayuda en el cliente                                                                              | R19      |
| Componentes accesibles        | Radix UI: `@radix-ui/react-dialog` 1.3.1, `react-dropdown-menu` 2.2.1, `react-tooltip` 1.4.1, `react-toast` 1.3.1                                          | Modal de confirmación, menús, ayudas emergentes y avisos (foco, teclado y ARIA resueltos); sin estilos propios | ADR-016  |
| Tipografía                    | `@fontsource-variable/fraunces` 5.3.0 (títulos) e `@fontsource-variable/inter` 5.3.0 (cuerpo), eje de peso                                                 | Fuentes autohospedadas, sin CDN; el navegador descarga solo el subconjunto latino (≈ 37 KB y 48 KB)            | ADR-016  |
| Tipos de la API               | `openapi-typescript` 7                                                                                                                                     | Generar tipos desde `contracts/openapi.yaml`                                                                   | R19      |
| Pruebas del frontend          | Vitest 3, Testing Library, MSW 2                                                                                                                           | Formularios, sesión y simulación de la API                                                                     | R18      |
| Entorno local                 | Docker Compose con `postgres:16`; `tsx` para ejecutar las migraciones; `VITE_SONDEO` para que Vite detecte cambios en el volumen montado (Windows y macOS) | Reproducir el entorno                                                                                          | R20      |

Esta funcionalidad **no** levanta Redis: no hay lecturas que cachear.

### 5.3 Funcionalidad 006 (caché compartida, límites compartidos y balanceo local)

Fuente: `specs/006-escalado-cache-balanceo/research.md`. Decisiones: ADR-029 (caché compartida con claves por barbería) y ADR-030 (balanceo local como representación de ADR-006).

| Capa                          | Librería, imagen o herramienta (versión fijada)                                | Licencia                    | Para qué                                                                                                   | Decisión      |
| ----------------------------- | ------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------- |
| Cliente de Redis              | `ioredis` **5.4.2**                                                            | MIT                         | Caché del catálogo público y contadores del límite por IP; tiempo límite de 100 ms por operación, sin cola | R05           |
| Límite general de solicitudes | `@nestjs/throttler` 6.7 con almacenamiento propio (`AlmacenLimitesCompartido`) | MIT                         | Ahora **compartido entre réplicas** en Redis, con respaldo en memoria por instancia si Redis no responde   | R09           |
| Balanceador local             | Imagen `nginx:1.27-alpine`                                                     | BSD de 2 cláusulas (Nginx)  | Reparto por turnos, salud pasiva, IP real del cliente y 503 `SERVICIO_NO_DISPONIBLE`                       | R01, R02, R04 |
| Caché local                   | Imagen `redis:7.4-alpine`, sin persistencia (`--save ""`, `--appendonly no`)   | RSALv2 / SSPLv1 (Redis 7.4) | Datos tolerantes a pérdida (principio VIII); nunca fuente de verdad                                        | R12           |
| Pruebas                       | Testcontainers 12 (`GenericContainer` de Redis y de Nginx)                     | MIT                         | Dos instancias en proceso sobre el mismo Redis; Nginx delante de ellas                                     | R15           |

La licencia de Redis 7.4 (RSALv2 o SSPLv1) permite usarlo como caché interna de la propia aplicación, que es este caso; no permite ofrecer Redis como servicio a terceros. En la nube se usaría ElastiCache, que lo resuelve el proveedor.

**Límites de memoria por contenedor** (`docker-compose.yml`; se recomienda asignar **3 GB** a Docker):

| Contenedor         | Límite | Uso medido (2026-10-22 y 2026-10-24) |
| ------------------ | ------ | ------------------------------------ |
| `db` (PostgreSQL)  | 512 MB | 23–127 MB                            |
| `redis`            | 64 MB  | 4–11 MB (`maxmemory 48mb`)           |
| `preparar-backend` | 1 GB   | Solo mientras compila; luego termina |
| `backend-1`        | 384 MB | 40–66 MB                             |
| `backend-2`        | 384 MB | 40–66 MB                             |
| `nginx`            | 32 MB  | 3–5 MB                               |
| `frontend` (Vite)  | 512 MB | 136–149 MB                           |

### 5.4 Funcionalidad 003 (suscripciones y pagos)

Fuente: `specs/003-suscripciones-pagos/research.md`. Decisiones: ADR-022 (pasarela en sandbox o simulada y
transferencia), ADR-023 (comprobantes privados), ADR-024 (tareas programadas sin duplicados) y ADR-031
(administrador de la plataforma). **Sin dependencias nuevas**: todo se resolvió con lo ya instalado y con
el módulo `crypto` de Node.

| Necesidad                                                                    | Cómo se resolvió (sin instalar nada)                                                                                                                                                                                                     | Decisión     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Pasarela de pagos de prueba                                                  | **Simulador propio** (`backend/simulador-pagos/`, servidor HTTP de Node sin librerías): sesiones de pago, página con "Aprobar" y "Rechazar", notificaciones firmadas con HMAC y modos de falla (lento, caído, duplicar, firma inválida…) | ADR-022, R03 |
| Firma de las notificaciones                                                  | HMAC-SHA256 con marca de tiempo y comparación en tiempo constante (`node:crypto`)                                                                                                                                                        | R03          |
| Segundo factor del administrador (TOTP)                                      | RFC 6238 con `node:crypto` (HMAC-SHA1, 30 s, 6 dígitos, ±1 paso), probado con los vectores del RFC; secreto cifrado con AES-256-GCM; 10 códigos de recuperación con Argon2id (`argon2` ya instalado)                                     | ADR-031, R07 |
| Subida de comprobantes                                                       | `multer` (ya incluido por `@nestjs/platform-express`), en memoria y con tope de 5 MB; el tipo se verifica por los primeros bytes (JPEG, PNG, PDF), no por el nombre ni por el `Content-Type`                                             | ADR-023, R06 |
| Almacenamiento de comprobantes                                               | PostgreSQL (`payment_receipt_file`, `bytea`) detrás del puerto `AlmacenComprobantes`; en la nube, S3 privado con enlaces de corta duración                                                                                               | ADR-023      |
| Tareas programadas (vencimiento, conciliación, expiración de transferencias) | Ejecutor propio con `setInterval` y `pg_try_advisory_lock`: corren en las dos réplicas y solo una procesa cada ciclo; registro en `scheduled_job_run`                                                                                    | ADR-024, R10 |

**Contenedor `pasarela-simulada`:** imagen `node:22` (la misma del backend, sin descarga nueva), un solo
proceso de Node con el cargador de `tsx`, el código montado en solo lectura y un límite de **64 MB**; publica el puerto 3100 para la página de pago y las rutas `/control/*` (con
`SIMULADOR_TOKEN_CONTROL`). El monolito no lo importa (regla `simulador-fuera-del-monolito` de PR14): solo le
habla por HTTP a través del adaptador.

### 5.1 Interfaz: criterios y rendimiento

Decisiones: [ADR-016](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-016-sistema-de-diseño-propio-con-componentes-accesibles-de-radix) (sistema de diseño), [ADR-017](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-017-indicador-de-sesión-hay_sesion-en-el-navegador) (indicador de sesión) y [ADR-018](../01-analisis-de-sistema/07-decisiones-arquitectonicas.md#adr-018-carga-diferida-de-rutas-y-librerías-en-archivos-separados) (carga diferida).

- **Sin librería de componentes completa.** Radix aporta solo el comportamiento accesible de las piezas
  difíciles (atrapar y devolver el foco, navegación por teclado, `role` y `aria-*`); el aspecto sale del
  sistema de diseño propio (`frontend/src/styles/tokens.css`, tema claro y oscuro con `light-dark()`). Los
  menús se usan en modo no modal para no ocultar el resto de la página a los lectores de pantalla.
- **Iconos e ilustración propios en SVG**, sin paquetes de iconos.
- **Carga por pantalla** con `React.lazy`: el JavaScript inicial bajó de 573 KB a 372 KB (≈ 123 KB
  comprimido); React, TanStack Query y los formularios van en archivos aparte para aprovechar la caché del
  navegador entre despliegues.
- **En las pantallas de acceso** el conmutador de tema se descarga después de pintar el formulario, para
  sacar el menú de Radix de la ruta crítica.
- **Medición con Lighthouse 12.3** (2026-10-16, build de producción con `vite preview`, Chrome 155; modo
  celular con la limitación de red y CPU por defecto; mediana de 3 pasadas por pantalla y dispositivo):

  | Pantalla              | Rendimiento (celular / escritorio) | Accesibilidad | Buenas prácticas | SEO |
  | --------------------- | ---------------------------------- | ------------- | ---------------- | --- |
  | Portada               | 96 / 100                           | 100           | 100              | 100 |
  | Registro              | 92 / 100                           | 100           | 100              | 100 |
  | Ingresar              | 92 / 100                           | 100           | 100              | 100 |
  | Activar               | 92 / 100                           | 100           | 100              | —   |
  | Inicio (con sesión)   | 99 / 100                           | 100           | 100              | —   |
  | Usuarios (con sesión) | 99 / 100                           | 100           | 100              | —   |

  El SEO de Activar y de las pantallas con sesión no aplica: `robots.txt` las excluye a propósito. En
  celular el LCP de las pantallas de acceso ronda 2,9 s (red lenta simulada); el resto de métricas, CLS 0
  y TBT de 50 a 120 ms.

- **axe-core 4.10** sobre 30 estados (menús abiertos, modales, errores de formulario, avisos, 320 px; tema
  claro y oscuro): sin incumplimientos WCAG 2.2 A ni AA. Queda un aviso de buena práctica (`region`)
  mientras un menú o una ayuda emergente está abierta, porque Radix los dibuja en un portal fuera de los
  _landmarks_.
- **Funcionalidad 002 (2026-10-18, build de producción):** el JavaScript inicial es de **376,9 KB**
  (≈ 121 KB comprimido; antes 372 KB), por debajo del presupuesto de 400 KB: `index` 57,4 KB, `react`
  279,9 KB y `consultas` 39,7 KB. Las 10 pantallas nuevas se cargan al visitarlas (`React.lazy`, ADR-018):
  la página pública `/b/:slug` suma 6,9 KB (2,7 KB comprimido); la más pesada, Agenda, 9,0 KB.
  **Pendiente:** Lighthouse en modo celular y axe-core sobre `/b/:slug` y las demás pantallas nuevas (T130 de
  002). No se ejecutaron porque ninguno de los dos está instalado en el proyecto y descargarlos con `npx`
  usaría la caché de npm fuera de la unidad D:.

### 5.2 Licencias de terceros en la interfaz

| Componente                                      | Licencia             | Obligación práctica                                                                                        |
| ----------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Fraunces e Inter (`@fontsource-variable` 5.3.0) | SIL OFL 1.1          | Uso comercial libre; no vender las fuentes por separado; conservar su aviso de licencia (va en el paquete) |
| Radix UI (4 paquetes)                           | MIT                  | Conservar el aviso de copyright y licencia en la distribución (va en el paquete)                           |
| Ilustración, iconos y favicon (SVG)             | Propios del proyecto | Sin dependencias de terceros; registrados en `frontend/public/img/README.md`                               |
| Fotos de marca (cuando existan)                 | Según cada foto      | Requisitos y registro de autoría en `frontend/public/img/README.md`                                        |

Licencias leídas del `package.json` de cada paquete instalado (2026-10-16).
