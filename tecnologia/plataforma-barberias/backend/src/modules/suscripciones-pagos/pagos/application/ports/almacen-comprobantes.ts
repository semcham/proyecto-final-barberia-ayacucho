import type { TipoComprobante } from '../../domain/tipo-de-archivo';

/** Metadatos de un comprobante (payment_receipt). Nunca el nombre original del archivo, que no se guarda. */
export interface Comprobante {
  id: string;
  pagoId: string;
  tipo: TipoComprobante;
  tamanoBytes: number;
  /** SHA-256 del contenido: detecta el mismo archivo subido por otra barbería (R09). */
  sha256: string;
  subidoPor: string;
  subidoEn: Date;
  revisadoEn: Date | null;
  resultado: 'APROBADO' | 'RECHAZADO' | null;
}

export interface ComprobanteNuevo {
  id: string;
  pagoId: string;
  tipo: TipoComprobante;
  contenido: Buffer;
  subidoPor: string;
}

/** Un comprobante en revisión ya existe para el pago (índice payment_receipt_uno_en_revision). */
export class ComprobanteEnRevisionExistente extends Error {
  constructor() {
    super('El pago ya tiene un comprobante en revisión');
    this.name = 'ComprobanteEnRevisionExistente';
  }
}

/**
 * T079 · Almacenamiento privado de los comprobantes (ADR-023, R09), en la barbería del contexto y en la
 * transacción en curso. El contenido solo sale por `contenido` (descarga con sesión): nunca en listados, en
 * la vía de la plataforma ni en registros. En la nube, el adaptador equivalente es S3 con cifrado del lado
 * del servidor, sin cambiar los casos de uso.
 */
export abstract class AlmacenComprobantes {
  /** Guarda el contenido y sus metadatos (con su SHA-256) en una sola transacción. */
  abstract guardar(comprobante: ComprobanteNuevo): Promise<Comprobante>;
  /** El último comprobante del pago (el vigente), si tiene. */
  abstract ultimoDe(pagoId: string): Promise<Comprobante | null>;
  abstract contenido(comprobanteId: string): Promise<Buffer | null>;
  /** Registra la revisión una sola vez (solo si sigue sin revisar). */
  abstract marcarRevisado(
    comprobanteId: string,
    revision: { por: string; en: Date; resultado: 'APROBADO' | 'RECHAZADO'; motivo: string | null },
  ): Promise<boolean>;
  /**
   * Consume un lugar del cupo diario de la barbería (5 por día, FR-020a) y devuelve false si ya no quedan.
   * Corre en la transacción del comprobante: si la subida falla, el lugar vuelve.
   */
  abstract consumirCupoDiario(dia: string): Promise<boolean>;
}
