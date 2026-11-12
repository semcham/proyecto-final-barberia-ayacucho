# Escenarios de atributos de calidad de la plataforma

Un escenario de atributo de calidad es una descripción **concreta y medible** de cómo debe responder el sistema ante un estímulo para cumplir un atributo de calidad. Una descripción general ("debe ser rápido") no es un escenario. Cada escenario sigue las **seis partes de la Guía 04** (fuente del estímulo, estímulo, artefacto, entorno, respuesta y medida de la respuesta) y agrega **Verificación** y **Estado**, como en el archivo de ejemplo de la guía. Debajo de cada escenario, su **ficha de medición** dice con qué herramienta y versión se mide, en qué entorno, con qué preparación y configuración, contra qué umbral, con qué comando, qué evidencia queda y en qué estado está. Lo que todavía no existe dice "por definir". Resumen por atributo: [04-atributos-de-calidad.md](04-atributos-de-calidad.md) §5.

> **Las medidas numéricas son metas propuestas** que se comprueban con las pruebas indicadas (la prueba PRnn corresponde al escenario EQ-nn, salvo EQ-23 y EQ-24, que se prueban con PR31 y PR32 porque PR23 a PR30 ya tenían otro uso; ver [pruebas](../05-gestion/04-pruebas.md)). La fila **Estado** dice si ya se midió en local, con qué funcionalidad, o si sigue **por medir**; los resultados completos están en la [trazabilidad](../trazabilidad.md). Ningún escenario se ha medido en la nube. Catálogo de atributos: [04-atributos-de-calidad.md](04-atributos-de-calidad.md).

**Convenciones de las fichas.** Las rutas de `backend/` son relativas a `tecnologia/plataforma-barberias/` y los comandos `npm run …` se ejecutan desde `tecnologia/plataforma-barberias/backend/`. "Docker Compose" es el entorno de `tecnologia/plataforma-barberias/docker-compose.yml`: Nginx 1.27 en el puerto 3000, réplicas `backend-1` y `backend-2` (Node 22), PostgreSQL 16 y Redis 7.4. "Pruebas" es Jest 29.7.0 con Testcontainers 12.2.1 (PostgreSQL real con RLS), en local y en la CI (`.github/workflows/plataforma-barberias.yml`, paso `npm run test:int`). Los scripts de k6 **no existen**: sus nombres y su carpeta (`tecnologia/plataforma-barberias/carga/k6/`) son una propuesta. El procedimiento general (tres repeticiones, mediana, resultados con fecha) está en [04](04-atributos-de-calidad.md) §6.

## Índice por atributo

| Atributo                                | Escenarios                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC01 Seguridad y privacidad             | [EQ-07](#eq-07-seguridad-autenticación), [EQ-08](#eq-08-seguridad-autorización-por-rol), [EQ-09](#eq-09-seguridad-aislamiento-multi-tenant), [EQ-10](#eq-10-seguridad-validación-de-entradas), [EQ-11](#eq-11-seguridad-gestión-de-secretos), [EQ-12](#eq-12-seguridad-límite-de-solicitudes), [EQ-13](#eq-13-seguridad-auditoría), [EQ-18](#eq-18-privacidad-consentimiento-y-derechos-sobre-los-datos), [EQ-19](#eq-19-privacidad-privacidad-en-el-asistente-de-ia), [EQ-23](#eq-23-seguridad-comprobantes-privados-del-adelanto-de-reserva) |
| AC02 Consistencia de datos              | [EQ-16](#eq-16-consistencia-reservas-simultáneas-del-mismo-horario), [EQ-17](#eq-17-consistencia-notificación-de-pago-repetida), [EQ-24](#eq-24-consistencia-el-adelanto-no-confirma-la-cita-dos-veces)                                                                                                                                                                                                                                                                                                                                       |
| AC03 Disponibilidad y resiliencia       | [EQ-04](#eq-04-disponibilidad-falla-de-una-instancia), [EQ-05](#eq-05-disponibilidad-caída-de-redis), [EQ-06](#eq-06-disponibilidad-falla-del-proveedor-de-ia-de-pagos-o-de-mensajería), [EQ-21](#eq-21-observabilidad-diagnóstico-de-una-solicitud-fallida), [EQ-22](#eq-22-disponibilidad-recuperación-ante-pérdida-de-datos)                                                                                                                                       |
| AC04 Mantenibilidad e interoperabilidad | [EQ-14](#eq-14-mantenibilidad-cambio-de-proveedor-sin-tocar-reglas-de-negocio), [EQ-20](#eq-20-interoperabilidad-integración-mediante-puertos)                                                                                                                                                                                                                                                                                                                        |
| AC05 Rendimiento y escalabilidad        | [EQ-01](#eq-01-rendimiento-consulta-de-disponibilidad-en-hora-pico), [EQ-02](#eq-02-rendimiento-creación-de-cita-bajo-carga), [EQ-03](#eq-03-escalabilidad-agregar-una-instancia)                                                                                                                                                                                                                                                                                     |
| AC06 Usabilidad y accesibilidad         | [EQ-15](#eq-15-usabilidad-reserva-simple-desde-celular)                                                                                                                                                                                                                                                                                                                                                                                                               |

## EQ-01. Rendimiento: Consulta de disponibilidad en hora pico

| Elemento                | Descripción                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Rendimiento y escalabilidad (AC05)                                                                                  |
| **Fuente**              | Clientes que consultan horarios                                                                                     |
| **Estímulo**            | 50 usuarios concurrentes consultan disponibilidad de la misma barbería                                              |
| **Artefacto**           | Módulo M02 Catálogo y citas, API REST, caché Redis                                                                  |
| **Entorno / condición** | Operación normal, una instancia, catálogo y horarios en caché                                                       |
| **Respuesta esperada**  | El sistema devuelve horarios libres calculados con los datos vigentes                                               |
| **Medida**              | p95 ≤ 800 ms y 0 % de errores 5xx _(propuesta por validar)_                                                         |
| **Verificación**        | PR01: prueba de carga (por ejemplo k6 o Locust)                                                                     |
| **Estado**              | Medido en local (006): con 2 réplicas y caché, p95 de 288 y 273 ms en caliente y 0 % de 5xx (en frío, 831 y 765 ms) |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | k6, versión por fijar (imagen `grafana/k6`). Medición preliminar: script propio `backend/scripts/medir-horarios.ts` (Node 22 con `tsx` 4.23.15)                                                                                                                                                                                                                                  |
| **Entorno**               | Local con Docker Compose                                                                                                                                                                                                                                                                                                                                                         |
| **Preparación**           | Barbería activa con 5 barberos, un servicio de 30 minutos y 60 citas confirmadas en el día medido (lo siembra `medir-horarios.ts` y lo borra al terminar); catálogo precargado con `GET /publico/{slug}`; réplicas con `PUBLICO_LIMITE_POR_MINUTO` alto (por ejemplo 100000)                                                                                                     |
| **Configuración**         | k6: 50 usuarios virtuales sobre `GET /api/v1/publico/{slug}/horarios`; duración por fijar. Preliminar (usada): 10 rondas de 50 consultas simultáneas, en cuatro variantes (1 o 2 réplicas, con o sin caché)                                                                                                                                                                      |
| **Métrica y umbral**      | p95 ≤ 800 ms y 0 % de errores 5xx                                                                                                                                                                                                                                                                                                                                                |
| **Comando**               | Preliminar (usado): `npm run medir:horarios -- --etiqueta D-2r-con-cache --salida ../../../tmp/medicion-D.json`. k6 (propuesto): `docker run --rm -i -e BASE_URL=http://host.docker.internal:3000/api/v1 -v "${PWD}/carga:/carga" grafana/k6 run --summary-export /carga/resultados/AAAA-MM-DD-eq-01.json /carga/k6/eq-01-horarios.js`, desde `tecnologia/plataforma-barberias/` |
| **Evidencia**             | Preliminar: JSON en `tmp/` (no se versiona) y resultados en `specs/006-escalado-cache-balanceo/quickstart.md` §6. k6: `carga/resultados/` (propuesto)                                                                                                                                                                                                                            |
| **Estado**                | **Parcial.** k6: Planificada. Medición preliminar Usada en 006: p95 de 288 y 273 ms en caliente y 0 % de 5xx (en frío, 831 y 765 ms)                                                                                                                                                                                                                                             |

## EQ-02. Rendimiento: Creación de cita bajo carga

| Elemento                | Descripción                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| **Atributo de calidad** | Rendimiento y escalabilidad (AC05)                                               |
| **Fuente**              | Clientes que reservan                                                            |
| **Estímulo**            | 20 solicitudes de reserva por segundo durante 5 minutos sobre distintos horarios |
| **Artefacto**           | M02, PostgreSQL                                                                  |
| **Entorno / condición** | Operación normal, dos instancias tras el balanceador                             |
| **Respuesta esperada**  | Cada reserva se confirma o se rechaza con motivo                                 |
| **Medida**              | p95 ≤ 1 500 ms; tasa de error técnico < 1 % _(propuesta por validar)_            |
| **Verificación**        | PR02: prueba de carga con datos de prueba                                        |
| **Estado**              | Por medir                                                                        |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | k6, versión por fijar (imagen `grafana/k6`)                                                                                                                                                                                      |
| **Entorno**               | Local con Docker Compose, dos réplicas tras Nginx                                                                                                                                                                                |
| **Preparación**           | Barbería con horarios libres para unas 6 000 reservas distintas (20 por segundo durante 300 s) y clientes con sesión. Cómo sembrarlos y cómo obtener sus tokens: por definir (puede partir de la siembra de `medir-horarios.ts`) |
| **Configuración**         | Tasa constante de 20 solicitudes por segundo durante 5 minutos sobre `POST /api/v1/citas`, cada una a un horario distinto                                                                                                        |
| **Métrica y umbral**      | p95 ≤ 1 500 ms; tasa de error técnico < 1 %                                                                                                                                                                                      |
| **Comando**               | Propuesto: el de EQ-01 con `/carga/k6/eq-02-reservas.js`                                                                                                                                                                         |
| **Evidencia**             | `carga/resultados/AAAA-MM-DD-eq-02.json` (propuesto)                                                                                                                                                                             |
| **Estado**                | **Planificada.** Por medir. **Opción de menor costo:** k6 por Docker contra el Compose local, sin nube, con tres repeticiones                                                                                                    |

## EQ-03. Escalabilidad: Agregar una instancia

| Elemento                | Descripción                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Atributo de calidad** | Rendimiento y escalabilidad (AC05)                                                                                             |
| **Fuente**              | Operador de la plataforma                                                                                                      |
| **Estímulo**            | El tráfico se duplica y se agrega una segunda instancia del backend                                                            |
| **Artefacto**           | Balanceador de carga, instancias del monolito, pool de conexiones a PostgreSQL                                                 |
| **Entorno / condición** | Sin interrupción del servicio, sesiones sin estado                                                                             |
| **Respuesta esperada**  | La nueva instancia recibe tráfico tras superar la verificación de salud                                                        |
| **Medida**              | Sin cambios de código; 0 solicitudes perdidas durante el alta; throughput ≥ 1,6× el de una instancia _(propuesta por validar)_ |
| **Verificación**        | PR03: prueba de escalado con carga constante                                                                                   |
| **Estado**              | Por medir                                                                                                                      |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | k6, versión por fijar, con Docker Compose para agregar la instancia                                                                                                                                                                                                 |
| **Entorno**               | Local con Docker Compose                                                                                                                                                                                                                                            |
| **Preparación**           | La siembra de EQ-01; `PUBLICO_LIMITE_POR_MINUTO` alto; arrancar solo con `backend-1` (`docker compose stop backend-2`)                                                                                                                                              |
| **Configuración**         | Carga constante sobre `GET /api/v1/publico/{slug}/horarios` (tasa por fijar): primero se mide el throughput con una instancia; luego, con la carga en marcha, `docker compose start backend-2` (las réplicas se reinician con `--no-deps`, como en `demo-caida.ts`) |
| **Métrica y umbral**      | Throughput ≥ 1,6 veces el de una instancia; 0 solicitudes perdidas durante el alta; sin cambios de código                                                                                                                                                           |
| **Comando**               | Propuesto: el de EQ-01 con `/carga/k6/eq-03-escalado.js`                                                                                                                                                                                                            |
| **Evidencia**             | `carga/resultados/AAAA-MM-DD-eq-03.json` (propuesto)                                                                                                                                                                                                                |
| **Estado**                | **Planificada.** Por medir. **Opción de menor costo:** las dos réplicas del Compose local (ADR-030), sin nube. En una sola máquina las réplicas comparten la CPU: el resultado local no representa la nube                                                          |

## EQ-04. Disponibilidad: Falla de una instancia

| Elemento                | Descripción                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Disponibilidad y resiliencia (AC03)                                                                         |
| **Fuente**              | Fallo de infraestructura                                                                                    |
| **Estímulo**            | Una de dos instancias del backend deja de responder                                                         |
| **Artefacto**           | Balanceador de carga (verificación de salud)                                                                |
| **Entorno / condición** | Operación normal con tráfico                                                                                |
| **Respuesta esperada**  | El balanceador deja de enviar tráfico a la instancia caída y la otra atiende                                |
| **Medida**              | Detección en ≤ 15 s; ≤ 2 % de solicitudes con error durante la transición _(propuesta por validar)_         |
| **Verificación**        | PR04: detener una instancia durante la carga                                                                |
| **Estado**              | Medido en local (006): PR04 con Compose, 0 errores al detener una réplica; 503 en menos de 3 s sin réplicas |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | k6 (versión por fijar) con Docker Compose. Hasta hoy: script propio `backend/scripts/demo-caida.ts` (`tsx` 4.23.15) con Docker Compose                     |
| **Entorno**               | Local con Docker Compose, dos réplicas tras Nginx                                                                                                          |
| **Preparación**           | Barbería de prueba sembrada por `demo-caida.ts` (la borra al terminar); réplicas con `PUBLICO_LIMITE_POR_MINUTO` alto                                      |
| **Configuración**         | Unas 20 solicitudes por segundo (catálogo y horarios) durante 60 s; `backend-2` se detiene a los 15 s y vuelve a los 40 s (valores por defecto del script) |
| **Métrica y umbral**      | Detección en ≤ 15 s; ≤ 2 % de solicitudes con error durante la transición                                                                                  |
| **Comando**               | Usado: `npm run demo:caida -- --objetivo replica`. k6 (propuesto): `/carga/k6/eq-04-caida.js` mientras se ejecuta `docker compose stop backend-2`          |
| **Evidencia**             | JSON en `tmp/` (por defecto; no se versiona) y registro en `specs/006-escalado-cache-balanceo/quickstart.md` §6                                            |
| **Estado**                | **Usada** (Docker Compose y script propio); k6 Planificada. Resultado: 0 errores al detener una réplica; 503 en menos de 3 s sin réplicas                  |

## EQ-05. Disponibilidad: Caída de Redis

| Elemento                | Descripción                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Disponibilidad y resiliencia (AC03)                                                     |
| **Fuente**              | Fallo de infraestructura                                                                |
| **Estímulo**            | Redis deja de estar disponible                                                          |
| **Artefacto**           | Adaptador de caché (M06), M02                                                           |
| **Entorno / condición** | Operación normal                                                                        |
| **Respuesta esperada**  | El sistema consulta directamente PostgreSQL; las reservas siguen siendo correctas       |
| **Medida**              | 0 reservas incorrectas; p95 de lecturas ≤ 2 s; alerta emitida _(propuesta por validar)_ |
| **Verificación**        | PR05: detener Redis durante pruebas funcionales y de carga                              |
| **Estado**              | Medido en local (006): PR05 con Redis detenido, 0 errores y 20 reservas sin duplicados  |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | k6 (versión por fijar) con Docker Compose. Hasta hoy: `demo-caida.ts` con Docker Compose, y Jest + Testcontainers (`backend/test/integration/escalado/redis-caido.spec.ts`) |
| **Entorno**               | Local con Docker Compose; pruebas en la CI                                                                                                                                  |
| **Preparación**           | Barbería sembrada por `demo-caida.ts`, con el catálogo en caché; réplicas con `PUBLICO_LIMITE_POR_MINUTO` alto                                                              |
| **Configuración**         | Los tiempos de EQ-04, deteniendo `redis`; durante la caída, 20 reservas enviadas dos veces cada una con la misma `Idempotency-Key`                                          |
| **Métrica y umbral**      | 0 reservas incorrectas; p95 de lecturas ≤ 2 s; alerta emitida                                                                                                               |
| **Comando**               | Usados: `npm run demo:caida -- --objetivo redis` y `npm run test:int -- redis-caido`                                                                                        |
| **Evidencia**             | JSON en `tmp/` y registro en `specs/006-escalado-cache-balanceo/quickstart.md` §6; salida de la CI                                                                          |
| **Estado**                | **Usada.** Resultado: 0 errores y 20 reservas sin duplicados. La parte "alerta emitida" no se puede medir hasta tener alertas (táctica T10, planificada)                    |

## EQ-06. Disponibilidad: Falla del proveedor de IA, de pagos o de mensajería

| Elemento                | Descripción                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Disponibilidad y resiliencia (AC03)                                                                                                                                                                                                                                     |
| **Fuente**              | Proveedor externo de IA, de pagos, de correo o de WhatsApp                                                                                                                                                                                                              |
| **Estímulo**            | El proveedor responde con error o excede el tiempo límite                                                                                                                                                                                                               |
| **Artefacto**           | Adaptadores `AIProvider`, `PaymentGateway` y `NotificationChannel` (correo y WhatsApp), circuit breaker                                                                                                                                                                 |
| **Entorno / condición** | Operación normal                                                                                                                                                                                                                                                        |
| **Respuesta esperada**  | Se reintenta con espera; el circuito se abre y se muestra una alternativa (flujo manual de reserva; "pago pendiente de confirmación"; la notificación por WhatsApp se reenvía por correo)                                                                               |
| **Medida**              | Circuito abierto tras 5 fallos en 60 s; mensaje alternativo en ≤ 3 s; el resto de la plataforma sigue operando; la reserva no se deshace por un fallo de envío; ≥ 95 % de las citas con una notificación entregada por algún canal en ≤ 5 min _(propuesta por validar)_ |
| **Verificación**        | PR06: simulador de proveedor con errores y latencias                                                                                                                                                                                                                    |
| **Estado**              | Parcial: medido para pagos (PR06, 003) y para correo y WhatsApp (PR06, 004) contra Mailpit y los simuladores; IA planificada (005)                                                                                                                                      |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Herramienta y versión** | Principal del atributo: k6 (versión por fijar) con Docker Compose. Hasta hoy, para pagos: Jest + Testcontainers con el simulador de pagos (`backend/simulador-pagos/`)                                                   |
| **Entorno**               | Pruebas; también recorrido con Docker Compose (003)                                                                                                                                                                      |
| **Preparación**           | Simulador de pagos en modo caído, lento o colgado                                                                                                                                                                        |
| **Configuración**         | Tiempo límite de 2 s (`PAGOS_TIEMPO_LIMITE_MS`); el interruptor abre tras 5 fallos en 60 s, durante 30 s                                                                                                                 |
| **Métrica y umbral**      | Circuito abierto tras 5 fallos en 60 s; mensaje alternativo en ≤ 3 s; el resto sigue operando; la reserva no se deshace por un fallo de envío; ≥ 95 % de las citas con notificación entregada por algún canal en ≤ 5 min |
| **Comando**               | Usado: `npm run test:int -- proveedor-caido` (`backend/test/integration/pagos/proveedor-caido.spec.ts`). Mensajería (004): `npm run test:int -- correo-caido respaldo-whatsapp simulador-whatsapp salida-eventos-dos-instancias`, y `npm run demo:avisos` con Docker Compose. IA: por definir (005) |
| **Evidencia**             | Salida de la CI; totales en [04-pruebas](../05-gestion/04-pruebas.md) §2.4                                                                                                                                               |
| **Estado**                | **Parcial.** Pagos: Usada (503 en ≤ 3 s con la transferencia como alternativa, y las reservas siguen). Mensajería: Usada (004, 2026-11-12) contra Mailpit y el simulador de WhatsApp: con el correo detenido, las operaciones de la cita responden igual y sin conexiones SMTP; 5 fallos abren el circuito; WhatsApp caído o con 3 fallos → el aviso sale una vez por correo; de la reserva a la aceptación del canal, p95 de 14,5 s en 100 citas (meta ≤ 5 min); con Compose, una reprogramación con Mailpit detenido respondió 200 en 1 310 ms. No medido contra proveedores reales. IA (005): Planificada |

## EQ-07. Seguridad: Autenticación

| Elemento                | Descripción                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad y privacidad: autenticación (AC01)                                                                                       |
| **Fuente**              | Usuario no autenticado o atacante                                                                                                  |
| **Estímulo**            | Acceso a un recurso protegido sin token, con token vencido o manipulado                                                            |
| **Artefacto**           | M01 Acceso y barberías, middleware de autenticación                                                                                |
| **Entorno / condición** | Operación normal                                                                                                                   |
| **Respuesta esperada**  | Se rechaza con 401 sin revelar detalles                                                                                            |
| **Medida**              | 100 % de las solicitudes inválidas rechazadas; contraseñas almacenadas con algoritmo de hash lento y sal _(propuesta por validar)_ |
| **Verificación**        | PR07: pruebas de autenticación y revisión de configuración                                                                         |
| **Estado**              | Prueba en verde en local (PR07, 001)                                                                                               |

**Ficha de medición**

| Campo                     | Detalle                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | Jest 29.7.0 + Testcontainers 12.2.1                                                                              |
| **Entorno**               | Pruebas (local y CI)                                                                                             |
| **Preparación**           | Barberías, usuarios y tokens creados por cada prueba                                                             |
| **Configuración**         | Solicitudes sin token, con token vencido, manipulado o de otra barbería                                          |
| **Métrica y umbral**      | 100 % de las solicitudes inválidas rechazadas; contraseñas con hash lento y sal                                  |
| **Comando**               | `npm run test:int -- autenticacion token-tenant`                                                                 |
| **Evidencia**             | `backend/test/integration/identidad/autenticacion.spec.ts` y `aislamiento/token-tenant.spec.ts`; salida de la CI |
| **Estado**                | **Usada.** En verde (PR07, 001)                                                                                  |

## EQ-08. Seguridad: Autorización por rol

| Elemento                | Descripción                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad y privacidad: autorización (AC01)                                                                         |
| **Fuente**              | Cliente o barbero autenticado                                                                                       |
| **Estímulo**            | Intenta una operación administrativa (por ejemplo, crear un servicio o ver reportes)                                |
| **Artefacto**           | M01, casos de uso de M02 y M04                                                                                      |
| **Entorno / condición** | Operación normal                                                                                                    |
| **Respuesta esperada**  | Se rechaza con 403 y se registra el intento                                                                         |
| **Medida**              | 100 % de los casos de la matriz rol × operación rechazados o permitidos según corresponda _(propuesta por validar)_ |
| **Verificación**        | PR08: suite parametrizada sobre la matriz RBAC                                                                      |
| **Estado**              | Prueba en verde en local (PR08: `rbac-002` y `rbac-003`, la tabla completa celda por celda)                         |

**Ficha de medición**

| Campo                     | Detalle                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| **Herramienta y versión** | Jest 29.7.0 + Testcontainers 12.2.1                                                              |
| **Entorno**               | Pruebas (local y CI)                                                                             |
| **Preparación**           | Un usuario por rol y la matriz de `contracts/rbac.md` de cada funcionalidad, leída por la prueba |
| **Configuración**         | Cada fila de la matriz por cada rol; en `rbac-003`, 120 celdas                                   |
| **Métrica y umbral**      | 100 % de las celdas rechazadas o permitidas según la matriz                                      |
| **Comando**               | `npm run test:int -- rbac`                                                                       |
| **Evidencia**             | `backend/test/contract/rbac.spec.ts`, `rbac-002.spec.ts` y `rbac-003.spec.ts`; salida de la CI   |
| **Estado**                | **Usada.** En verde (PR08, 001 a 003)                                                            |

## EQ-09. Seguridad: Aislamiento multi-tenant

| Elemento                | Descripción                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad y privacidad: aislamiento (AC01)                                                                                               |
| **Fuente**              | Usuario autenticado de la barbería A                                                                                                     |
| **Estímulo**            | Intenta leer o modificar datos de la barbería B (cambiando identificadores, parámetros o cuerpo)                                         |
| **Artefacto**           | Contexto de tenant (M01/M06), repositorios, políticas RLS de PostgreSQL                                                                  |
| **Entorno / condición** | Operación normal, varias barberías con datos                                                                                             |
| **Respuesta esperada**  | Ningún dato de B es visible o modificable; se rechaza o devuelve vacío                                                                   |
| **Medida**              | 0 filtraciones en la suite de pruebas de fuga sobre todos los endpoints; el `tenant_id` se toma solo del token _(propuesta por validar)_ |
| **Verificación**        | PR09: pruebas automáticas de fuga (incluye consultas sin filtro para comprobar que RLS bloquea)                                          |
| **Estado**              | Prueba en verde en local (PR09, 001 a 003 y 006)                                                                                         |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | Jest 29.7.0 + Testcontainers 12.2.1                                                                                                                                                                                                    |
| **Entorno**               | Pruebas (local y CI)                                                                                                                                                                                                                   |
| **Preparación**           | Dos o más barberías con datos, incluidos datos canario                                                                                                                                                                                 |
| **Configuración**         | Cada endpoint protegido con el token de otra barbería; consultas sin filtro para comprobar que RLS bloquea                                                                                                                             |
| **Métrica y umbral**      | 0 filtraciones; el `tenant_id` sale solo del token                                                                                                                                                                                     |
| **Comando**               | `npm run test:int -- aislamiento canarios`                                                                                                                                                                                             |
| **Evidencia**             | `backend/test/integration/aislamiento/` (entre ellas `rls.spec.ts`, `aislamiento-tenant.spec.ts`, `aislamiento-pagos.spec.ts`, `aislamiento-cache.spec.ts` y `lectura-plataforma.spec.ts`) y `pagos/canarios.spec.ts`; salida de la CI |
| **Estado**                | **Usada.** En verde (PR09, 001 a 003 y 006)                                                                                                                                                                                            |

## EQ-10. Seguridad: Validación de entradas

| Elemento                | Descripción                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad y privacidad: validación de entradas (AC01)                                                                              |
| **Fuente**              | Atacante o usuario con error                                                                                                       |
| **Estímulo**            | Envía datos mal formados, demasiado largos, con inyección SQL o scripts                                                            |
| **Artefacto**           | Capa de presentación (API) y casos de uso                                                                                          |
| **Entorno / condición** | Operación normal                                                                                                                   |
| **Respuesta esperada**  | Se rechaza con 400 y mensaje controlado; no se ejecuta contenido                                                                   |
| **Medida**              | 100 % de las cargas del conjunto de pruebas rechazadas o neutralizadas; consultas siempre parametrizadas _(propuesta por validar)_ |
| **Verificación**        | PR10: pruebas de entradas inválidas y análisis estático                                                                            |
| **Estado**              | Prueba en verde en local (PR10, 001 y 002)                                                                                         |

**Ficha de medición**

| Campo                     | Detalle                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | Jest 29.7.0 + Testcontainers 12.2.1. Complemento: OWASP ZAP, escaneo base (versión por fijar) |
| **Entorno**               | Pruebas (local y CI). ZAP: local con Docker Compose (propuesto)                               |
| **Preparación**           | Conjunto de cargas inválidas y maliciosas de la propia prueba                                 |
| **Configuración**         | Cada carga contra los endpoints que reciben datos                                             |
| **Métrica y umbral**      | 100 % de las cargas rechazadas o neutralizadas; consultas siempre parametrizadas              |
| **Comando**               | `npm run test:int -- entradas`. ZAP: por definir                                              |
| **Evidencia**             | `backend/test/integration/host/entradas.spec.ts`; salida de la CI                             |
| **Estado**                | **Usada** (Jest). En verde (PR10, 001 y 002). ZAP: Planificada                                |

## EQ-11. Seguridad: Gestión de secretos

| Elemento                | Descripción                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad y privacidad: secretos (AC01)                                                                              |
| **Fuente**              | Desarrollador o atacante con acceso al repositorio                                                                   |
| **Estímulo**            | Intento de obtener claves del proveedor de pagos, de IA o de la base de datos                                        |
| **Artefacto**           | Configuración, repositorio, variables de entorno                                                                     |
| **Entorno / condición** | Desarrollo y producción                                                                                              |
| **Respuesta esperada**  | Los secretos no están en el código ni en los registros; se leen de variables de entorno o gestor de secretos         |
| **Medida**              | 0 secretos detectados por la herramienta de escaneo; rotación posible sin cambio de código _(propuesta por validar)_ |
| **Verificación**        | PR11: escaneo de secretos en el repositorio y en el historial                                                        |
| **Estado**              | Por medir                                                                                                            |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | gitleaks, versión por fijar (complemento planificado de AC01). La principal del atributo, Jest + Testcontainers, no mide este escenario         |
| **Entorno**               | Repositorio local con todo su historial                                                                                                         |
| **Preparación**           | Ninguna; las variables de desarrollo de `.env.example` y `docker-compose.yml` se marcan como valores de desarrollo conocidos (por definir cómo) |
| **Configuración**         | Escaneo del árbol de trabajo y del historial completo                                                                                           |
| **Métrica y umbral**      | 0 secretos detectados; rotación posible sin cambio de código                                                                                    |
| **Comando**               | Por definir al fijar la versión                                                                                                                 |
| **Evidencia**             | Informe del escaneo con fecha (ubicación por definir)                                                                                           |
| **Estado**                | **Planificada.** Por medir. **Opción de menor costo:** una pasada de gitleaks por Docker en local antes de cada entrega, sin servicio de pago   |

## EQ-12. Seguridad: Límite de solicitudes

| Elemento                | Descripción                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad y privacidad: abuso y fuerza bruta (AC01)                                                                              |
| **Fuente**              | Atacante o bot                                                                                                                   |
| **Estímulo**            | Más de 5 intentos de inicio de sesión fallidos por minuto desde la misma IP y cuenta; ráfagas contra la API o el asistente de IA |
| **Artefacto**           | Middleware de limitación, M01, M04                                                                                               |
| **Entorno / condición** | Operación normal                                                                                                                 |
| **Respuesta esperada**  | Se responde 429 y se aplica espera creciente                                                                                     |
| **Medida**              | El intento 6 y siguientes se rechazan; el uso normal no se ve afectado _(propuesta por validar)_                                 |
| **Verificación**        | PR12: prueba de limitación                                                                                                       |
| **Estado**              | Prueba en verde en local (PR12, 001); el límite del asistente de IA está planificado (005)                                       |

**Ficha de medición**

| Campo                     | Detalle                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | Jest 29.7.0 + Testcontainers 12.2.1                                                                                  |
| **Entorno**               | Pruebas (local y CI); `limite-compartido` con dos instancias en proceso sobre el mismo Redis                         |
| **Preparación**           | Una cuenta y una IP de prueba                                                                                        |
| **Configuración**         | 6 intentos fallidos en un minuto; ráfagas contra la API con dos instancias                                           |
| **Métrica y umbral**      | El intento 6 y siguientes se rechazan; el uso normal no se ve afectado                                               |
| **Comando**               | `npm run test:int -- limite-intentos limite-compartido`                                                              |
| **Evidencia**             | `backend/test/integration/identidad/limite-intentos.spec.ts` y `escalado/limite-compartido.spec.ts`; salida de la CI |
| **Estado**                | **Usada.** En verde (PR12, 001 y 006). El límite del asistente de IA: Planificado (005)                              |

## EQ-13. Seguridad: Auditoría

| Elemento                | Descripción                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad y privacidad: auditoría (AC01)                                                                                |
| **Fuente**              | Usuario con rol privilegiado                                                                                            |
| **Estímulo**            | Suspende una barbería, cambia roles o modifica un plan                                                                  |
| **Artefacto**           | Servicio de auditoría (M06)                                                                                             |
| **Entorno / condición** | Operación normal                                                                                                        |
| **Respuesta esperada**  | Se registra quién, qué, cuándo, desde dónde y sobre qué tenant                                                          |
| **Medida**              | 100 % de las acciones sensibles listadas generan registro inmutable para el rol de aplicación _(propuesta por validar)_ |
| **Verificación**        | PR13: revisión de registros tras ejecutar acciones sensibles                                                            |
| **Estado**              | Prueba en verde en local (PR13, 001 a 003)                                                                              |

**Ficha de medición**

| Campo                     | Detalle                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | Jest 29.7.0 + Testcontainers 12.2.1                                                                               |
| **Entorno**               | Pruebas (local y CI)                                                                                              |
| **Preparación**           | Usuarios con rol privilegiado y una barbería de prueba                                                            |
| **Configuración**         | Cada acción sensible de la lista; intento de modificar el registro con el rol de la aplicación                    |
| **Métrica y umbral**      | 100 % de las acciones sensibles listadas con registro inmutable para el rol de aplicación                         |
| **Comando**               | `npm run test:int -- auditoria`                                                                                   |
| **Evidencia**             | `backend/test/integration/auditoria.spec.ts` (también comprueba el identificador de correlación); salida de la CI |
| **Estado**                | **Usada.** En verde (PR13, 001 a 003)                                                                             |

## EQ-14. Mantenibilidad: Cambio de proveedor sin tocar reglas de negocio

| Elemento                | Descripción                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Mantenibilidad e interoperabilidad: mantenibilidad (AC04)                                                                                                                                      |
| **Fuente**              | Equipo de desarrollo                                                                                                                                                                           |
| **Estímulo**            | Se decide cambiar el proveedor de pagos o de IA, o agregar un método de pago                                                                                                                   |
| **Artefacto**           | Puertos y adaptadores (M03, M04), módulos del monolito                                                                                                                                         |
| **Entorno / condición** | Desarrollo                                                                                                                                                                                     |
| **Respuesta esperada**  | Solo se escribe un nuevo adaptador y se cambia la configuración                                                                                                                                |
| **Medida**              | 0 archivos modificados en las capas de Dominio y Aplicación; pruebas de contrato del puerto en verde; 0 violaciones en la verificación de dependencias entre módulos _(propuesta por validar)_ |
| **Verificación**        | PR14: prueba de arquitectura (dependencias) y pruebas de contrato                                                                                                                              |
| **Estado**              | Parcial: reglas de dependencias en verde (PR14, 24/24); el cambio al proveedor real no se ha hecho                                                                                             |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | dependency-cruiser 18.6.0 y Jest 29.7.0 (`test/architecture/`). Complementos: pruebas de contrato (Usadas); `jest --coverage` y SonarQube o SonarCloud (Planificadas) |
| **Entorno**               | Local y CI, sin base de datos                                                                                                                                         |
| **Preparación**           | Ninguna                                                                                                                                                               |
| **Configuración**         | Las 19 reglas de `backend/.dependency-cruiser.cjs` sobre `src` y `migrations`, y las pruebas de arquitectura                                                          |
| **Métrica y umbral**      | 0 violaciones; 0 archivos modificados en Dominio y Aplicación al cambiar de proveedor; pruebas de contrato del puerto en verde                                        |
| **Comando**               | `npm run test:arch`. Cobertura (propuesta, sin configurar): `npx jest --coverage`                                                                                     |
| **Evidencia**             | Salida de la CI; la última, verificada el 2026-11-06: 0 violaciones en 292 módulos y 1334 dependencias, y 24 de 24 pruebas                                            |
| **Estado**                | **Parcial.** dependency-cruiser: Usada (24/24). El cambio al proveedor real no se ha hecho                                                                            |

## EQ-15. Usabilidad: Reserva simple desde celular

| Elemento                | Descripción                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Usabilidad y accesibilidad (AC06)                                                      |
| **Fuente**              | Cliente nuevo                                                                          |
| **Estímulo**            | Reserva una cita desde un celular con navegador                                        |
| **Artefacto**           | Interfaz web (Presentación)                                                            |
| **Entorno / condición** | Sin capacitación previa                                                                |
| **Respuesta esperada**  | Completa la reserva sin ayuda                                                          |
| **Medida**              | ≤ 5 pasos y ≤ 2 minutos; ≥ 80 % de éxito con 5 participantes _(propuesta por validar)_ |
| **Verificación**        | PR15: prueba de usabilidad con usuarios (puede hacerse en el trabajo de campo)         |
| **Estado**              | Por medir                                                                              |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Herramienta y versión** | Para este escenario: cuestionario SUS y cronometraje con personas (Planificados). Lighthouse 12.3 y axe-core 4.10 (Usadas en 001) miden la interfaz (PR29 y PR30), no la tarea de reservar |
| **Entorno**               | Interfaz en producción local (`vite preview`) desde un celular; Lighthouse y axe con el método de `specs/001-registro-acceso-barberia/quickstart.md` §3.1                                  |
| **Preparación**           | Barbería con catálogo y horarios libres; 5 participantes sin capacitación (cómo reclutarlos: por definir, en el trabajo de campo)                                                          |
| **Configuración**         | Cada participante reserva una cita sin ayuda; se cuentan los pasos y el tiempo                                                                                                             |
| **Métrica y umbral**      | ≤ 5 pasos y ≤ 2 minutos; ≥ 80 % de éxito con 5 participantes                                                                                                                               |
| **Comando**               | No aplica (observación con personas). Lighthouse y axe: pasos de `specs/001-registro-acceso-barberia/quickstart.md` §3.1                                                                   |
| **Evidencia**             | Por definir (hoja de observación con fecha). Lighthouse y axe de 001: [tecnologías](../02-arquitectura-software/tecnologias.md) §5.1                                                       |
| **Estado**                | **Planificada** para este escenario. Lighthouse y axe sobre las pantallas de 002 (T130 de 002), de 003 y del lote 2 de mejoras de interfaz siguen pendientes                               |

## EQ-16. Consistencia: Reservas simultáneas del mismo horario

| Elemento                | Descripción                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Consistencia de datos (AC02)                                                                  |
| **Fuente**              | Dos o más clientes simultáneos                                                                |
| **Estímulo**            | 200 solicitudes de reserva concurrentes para el mismo barbero y el mismo horario              |
| **Artefacto**           | M02, PostgreSQL (restricción de exclusión, transacción)                                       |
| **Entorno / condición** | Dos instancias del backend, con o sin Redis disponible                                        |
| **Respuesta esperada**  | Una reserva se acepta; las demás reciben rechazo con mensaje de horario no disponible         |
| **Medida**              | Exactamente 1 cita activa por barbero y rango horario; 0 duplicados _(propuesta por validar)_ |
| **Verificación**        | PR16: prueba de concurrencia y comprobación en base de datos                                  |
| **Estado**              | Prueba en verde en local (PR16, 002), también a través de Nginx con 2 réplicas (006)          |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | k6 (versión por fijar) y una consulta SQL que cuenta duplicados. Hasta hoy: Jest 29.7.0 + Testcontainers 12.2.1                                                     |
| **Entorno**               | Pruebas (local y CI); `balanceador` con Nginx delante de dos instancias. k6: local con Docker Compose (propuesto)                                                   |
| **Preparación**           | Una barbería, un barbero y un horario libre; 200 clientes con sesión creados por la prueba                                                                          |
| **Configuración**         | 200 solicitudes de reserva simultáneas al mismo barbero y horario                                                                                                   |
| **Métrica y umbral**      | Exactamente 1 cita activa por barbero y rango horario; 0 duplicados (la prueba lo cuenta en la base con `SELECT count(*)`)                                          |
| **Comando**               | Usado: `npm run test:int -- concurrencia-reservas balanceador`. k6 (propuesto): `/carga/k6/eq-16-reservas-simultaneas.js` y la consulta SQL de conteo (por definir) |
| **Evidencia**             | `backend/test/integration/citas/concurrencia-reservas.spec.ts` y `escalado/balanceador.spec.ts`; salida de la CI                                                    |
| **Estado**                | **Usada** (Jest). En verde (PR16, 002), también por Nginx con 2 réplicas (006). k6: Planificada                                                                     |

## EQ-17. Consistencia: Notificación de pago repetida

| Elemento                | Descripción                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Consistencia de datos: idempotencia (AC02)                                                                              |
| **Fuente**              | Proveedor de pagos (o atacante)                                                                                         |
| **Estímulo**            | La misma notificación de pago llega 10 veces, o llega una con firma inválida                                            |
| **Artefacto**           | M03 Suscripciones y pagos (submódulos `pagos` y `suscripciones`)                                                        |
| **Entorno / condición** | Operación normal                                                                                                        |
| **Respuesta esperada**  | Solo el primer evento válido modifica la suscripción; la firma inválida se rechaza                                      |
| **Medida**              | 1 transición de estado y 1 registro de pago; 100 % de las firmas inválidas rechazadas _(propuesta por validar)_         |
| **Verificación**        | PR17: pruebas de idempotencia y de firma                                                                                |
| **Estado**              | Prueba en verde en local (PR17, 003): 10 notificaciones iguales producen 1 efecto; la firma inválida se rechaza con 401 |

**Ficha de medición**

| Campo                     | Detalle                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | k6 (versión por fijar) y una consulta SQL que cuenta duplicados. Hasta hoy: Jest 29.7.0 + Testcontainers 12.2.1 |
| **Entorno**               | Pruebas (local y CI); también recorrido con Docker Compose y el simulador (003)                                 |
| **Preparación**           | Una barbería con un pago pendiente; notificaciones firmadas con HMAC                                            |
| **Configuración**         | La misma notificación 10 veces; notificaciones sin firma, con firma inválida o vencida                          |
| **Métrica y umbral**      | 1 transición de estado y 1 registro de pago; 100 % de las firmas inválidas rechazadas                           |
| **Comando**               | `npm run test:int -- pagos/notificaciones`                                                                      |
| **Evidencia**             | `backend/test/integration/pagos/notificaciones.spec.ts`; salida de la CI                                        |
| **Estado**                | **Usada** (Jest). En verde (PR17, 003). k6: Planificada                                                         |

## EQ-18. Privacidad: Consentimiento y derechos sobre los datos

| Elemento                | Descripción                                                                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad y privacidad: privacidad (AC01)                                                                                                                                                                                  |
| **Fuente**              | Cliente o propietario                                                                                                                                                                                                      |
| **Estímulo**            | Se registra (eligiendo canal de notificación) y, luego, solicita acceso o eliminación de sus datos                                                                                                                         |
| **Artefacto**           | M01, registro de consentimiento, solicitudes de datos                                                                                                                                                                      |
| **Entorno / condición** | Operación normal                                                                                                                                                                                                           |
| **Respuesta esperada**  | Se guarda el consentimiento (fecha, versión del texto), incluido el de recibir mensajes por WhatsApp, y la solicitud se atiende con seguimiento                                                                            |
| **Medida**              | 100 % de registros con consentimiento; 0 mensajes de WhatsApp enviados sin consentimiento registrado; solicitudes atendidas en el plazo interno propuesto de 10 días hábiles _(por validar contra el plazo legal vigente)_ |
| **Verificación**        | PR18: prueba funcional y revisión de procedimiento                                                                                                                                                                         |
| **Estado**              | Parcial: consentimiento implementado (002) y consentimiento de WhatsApp implementado y medido contra el simulador (004); solicitudes sobre los datos planificadas (007)                                                    |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | Jest 29.7.0 + Testcontainers 12.2.1                                                                                                                                           |
| **Entorno**               | Pruebas (local y CI)                                                                                                                                                          |
| **Preparación**           | Clientes registrados con cuenta y clientes presenciales                                                                                                                       |
| **Configuración**         | Registro con y sin aceptar el consentimiento; consulta del registro guardado                                                                                                  |
| **Métrica y umbral**      | 100 % de registros con consentimiento; 0 mensajes de WhatsApp sin consentimiento; solicitudes atendidas en 10 días hábiles (plazo interno propuesto)                          |
| **Comando**               | `npm run test:int -- cuenta-cliente presencial`. WhatsApp (004): `npm run test:int -- canal-aviso whatsapp-sin-consentimiento`. Plazo de las solicitudes: revisión de procedimiento, por definir (007) |
| **Evidencia**             | `backend/test/integration/clientes/cuenta-cliente.spec.ts`, `presencial.spec.ts`, `canal-aviso.spec.ts`, `canal-aviso-auditoria.spec.ts` y `notificaciones/whatsapp-sin-consentimiento.spec.ts`; salida de la CI |
| **Estado**                | **Parcial.** Consentimiento: Usada (002). WhatsApp: Usada (004, 2026-11-12) contra el simulador: elegirlo exige aceptar el texto vigente; **0 mensajes** en el simulador para clientes sin consentimiento vigente, también si se retiró entre la cita y el recordatorio. Solicitudes sobre los datos (007): Planificadas |

## EQ-19. Privacidad: Privacidad en el asistente de IA

| Elemento                | Descripción                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Atributo de calidad** | Seguridad y privacidad: privacidad en la IA (AC01)                                                                                   |
| **Fuente**              | Usuario del asistente (incluye intento de prompt injection)                                                                          |
| **Estímulo**            | Pide datos de otra barbería, solicita una consulta libre a la base de datos o intenta que el asistente ignore sus reglas             |
| **Artefacto**           | M04 Asistente IA y reportes, herramientas cerradas por rol                                                                           |
| **Entorno / condición** | Operación normal                                                                                                                     |
| **Respuesta esperada**  | El asistente rechaza o ignora; solo accede a datos del tenant y rol autenticados, con el mínimo necesario                            |
| **Medida**              | 0 fugas en el conjunto de pruebas adversariales; 0 secretos en los prompts; 100 % de consultas registradas _(propuesta por validar)_ |
| **Verificación**        | PR19: pruebas adversariales y revisión de prompts y registros                                                                        |
| **Estado**              | Por medir                                                                                                                            |

**Ficha de medición**

| Campo                     | Detalle                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Herramienta y versión** | Jest + Testcontainers (la principal del atributo), con un proveedor de IA simulado: por definir en 005 |
| **Entorno**               | Pruebas                                                                                                |
| **Preparación**           | Dos barberías con datos y un conjunto de instrucciones adversariales: por definir                      |
| **Configuración**         | Por definir                                                                                            |
| **Métrica y umbral**      | 0 fugas en el conjunto adversarial; 0 secretos en los prompts; 100 % de consultas registradas          |
| **Comando**               | Por definir                                                                                            |
| **Evidencia**             | Por definir                                                                                            |
| **Estado**                | **Planificada** (M04 no existe todavía; 005)                                                           |

## EQ-20. Interoperabilidad: Integración mediante puertos

| Elemento                | Descripción                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Mantenibilidad e interoperabilidad: interoperabilidad (AC04)                                                            |
| **Fuente**              | Equipo de desarrollo                                                                                                    |
| **Estímulo**            | Se sustituye un adaptador por una implementación simulada o por otro proveedor                                          |
| **Artefacto**           | Puertos `PaymentGateway` y `NotificationChannel` (implementados); `AIProvider` (planificado)                            |
| **Entorno / condición** | Pruebas                                                                                                                 |
| **Respuesta esperada**  | Los casos de uso funcionan igual con cualquier implementación que cumpla el contrato                                    |
| **Medida**              | Misma suite de contrato en verde con el adaptador real (entorno de pruebas) y con el simulado _(propuesta por validar)_ |
| **Verificación**        | PR20: pruebas de contrato                                                                                               |
| **Estado**              | Parcial: PR20 en verde contra el simulador de pagos y, en 004, la suite del canal con Mailpit y el simulador de WhatsApp; contra proveedores reales, omitidas por falta de credenciales |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Herramienta y versión** | Pruebas de contrato con Jest 29.7.0                                                                                                                    |
| **Entorno**               | Pruebas (local y CI)                                                                                                                                   |
| **Preparación**           | Simulador de pagos arrancado en el proceso de la prueba; para el ambiente real, las variables `PAGOS_SANDBOX_*`                                        |
| **Configuración**         | La misma suite `backend/test/contract/payment-gateway.contract.ts` contra cada adaptador                                                               |
| **Métrica y umbral**      | Misma suite en verde con el adaptador real (ambiente de pruebas) y con el simulado                                                                     |
| **Comando**               | `npm run test:int -- gateway-simulado gateway-sandbox`                                                                                                 |
| **Evidencia**             | `backend/test/integration/pagos/gateway-simulado.spec.ts` y `gateway-sandbox.spec.ts`; salida de la CI                                                 |
| **Estado**                | **Parcial.** En verde contra el simulador; contra el ambiente del proveedor, omitida sin credenciales (R15). Mensajería (004): la suite `notification-channel.contract.ts` en verde con `canal-correo` (Mailpit) y `canal-whatsapp` (simulador); `canal-sandbox`, omitida sin las variables `SMTP_SANDBOX_*`. IA: Planificada (005) |

## EQ-21. Observabilidad: Diagnóstico de una solicitud fallida

| Elemento                | Descripción                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Disponibilidad y resiliencia: observabilidad (AC03)                                                                                                                           |
| **Fuente**              | Operador                                                                                                                                                                      |
| **Estímulo**            | Un cliente reporta un error al reservar                                                                                                                                       |
| **Artefacto**           | Registro estructurado, identificador de correlación, métricas (M06)                                                                                                           |
| **Entorno / condición** | Producción                                                                                                                                                                    |
| **Respuesta esperada**  | El operador localiza la solicitud y su traza de extremo a extremo                                                                                                             |
| **Medida**              | 100 % de las solicitudes con identificador de correlación; alerta si 5xx > 2 % durante 5 minutos; sin datos personales ni secretos en los registros _(propuesta por validar)_ |
| **Verificación**        | PR21: revisión de registros y prueba de alerta                                                                                                                                |
| **Estado**              | Por medir                                                                                                                                                                     |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | Prometheus + Grafana, versiones por fijar (táctica T10, planificada)                                                                                                                                  |
| **Entorno**               | Local con Docker Compose (propuesto), como paso previo a producción                                                                                                                                   |
| **Preparación**           | Por definir. Hoy existe el identificador de correlación: `backend/src/host/contexto-solicitud.ts` lo toma de `X-Correlation-Id` o lo genera, y `auditoria.spec.ts` comprueba que llega a la auditoría |
| **Configuración**         | Por definir (regla de alerta: 5xx > 2 % durante 5 minutos)                                                                                                                                            |
| **Métrica y umbral**      | 100 % de las solicitudes con identificador de correlación; alerta si 5xx > 2 % durante 5 minutos; sin datos personales ni secretos en los registros                                                   |
| **Comando**               | Por definir                                                                                                                                                                                           |
| **Evidencia**             | Por definir                                                                                                                                                                                           |
| **Estado**                | **Planificada.** Por medir                                                                                                                                                                            |

## EQ-22. Disponibilidad: Recuperación ante pérdida de datos

| Elemento                | Descripción                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Disponibilidad y resiliencia: recuperación (AC03)                                                                                            |
| **Fuente**              | Fallo o error operativo                                                                                                                      |
| **Estímulo**            | Se pierde o corrompe la base de datos                                                                                                        |
| **Artefacto**           | PostgreSQL, procedimiento de respaldo                                                                                                        |
| **Entorno / condición** | Producción                                                                                                                                   |
| **Respuesta esperada**  | Se restaura desde el último respaldo verificado                                                                                              |
| **Medida**              | RPO ≤ 24 h y RTO ≤ 4 h; respaldos al menos semanales exigidos por la normativa (según fuente secundaria), diarios propuestos _(por validar)_ |
| **Verificación**        | PR22: simulacro de restauración en entorno de pruebas                                                                                        |
| **Estado**              | Por medir                                                                                                                                    |

**Ficha de medición**

| Campo                     | Detalle                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | `pg_dump` y `pg_restore` de PostgreSQL 16 (imagen `postgres:16` del Compose), en Docker. **No se mide con k6**                                                                                       |
| **Entorno**               | Local con Docker Compose (servicio `db`, base `barberias`)                                                                                                                                           |
| **Preparación**           | Base con datos de prueba sembrados; un respaldo tomado con `pg_dump` y su hora anotada                                                                                                               |
| **Configuración**         | Simulacro de PR22: borrar o dañar la base y restaurarla en una base vacía; contar las filas de las tablas principales antes y después                                                                |
| **Métrica y umbral**      | RPO ≤ 24 h y RTO ≤ 4 h; respaldos al menos semanales exigidos, diarios propuestos                                                                                                                    |
| **Comando**               | Propuesto: `docker compose exec -T db pg_dump -U postgres -Fc barberias > respaldo.dump` y, sobre una base vacía, `docker compose exec -T db pg_restore -U postgres -d <base vacía> < respaldo.dump` |
| **Evidencia**             | Acta del simulacro con fecha, horas de inicio y fin y conteos (ubicación por definir)                                                                                                                |
| **Estado**                | **Planificada.** Por medir. **Opción de menor costo:** el simulacro en local con Docker, sin nube                                                                                                    |

## EQ-23. Seguridad: Comprobantes privados del adelanto de reserva

| Elemento                | Descripción                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Seguridad y privacidad: comprobantes del adelanto (AC01)                                                                                                         |
| **Fuente**              | Cliente o usuario de otra barbería, o visitante sin sesión                                                                                                       |
| **Estímulo**            | Intenta ver el número de operación o la captura del adelanto de una cita ajena, o registra un número de operación ya usado                                       |
| **Artefacto**           | M02 (cita pendiente), M03 (comprobantes privados, ADR-023), RLS                                                                                                  |
| **Entorno / condición** | Operación normal, varias barberías con adelanto activo                                                                                                           |
| **Respuesta esperada**  | Solo el cliente de la cita y el personal de esa barbería ven el comprobante, siempre con sesión; el número de operación repetido se rechaza                       |
| **Medida**              | 0 accesos a comprobantes de otra cita o de otra barbería; 100 % de los números de operación repetidos rechazados _(propuesta por validar)_                       |
| **Verificación**        | PR31: pruebas de aislamiento y de número repetido sobre los comprobantes del adelanto                                                                            |
| **Estado**              | Por medir (planificado, 008)                                                                                                                                     |

**Ficha de medición**

| Campo                     | Detalle                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | Jest + Testcontainers (la principal del atributo)                                                                 |
| **Entorno**               | Pruebas                                                                                                           |
| **Preparación**           | Dos barberías con el adelanto activo y citas pendientes con comprobante: por definir en 008                        |
| **Configuración**         | Por definir en 008                                                                                                |
| **Métrica y umbral**      | 0 accesos a comprobantes ajenos; 100 % de los números de operación repetidos rechazados                           |
| **Comando**               | Por definir                                                                                                       |
| **Evidencia**             | Por definir                                                                                                       |
| **Estado**                | **Planificada** (RF35 no tiene código todavía; 008)                                                               |

## EQ-24. Consistencia: El adelanto no confirma la cita dos veces

| Elemento                | Descripción                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atributo de calidad** | Consistencia de datos (AC02)                                                                                                                                      |
| **Fuente**              | Propietario (dos pestañas o dos réplicas) y la tarea programada de vencimiento                                                                                    |
| **Estímulo**            | El propietario confirma el mismo adelanto dos veces a la vez, o lo confirma mientras el vencimiento cancela la cita                                               |
| **Artefacto**           | M02 (`Cita.aprobar()`, transición de estado), M03, tareas programadas (ADR-024), avisos de 004                                                                     |
| **Entorno / condición** | Dos instancias del backend                                                                                                                                        |
| **Respuesta esperada**  | La cita pasa de pendiente a confirmada una sola vez y se envía un solo aviso; si la cita ya se canceló por vencimiento, la confirmación se rechaza                |
| **Medida**              | Exactamente 1 transición y 1 aviso por cita; 0 citas que queden confirmadas y canceladas a la vez _(propuesta por validar)_                                       |
| **Verificación**        | PR32: prueba de concurrencia de la confirmación y del vencimiento, con comprobación en la base de datos                                                          |
| **Estado**              | Por medir (planificado, 008)                                                                                                                                      |

**Ficha de medición**

| Campo                     | Detalle                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Herramienta y versión** | k6 (versión por fijar) y una consulta SQL que cuenta duplicados; Jest + Testcontainers                            |
| **Entorno**               | Pruebas, con dos instancias en proceso                                                                            |
| **Preparación**           | Una barbería con el adelanto activo y una cita pendiente con el pago registrado: por definir en 008               |
| **Configuración**         | Confirmaciones simultáneas de la misma cita, y una confirmación a la vez que el vencimiento: por definir en 008     |
| **Métrica y umbral**      | Exactamente 1 transición y 1 aviso por cita; 0 citas confirmadas y canceladas a la vez                            |
| **Comando**               | Por definir                                                                                                       |
| **Evidencia**             | Por definir                                                                                                       |
| **Estado**                | **Planificada** (RF35 no tiene código todavía; 008)                                                               |

## Resumen de escenarios

| Código | Atributo de calidad                     | Qué se busca comprobar                                    |
| ------ | --------------------------------------- | --------------------------------------------------------- |
| EQ-01  | AC05 Rendimiento y escalabilidad        | Tiempo de respuesta al consultar horarios con 50 usuarios |
| EQ-02  | AC05 Rendimiento y escalabilidad        | Tiempo y errores al reservar bajo carga                   |
| EQ-03  | AC05 Rendimiento y escalabilidad        | Agregar una instancia sin cambios y sin pérdida           |
| EQ-04  | AC03 Disponibilidad y resiliencia       | Continuidad si cae una instancia                          |
| EQ-05  | AC03 Disponibilidad y resiliencia       | Continuidad correcta si cae Redis                         |
| EQ-06  | AC03 Disponibilidad y resiliencia       | Degradación controlada si fallan IA o pagos               |
| EQ-07  | AC01 Seguridad y privacidad             | Rechazo de tokens ausentes, vencidos o falsos             |
| EQ-08  | AC01 Seguridad y privacidad             | Cumplimiento de la matriz rol × operación                 |
| EQ-09  | AC01 Seguridad y privacidad             | Cero fugas entre barberías                                |
| EQ-10  | AC01 Seguridad y privacidad             | Rechazo de entradas maliciosas o mal formadas             |
| EQ-11  | AC01 Seguridad y privacidad             | Ausencia de secretos en código y registros                |
| EQ-12  | AC01 Seguridad y privacidad             | Limitación de intentos y ráfagas                          |
| EQ-13  | AC01 Seguridad y privacidad             | Registro de acciones sensibles                            |
| EQ-14  | AC04 Mantenibilidad e interoperabilidad | Cambiar proveedor sin tocar dominio ni aplicación         |
| EQ-15  | AC06 Usabilidad y accesibilidad         | Reserva simple desde celular                              |
| EQ-16  | AC02 Consistencia de datos              | Cero reservas duplicadas bajo concurrencia                |
| EQ-17  | AC02 Consistencia de datos              | Idempotencia y autenticidad de la notificación de pago    |
| EQ-18  | AC01 Seguridad y privacidad             | Consentimiento y derechos sobre los datos                 |
| EQ-19  | AC01 Seguridad y privacidad             | Cero fugas y resistencia a prompt injection               |
| EQ-20  | AC04 Mantenibilidad e interoperabilidad | Adaptadores intercambiables por contrato                  |
| EQ-21  | AC03 Disponibilidad y resiliencia       | Diagnóstico de extremo a extremo                          |
| EQ-22  | AC03 Disponibilidad y resiliencia       | Restaurar desde respaldo dentro de RPO y RTO              |
| EQ-23  | AC01 Seguridad y privacidad             | Comprobantes del adelanto privados y sin número repetido  |
| EQ-24  | AC02 Consistencia de datos              | El adelanto confirma la cita una sola vez                 |
