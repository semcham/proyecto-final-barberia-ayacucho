import { Injectable } from '@nestjs/common';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';
import type { CandidatoPorVencer } from '../../../adelantos-api';
import { AdelantosPorVencerLectura } from '../../application/ports/adelantos-por-vencer';

/**
 * T050 de 008 · Candidatos de vencer-adelantos con el rol de solo lectura de la plataforma (ADR-031; data-model §7):
 * usa SOLO las cinco columnas técnicas que ese rol puede leer de booking_deposit (id, tenant_id, status, due_at y
 * review_limit_at), con los dos índices parciales de la migración 0029. Ni la cita, ni el cliente, ni el monto.
 */
@Injectable()
export class AdelantosPorVencerPlataforma extends AdelantosPorVencerLectura {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  candidatos(ahora: Date, lote: number, despuesDe: string | null): Promise<CandidatoPorVencer[]> {
    return this.lectura.ejecutarLectura(async (trx) => {
      let consulta = trx
        .selectFrom('booking_deposit')
        .select(['id', 'tenant_id'])
        .where((eb) =>
          eb.or([
            eb.and([eb('status', '=', 'POR_PAGAR'), eb('due_at', '<=', ahora)]),
            eb.and([eb('status', '=', 'POR_REVISAR'), eb('review_limit_at', '<=', ahora)]),
          ]),
        )
        .orderBy('id')
        .limit(lote);
      if (despuesDe) consulta = consulta.where('id', '>', despuesDe);
      const filas = await consulta.execute();
      return filas.map((f) => ({ tenantId: f.tenant_id, adelantoId: f.id }));
    });
  }
}
