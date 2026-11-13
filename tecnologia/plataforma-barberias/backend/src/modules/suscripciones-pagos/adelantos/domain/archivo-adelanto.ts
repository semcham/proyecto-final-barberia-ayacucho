import { ComprobanteInvalido } from '../../pagos/domain/errores';
import { detectarTipoComprobante, type TipoComprobante } from '../../pagos/domain/tipo-de-archivo';

// T016 de 008 · Archivos privados del adelanto (research R05): el QR de la barbería (JPEG o PNG, hasta 1 MB) y la
// captura del pago (además PDF, hasta 5 MB). El tipo se decide por los bytes, con la misma detección que los
// comprobantes de 003; el nombre y el Content-Type del navegador no cuentan.

export type ClaseDeArchivoAdelanto = 'QR' | 'CAPTURA';

export const TAMANO_MAXIMO_ARCHIVO_ADELANTO: Readonly<Record<ClaseDeArchivoAdelanto, number>> = {
  QR: 1024 * 1024,
  CAPTURA: 5 * 1024 * 1024,
};

const TIPOS_PERMITIDOS: Readonly<Record<ClaseDeArchivoAdelanto, readonly TipoComprobante[]>> = {
  QR: ['image/jpeg', 'image/png'],
  CAPTURA: ['image/jpeg', 'image/png', 'application/pdf'],
};

/**
 * El archivo no es del tipo o del tamaño permitido: el mismo error que los comprobantes de 003 (VALIDACION con el
 * campo `archivo`), con 422 como pide el contrato de 008. Nunca repite lo recibido.
 */
export class ArchivoDeAdelantoInvalido extends ComprobanteInvalido {
  readonly estadoHttp = 422;

  constructor(problema: 'requerido' | 'tipo_no_permitido' | 'demasiado_grande') {
    super('archivo', problema);
  }
}

/** El tipo verificado por los bytes, o ArchivoDeAdelantoInvalido. */
export function tipoDeArchivoDeAdelanto(
  clase: ClaseDeArchivoAdelanto,
  contenido: Uint8Array,
): TipoComprobante {
  if (contenido.length === 0) throw new ArchivoDeAdelantoInvalido('requerido');
  if (contenido.length > TAMANO_MAXIMO_ARCHIVO_ADELANTO[clase]) {
    throw new ArchivoDeAdelantoInvalido('demasiado_grande');
  }
  const tipo = detectarTipoComprobante(contenido);
  if (!tipo || !TIPOS_PERMITIDOS[clase].includes(tipo))
    throw new ArchivoDeAdelantoInvalido('tipo_no_permitido');
  return tipo;
}
