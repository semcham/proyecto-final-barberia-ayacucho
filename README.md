<div align="center">

# 💈 Plataforma SaaS multi-tenant para la gestión y reserva de citas en barberías de Ayacucho

**Documentación de arquitectura de software · Proyecto final de IS-488**

![Curso](https://img.shields.io/badge/curso-IS--488%20Arquitectura%20de%20Software-1f6feb)
![Semestre](https://img.shields.io/badge/semestre-2026--II-8957e5)
![Estilo](https://img.shields.io/badge/estilo-monolito%20modular-2da44e)
![Multi-tenancy](https://img.shields.io/badge/multi--tenancy-tenant__id%20%2B%20RLS-d29922)
![Modelo](<https://img.shields.io/badge/modelo-C4%20(4%20niveles)-0969da>)
![Estado](<https://img.shields.io/badge/estado-funcionalidad%20001%20implementada-2da44e>)

_Una sola plataforma web para que muchas barberías administren sus servicios, barberos, horarios y citas, con datos aislados por barbería._

</div>

---

## 📌 Datos del proyecto

| Campo                     | Valor                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Autor**                 | Sem Torres                                                                                               |
| **Curso**                 | IS-488 Arquitectura de Software                                                                          |
| **Escuela / Universidad** | Escuela Profesional de Ingeniería de Sistemas, Universidad Nacional de San Cristóbal de Huamanga (UNSCH) |
| **Semestre**              | 2026-II                                                                                                  |
| **Entregable**            | Documentación de arquitectura (primer sprint del proyecto final)                                         |
| **Nombre comercial**      | Pendiente de aprobación. En todo el repositorio se usa "la plataforma" o "el sistema".                   |

## 🎯 1. Descripción del caso de estudio

Plataforma **web** SaaS en la que varias barberías gestionan servicios, barberos, horarios, citas, usuarios y reportes desde una misma solución. Cada barbería es un _tenant_ con datos y permisos aislados. El modelo comercial es **prueba gratuita + suscripción**. Incluye un asistente de IA, un módulo de pagos de suscripciones (proveedor externo), PostgreSQL como base principal, Redis como caché selectiva y un despliegue en la nube (AWS) con balanceador de carga (Application Load Balancer) y varias instancias del mismo backend. Los clientes reciben **recordatorios de su cita** por correo o WhatsApp.

> **Analogía.** Se parece a un servicio por suscripción (prueba gratuita y planes), pero el suscriptor es una **barbería**, no una persona, y los datos de cada una están aislados de las demás, como en una plataforma de tiendas en línea.

### Decisiones de alcance cerradas

| Decisión            | Detalle                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Plataforma          | **Solo web** (navegador, diseño responsive). La aplicación móvil nativa queda como **evolución futura**.  |
| Pagos               | Solo la **suscripción de las barberías**. El pago de citas por parte de los clientes queda fuera del MVP. |
| Estilo              | **Monolito modular** de 6 módulos (5 de negocio + núcleo compartido).                                     |
| Organización lógica | **4 capas** con enfoque **Clean Architecture**.                                                           |
| Multi-tenancy       | **Base compartida** con `tenant_id` + **Row-Level Security** en PostgreSQL.                               |
| Notificaciones      | Correo (MVP y respaldo) y WhatsApp (opcional, con consentimiento).                                        |

## 🗺️ 2. Mapa de lectura

El orden sigue el proceso del curso (Guías 02, 03 y 04): _primero se analizan las necesidades, luego se toman las decisiones de arquitectura_.

> **Núcleo y complementos.** Lo que pide la Guía 04 es: `docs/01-analisis-de-sistema` (01 a 08), `arquitectura-inicial`, `estilo`, `enfoque` y `componentes` de `docs/02-arquitectura-software`, `docs/03-diseño-de-software/diseño-interno`, `docs/04-modelo-c4`, `img` y `tecnologia` (la aplicación en `tecnologia/plataforma-barberias`). El resto (contexto del negocio, tácticas, multi-tenancy, caché, despliegue, seguridad, tecnologías, gestión y trazabilidad) son **complementos** propios de este proyecto SaaS.

### Análisis

| Paso                                                       | Documento                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 0. Necesidad del negocio, problema, objetivos y evidencias | [00-contexto-negocio-y-evidencias.md](docs/00-contexto-negocio-y-evidencias.md)                      |
| 1. Actores                                                 | [01-actores.md](docs/01-analisis-de-sistema/01-actores.md)                                           |
| 2. Historias de usuario                                    | [02-historias-del-usuario.md](docs/01-analisis-de-sistema/02-historias-del-usuario.md)               |
| 3. Requisitos funcionales                                  | [03-requisitos-funcionales.md](docs/01-analisis-de-sistema/03-requisitos-funcionales.md)             |
| 4. Atributos de calidad                                    | [04-atributos-de-calidad.md](docs/01-analisis-de-sistema/04-atributos-de-calidad.md)                 |
| 5. Restricciones                                           | [05-restricciones.md](docs/01-analisis-de-sistema/05-restricciones.md)                               |
| 6. Drivers arquitectónicos                                 | [06-driver-arquitectonicos.md](docs/01-analisis-de-sistema/06-driver-arquitectonicos.md)             |
| 7. Decisiones arquitectónicas (ADR)                        | [07-decisiones-arquitectonicas.md](docs/01-analisis-de-sistema/07-decisiones-arquitectonicas.md)     |
| 8. Escenarios de calidad                                   | [08-escenarios-atributos-calidad.md](docs/01-analisis-de-sistema/08-escenarios-atributos-calidad.md) |

### Arquitectura y diseño

| Tema                                     | Documento                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Arquitectura inicial (3 capas → 4 capas) | [arquitectura-inicial.md](docs/02-arquitectura-software/arquitectura-inicial.md)               |
| Estilo: monolito modular                 | [estilo-arquitectonico.md](docs/02-arquitectura-software/estilo-arquitectonico.md)             |
| Enfoque: Clean Architecture y 4 capas    | [enfoque-arquitectonico.md](docs/02-arquitectura-software/enfoque-arquitectonico.md)           |
| Tácticas                                 | [tacticas-arquitectonicas.md](docs/02-arquitectura-software/tacticas-arquitectonicas.md)       |
| Componentes                              | [componentes-arquitectonicos.md](docs/02-arquitectura-software/componentes-arquitectonicos.md) |
| Multi-tenancy y datos                    | [multi-tenancy-y-datos.md](docs/02-arquitectura-software/multi-tenancy-y-datos.md)             |
| API REST                                 | [api-rest.md](docs/02-arquitectura-software/api-rest.md)                                       |
| Caché con Redis                          | [estrategia-de-cache.md](docs/02-arquitectura-software/estrategia-de-cache.md)                 |
| Despliegue y escalabilidad               | [despliegue-y-escalabilidad.md](docs/02-arquitectura-software/despliegue-y-escalabilidad.md)   |
| Seguridad y privacidad                   | [seguridad-y-privacidad.md](docs/02-arquitectura-software/seguridad-y-privacidad.md)           |
| Tecnologías                              | [tecnologias.md](docs/02-arquitectura-software/tecnologias.md)                                 |
| Diseño interno, patrones y SOLID         | [diseño-interno/](docs/03-diseño-de-software/diseño-interno/)                                  |

### Modelo C4

| Nivel                   | Documento                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| 1. Contexto del sistema | [Nivel1-DiagramadeContextodelSistema.md](docs/04-modelo-c4/Nivel1-DiagramadeContextodelSistema.md) |
| 2. Contenedores         | [Nivel2-DiagramadeContenedores.md](docs/04-modelo-c4/Nivel2-DiagramadeContenedores.md)             |
| 3. Componentes          | [Nivel3-Diagrama-de-Componentes.md](docs/04-modelo-c4/Nivel3-Diagrama-de-Componentes.md)           |
| 4. Código               | [Nivel4-DiagramadeCodigo.md](docs/04-modelo-c4/Nivel4-DiagramadeCodigo.md)                         |

### Gestión y trazabilidad

| Tema                                                              | Documento                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Scrum                                                             | [01-scrum.md](docs/05-gestion/01-scrum.md)                                           |
| Backlog y sprints                                                 | [02-backlog-y-sprints.md](docs/05-gestion/02-backlog-y-sprints.md)                   |
| Desarrollo guiado por especificaciones (SDD)                      | [03-sdd-spec-kit.md](docs/05-gestion/03-sdd-spec-kit.md)                             |
| Pruebas                                                           | [04-pruebas.md](docs/05-gestion/04-pruebas.md)                                       |
| Riesgos                                                           | [05-riesgos.md](docs/05-gestion/05-riesgos.md)                                       |
| MVP y evolución                                                   | [06-mvp-y-evolucion.md](docs/05-gestion/06-mvp-y-evolucion.md)                       |
| Guion de exposición y defensa                                     | [07-guion-exposicion-y-defensa.md](docs/05-gestion/07-guion-exposicion-y-defensa.md) |
| Adopción y capacitación de usuarios                               | [08-adopcion-y-capacitacion.md](docs/05-gestion/08-adopcion-y-capacitacion.md)       |
| **Trazabilidad** HU → RF → AC/EQ → DA → ADR → componente → prueba | [trazabilidad.md](docs/trazabilidad.md)                                              |

## 🧱 3. Estructura del proyecto

```text
proyecto-final-barberia-ayacucho/
│
├── README.md                                  ← este archivo
│
├── docs/                                      ← toda la documentación
│   ├── 00-contexto-negocio-y-evidencias.md    necesidad, problema, objetivos, alcance, evidencias
│   │
│   ├── 01-analisis-de-sistema/                qué necesita el sistema
│   │   ├── 01-actores.md
│   │   ├── 02-historias-del-usuario.md        HU01–HU28
│   │   ├── 03-requisitos-funcionales.md       RF01–RF34
│   │   ├── 04-atributos-de-calidad.md         AC01–AC10
│   │   ├── 05-restricciones.md                RC01–RC16
│   │   ├── 06-driver-arquitectonicos.md       DA01–DA12
│   │   ├── 07-decisiones-arquitectonicas.md   ADR-001–ADR-018
│   │   └── 08-escenarios-atributos-calidad.md EQ-01–EQ-22
│   │
│   ├── 02-arquitectura-software/              cómo se organiza el sistema
│   │   ├── arquitectura-inicial.md
│   │   ├── estilo-arquitectonico.md
│   │   ├── enfoque-arquitectonico.md
│   │   ├── componentes-arquitectonicos.md
│   │   ├── tacticas-arquitectonicas.md
│   │   ├── api-rest.md
│   │   ├── multi-tenancy-y-datos.md
│   │   ├── estrategia-de-cache.md
│   │   ├── despliegue-y-escalabilidad.md
│   │   ├── seguridad-y-privacidad.md
│   │   └── tecnologias.md
│   │
│   ├── 03-diseño-de-software/
│   │   └── diseño-interno/
│   │       ├── diseño-interno-de-modulos.md
│   │       ├── patrones-de-diseño.md
│   │       └── principios-de-diseño.md
│   │
│   ├── 04-modelo-c4/                          los cuatro niveles del modelo C4
│   │   ├── Nivel1-DiagramadeContextodelSistema.md
│   │   ├── Nivel2-DiagramadeContenedores.md
│   │   ├── Nivel3-Diagrama-de-Componentes.md
│   │   └── Nivel4-DiagramadeCodigo.md
│   │
│   ├── 05-gestion/                            cómo se organiza el trabajo
│   │   ├── 01-scrum.md
│   │   ├── 02-backlog-y-sprints.md
│   │   ├── 03-sdd-spec-kit.md
│   │   ├── 04-pruebas.md
│   │   ├── 05-riesgos.md
│   │   ├── 06-mvp-y-evolucion.md
│   │   ├── 07-guion-exposicion-y-defensa.md
│   │   └── 08-adopcion-y-capacitacion.md
│   │
│   └── trazabilidad.md                        matriz que une todo lo anterior
│
├── img/                                       21 diagramas en PNG, al mismo nivel que docs (código Mermaid en cada documento)
│
├── specs/                                     especificaciones de Spec Kit (una carpeta por funcionalidad)
│   └── 001-registro-acceso-barberia/          spec, plan, tareas, contrato OpenAPI, guía rápida
│
├── .github/workflows/                         integración continua (formato, lint, build y pruebas)
│
└── tecnologia/                                ← recursos tecnológicos
    └── plataforma-barberias/                  ← la aplicación (se construye con SDD y Spec Kit)
        ├── README.md                          qué contiene y cómo ejecutarla
        ├── docker-compose.yml                 entorno de desarrollo: db, backend y frontend
        ├── backend/                           NestJS: hoy M01, M03 (mínimo) y M06 (ver estructura del backend)
        └── frontend/                          React con Vite y TypeScript, sistema de diseño propio con Radix UI
            ├── src/styles/                    tokens del sistema de diseño (tema claro y oscuro)
            ├── src/components/                ui/ (componentes base), app/ (estructura), marca/ (ilustración)
            ├── src/pages/                     registro, ingreso, activación, inicio y usuarios
            └── public/                        favicon, robots.txt e img/ (fotos de marca y su licencia)
```

Las imágenes de los diagramas están en `img/` y se incrustan con rutas relativas. Cada una trae su código Mermaid editable en un bloque desplegable.

### Estructura planificada del backend

Se ubica en `tecnologia/plataforma-barberias/backend/src/`.

Seis módulos (cinco de negocio y un núcleo compartido). Los módulos con dos responsabilidades cercanas se dividen en submódulos, y cada submódulo lleva las mismas cuatro capas (Clean Architecture). La regla de dependencia apunta siempre hacia el dominio.

```text
backend/src/
├── host/                         raíz de composición: rutas, middleware de tenant y autenticación
├── modules/
│   ├── acceso-barberias/         M01   submódulos: identidad, barberias
│   ├── catalogo-citas/           M02   submódulos: catalogo, citas
│   ├── suscripciones-pagos/      M03   submódulos: suscripciones, pagos
│   ├── asistente-reportes/       M04   submódulos: asistente, reportes
│   └── notificaciones/           M05
│
│   cada submódulo contiene:
│       presentation/    controladores y DTO
│       application/     casos de uso y puertos
│       domain/          entidades y reglas
│       infrastructure/  repositorios y adaptadores
│
└── shared/                       M06   contexto de tenant, eventos, caché, auditoría, registro, límites
```

Si el sistema crece, un submódulo puede promoverse a módulo (o extraerse como servicio) sin cambiar su contrato. Ver [estilo-arquitectonico.md](docs/02-arquitectura-software/estilo-arquitectonico.md#41-cómo-crece-el-sistema).

## 🧭 4. Vista rápida de la arquitectura

| Aspecto                     | Decisión                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Estilo                      | Monolito modular, 6 módulos (con submódulos) y dependencias permitidas explícitas    |
| Capas                       | Presentación, aplicación, dominio e infraestructura                                  |
| Aislamiento entre barberías | `tenant_id` firmado en el token + Row-Level Security                                 |
| Reservas sin duplicados     | Restricción de exclusión en PostgreSQL (`EXCLUDE USING gist`)                        |
| Caché                       | Redis solo como caché selectiva, nunca como fuente de verdad                         |
| Pagos                       | Puerto `PaymentGateway`, webhook firmado e idempotente, conciliación                 |
| IA                          | Puerto `AIProvider`, herramientas cerradas por rol, sin SQL libre                    |
| Notificaciones              | Puerto `NotificationChannel` (correo y WhatsApp), asíncrono, con respaldo por correo |
| Despliegue                  | AWS: Application Load Balancer + varias instancias idénticas del backend             |
| Interfaz web                | React + Vite + TypeScript; sistema de diseño propio (tema claro y oscuro) con Radix UI; WCAG 2.2 AA; pantallas con carga diferida (ADR-014, 016, 018) |
| Sesión en el navegador      | Token de acceso solo en memoria; renovación con cookie HttpOnly; indicador `hay_sesion` (ADR-010, 017) |

## ▶️ Cómo ejecutar la aplicación

```powershell
cd tecnologia/plataforma-barberias
Copy-Item .env.example .env      # completar las claves JWT de desarrollo
docker compose up -d
docker compose exec backend npm run migrate
```

Aplicación web en <http://localhost:5173> y API en <http://localhost:3000/api/v1/salud>. Ejecución sin Docker, comprobaciones (las mismas del CI) y notas del entorno en el [README de la aplicación](tecnologia/plataforma-barberias/README.md); guía completa con los escenarios de validación en [quickstart.md](specs/001-registro-acceso-barberia/quickstart.md).

## 🔎 5. Reglas de rigor aplicadas

- Cada dato de Perú o Ayacucho lleva fuente, nivel (nacional o regional) y estado de verificación. Ninguna cifra nacional se atribuye a Ayacucho.
- Los umbrales numéricos son **metas propuestas por validar** con pruebas. Los precios de planes son **ejemplos hipotéticos**.
- Cada componente se etiqueta como **implementado, prototipado, planificado o futuro**. Hoy está **implementada** la funcionalidad 001 (registro de barbería, acceso con roles y aislamiento, con su interfaz web); el resto sigue **planificado**. El estado de cada componente está en la [trazabilidad](docs/trazabilidad.md).
- Diagramas en Mermaid (compatibles con GitHub). Citas en APA 7.

## 🏷️ 6. Convenciones

**Identificadores**

| Código    | Significado             |
| --------- | ----------------------- |
| `HU01`    | Historia de usuario     |
| `RF01`    | Requisito funcional     |
| `AC01`    | Atributo de calidad     |
| `EQ-01`   | Escenario de calidad    |
| `RC01`    | Restricción             |
| `DA01`    | Driver arquitectónico   |
| `ADR-001` | Decisión arquitectónica |
| `M01`     | Módulo / componente     |
| `T01`     | Táctica                 |
| `PR01`    | Prueba                  |

**Commits:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`. Ejemplo: `docs: agregar escenarios de calidad`.

## 📚 7. Referencias del proyecto

Fuentes de consulta que respaldan las decisiones de esta documentación. Las citas completas en APA 7 y el nivel de verificación de cada dato están en [00-contexto-negocio-y-evidencias.md](docs/00-contexto-negocio-y-evidencias.md).

**Modelado y arquitectura**

- Brown, S. _The C4 model for visualising software architecture_. <https://c4model.com>
- Martin, R. C. (2017). _Clean Architecture: A Craftsman's Guide to Software Structure and Design_. Prentice Hall.
- Bass, L., Clements, P., & Kazman, R. (2021). _Software Architecture in Practice_ (4.ª ed.). Addison-Wesley.
- Mermaid. _Documentación de diagramas como código_. <https://mermaid.js.org>

**Datos y multi-tenancy**

- PostgreSQL. _Row Security Policies_. <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>
- PostgreSQL. _Range Types y restricciones de exclusión_. <https://www.postgresql.org/docs/current/rangetypes.html>
- Redis. _Documentación oficial_. <https://redis.io/docs/>

**Pagos y mensajería (proveedores candidatos, sin contratar)**

- Culqi. _Documentación para desarrolladores_. <https://docs.culqi.com>
- Meta. _WhatsApp Business Platform_. <https://developers.facebook.com/docs/whatsapp>

**Proceso de trabajo**

- Schwaber, K., & Sutherland, J. _La Guía de Scrum_. <https://scrumguides.org>
- GitHub. _Spec Kit_ (desarrollo guiado por especificaciones). <https://github.com/github/spec-kit>
- American Psychological Association. (2020). _Publication Manual of the American Psychological Association_ (7.ª ed.).

**Marco legal (Perú)**

- Ley N.° 29733, Ley de Protección de Datos Personales, y su reglamento. Verificar el texto vigente en El Peruano y en <https://www.gob.pe>. Esta documentación no constituye asesoría legal.

**Material del curso**

- Guías 02, 03 y 04 de IS-488 Arquitectura de Software (UNSCH, 2026-II) y material de diagramas C4.

---

<div align="center">

**Sem Torres** · Escuela Profesional de Ingeniería de Sistemas · UNSCH · 2026-II

</div>
