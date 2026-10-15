import { RequiereOperacion } from '../../../../shared';
import type { Operacion as CodigoOperacion } from '../domain/permisos';

/** Operación de la matriz de permisos que exige la ruta (primera barrera HTTP; el caso de uso la vuelve a exigir). */
export const Operacion = (operacion: CodigoOperacion) => RequiereOperacion(operacion);
