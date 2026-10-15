import type { Request } from 'express';
import type { Actor, Operacion as CodigoOperacion } from '../modules/acceso-barberias';
import { RequiereOperacion } from '../shared';

// Los decoradores genéricos viven en M06 (shared/http/decoradores.ts) para que los controladores de los
// módulos los usen sin depender del host. Aquí solo se les da el tipo de M01.
export { ActorActual, CLAVE_OPERACION, CLAVE_PUBLICA, Publica } from '../shared';

/** Solicitud HTTP con el actor autenticado que adjunta el AuthGuard. */
export interface SolicitudConActor extends Request {
  actor?: Actor;
}

/** Operación de la matriz de permisos que exige la ruta (tipada con las operaciones de M01). */
export const Operacion = (operacion: CodigoOperacion) => RequiereOperacion(operacion);
