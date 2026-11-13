import { ErrorDeAplicacion } from '../../../../shared/nucleo';

// T041 de 008 · El motivo con el que el propietario rechaza un pago (FR-014): obligatorio, de 5 a 300 caracteres sin
// contar los espacios de los extremos (el mismo CHECK de booking_deposit_payment.rejection_reason).

const MINIMO = 5;
const MAXIMO = 300;

/** Falta el motivo o no tiene el largo permitido. VALIDACION con 422 (contracts/openapi.yaml de 008). */
export class MotivoDeRechazoInvalido extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  readonly estadoHttp = 422;

  constructor(problema: 'requerido' | 'largo') {
    super('Escribe el motivo del rechazo, de 5 a 300 caracteres.', [{ campo: 'motivo', problema }]);
  }
}

/** El motivo sin los espacios de los extremos, o MotivoDeRechazoInvalido. */
export function motivoDeRechazo(entrada: string | undefined): string {
  const motivo = (entrada ?? '').trim();
  if (motivo === '') throw new MotivoDeRechazoInvalido('requerido');
  if (motivo.length < MINIMO || motivo.length > MAXIMO) throw new MotivoDeRechazoInvalido('largo');
  return motivo;
}
