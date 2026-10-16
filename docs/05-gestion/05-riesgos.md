# Matriz de riesgos

Escala: probabilidad (Baja, Media, Alta) × impacto (Bajo, Medio, Alto) = prioridad. Valoraciones son **propuestas del equipo, por validar**.

| ID | Riesgo | Prob. | Impacto | Prioridad | Mitigación | Contingencia | Tratamiento |
|---|---|---|---|---|---|---|---|
| R01 | Filtración de datos entre barberías | Media | Alto | **Alta** | `tenant_id` del token, repositorios con filtro, RLS, pruebas PR09 (ADR-003, 010) | Suspender el acceso afectado, notificar según procedimiento de incidentes, restaurar | Reducido por diseño; **requiere pruebas** |
| R02 | Reservas duplicadas | Media | Alto | **Alta** | Restricción de exclusión y transacciones (ADR-009); PR16 | Cancelar la cita duplicada y avisar al cliente | Reducido por diseño; requiere pruebas |
| R03 | Caída del backend | Media | Alto | **Alta** | Instancias múltiples y balanceo (ADR-006); verificación de salud | Reiniciar; restaurar versión anterior | Requiere pruebas y monitoreo (PR04) |
| R04 | Saturación por picos de uso | Media | Medio | Media | Caché, límites de solicitudes, escalado horizontal | Limitar funciones no críticas (IA, reportes) | Requiere pruebas de carga |
| R05 | Caída de Redis | Media | Bajo | Baja | Degradación a PostgreSQL (EQ-05) | Reiniciar Redis | Reducido por diseño |
| R06 | Caída o degradación de PostgreSQL | Baja | Alto | **Alta** | Respaldos, pool de conexiones, índices, monitoreo | Restaurar desde respaldo (EQ-22) | Requiere pruebas y operación |
| R07 | Pagos duplicados o aplicados dos veces | Media | Alto | **Alta** | Idempotencia por evento, índice único, conciliación (ADR-007) | Reembolso manual y corrección | Reducido por diseño; requiere pruebas (PR17) |
| R08 | Proveedor de pagos no disponible | Media | Medio | Media | Circuit breaker, estado "pago pendiente", conciliación (ADR-012) | Activación manual del plan por el administrador | Reducido por diseño |
| R09 | Proveedor de IA no disponible | Alta | Bajo | Media | Degradación al flujo manual (ADR-012) | Desactivar el asistente | Reducido por diseño |
| R10 | Respuestas incorrectas de la IA o prompt injection | Media | Medio | Media | Herramientas cerradas, datos reales del backend, confirmación explícita (ADR-008) | Retirar herramienta afectada | Requiere pruebas adversariales (PR19) |
| R11 | Costos de IA e infraestructura superiores a lo previsto | Media | Medio | Media | Cuotas por tenant, límites de uso, una sola instancia al inicio | Desactivar IA por plan | Requiere monitoreo |
| R12 | Pérdida de datos o incidente de datos personales | Baja | Alto | **Alta** | Respaldos cifrados y probados, auditoría, procedimiento de incidentes, minimización | Notificación a la autoridad en el plazo aplicable (verificar) | Requiere procedimiento y simulacro |
| R13 | Complejidad excesiva para el equipo (sobreingeniería, erosión de límites) | Alta | Medio | **Alta** | Clean Architecture proporcional (ADR-011); verificación de dependencias (T13) | Simplificar módulos | Requiere disciplina del equipo |
| R14 | Falta de tiempo o de acceso al campo | Alta | Alto | **Alta** | Priorizar MVP; documentación primero; trabajo de campo acotado | Presentar hipótesis marcadas "por validar" | Gestión del proyecto |
| R15 | El proveedor de pagos no confirma Yape o no entrega credenciales de pruebas | Media | Medio | Media | Puerto desacoplado; evaluar más de un proveedor; simulador | Activación manual del plan en el MVP | Decisión pendiente |
| R16 | Incumplimiento de la normativa de datos personales | Media | Alto | **Alta** | Consentimiento, derechos, seguridad (ver seguridad y privacidad); revisión legal | Corregir y notificar | Por validar con asesoría legal |
| R17 | Condiciones del proveedor de WhatsApp (consentimiento, plantillas aprobadas, costos) o bloqueo del canal | Media | Medio | Media | Puerto `NotificationChannel` desacoplado; correo como respaldo; simulador; evaluar proveedor antes de contratar (ADR-013) | Operar solo con correo | Decisión pendiente |
| R18 | Cierre de sesión involuntario por "reutilización" del token de renovación: si una renovación se interrumpe después de que el servidor rotó el token (dos recargas rápidas, pestaña cerrada o red cortada a mitad de la respuesta), el navegador conserva el token anterior; en la siguiente renovación el backend lo trata como robo, registra `SESION_REUTILIZADA` y revoca la sesión. Observado al medir con Lighthouse (2026-10-16) | Media | Medio | Media | Detección de reutilización por diseño (protege ante robo de `rt`, funcionalidad 001); mitigación propuesta: aceptar el token anterior durante un margen de gracia corto (por ejemplo, 30 s) solo para la misma sesión, devolviendo el token vigente sin rotar de nuevo. Requiere cambio en el backend y prueba de concurrencia | El usuario vuelve a ingresar; revisar `audit_log` (`SESION_REUTILIZADA`) para distinguir cortes de red de robos reales | Decisión pendiente (cambio de backend) |
| R19 | Fallo al navegar tras publicar una versión nueva: una pestaña abierta con la versión anterior pide un archivo de pantalla (chunk) que ya no existe (ADR-018) | Media | Bajo | Baja | Conservar los chunks de la versión anterior al menos un día; `index.html` sin caché ([despliegue](../02-arquitectura-software/despliegue-y-escalabilidad.md)) | Recargar la página | Reducido por diseño; a aplicar en el despliegue |

## Riesgos reducidos por diseño frente a riesgos que requieren pruebas o monitoreo

| Reducidos por diseño (pero a demostrar) | Requieren pruebas, monitoreo u operación |
|---|---|
| R02, R05, R07, R08, R09, R19 | R01, R03, R04, R06, R10, R11, R12, R13, R14, R16, R17, R18 |

*Nota.* "Reducido por diseño" no significa eliminado: cada uno tiene su prueba asociada.
