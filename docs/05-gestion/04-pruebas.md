# Estrategia de pruebas

Las pruebas de este catálogo son **planificadas**, salvo las que ya ejecutó la funcionalidad 001 (ver §2.1 y la [trazabilidad](../trazabilidad.md#41-funcionalidad-001-componentes-implementados-y-su-evidencia)). Los criterios son **metas propuestas**; los resultados medidos se registran en la trazabilidad de cada funcionalidad y en el Sprint 6.

## 1. Niveles de prueba

| Nivel | Qué verifica | Herramientas posibles | Evidencia esperada |
|---|---|---|---|
| Unitarias | Dominio: `RangoHorario`, transiciones de estado, `PlanPolicy` | Jest u otro marco del lenguaje elegido | Informe de ejecución y cobertura |
| Integración | Repositorios con PostgreSQL real, RLS, restricción de exclusión, caché | Testcontainers o contenedores en CI | Informe en CI |
| API | Contratos REST, códigos HTTP, validación | Supertest, Postman/Newman | Colección ejecutada |
| Aceptación | Criterios de cada HU de extremo a extremo | Playwright u otra herramienta | Capturas y reportes |
| Arquitectura | Reglas de dependencia entre capas y módulos | Reglas de importación, pruebas de arquitectura | Falla en CI si se viola |
| Seguridad y aislamiento | RBAC, fuga entre tenants, validación, secretos | Suite propia, escáner de secretos | Informe |
| Concurrencia | Reservas simultáneas | Script concurrente / k6 | Conteo en base de datos |
| Rendimiento | Latencia y escalado | k6 o Locust | Gráficas y percentiles |
| Resiliencia | Caídas de instancia, Redis, IA, pagos | Detener contenedores; simulador de proveedor | Registro de la prueba |
| Pagos en ambiente de pruebas | Webhooks, idempotencia | Credenciales de pruebas del proveedor y simulador | Registros |
| Recuperación | Restauración de respaldo | Procedimiento documentado | Acta del simulacro |
| Usabilidad | Reserva simple | Observación con usuarios | Notas y tiempos |
| Interfaz | Formularios, sesión, pantallas y componentes base, con la API simulada | Vitest, Testing Library y MSW | Informe en CI |
| Accesibilidad | WCAG 2.2 A y AA en los estados interactivos, tema claro y oscuro | axe-core en Chrome; revisión con teclado | Informe con los estados revisados |
| Rendimiento de la interfaz | Peso inicial y métricas de carga en celular | Lighthouse (mediana de 3 pasadas) | Puntajes y métricas por pantalla |

## 2. Catálogo de pruebas (PRnn ↔ EQ-nn)

| ID | Prueba | Escenario | Criterio (propuesta por validar) | Estado |
|---|---|---|---|---|
| PR01 | Carga de consulta de disponibilidad (50 concurrentes) | EQ-01 | p95 ≤ 800 ms; 0 % 5xx | Planificado |
| PR02 | Carga de reservas (20 por segundo, 5 min) | EQ-02 | p95 ≤ 1 500 ms; error < 1 % | Planificado |
| PR03 | Escalado agregando una instancia | EQ-03 | ≥ 1,6× throughput; 0 solicitudes perdidas | Planificado |
| PR04 | Caída de una instancia | EQ-04 | Detección ≤ 15 s; ≤ 2 % errores | Planificado |
| PR05 | Caída de Redis | EQ-05 | 0 reservas incorrectas; p95 lectura ≤ 2 s | Planificado |
| PR06 | Fallas del proveedor de IA, de pagos y de mensajería (WhatsApp y correo) | EQ-06 | Circuito abre tras 5 fallos/60 s; mensaje ≤ 3 s | Planificado |
| PR07 | Autenticación | EQ-07 | 100 % de tokens inválidos rechazados | Planificado |
| PR08 | Autorización (matriz RBAC) | EQ-08 | 100 % de celdas correctas | Planificado |
| PR09 | Fuga entre tenants | EQ-09 | 0 filtraciones en todos los endpoints | Planificado |
| PR10 | Validación de entradas | EQ-10 | 100 % de cargas maliciosas neutralizadas | Planificado |
| PR11 | Escaneo de secretos | EQ-11 | 0 secretos detectados | Planificado |
| PR12 | Límite de solicitudes | EQ-12 | Intento 6/min rechazado | Planificado |
| PR13 | Auditoría | EQ-13 | 100 % de acciones sensibles registradas | Planificado |
| PR14 | Arquitectura (dependencias) y pruebas de contrato de cambio de proveedor | EQ-14 | 0 violaciones; 0 archivos de dominio/aplicación modificados | Planificado |
| PR15 | Usabilidad de la reserva | EQ-15 | ≤ 5 pasos; ≤ 2 min; ≥ 80 % de éxito | Planificado |
| PR16 | Concurrencia de reservas (200 simultáneas) | EQ-16 | Exactamente 1 cita activa | Planificado |
| PR17 | Idempotencia y firma de webhooks | EQ-17 | 1 efecto por 10 repeticiones; firmas inválidas rechazadas | Planificado |
| PR18 | Consentimiento y solicitudes de datos | EQ-18 | 100 % con consentimiento; plazo interno 10 días hábiles | Planificado |
| PR19 | Privacidad e inyección en el asistente de IA | EQ-19 | 0 fugas; 0 secretos en prompts | Planificado |
| PR20 | Contratos de puertos (real y simulado) | EQ-20 | Misma suite en verde | Planificado |
| PR21 | Observabilidad | EQ-21 | 100 % con correlación; alerta 5xx > 2 % en 5 min | Planificado |
| PR22 | Restauración de respaldo | EQ-22 | RPO ≤ 24 h; RTO ≤ 4 h | Planificado |
| PR23 | Aceptación de la reserva de extremo a extremo | HU11 | Criterios de HU11 cumplidos | Planificado |
| PR24 | Unitarias de transiciones de cita | HU12–HU14 | Transiciones inválidas rechazadas | Planificado |
| PR25 | Unitarias de estados y funciones por suscripción | HU17, HU19 | Tabla de estados cumplida | Planificado |
| PR26 | Contrato de la API REST | RC03 | Esquemas válidos | Planificado |
| PR27 | Notificación de la cita por correo y WhatsApp: confirmación, recordatorio, aviso de cambio, respaldo por correo, consentimiento, sin duplicados entre instancias | HU25, EQ-06, EQ-18 | 100 % de citas con aviso por algún canal; 0 envíos por WhatsApp sin consentimiento; 0 recordatorios duplicados | Planificado |
| PR28 | Recordatorio del día de la cita y enlaces de acción: envío en la hora configurada, un solo uso, vencimiento, alcance a una cita, cancelación libera el horario, sin respuesta no cancela, sin duplicados entre instancias | HU28, EQ-08, EQ-09 | 100 % de enlaces reutilizados o vencidos rechazados; 0 acceso a otras citas; 0 recordatorios duplicados | Planificado |
| PR29 | Accesibilidad de la interfaz | AC06; ADR-016 | 0 incumplimientos WCAG 2.2 A/AA (axe-core); foco visible y uso completo con teclado | Ejecutada en local (funcionalidad 001): 30 estados, 0 incumplimientos |
| PR30 | Rendimiento de la interfaz en celular | AC01; ADR-018 | Lighthouse ≥ 90 en rendimiento, accesibilidad y buenas prácticas; JavaScript inicial ≤ 400 KB | Ejecutada en local (funcionalidad 001): 92–99 en celular; 372 KB |

### 2.1 Ejecutadas en la funcionalidad 001

En el entorno local (PostgreSQL 16 real, Testcontainers y Docker Compose), con resultados en verde: PR07, PR08, PR09, PR10, PR12, PR13 y PR14 (backend), las pruebas de interfaz (Vitest, 35 pruebas), PR29 y PR30. Recuentos de la última ejecución completa (2026-10-16, tras el período de gracia de ADR-019): backend unitarias 122, integración 246 y arquitectura 10; frontend 35, todas en verde. La aceptación de extremo a extremo con una herramienta automatizada sigue **planificada**; mientras tanto, los escenarios de la [guía rápida](../../specs/001-registro-acceso-barberia/quickstart.md) se recorrieron por HTTP y en Chrome (§6). Su ejecución en CI está **por confirmar**.

## 3. Datos y entornos

- Datos de prueba **ficticios**; nunca datos reales de clientes.
- Entornos: local (contenedores), integración continua, pruebas compartidas.
- Los pagos usan simulador y, si el proveedor lo permite, su ambiente de pruebas; no se hacen cobros reales.

## 4. Criterio de cierre

Una prueba pasa a "ejecutada" cuando existe evidencia archivada (informe o registro) y el resultado se anota **tal como salió**, aunque no alcance la meta; en ese caso se registra la desviación y, si corresponde, se ajusta el diseño o la meta con un ADR.
