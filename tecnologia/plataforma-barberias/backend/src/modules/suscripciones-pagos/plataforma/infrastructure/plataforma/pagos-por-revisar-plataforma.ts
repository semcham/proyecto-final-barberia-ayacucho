import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';
import {
  MARCAS_POR_REVISAR,
  type MarcaPorRevisar,
  type PagoPorRevisar,
  PagosPorRevisarLectura,
} from '../../application/ports/pagos-por-revisar';

/** Tope de cada parte de la lista en una lectura. */
const MAXIMO = 500;

/**
 * T090 · Casos por revisar de todas las barberías (FR-025a), con el rol de solo lectura de la plataforma:
 * - pagos con una marca de la lista (duplicado, importe distinto, aprobado tras rechazo, devolución) sin
 *   resolver; se detectaron cuando llegó el evento del proveedor que los marcó (o, si no hay, al aprobarse o
 *   cerrarse);
 * - notificaciones de pagos desconocidos (SIN_PAGO) recibidas desde `desdeSinPago`: no tienen barbería ni
 *   pago, y quedan en provider_event, que el rol de la aplicación no puede modificar (C1).
 * Del más antiguo al más reciente.
 */
@Injectable()
export class PagosPorRevisarPlataforma extends PagosPorRevisarLectura {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  pendientes(desdeSinPago: Date): Promise<PagoPorRevisar[]> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const pagos = await trx
        .selectFrom('payment as p')
        .innerJoin('tenant as t', 't.id', 'p.tenant_id')
        .select([
          'p.id',
          'p.tenant_id',
          't.name as barberia',
          'p.review',
          'p.amount_cents',
          sql<Date>`coalesce(
            (select max(e.received_at) from provider_event e where e.payment_id = p.id and e.effect = 'REVISION'),
            p.approved_at, p.closed_at, p.created_at)`.as('detectado'),
        ])
        .where('p.review', 'in', [...MARCAS_POR_REVISAR])
        .where('p.review_resolved_at', 'is', null)
        .limit(MAXIMO)
        .execute();
      const sinPago = await trx
        .selectFrom('provider_event')
        .select(['event_id', 'amount_cents', 'received_at'])
        .where('effect', '=', 'SIN_PAGO')
        .where('received_at', '>=', desdeSinPago)
        .orderBy('received_at')
        .limit(MAXIMO)
        .execute();

      const casos: PagoPorRevisar[] = [
        ...pagos.map((f) => ({
          marca: f.review as MarcaPorRevisar,
          barberia: { id: f.tenant_id, nombre: f.barberia },
          pagoId: f.id,
          eventoId: null,
          importeCentimos: f.amount_cents,
          detectadoEn: f.detectado,
        })),
        ...sinPago.map((f) => ({
          marca: 'SIN_PAGO' as const,
          barberia: null,
          pagoId: null,
          eventoId: f.event_id,
          importeCentimos: f.amount_cents,
          detectadoEn: f.received_at,
        })),
      ];
      return casos.sort((a, b) => a.detectadoEn.getTime() - b.detectadoEn.getTime());
    });
  }
}
