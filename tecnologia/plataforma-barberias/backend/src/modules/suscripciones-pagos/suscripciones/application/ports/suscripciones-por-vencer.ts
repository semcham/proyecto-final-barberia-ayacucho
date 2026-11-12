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
  /**
   * 004 (T128; FR-037, research R14): las suscripciones EN PRUEBA cuya prueba termina en (`ahora`, `hasta`], para la
   * tarea avisar-fin-de-prueba. Es una preselección por la misma vía y en las mismas páginas: la decisión (el
   * criterio del panel) se toma después en la barbería, con su tenant y RLS.
   */
  abstract pruebasPorTerminar(
    ahora: Date,
    hasta: Date,
    despuesDe: string | null,
    limite: number,
  ): Promise<SuscripcionPorVencer[]>;
}
