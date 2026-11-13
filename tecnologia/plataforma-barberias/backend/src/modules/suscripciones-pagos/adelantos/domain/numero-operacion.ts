import { ComprobanteInvalido } from '../../pagos/domain/errores';

// T008 de 008 · Número de operación del pago del adelanto (research R07, FR-010). Se guarda normalizado (sin
// espacios y en mayúsculas) para que dos escrituras del mismo número choquen con UNIQUE (tenant_id,
// operation_number). Solo letras A-Z y dígitos 0-9, de 4 a 20 caracteres.

const FORMATO = /^[A-Z0-9]{4,20}$/;

/** El número normalizado, o null si no tiene el formato (el caso de uso responde VALIDACION). */
export function normalizarNumeroOperacion(entrada: string): string | null {
  const normalizado = entrada.replace(/\s+/g, '').toUpperCase();
  return FORMATO.test(normalizado) ? normalizado : null;
}

/**
 * T031 · El número no tiene el formato: el mismo error que los comprobantes de 003 (VALIDACION con el campo
 * `numeroOperacion`), con 422 como pide el contrato de 008. Nunca repite lo recibido.
 */
export class NumeroDeOperacionInvalido extends ComprobanteInvalido {
  readonly estadoHttp = 422;

  constructor() {
    super('numeroOperacion', 'formato');
  }
}
