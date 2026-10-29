import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import {
  type PeriodoNuevo,
  type ResultadoDeReactivar,
  SuscripcionRepository,
} from '../application/ports/suscripcion-repository';
import { PeriodoYaCubierto } from '../domain/errores';
import type { PasoDeSuscripcion } from '../domain/estado-suscripcion';
import type { Periodo } from '../domain/periodo';
import { Plan } from '../domain/plan';
import { type EstadoSuscripcion, Suscripcion } from '../domain/suscripcion';

/** Restricciones de la base que significan "el período ya está cubierto" (migración 0015). */
const RESTRICCIONES_DE_COBERTURA = new Set([
  'subscription_period_sin_solape',
  'subscription_period_un_periodo_por_pago',
]);

const COLUMNAS_PLAN = [
  'plan.id',
  'plan.code',
  'plan.name',
  'plan.trial_days',
  'plan.max_users',
  'plan.max_barbers',
  'plan.price_cents',
  'plan.currency',
  'plan.active',
  'plan.public',
] as const;

interface FilaPlan {
  id: string;
  code: string;
  name: string;
  trial_days: number | null;
  max_users: number;
  max_barbers: number;
  price_cents: number | null;
  currency: string;
  active: boolean;
  public: boolean;
}

function aPlan(fila: FilaPlan): Plan {
  return Plan.reconstruir({
    id: fila.id,
    codigo: fila.code,
    nombre: fila.name,
    diasPrueba: fila.trial_days,
    maxUsuarios: fila.max_users,
    maxBarberos: fila.max_barbers,
    precioCentimos: fila.price_cents,
    moneda: fila.currency,
    activo: fila.active,
    publico: fila.public,
  });
}

function restriccionViolada(error: unknown): string | null {
  const { code, constraint } = (error ?? {}) as { code?: string; constraint?: string };
  return (code === '23P01' || code === '23505') && constraint ? constraint : null;
}

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
      .select(COLUMNAS_PLAN)
      .where('code', '=', codigo)
      .executeTakeFirst();
    if (!fila) throw new Error(`No existe el plan ${codigo}`);
    return aPlan(fila);
  }

  async planPorId(id: string): Promise<Plan | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('plan')
      .select(COLUMNAS_PLAN)
      .where('id', '=', id)
      .executeTakeFirst();
    return fila ? aPlan(fila) : null;
  }

  async planesContratables(): Promise<Plan[]> {
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('plan')
      .select(COLUMNAS_PLAN)
      .where('active', '=', true)
      .where('public', '=', true)
      .where('price_cents', 'is not', null)
      .orderBy('price_cents')
      .execute();
    return filas.map(aPlan);
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
        // Copia derivada de la cobertura (M2): sin períodos, el fin de la prueba.
        current_period_end: suscripcion.finCobertura,
      })
      .execute();
  }

  async planDelTenant(opciones: { bloquear?: boolean } = {}): Promise<Plan | null> {
    let consulta = this.uow
      .transaccionActual()
      .selectFrom('subscription')
      .innerJoin('plan', 'plan.id', 'subscription.plan_id')
      .select(COLUMNAS_PLAN)
      .where('subscription.tenant_id', '=', this.tenantContext.actual().valor);
    // Solo se bloquea la fila de la suscripción (no el catálogo de planes), hasta que termine la transacción.
    if (opciones.bloquear) consulta = consulta.forUpdate('subscription');
    const fila = await consulta.executeTakeFirst();
    return fila ? aPlan(fila) : null;
  }

  async suscripcionDelTenant(
    opciones: { bloquear?: boolean; saltarSiBloqueada?: boolean } = {},
  ): Promise<Suscripcion | null> {
    let consulta = this.uow
      .transaccionActual()
      .selectFrom('subscription')
      .select([
        'id',
        'tenant_id',
        'plan_id',
        'status',
        'started_at',
        'trial_ends_at',
        'current_period_end',
        'grace_ends_at',
        'suspended_at',
        'suspension_reason',
      ])
      .where('tenant_id', '=', this.tenantContext.actual().valor);
    // Solo la fila de la suscripción, hasta que termine la transacción.
    if (opciones.bloquear) consulta = consulta.forUpdate('subscription');
    // SKIP LOCKED: si otra transacción la tiene (una aprobación en curso, otra réplica), no espera.
    if (opciones.bloquear && opciones.saltarSiBloqueada) consulta = consulta.skipLocked();
    const fila = await consulta.executeTakeFirst();
    return fila
      ? Suscripcion.reconstruir({
          id: fila.id,
          tenantId: fila.tenant_id,
          planId: fila.plan_id,
          estado: fila.status,
          iniciaEn: fila.started_at,
          vencePruebaEn: fila.trial_ends_at,
          finCobertura: fila.current_period_end,
          graciaHasta: fila.grace_ends_at,
          suspendidaEn: fila.suspended_at,
          motivoSuspension: fila.suspension_reason,
        })
      : null;
  }

  async periodos(suscripcionId: string): Promise<Periodo[]> {
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('subscription_period')
      .select(['id', 'payment_id', 'plan_id', 'starts_at', 'ends_at'])
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('subscription_id', '=', suscripcionId)
      .orderBy('starts_at')
      .execute();
    return filas.map((f) => ({
      id: f.id,
      pagoId: f.payment_id,
      planId: f.plan_id,
      inicio: f.starts_at,
      fin: f.ends_at,
    }));
  }

  async insertarPeriodo(periodo: PeriodoNuevo): Promise<void> {
    const trx = this.uow.transaccionActual();
    const tenantId = this.tenantContext.actual().valor;
    // Un punto de guardado: si la base rechaza el período, la transacción del llamador sigue viva para
    // dejar el pago como DUPLICADO.
    await sql`savepoint periodo_nuevo`.execute(trx);
    try {
      await trx
        .insertInto('subscription_period')
        .values({
          id: periodo.id,
          tenant_id: tenantId,
          subscription_id: periodo.suscripcionId,
          payment_id: periodo.pagoId,
          plan_id: periodo.planId,
          starts_at: periodo.inicio,
          ends_at: periodo.fin,
        })
        .execute();
    } catch (error) {
      await sql`rollback to savepoint periodo_nuevo`.execute(trx);
      const restriccion = restriccionViolada(error);
      if (restriccion && RESTRICCIONES_DE_COBERTURA.has(restriccion)) throw new PeriodoYaCubierto();
      throw error;
    }
    await sql`release savepoint periodo_nuevo`.execute(trx);
    // Copia derivada en la misma transacción (M2): la misma cuenta que coberturaHasta() del dominio.
    await trx
      .updateTable('subscription')
      .set({
        current_period_end: sql<Date>`greatest(trial_ends_at, (
          SELECT max(sp.ends_at) FROM subscription_period sp
           WHERE sp.tenant_id = subscription.tenant_id AND sp.subscription_id = subscription.id))`,
        updated_at: sql<Date>`now()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', periodo.suscripcionId)
      .execute();
  }

  async aplicarPaso(suscripcionId: string, paso: PasoDeSuscripcion): Promise<boolean> {
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('subscription')
      .set({
        status: paso.hacia,
        grace_ends_at: paso.hacia === 'PAST_DUE' ? paso.graciaHasta : null,
        updated_at: sql<Date>`now()`,
        ...(paso.planId ? { plan_id: paso.planId } : {}),
      })
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', suscripcionId)
      .where('status', '=', paso.desde)
      .executeTakeFirst();
    return Number(resultado.numUpdatedRows) === 1;
  }

  async suspender(
    suscripcionId: string,
    desde: EstadoSuscripcion,
    motivo: string,
    ahora: Date,
  ): Promise<boolean> {
    // La gracia deja de contar como estado (subscription_gracia_con_fecha); al reactivar se recalcula.
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('subscription')
      .set({
        status: 'SUSPENDED',
        suspended_at: ahora,
        suspension_reason: motivo,
        grace_ends_at: null,
        updated_at: sql<Date>`now()`,
      })
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', suscripcionId)
      .where('status', '=', desde)
      .executeTakeFirst();
    return Number(resultado.numUpdatedRows) === 1;
  }

  async reactivar(suscripcionId: string, resultado: ResultadoDeReactivar): Promise<boolean> {
    const cambio = await this.uow
      .transaccionActual()
      .updateTable('subscription')
      .set({
        status: resultado.estado,
        suspended_at: null,
        suspension_reason: null,
        grace_ends_at: resultado.estado === 'PAST_DUE' ? resultado.graciaHasta : null,
        updated_at: sql<Date>`now()`,
        ...(resultado.planId ? { plan_id: resultado.planId } : {}),
      })
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', suscripcionId)
      .where('status', '=', 'SUSPENDED')
      .executeTakeFirst();
    return Number(cambio.numUpdatedRows) === 1;
  }
}
