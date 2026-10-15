import { Injectable } from '@nestjs/common';
import { TenantContext, type TenantId } from '../../../../shared';
import { SuscripcionRepository } from './ports/suscripcion-repository';

/** Máximo de usuarios del personal que permite el plan de la barbería (FR-020). Participa en la transacción del llamador. */
@Injectable()
export class ObtenerLimiteUsuarios {
  constructor(
    private readonly suscripciones: SuscripcionRepository,
    private readonly tenantContext: TenantContext,
  ) {}

  async ejecutar(tenantId: TenantId): Promise<number> {
    if (!this.tenantContext.actual().equals(tenantId)) {
      throw new Error('El límite de usuarios debe consultarse dentro de la transacción del mismo tenant');
    }
    const plan = await this.suscripciones.planDelTenant();
    if (!plan) throw new Error('La barbería no tiene una suscripción');
    return plan.maxUsuarios;
  }
}
