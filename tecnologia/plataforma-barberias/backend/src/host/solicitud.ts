import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor, Operacion as CodigoOperacion } from '../modules/acceso-barberias';

/** Solicitud HTTP con el actor autenticado que adjunta el AuthGuard. */
export interface SolicitudConActor extends Request {
  actor?: Actor;
}

export const CLAVE_PUBLICA = 'ruta-publica';
export const CLAVE_OPERACION = 'operacion-protegida';

/** Marca una ruta como pública: el AuthGuard no exige token. */
export const Publica = () => SetMetadata(CLAVE_PUBLICA, true);

/** Operación de la matriz de permisos que exige la ruta (primera barrera HTTP, R22). */
export const Operacion = (operacion: CodigoOperacion) => SetMetadata(CLAVE_OPERACION, operacion);

/** Inyecta en el controlador el actor autenticado, para pasarlo al caso de uso. */
export const ActorActual = createParamDecorator((_dato: unknown, contexto: ExecutionContext): Actor => {
  const actor = contexto.switchToHttp().getRequest<SolicitudConActor>().actor;
  if (!actor) throw new Error('ActorActual usado en una ruta sin AuthGuard');
  return actor;
});
