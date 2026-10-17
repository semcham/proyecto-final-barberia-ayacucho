import { RequiereOperacion } from '../../../../shared';
import type { OperacionCatalogoCitas } from '../domain/permisos';

/**
 * Operación de la matriz de M02 que exige la ruta (primera barrera HTTP en el RolesGuard del host; el caso
 * de uso la vuelve a exigir con AutorizacionCatalogoCitas).
 */
export const OperacionM02 = (operacion: OperacionCatalogoCitas) => RequiereOperacion(operacion);
