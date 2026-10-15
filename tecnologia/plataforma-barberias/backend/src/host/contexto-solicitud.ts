import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { TenantContext } from '../shared';

const ID_CORRELACION_VALIDO = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Abre un contexto por solicitud (sin tenant todavía) con la IP, el agente de usuario y un identificador
 * de correlación (EQ-21). Debe registrarse DESPUÉS del parser del cuerpo: el parser lee el stream fuera
 * de este contexto y lo perdería.
 */
export function middlewareContextoSolicitud(tenantContext: TenantContext) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const recibido = req.header('x-correlation-id');
    const correlationId = recibido && ID_CORRELACION_VALIDO.test(recibido) ? recibido : randomUUID();
    res.setHeader('X-Correlation-Id', correlationId);
    tenantContext.ejecutarCon(null, () => next(), {
      ip: req.ip,
      userAgent: req.header('user-agent'),
      correlationId,
    });
  };
}
