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

/** US5 de 003: la barbería de la ruta no existe (404, como cualquier recurso ajeno). */
export class BarberiaNoEncontrada extends ErrorDeAplicacion {
  readonly codigo = 'NO_ENCONTRADO';
  constructor() {
    super('No se encontró el recurso solicitado.');
  }
}

/** US5 de 003: suspender una barbería ya suspendida, o reactivar una activa (409). */
export class BarberiaYaEnEseEstado extends ErrorDeAplicacion {
  readonly codigo = 'BARBERIA_YA_EN_ESE_ESTADO';
  constructor(estado: 'ACTIVA' | 'SUSPENDIDA') {
    super(estado === 'SUSPENDIDA' ? 'La barbería ya está suspendida.' : 'La barbería ya está activa.', [
      { estado },
    ]);
  }
}

/** El enlace elegido ya lo usa otra barbería o es una palabra reservada (R15 de 002). */
export class EnlaceNoDisponible extends ErrorDeAplicacion {
  readonly codigo = 'ENLACE_NO_DISPONIBLE';
  constructor() {
    super('Ese enlace no está disponible. Elige otro.');
  }
}
