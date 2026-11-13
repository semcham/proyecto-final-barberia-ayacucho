import { Module } from '@nestjs/common';
import { AccesoBarberiasModule } from '../acceso-barberias';
import { Clock, Configuracion } from '../../shared';
import { EnviarAvisos } from './application/enviar-avisos';
import { ManejadoresDeCita } from './application/manejadores-de-cita';
import { ManejadorRecordatorio } from './application/manejador-recordatorio';
import { ManejadoresDeSuscripcion } from './application/manejadores-de-suscripcion';
import { ManejadoresDeAdelanto } from './application/manejadores-de-adelanto';
import { AvisoRepository, PendientesDeAvisos } from './application/ports/aviso-repository';
import { CanalesDeAviso } from './application/ports/notification-channel';
import { crearCanalesDeAviso } from './infrastructure/fabrica-canales';
import { KyselyAvisoRepository } from './infrastructure/kysely-aviso-repository';
import { AvisosPendientesPlataforma } from './infrastructure/plataforma/avisos-pendientes';

/**
 * M05 Notificaciones (004; ADR-013, ADR-025, ADR-026). Ningún módulo lo importa (regla m05-sin-llamadas de
 * PR14): recibe los hechos por el bus de eventos de M06, suscrito desde host/eventos.ts, y su tarea enviar-avisos
 * la registra host/tareas.ts. Lee el contacto de los destinatarios de M01 por su interfaz pública (ADR-013
 * revisado).
 *
 * Fase 3: avisos de cita por correo (manejadores, envío con reintentos y purga a los 90 días).
 * Fase 5: WhatsApp (simulado) con consentimiento, y el correo como respaldo.
 */
@Module({
  imports: [AccesoBarberiasModule],
  providers: [
    {
      // Fase 5: el correo y WhatsApp (simulado, o no disponible sin proveedor), cada uno con su interruptor.
      provide: CanalesDeAviso,
      inject: [Configuracion, Clock],
      useFactory: (configuracion: Configuracion, reloj: Clock) => crearCanalesDeAviso(configuracion, reloj),
    },
    { provide: AvisoRepository, useClass: KyselyAvisoRepository },
    { provide: PendientesDeAvisos, useClass: AvisosPendientesPlataforma },
    ManejadoresDeCita,
    // Fase 4: el recordatorio del día con sus enlaces.
    ManejadorRecordatorio,
    // Fase 6: los avisos de suscripción al propietario (US5).
    ManejadoresDeSuscripcion,
    // 008 (T032): los avisos del adelanto de reserva.
    ManejadoresDeAdelanto,
    EnviarAvisos,
  ],
  exports: [
    ManejadoresDeCita,
    ManejadorRecordatorio,
    ManejadoresDeSuscripcion,
    ManejadoresDeAdelanto,
    EnviarAvisos,
  ],
})
export class NotificacionesModule {}
