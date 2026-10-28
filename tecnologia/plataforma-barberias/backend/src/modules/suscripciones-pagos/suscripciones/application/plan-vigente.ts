import { Injectable } from '@nestjs/common';
import { Clock } from '../../../../shared';
import type { Plan } from '../domain/plan';
import { SuscripcionRepository } from './ports/suscripcion-repository';

/**
 * T047 · Plan que rige ahora en la barbería del contexto (R04, FR-005): el del período pagado que cubre el
 * instante, no el último registrado en la suscripción. Así, un cambio de plan rige desde que su período
 * empieza aunque la tarea programada todavía no haya pasado. Con `bloquear`, la fila de la suscripción queda
 * bloqueada hasta que termine la transacción del llamador.
 */
@Injectable()
export class PlanVigente {
  constructor(
    private readonly suscripciones: SuscripcionRepository,
    private readonly reloj: Clock,
  ) {}

  async delTenant(opciones: { bloquear?: boolean } = {}): Promise<Plan | null> {
    const suscripcion = await this.suscripciones.suscripcionDelTenant(opciones);
    if (!suscripcion) return null;
    const periodos = await this.suscripciones.periodos(suscripcion.id);
    const planId = suscripcion.planVigente(periodos, this.reloj.ahora());
    return this.suscripciones.planPorId(planId);
  }
}
