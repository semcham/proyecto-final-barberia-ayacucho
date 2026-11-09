import { Module } from '@nestjs/common';
import { Clock, Configuracion } from '../../shared';
import { NotificationChannel } from './application/ports/notification-channel';
import { crearCanalDeCorreo } from './infrastructure/fabrica-canales';

/**
 * M05 Notificaciones (004; ADR-013, ADR-025, ADR-026). Esqueleto de la fase 1: el puerto de envío con el
 * adaptador de correo. Los manejadores de eventos y la tarea de envío llegan en la fase 3. Ningún módulo lo
 * importa (regla m05-sin-llamadas de PR14): recibe los hechos por el bus de eventos de M06, suscrito desde
 * host/eventos.ts.
 */
@Module({
  providers: [
    {
      provide: NotificationChannel,
      inject: [Configuracion, Clock],
      useFactory: (configuracion: Configuracion, reloj: Clock) => crearCanalDeCorreo(configuracion, reloj),
    },
  ],
})
export class NotificacionesModule {}
