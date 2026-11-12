import { ErrorDeAplicacion } from '../../../../shared/nucleo';

// T116 de 004 · Canal de aviso del cliente en una barbería (RF33; FR-016, FR-017; data-model §2.1). Sin preferencia
// guardada, el canal es el correo. El número de WhatsApp es un campo PROPIO del cliente en esa barbería: se propone
// con su teléfono de contacto y cambiarlo no cambia ese teléfono.

export type CanalDeAviso = 'CORREO' | 'WHATSAPP';

export interface PreferenciaAviso {
  canal: CanalDeAviso;
  /** Null si nunca eligió WhatsApp. */
  numero: string | null;
}

export const PREFERENCIA_POR_DEFECTO: PreferenciaAviso = { canal: 'CORREO', numero: null };

/** El mismo formato que la columna whatsapp_number (CHECK de 0022). */
const FORMATO_NUMERO = /^\+?[0-9 ]{6,20}$/;

/**
 * El número de WhatsApp no es válido. Código VALIDACION, como cualquier dato inválido, pero con 422: así lo fija el
 * contrato de PUT /clientes/yo/aviso (el canal no cambia).
 */
export class NumeroWhatsappInvalido extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  readonly estadoHttp = 422;
  constructor() {
    super('El número de WhatsApp no es válido.', [{ campo: 'numeroWhatsapp', problema: 'formato' }]);
  }
}

/** Quita los espacios de los extremos y junta los repetidos; lanza si no tiene el formato. */
export function normalizarNumero(texto: string | null | undefined): string {
  const limpio = (texto ?? '').trim().replace(/\s+/g, ' ');
  if (!FORMATO_NUMERO.test(limpio) || limpio.replace(/\D/g, '').length < 6)
    throw new NumeroWhatsappInvalido();
  return limpio;
}

/** Solo los dos últimos dígitos, para la auditoría (nunca el número completo). */
export function numeroOculto(numero: string): string {
  return `*${numero.replace(/\D/g, '').slice(-2)}`;
}
