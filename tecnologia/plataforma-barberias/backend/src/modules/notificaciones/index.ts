// Interfaz pública de M05 Notificaciones: solo la importa el host (raíz de composición). Ningún otro módulo
// llama a M05 (regla m05-sin-llamadas de PR14).
export { NotificacionesModule } from './notificaciones.module';
// Fase 3 de 004: los manejadores que el host suscribe al bus (host/eventos.ts) y la tarea de envío
// (host/tareas.ts).
export { ManejadoresDeCita } from './application/manejadores-de-cita';
export { EnviarAvisos } from './application/enviar-avisos';
export { ManejadorRecordatorio } from './application/manejador-recordatorio';
// Fase 6 de 004: los avisos de suscripción al propietario (US5).
export { ManejadoresDeSuscripcion } from './application/manejadores-de-suscripcion';
// 008 (T032): los avisos del adelanto de reserva.
export { ManejadoresDeAdelanto } from './application/manejadores-de-adelanto';
