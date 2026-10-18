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

/** El enlace elegido ya lo usa otra barbería o es una palabra reservada (R15 de 002). */
export class EnlaceNoDisponible extends ErrorDeAplicacion {
  readonly codigo = 'ENLACE_NO_DISPONIBLE';
  constructor() {
    super('Ese enlace no está disponible. Elige otro.');
  }
}
