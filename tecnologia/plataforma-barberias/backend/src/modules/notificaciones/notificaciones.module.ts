import { Module } from '@nestjs/common';
import { AccesoBarberiasModule } from '../acceso-barberias';
import { Clock, Configuracion } from '../../shared';
import { EnviarAvisos } from './application/enviar-avisos';
import { ManejadoresDeCita } from './application/manejadores-de-cita';
import { ManejadorRecordatorio } from './application/manejador-recordatorio';
import { AvisoRepository, PendientesDeAvisos } from './application/ports/aviso-repository';
import { NotificationChannel } from './application/ports/notification-channel';
import { crearCanalDeCorreo } from './infrastructure/fabrica-canales';
import { KyselyAvisoRepository } from './infrastructure/kysely-aviso-repository';
import { AvisosPendientesPlataforma } from './infrastructure/plataforma/avisos-pendientes';

/**
 * M05 Notificaciones (004; ADR-013, ADR-025, ADR-026). Ningún módulo lo importa (regla m05-sin-llamadas de
 * PR14): recibe los hechos por el bus de eventos de M06, suscrito desde host/eventos.ts, y su tarea enviar-avisos
 * la registra host/tareas.ts. Lee el contacto de los destinatarios de M01 por su interfaz pública (ADR-013
 * revisado).
 *
 * Fase 3: avisos de cita por correo (manejadores, envío con reintentos y purga a los 90 días).
 */
@Module({
  imports: [AccesoBarberiasModule],
  providers: [
    {
      provide: NotificationChannel,
      inject: [Configuracion, Clock],
      useFactory: (configuracion: Configuracion, reloj: Clock) => crearCanalDeCorreo(configuracion, reloj),
    },
    { provide: AvisoRepository, useClass: KyselyAvisoRepository },
    { provide: PendientesDeAvisos, useClass: AvisosPendientesPlataforma },
    ManejadoresDeCita,
    // Fase 4: el recordatorio del día con sus enlaces.
    ManejadorRecordatorio,
    EnviarAvisos,
  ],
  exports: [ManejadoresDeCita, ManejadorRecordatorio, EnviarAvisos],
})
export class NotificacionesModule {}
