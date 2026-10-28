import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NoAutenticado, ValidarSolicitud, ValidarSolicitudPlataforma } from '../modules/acceso-barberias';
import { TenantContext, TenantId } from '../shared';
import { CLAVE_PLATAFORMA, CLAVE_PUBLICA, type SolicitudConActor } from './solicitud';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*)$/;

/**
 * Autenticación de cada ruta no marcada con @Publica (T042). El tenant de la solicitud sale SOLO del
 * token verificado (principio III). Cualquier fallo responde 401 sin explicar el motivo (EQ-07).
 *
 * Rutas @Plataforma() (003, ADR-031): exigen el token del administrador (aud "plataforma", sin tid) y NO fijan
 * ningún tenant. Un token de barbería no sirve en ellas, y el token de plataforma no sirve en ninguna otra
 * ruta: cada vía verifica solo su propia audiencia.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly validarSolicitud: ValidarSolicitud,
    private readonly validarSolicitudPlataforma: ValidarSolicitudPlataforma,
    private readonly tenantContext: TenantContext,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const objetivos = [contexto.getHandler(), contexto.getClass()];
    const publica = this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICA, objetivos);
    const plataforma = this.reflector.getAllAndOverride<boolean>(CLAVE_PLATAFORMA, objetivos);
    if (publica && plataforma) throw new Error('Una ruta no puede ser @Publica() y @Plataforma() a la vez');
    if (publica) return true;

    const solicitud = contexto.switchToHttp().getRequest<SolicitudConActor>();
    const coincidencia = BEARER.exec(solicitud.header('authorization') ?? '');
    if (!coincidencia) throw new NoAutenticado();

    if (plataforma) {
      solicitud.actorPlataforma = await this.validarSolicitudPlataforma.ejecutar(coincidencia[1]);
      return true;
    }

    const actor = await this.validarSolicitud.ejecutar(coincidencia[1]);
    this.tenantContext.fijar(TenantId.de(actor.tenantId));
    solicitud.actor = actor;
    return true;
  }
}
