import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { SuscripcionRepository } from '../application/ports/suscripcion-repository';
import { Plan } from '../domain/plan';
import type { Suscripcion } from '../domain/suscripcion';

/** Participa en la transacción en curso de UnitOfWork (la del registro de la barbería, por ejemplo). */
@Injectable()
export class KyselySuscripcionRepository extends SuscripcionRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async planPorCodigo(codigo: string): Promise<Plan> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('plan')
      .select(['id', 'code', 'trial_days', 'max_users'])
      .where('code', '=', codigo)
      .executeTakeFirst();
    if (!fila) throw new Error(`No existe el plan ${codigo}`);
    return Plan.reconstruir({
      id: fila.id,
      codigo: fila.code,
      diasPrueba: fila.trial_days,
      maxUsuarios: fila.max_users,
    });
  }

  async crear(suscripcion: Suscripcion): Promise<void> {
    await this.uow
      .transaccionActual()
      .insertInto('subscription')
      .values({
        id: suscripcion.id,
        tenant_id: this.tenantContext.actual().valor,
        plan_id: suscripcion.planId,
        status: suscripcion.estado,
        started_at: suscripcion.iniciaEn,
        trial_ends_at: suscripcion.vencePruebaEn,
      })
      .execute();
  }

  async planDelTenant(): Promise<Plan | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('subscription')
      .innerJoin('plan', 'plan.id', 'subscription.plan_id')
      .select(['plan.id', 'plan.code', 'plan.trial_days', 'plan.max_users'])
      .where('subscription.tenant_id', '=', this.tenantContext.actual().valor)
      .executeTakeFirst();
    return fila
      ? Plan.reconstruir({
          id: fila.id,
          codigo: fila.code,
          diasPrueba: fila.trial_days,
          maxUsuarios: fila.max_users,
        })
      : null;
  }
}
