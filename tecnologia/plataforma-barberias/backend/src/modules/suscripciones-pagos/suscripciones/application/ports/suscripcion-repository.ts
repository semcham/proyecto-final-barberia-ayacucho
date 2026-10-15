import type { Plan } from '../../domain/plan';
import type { Suscripcion } from '../../domain/suscripcion';

/** Suscripciones del tenant del contexto (filtro explícito por tenant además de RLS) y catálogo de planes. */
export abstract class SuscripcionRepository {
  abstract planPorCodigo(codigo: string): Promise<Plan>;
  abstract crear(suscripcion: Suscripcion): Promise<void>;
  /**
   * Plan de la suscripción del tenant actual, o null si la barbería aún no tiene suscripción. Con
   * `bloquear`, la fila de la suscripción queda bloqueada (FOR UPDATE) hasta que termine la transacción.
   */
  abstract planDelTenant(opciones?: { bloquear?: boolean }): Promise<Plan | null>;
}
