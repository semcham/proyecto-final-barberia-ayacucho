/**
 * Un comprobante en revisión tal como lo ve el administrador en la cola (contracts/openapi.yaml,
 * ComprobantePorRevisar). Sin el número de operación completo (solo los últimos 4 caracteres, H2), sin el
 * contenido ni el nombre del archivo.
 */
export interface ComprobantePorRevisar {
  barberia: { id: string; nombre: string };
  pago: {
    id: string;
    plan: string;
    importeCentimos: number;
    referencia: string;
    numeroOperacionFinal: string;
    /** El mismo número (comparado por su hash) figura en otro pago, de esta o de otra barbería. */
    numeroRepetido: boolean;
    fechaTransferencia: string;
    /** Ids de otros pagos con el mismo número (por su hash) o con el mismo archivo (por su SHA-256). */
    numeroYaUsadoEn: string[];
  };
  enviadoEn: Date;
}

/**
 * Lectura entre barberías de la cola de comprobantes (ADR-031), con el rol de solo lectura de la plataforma:
 * ese rol lee bank_operation_last4 y bank_operation_hash pero nunca el número completo ni el contenido.
 */
export abstract class ColaDeComprobantesLectura {
  abstract enRevision(): Promise<ComprobantePorRevisar[]>;
}
