// Tipo real de un comprobante por sus bytes iniciales (R05, FR-020). Dominio puro: nunca se usan el nombre
// del archivo ni el Content-Type que declara el navegador, que el usuario controla.

export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type TipoComprobante = (typeof TIPOS_COMPROBANTE)[number];

/** Tamaño máximo de un comprobante: 5 MB (CHECK de payment_receipt y payment_receipt_file). */
export const TAMANO_MAXIMO_COMPROBANTE = 5 * 1024 * 1024;

const FIRMAS: { tipo: TipoComprobante; bytes: readonly number[] }[] = [
  // JPEG: SOI (FF D8) seguido del primer marcador (FF).
  { tipo: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  // PNG: la firma completa de 8 bytes del estándar.
  { tipo: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // PDF: "%PDF-".
  { tipo: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

/**
 * El tipo del comprobante si sus primeros bytes son los de un JPEG, PNG o PDF; si no (texto, vacío,
 * cabecera truncada u otro formato), null. Exige además al menos un byte después de la firma: una firma sola
 * no es un archivo.
 */
export function detectarTipoComprobante(contenido: Uint8Array): TipoComprobante | null {
  for (const { tipo, bytes } of FIRMAS) {
    if (contenido.length > bytes.length && bytes.every((byte, i) => contenido[i] === byte)) return tipo;
  }
  return null;
}

/** Extensión para el nombre de la descarga (el nombre original nunca se guarda). */
export function extensionDe(tipo: TipoComprobante): 'jpg' | 'png' | 'pdf' {
  return tipo === 'image/jpeg' ? 'jpg' : tipo === 'image/png' ? 'png' : 'pdf';
}
