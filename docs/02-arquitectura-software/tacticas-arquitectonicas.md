# Tácticas arquitectónicas

Una táctica es una decisión de diseño concreta para lograr un atributo de calidad. Esta tabla conecta atributo/driver → táctica → dónde se aplica → cómo se verifica.

## 1. Catálogo

| ID  | Táctica                                                                                                      | Atributo / driver      | Módulo y capa donde se aplica                 | Verificación               |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------- | -------------------------- |
| T01 | **Caché selectiva (Redis)** con TTL e invalidación; claves con tenant                                        | AC01, DA03             | M02 · Infraestructura (adaptador `Cache`)     | EQ-01 / PR01; EQ-05 / PR05 |
| T02 | **Balanceo de carga** con verificación de salud                                                              | AC02, AC03, DA04, DA05 | Despliegue (ALB de AWS)                       | EQ-03, EQ-04 / PR03, PR04  |
| T03 | **Reintentos con espera creciente** (solo operaciones idempotentes)                                          | AC03, DA05             | M03, M04, M05 · Infraestructura (adaptadores) | EQ-06 / PR06               |
| T04 | **Circuit breaker** ante IA y pagos                                                                          | AC03, DA05, DA08       | M03, M04 · Infraestructura                    | EQ-06 / PR06               |
| T05 | **Limitación de solicitudes (rate limiting)** por IP, usuario y tenant; cuotas de IA                         | AC04, DA09             | M06 · Presentación (middleware)               | EQ-12 / PR12               |
| T06 | **Autenticación y autorización** (JWT corto + RBAC)                                                          | AC04, DA01             | M01 · Presentación y Aplicación               | EQ-07, EQ-08 / PR07, PR08  |
| T07 | **Validación de entradas** (formato en Presentación, reglas en Aplicación/Dominio; consultas parametrizadas) | AC04                   | Todos · Presentación/Aplicación               | EQ-10 / PR10               |
| T08 | **Idempotencia** (clave de evento/operación)                                                                 | AC07, DA07             | M03, M02 · Aplicación e Infraestructura       | EQ-17 / PR17               |
| T09 | **Restricciones de exclusión y transacciones** en PostgreSQL                                                 | AC07, DA02             | M02 · Infraestructura (esquema)               | EQ-16 / PR16               |
| T10 | **Registro y monitoreo**: logs estructurados, identificador de correlación, métricas, alertas                | AC10, DA12             | M06 · Infraestructura                         | EQ-21 / PR21               |
| T11 | **Aislamiento de tenant**: contexto por solicitud + filtro en repositorios + RLS                             | AC04, DA01             | M06, todos los repositorios · Infraestructura | EQ-09 / PR09               |
| T12 | **Degradación controlada** (flujo manual sin IA; "pago pendiente")                                           | AC03, DA05             | M04, M03 · Aplicación                         | EQ-06 / PR06               |
| T13 | **Verificación automática de dependencias** entre módulos                                                    | AC05, DA06             | Todo el backend · CI                          | EQ-14 / PR14               |
| T14 | **Gestión de secretos** por variables de entorno o gestor                                                    | AC04                   | Configuración · Despliegue                    | EQ-11 / PR11               |
| T15 | **Respaldo y recuperación**                                                                                  | AC03, DA11             | PostgreSQL · Operación                        | EQ-22 / PR22               |
| T16 | **Puertos y adaptadores**                                                                                    | AC09, AC05, DA07, DA08 | M03, M04, M05 · Aplicación e Infraestructura  | EQ-20 / PR20               |
| T17 | **Auditoría** de acciones sensibles                                                                          | AC04, DA11             | M06 · Aplicación e Infraestructura            | EQ-13 / PR13               |
| T18 | **Servicios sin estado (stateless)**                                                                         | AC02, DA04             | Host · Presentación                           | EQ-03 / PR03               |

## 2. Cómo se articulan en los flujos críticos

| Flujo                       | Tácticas combinadas                                           |
| --------------------------- | ------------------------------------------------------------- |
| Reservar cita               | T06, T11, T07, T01 (lectura), T09 + T08 (escritura), T10, T17 |
| Confirmar pago              | T06 (firma del webhook), T08, T11, T03, T04, T10, T17         |
| Consulta al asistente de IA | T06, T05, T11, T16, T03, T04, T12, T10                        |
| Servir el catálogo público  | T01, T02, T18, T05                                            |

## 3. Detalle de tácticas con parámetros propuestos

Los valores son **propuestas por validar** con las pruebas indicadas.

| Táctica | Parámetro propuesto                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T01     | TTL del catálogo y servicios: 5 min; configuración de barbería: 5 min; invalidación explícita al modificar; la **disponibilidad no se cachea como definitiva** (si se cachea el cálculo, TTL ≤ 30 s y siempre se reconfirma en PostgreSQL al reservar) |
| T03     | 3 intentos, espera 200 ms, 400 ms, 800 ms con variación aleatoria; solo en operaciones idempotentes                                                                                                                                                    |
| T04     | Abre tras 5 fallos en 60 s; medio abierto tras 30 s                                                                                                                                                                                                    |
| T05     | 5 intentos de login por minuto por IP y cuenta; 60 solicitudes por minuto por usuario autenticado; cuota diaria de consultas de IA por tenant                                                                                                          |
| T02     | Verificación de salud cada 5 s; 3 fallos consecutivos retiran la instancia                                                                                                                                                                             |
| T15     | Respaldo completo diario; prueba de restauración mensual                                                                                                                                                                                               |
