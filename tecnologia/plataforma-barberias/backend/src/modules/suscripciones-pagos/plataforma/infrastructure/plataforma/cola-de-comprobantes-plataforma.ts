import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';
import {
  type ComprobantePorRevisar,
  ColaDeComprobantesLectura,
} from '../../application/ports/cola-de-comprobantes';

/** Tope de la cola en una lectura: el volumen esperado es de unos pocos por día (R09). */
const MAXIMO = 500;

/**
 * T081 · Cola de comprobantes en revisión de todas las barberías, del más antiguo al más reciente, con el rol
 * de solo lectura de la plataforma (ADR-031). Las repeticiones se detectan sin ver el número: por
 * `bank_operation_hash` (el mismo número en otro pago) y por el SHA-256 del archivo (el mismo comprobante
 * subido otra vez).
 */
@Injectable()
export class ColaDeComprobantesPlataforma extends ColaDeComprobantesLectura {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  enRevision(): Promise<ComprobantePorRevisar[]> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const filas = await trx
        .selectFrom('payment as p')
        .innerJoin('tenant as t', 't.id', 'p.tenant_id')
        .innerJoin('plan as pl', 'pl.id', 'p.plan_id')
        .innerJoin('payment_receipt as r', (join) =>
          join
            .onRef('r.payment_id', '=', 'p.id')
            .onRef('r.tenant_id', '=', 'p.tenant_id')
            .on('r.reviewed_at', 'is', null),
        )
        .select([
          'p.id',
          'p.tenant_id',
          't.name as barberia',
          'pl.name as plan',
          'p.amount_cents',
          'p.transfer_reference',
          'p.bank_operation_last4',
          'p.bank_operation_hash',
          sql<string>`to_char(p.transfer_date, 'YYYY-MM-DD')`.as('fecha'),
          'r.sha256',
          'r.uploaded_at',
        ])
        .where('p.status', '=', 'EN_REVISION')
        .orderBy('r.uploaded_at')
        .limit(MAXIMO)
        .execute();
      if (filas.length === 0) return [];

      const hashes = [
        ...new Set(filas.map((f) => f.bank_operation_hash).filter((h): h is string => h !== null)),
      ];
      const archivos = [...new Set(filas.map((f) => f.sha256))];
      const conNumero = hashes.length
        ? await trx
            .selectFrom('payment')
            .select(['id', 'bank_operation_hash'])
            .where('bank_operation_hash', 'in', hashes)
            .execute()
        : [];
      const conArchivo = await trx
        .selectFrom('payment_receipt')
        .select(['payment_id', 'sha256'])
        .where('sha256', 'in', archivos)
        .execute();

      return filas.map((f) => {
        const mismoNumero = conNumero.filter(
          (o) => o.bank_operation_hash === f.bank_operation_hash && o.id !== f.id,
        );
        const mismoArchivo = conArchivo.filter((o) => o.sha256 === f.sha256 && o.payment_id !== f.id);
        return {
          barberia: { id: f.tenant_id, nombre: f.barberia },
          pago: {
            id: f.id,
            plan: f.plan,
            importeCentimos: f.amount_cents,
            referencia: f.transfer_reference ?? '',
            numeroOperacionFinal: f.bank_operation_last4 ?? '',
            numeroRepetido: mismoNumero.length > 0,
            fechaTransferencia: f.fecha,
            numeroYaUsadoEn: [
              ...new Set([...mismoNumero.map((o) => o.id), ...mismoArchivo.map((o) => o.payment_id)]),
            ],
          },
          enviadoEn: f.uploaded_at,
        };
      });
    });
  }
}
