import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NoAutenticado, ValidarSolicitud } from '../modules/acceso-barberias';
import { TenantContext, TenantId } from '../shared';
import { CLAVE_PUBLICA, type SolicitudConActor } from './solicitud';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*)$/;

/**
 * Autenticación de cada ruta no marcada con @Publica (T042). El tenant de la solicitud sale SOLO del
 * token verificado (principio III). Cualquier fallo responde 401 sin explicar el motivo (EQ-07).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly validarSolicitud: ValidarSolicitud,
    private readonly tenantContext: TenantContext,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publica = this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publica) return true;

    const solicitud = contexto.switchToHttp().getRequest<SolicitudConActor>();
    const coincidencia = BEARER.exec(solicitud.header('authorization') ?? '');
    if (!coincidencia) throw new NoAutenticado();

    const actor = await this.validarSolicitud.ejecutar(coincidencia[1]);
    this.tenantContext.fijar(TenantId.de(actor.tenantId));
    solicitud.actor = actor;
    return true;
  }
}
