import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AccesoDenegado,
  NoAutenticado,
  type Operacion as CodigoOperacion,
  Permisos,
} from '../modules/acceso-barberias';
import { AuditLog, TenantId } from '../shared';
import { CLAVE_OPERACION, type SolicitudConActor } from './solicitud';

// El decorador @Operacion(...) se define en ./solicitud.
export { Operacion } from './solicitud';

/**
 * Primera barrera de autorización en HTTP (T043). Usa la misma matriz `Permisos` que la comprobación de
 * la capa de aplicación (R22); el caso de uso vuelve a exigir el permiso, así que esta barrera no es la única.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditoria: AuditLog,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const operacion = this.reflector.getAllAndOverride<CodigoOperacion | undefined>(CLAVE_OPERACION, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!operacion) return true;

    const actor = contexto.switchToHttp().getRequest<SolicitudConActor>().actor;
    if (!actor) throw new NoAutenticado();
    if (Permisos.permite(actor.rol, operacion)) return true;

    await this.auditoria.registrarEnTransaccionPropia(
      {
        accion: 'ACCESO_DENEGADO_ROL',
        actorId: actor.usuarioId,
        recurso: `operacion:${operacion}`,
        resultado: 'DENEGADO',
      },
      TenantId.de(actor.tenantId),
    );
    throw new AccesoDenegado();
  }
}
