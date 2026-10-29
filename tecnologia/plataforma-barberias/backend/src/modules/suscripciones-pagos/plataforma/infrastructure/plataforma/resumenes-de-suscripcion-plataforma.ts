import { Injectable } from '@nestjs/common';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';
import {
  type ResumenDeSuscripcion,
  ResumenesDeSuscripcionLectura,
} from '../../application/ports/resumenes-de-suscripcion';

/** T096 · Estado, plan y cobertura de las suscripciones de una página de barberías, en una sola consulta. */
@Injectable()
export class ResumenesDeSuscripcionPlataforma extends ResumenesDeSuscripcionLectura {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  async deBarberias(tenantIds: readonly string[]): Promise<Map<string, ResumenDeSuscripcion>> {
    if (tenantIds.length === 0) return new Map();
    return this.lectura.ejecutarLectura(async (trx) => {
      const filas = await trx
        .selectFrom('subscription as s')
        .innerJoin('plan as p', 'p.id', 's.plan_id')
        .select(['s.tenant_id', 's.status', 'p.name', 's.current_period_end'])
        .where('s.tenant_id', 'in', [...tenantIds])
        .execute();
      return new Map(
        filas.map((f) => [
          f.tenant_id,
          { estado: f.status, plan: f.name, finCobertura: f.current_period_end },
        ]),
      );
    });
  }
}
