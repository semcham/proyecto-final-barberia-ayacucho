import type { PasoDeSuscripcion } from '../../domain/estado-suscripcion';
import type { Periodo } from '../../domain/periodo';
import type { Plan } from '../../domain/plan';
import type { Suscripcion } from '../../domain/suscripcion';

/** Período nuevo que paga un pago aprobado (regla de aprobación, data-model.md §3). */
export interface PeriodoNuevo {
  id: string;
  suscripcionId: string;
  pagoId: string;
  planId: string;
  inicio: Date;
  fin: Date;
}

/**
 * Suscripciones del tenant del contexto (filtro explícito por tenant además de RLS) y catálogo de planes.
 * Todas las operaciones participan en la transacción en curso de UnitOfWork.
 */
export abstract class SuscripcionRepository {
  abstract planPorCodigo(codigo: string): Promise<Plan>;
  abstract planPorId(id: string): Promise<Plan | null>;
  /** Planes que se pueden contratar (activos, públicos y con precio), del más barato al más caro. */
  abstract planesContratables(): Promise<Plan[]>;
  abstract crear(suscripcion: Suscripcion): Promise<void>;
  /**
   * Plan de la suscripción del tenant actual, o null si la barbería aún no tiene suscripción. Con
   * `bloquear`, la fila de la suscripción queda bloqueada (FOR UPDATE) hasta que termine la transacción.
   */
  abstract planDelTenant(opciones?: { bloquear?: boolean }): Promise<Plan | null>;
  /** Suscripción del tenant actual. Con `bloquear`, FOR UPDATE hasta que termine la transacción. */
  abstract suscripcionDelTenant(opciones?: { bloquear?: boolean }): Promise<Suscripcion | null>;
  /** Períodos pagados de la suscripción, en orden de inicio. */
  abstract periodos(suscripcionId: string): Promise<Periodo[]>;
  /**
   * Inserta el período y, en la misma transacción, actualiza la copia derivada `current_period_end` (M2).
   * Si la base lo rechaza por solaparse con otro período o porque el pago ya tiene uno, lanza
   * `PeriodoYaCubierto` (las restricciones EXCLUDE y UNIQUE son la última barrera).
   */
  abstract insertarPeriodo(periodo: PeriodoNuevo): Promise<void>;
  /**
   * Aplica un paso de la máquina de estados solo si la suscripción sigue en `paso.desde` (transición
   * condicional, FR-032). Devuelve si se aplicó.
   */
  abstract aplicarPaso(suscripcionId: string, paso: PasoDeSuscripcion): Promise<boolean>;
}
