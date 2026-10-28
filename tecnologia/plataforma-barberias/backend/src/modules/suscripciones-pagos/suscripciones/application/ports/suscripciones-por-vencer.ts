/** Una suscripción con una transición automática pendiente: su barbería (tenant) y su id. */
export interface SuscripcionPorVencer {
  tenantId: string;
  suscripcionId: string;
}

/**
 * Lectura entre barberías de la vía de la plataforma (ADR-031) para la tarea de vencimiento: las
 * suscripciones cuya fecha ya pasó (fin de la prueba, del período o de la gracia) o que empiezan un período de
 * otro plan. Por páginas ordenadas por id (`despuesDe`), sin datos de negocio. Lo que se hace con cada una
 * corre después en una transacción con su tenant y RLS.
 */
export abstract class SuscripcionesPorVencer {
  abstract pendientes(ahora: Date, despuesDe: string | null, limite: number): Promise<SuscripcionPorVencer[]>;
}
