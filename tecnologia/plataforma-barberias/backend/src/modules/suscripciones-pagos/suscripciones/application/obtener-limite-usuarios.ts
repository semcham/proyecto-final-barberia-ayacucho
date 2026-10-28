import { Injectable } from '@nestjs/common';
import { TenantContext, type TenantId } from '../../../../shared';
import { PlanVigente } from './plan-vigente';

/**
 * Máximo de usuarios del personal que permite el plan de la barbería (FR-020). Participa en la
 * transacción del llamador. Con `bloquear`, la fila de la suscripción queda bloqueada hasta que esa
 * transacción termine: dos altas simultáneas se ejecutan una después de otra y la segunda ya cuenta a
 * la primera, así nunca se supera el plan.
 */
@Injectable()
export class ObtenerLimiteUsuarios {
  constructor(
    private readonly planVigente: PlanVigente,
    private readonly tenantContext: TenantContext,
  ) {}

  async ejecutar(tenantId: TenantId, opciones: { bloquear?: boolean } = {}): Promise<number> {
    if (!this.tenantContext.actual().equals(tenantId)) {
      throw new Error('El límite de usuarios debe consultarse dentro de la transacción del mismo tenant');
    }
    const plan = await this.planVigente.delTenant({ bloquear: opciones.bloquear });
    if (!plan) throw new Error('La barbería no tiene una suscripción');
    return plan.maxUsuarios;
  }
}
