import { Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ErrorDeAplicacion, Publica } from '../../../../shared';
import { FirmaInvalida } from '../../pagos/application/ports/payment-gateway';
import { RecibirNotificacion } from '../../pagos/application/recibir-notificacion';

/** Notificaciones aceptadas por IP y minuto (FR-013a): 600 por defecto, configurable. */
const limiteNotificaciones = () => Number(process.env.PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO ?? 600);

/** La firma falta, no coincide o venció: 401 sin ningún efecto y sin explicar el motivo. */
class NotificacionNoValida extends ErrorDeAplicacion {
  readonly codigo = 'NO_AUTENTICADO';

  constructor() {
    super('Notificación no válida.');
  }
}

/** Solicitud con el cuerpo crudo que guarda el parser JSON de main.ts para esta ruta. */
export interface SolicitudConCuerpoCrudo extends Request {
  cuerpoCrudo?: Buffer;
}

/**
 * T049 · POST /api/v1/pagos/notificaciones (RF24; FR-013 a FR-018). Pública: no usa token de usuario, la
 * autentica la firma del proveedor sobre el cuerpo crudo (hasta 16 KB). Responde 200 apenas la notificación
 * queda procesada o reconocida como repetida, para que el proveedor no la siga reenviando (FR-018). Un
 * rechazo deja solo una línea resumida, sin el cuerpo (FR-013a).
 */
@Controller('pagos')
@Publica()
@Throttle({ general: { limit: limiteNotificaciones, ttl: 60_000 } })
export class NotificacionesController {
  private readonly logger = new Logger('PagosNotificaciones');

  constructor(private readonly recibir: RecibirNotificacion) {}

  @Post('notificaciones')
  @HttpCode(200)
  async notificacion(@Req() solicitud: SolicitudConCuerpoCrudo): Promise<{ recibido: true }> {
    try {
      await this.recibir.ejecutar(solicitud.cuerpoCrudo ?? Buffer.alloc(0), solicitud.headers);
    } catch (error) {
      if (!(error instanceof FirmaInvalida)) throw error;
      this.logger.warn(`PAGO_NOTIFICACION_RECHAZADA ip=${solicitud.ip ?? 'desconocida'}`);
      throw new NotificacionNoValida();
    }
    return { recibido: true };
  }
}
