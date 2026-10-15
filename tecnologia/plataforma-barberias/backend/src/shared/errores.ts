/**
 * Base de los errores esperados de la aplicación (de dominio o de aplicación). El host los traduce
 * al formato { codigo, mensaje, detalles } y al estado HTTP (R21). No depende de ningún framework.
 */
export abstract class ErrorDeAplicacion extends Error {
  abstract readonly codigo: string;

  constructor(
    mensaje: string,
    readonly detalles: Record<string, unknown>[] = [],
  ) {
    super(mensaje);
    this.name = new.target.name;
  }
}

/** Se usó un componente que necesita el tenant fuera de un contexto de tenant. Es un error de programación. */
export class SinContextoDeTenant extends Error {
  constructor() {
    super('No hay un tenant fijado en el contexto de esta operación');
    this.name = 'SinContextoDeTenant';
  }
}
