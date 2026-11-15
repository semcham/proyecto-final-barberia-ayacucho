import { ErrorDeAplicacion } from '../../../../shared/nucleo';

/** El rol no tiene la operación de M04 (403 ACCESO_DENEGADO, auditado como en 001). */
export class AccesoDenegado extends ErrorDeAplicacion {
  readonly codigo = 'ACCESO_DENEGADO';

  constructor() {
    super('No tienes permiso para realizar esta operación.');
  }
}
