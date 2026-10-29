import type { EstadoSuscripcion } from '../../../suscripciones/domain/suscripcion';

/** Lo que el listado de barberías del administrador muestra de cada suscripción (BarberiaPlataforma). */
export interface ResumenDeSuscripcion {
  estado: EstadoSuscripcion;
  /** Nombre del plan con el que está la suscripción ahora. */
  plan: string;
  /** Fin del último período pagado o, sin períodos, de la prueba (copia derivada, M2). */
  finCobertura: Date | null;
}

/**
 * Resúmenes de varias barberías a la vez, con el rol de solo lectura de la plataforma (ADR-031). Solo estado,
 * plan y cobertura: ni pagos ni datos de la barbería.
 */
export abstract class ResumenesDeSuscripcionLectura {
  abstract deBarberias(tenantIds: readonly string[]): Promise<Map<string, ResumenDeSuscripcion>>;
}
