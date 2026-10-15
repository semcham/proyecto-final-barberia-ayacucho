import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

// Decoradores HTTP genéricos de M06. Los usan los controladores de los módulos y los guards del host,
// sin que los módulos dependan del host ni M06 dependa de los módulos.

export const CLAVE_PUBLICA = 'ruta-publica';
export const CLAVE_OPERACION = 'operacion-protegida';

/** Marca una ruta como pública: el AuthGuard no exige token. */
export const Publica = () => SetMetadata(CLAVE_PUBLICA, true);

/** Operación de la matriz de permisos que exige la ruta (primera barrera HTTP, R22). */
export const RequiereOperacion = (operacion: string) => SetMetadata(CLAVE_OPERACION, operacion);

/** Inyecta el actor autenticado que adjuntó el AuthGuard a la solicitud. */
export const ActorActual = createParamDecorator((_dato: unknown, contexto: ExecutionContext): unknown => {
  const actor = contexto.switchToHttp().getRequest<{ actor?: unknown }>().actor;
  if (!actor) throw new Error('ActorActual usado en una ruta sin AuthGuard');
  return actor;
});
