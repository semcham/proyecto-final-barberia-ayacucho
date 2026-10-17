import { ErrorDeAplicacion } from '../../../../shared/nucleo';

/**
 * El enlace público no existe, cambió o la barbería está suspendida. Mismo error en todos los casos para
 * no revelar cuál ocurrió (FR-022 de 002).
 */
export class BarberiaNoDisponible extends ErrorDeAplicacion {
  readonly codigo = 'BARBERIA_NO_DISPONIBLE';
  constructor() {
    super('Esta barbería no está disponible.');
  }
}
