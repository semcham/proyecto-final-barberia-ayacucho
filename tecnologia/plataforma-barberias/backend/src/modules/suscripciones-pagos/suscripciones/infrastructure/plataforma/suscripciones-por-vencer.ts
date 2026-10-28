import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';
import {
  type SuscripcionPorVencer,
  SuscripcionesPorVencer,
} from '../../application/ports/suscripciones-por-vencer';

/**
 * T058 · Suscripciones con una transición automática pendiente, con el rol de solo lectura de la plataforma
 * (ADR-031). Es solo una preselección: la decisión la toma el dominio (siguientePaso) con la suscripción ya
 * bloqueada en su barbería, así que una fila de más no cambia nada y una que cambió mientras tanto se salta.
 */
@Injectable()
export class SuscripcionesPorVencerPlataforma extends SuscripcionesPorVencer {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  pendientes(ahora: Date, despuesDe: string | null, limite: number): Promise<SuscripcionPorVencer[]> {
    return this.lectura.ejecutarLectura(async (trx) => {
      let consulta = trx
        .selectFrom('subscription as s')
        .select(['s.tenant_id', 's.id'])
        .where('s.status', 'in', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED'])
        .where((eb) =>
          eb.or([
            eb.and([eb('s.status', '=', 'TRIAL'), eb('s.trial_ends_at', '<=', ahora)]),
            eb.and([eb('s.status', '=', 'ACTIVE'), eb('s.current_period_end', '<=', ahora)]),
            eb.and([eb('s.status', '=', 'PAST_DUE'), eb('s.grace_ends_at', '<=', ahora)]),
            // Un período pagado que cubre el instante: activa una vencida o en gracia, o cambia el plan.
            eb.exists(
              eb
                .selectFrom('subscription_period as p')
                .select(sql`1`.as('uno'))
                .whereRef('p.subscription_id', '=', 's.id')
                .where('p.starts_at', '<=', ahora)
                .where('p.ends_at', '>', ahora)
                .where((e) =>
                  e.or([
                    e('s.status', 'in', ['PAST_DUE', 'EXPIRED']),
                    e('p.plan_id', '<>', e.ref('s.plan_id')),
                  ]),
                ),
            ),
          ]),
        )
        .orderBy('s.id')
        .limit(limite);
      if (despuesDe) consulta = consulta.where('s.id', '>', despuesDe);
      const filas = await consulta.execute();
      return filas.map((f) => ({ tenantId: f.tenant_id, suscripcionId: f.id }));
    });
  }
}
