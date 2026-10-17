import { Injectable } from '@nestjs/common';
import { TenantContext, type TenantId } from '../../../../shared';
import { SuscripcionRepository } from './ports/suscripcion-repository';

/**
 * T024 · Máximo de barberos activos del catálogo que permite el plan (FR-012 de 002, research R13).
 * Participa en la transacción del llamador (M02) y deja bloqueada la fila de la suscripción hasta que esa
 * transacción termine: dos altas o reactivaciones simultáneas se ejecutan una después de otra y la
 * segunda ya cuenta a la primera, así nunca se supera el plan.
 */
@Injectable()
export class ObtenerLimiteBarberos {
  constructor(
    private readonly suscripciones: SuscripcionRepository,
    private readonly tenantContext: TenantContext,
  ) {}

  async ejecutar(tenantId: TenantId): Promise<number> {
    if (!this.tenantContext.actual().equals(tenantId)) {
      throw new Error('El límite de barberos debe consultarse dentro de la transacción del mismo tenant');
    }
    const plan = await this.suscripciones.planDelTenant({ bloquear: true });
    if (!plan) throw new Error('La barbería no tiene una suscripción');
    return plan.maxBarberos;
  }
}
