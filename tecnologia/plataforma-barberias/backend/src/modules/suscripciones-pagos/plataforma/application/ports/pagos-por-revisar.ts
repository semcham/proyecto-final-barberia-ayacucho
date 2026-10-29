/** Marcas de la lista de pagos por revisar (FR-025a; contracts/openapi.yaml, PagoPorRevisar). */
export const MARCAS_POR_REVISAR = [
  'DUPLICADO',
  'IMPORTE_DISTINTO',
  'APROBADO_TRAS_RECHAZO',
  'DEVOLUCION',
] as const;
export type MarcaPorRevisar = (typeof MARCAS_POR_REVISAR)[number];

/**
 * Un caso por revisar: un pago con una marca sin resolver, o una notificación del proveedor que no corresponde
 * a ningún pago (SIN_PAGO, sin barbería). Sin datos del pagador ni del comprobante.
 */
export interface PagoPorRevisar {
  marca: MarcaPorRevisar | 'SIN_PAGO';
  barberia: { id: string; nombre: string } | null;
  pagoId: string | null;
  eventoId: string | null;
  importeCentimos: number | null;
  detectadoEn: Date;
}

/** Lectura entre barberías de los casos por revisar, con el rol de solo lectura de la plataforma (ADR-031). */
export abstract class PagosPorRevisarLectura {
  abstract pendientes(desdeSinPago: Date): Promise<PagoPorRevisar[]>;
}
