import type { TipoComprobante } from '../../../pagos/domain/tipo-de-archivo';
import type { ClaseDeArchivoAdelanto } from '../../domain/archivo-adelanto';

/** Un archivo del adelanto para servir: el tipo verificado por los bytes y el contenido. */
export interface ArchivoAdelanto {
  id: string;
  clase: ClaseDeArchivoAdelanto;
  tipo: TipoComprobante;
  contenido: Buffer;
}

/**
 * T016 de 008 · Archivos privados del adelanto (booking_deposit_file, research R05), en la barbería de la
 * transacción en curso. Inmutables: no se cambian ni se borran; reemplazar el QR guarda otro (FR-004). Nunca hay
 * una URL pública: se leen solo con el tenant fijado y se sirven con sesión y permiso.
 */
export abstract class ArchivosAdelanto {
  /** Guarda el contenido con su tipo (verificado de nuevo por los bytes), tamaño y SHA-256. Devuelve el id. */
  abstract guardar(nuevo: {
    id: string;
    clase: ClaseDeArchivoAdelanto;
    contenido: Buffer;
    por: string;
  }): Promise<string>;

  /** El archivo de la barbería, o null si no existe en ella. */
  abstract leer(id: string): Promise<ArchivoAdelanto | null>;
}
