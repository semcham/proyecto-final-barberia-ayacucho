import type { CandidatoPorVencer } from '../../../adelantos-api';

/**
 * T050 de 008 · Preselección de la tarea vencer-adelantos (research R09): los adelantos de TODAS las barberías por
 * pagar con la hora límite cumplida o por revisar con el límite máximo adicional cumplido, ordenados por id, en lotes.
 * Es solo una preselección: la decisión se toma con la cita y el adelanto bloqueados en su barbería.
 */
export abstract class AdelantosPorVencerLectura {
  abstract candidatos(ahora: Date, lote: number, despuesDe: string | null): Promise<CandidatoPorVencer[]>;
}
