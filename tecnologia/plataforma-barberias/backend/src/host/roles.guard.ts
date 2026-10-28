import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AccesoDenegado,
  type CodigoRol,
  NoAutenticado,
  OPERACIONES,
  type Operacion as OperacionM01,
  Permisos,
} from '../modules/acceso-barberias';
import {
  OPERACIONES_CATALOGO_CITAS,
  type OperacionCatalogoCitas,
  PermisosCatalogoCitas,
} from '../modules/catalogo-citas';
import {
  OPERACIONES_SUSCRIPCIONES,
  type OperacionSuscripciones,
  PermisosSuscripciones,
} from '../modules/suscripciones-pagos';
import { AuditLog, TenantId } from '../shared';
import { CLAVE_OPERACION, type SolicitudConActor } from './solicitud';

// El decorador @Operacion(...) se define en ./solicitud.
export { Operacion } from './solicitud';

/**
 * Permiso de un rol para una operación de la matriz de M01, de M02 o de M03 (T033; T048 de 003). Una operación que no está en
 * ninguna matriz es un error de programación: se rechaza.
 */
export function rolPermiteOperacion(rol: CodigoRol, operacion: string): boolean {
  if ((OPERACIONES as readonly string[]).includes(operacion)) {
    return Permisos.permite(rol, operacion as OperacionM01);
  }
  if ((OPERACIONES_CATALOGO_CITAS as readonly string[]).includes(operacion)) {
    return PermisosCatalogoCitas.permite(rol, operacion as OperacionCatalogoCitas);
  }
  if ((OPERACIONES_SUSCRIPCIONES as readonly string[]).includes(operacion)) {
    return PermisosSuscripciones.permite(rol, operacion as OperacionSuscripciones);
  }
  throw new Error(`Operación desconocida en @Operacion: ${operacion}`);
}

/**
 * Primera barrera de autorización en HTTP (T043, T033 de 002). Usa las mismas matrices que la
 * comprobación de la capa de aplicación (R22): `Permisos` de M01 y `PermisosCatalogoCitas` de M02. El
 * caso de uso vuelve a exigir el permiso (y limita el alcance a sus recursos), así que esta barrera no es
 * la única. Las rutas `@Publica()` no tienen operación y no leen el token.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditoria: AuditLog,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const operacion = this.reflector.getAllAndOverride<string | undefined>(CLAVE_OPERACION, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!operacion) return true;

    const actor = contexto.switchToHttp().getRequest<SolicitudConActor>().actor;
    if (!actor) throw new NoAutenticado();
    if (rolPermiteOperacion(actor.rol, operacion)) return true;

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
