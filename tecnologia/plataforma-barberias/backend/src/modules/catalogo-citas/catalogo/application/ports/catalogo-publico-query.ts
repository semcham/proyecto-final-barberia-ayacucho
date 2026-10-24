import type { TenantId } from '../../../../../shared';
import type { FuenteDisponibilidad } from './fuente-disponibilidad';

/** Catálogo público sin los datos de la barbería (esos los da M01, `BarberiasApi.barberiaPublicaPorEnlace`). */
export interface CatalogoPublicoDatos {
  horario: { tramos: { diaSemana: number; inicio: string; fin: string }[] };
  servicios: {
    id: string;
    nombre: string;
    descripcion: string | null;
    precio: string;
    duracionMinutos: number;
  }[];
  barberos: { id: string; nombre: string; servicioIds: string[] }[];
}

/**
 * T034 (006) · Lecturas de la vía pública por enlace (ADR-021), para el catálogo en caché (R07) y los horarios
 * libres (R11). Cada método usa una sola transacción pública.
 */
export abstract class CatalogoPublicoQuery {
  /** Horario de atención, servicios activos y barberos activos con sus servicios activos. */
  abstract catalogo(tenantId: TenantId): Promise<CatalogoPublicoDatos>;

  /**
   * Fuente que toma el servicio, el horario de atención y los barberos candidatos del `catalogo` recibido (la
   * entrada en caché) y lee de la base solo la disponibilidad semanal, los bloqueos y las citas del día.
   */
  abstract fuenteDelDia(tenantId: TenantId, catalogo: CatalogoPublicoDatos): FuenteDisponibilidad;

  /** Fuente que lee todo de la base: sin entrada en caché (desactivada, ausente o Redis caído). */
  abstract fuenteCompleta(tenantId: TenantId): FuenteDisponibilidad;
}
