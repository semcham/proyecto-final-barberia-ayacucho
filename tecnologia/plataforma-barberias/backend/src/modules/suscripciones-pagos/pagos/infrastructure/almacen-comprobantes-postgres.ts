import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import {
  AlmacenComprobantes,
  type Comprobante,
  ComprobanteEnRevisionExistente,
  type ComprobanteNuevo,
} from '../application/ports/almacen-comprobantes';
import { COMPROBANTES_POR_DIA } from '../domain/transferencia';

interface FilaComprobante {
  id: string;
  payment_id: string;
  content_type: Comprobante['tipo'];
  size_bytes: number;
  sha256: string;
  uploaded_by: string;
  uploaded_at: Date;
  reviewed_at: Date | null;
  review_result: Comprobante['resultado'];
}

function aComprobante(f: FilaComprobante): Comprobante {
  return {
    id: f.id,
    pagoId: f.payment_id,
    tipo: f.content_type,
    tamanoBytes: f.size_bytes,
    sha256: f.sha256,
    subidoPor: f.uploaded_by,
    subidoEn: f.uploaded_at,
    revisadoEn: f.reviewed_at,
    resultado: f.review_result,
  };
}

const COLUMNAS = [
  'id',
  'payment_id',
  'content_type',
  'size_bytes',
  'sha256',
  'uploaded_by',
  'uploaded_at',
  'reviewed_at',
  'review_result',
] as const;

/**
 * T079 · Comprobantes en PostgreSQL (ADR-023): metadatos en payment_receipt y contenido `bytea` en
 * payment_receipt_file, las dos con RLS y filtro explícito por tenant. El rol de la plataforma no tiene
 * SELECT sobre payment_receipt_file: el contenido solo se lee con el tenant de la barbería fijado.
 */
@Injectable()
export class AlmacenComprobantesPostgres extends AlmacenComprobantes {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private tenant(): string {
    return this.tenantContext.actual().valor;
  }

  async guardar(nuevo: ComprobanteNuevo): Promise<Comprobante> {
    const trx = this.uow.transaccionActual();
    const sha256 = createHash('sha256').update(nuevo.contenido).digest('hex');
    let fila;
    try {
      fila = await trx
        .insertInto('payment_receipt')
        .values({
          id: nuevo.id,
          tenant_id: this.tenant(),
          payment_id: nuevo.pagoId,
          content_type: nuevo.tipo,
          size_bytes: nuevo.contenido.length,
          sha256,
          uploaded_by: nuevo.subidoPor,
        })
        .returning(COLUMNAS)
        .executeTakeFirstOrThrow();
    } catch (error) {
      const { code, constraint } = (error ?? {}) as { code?: string; constraint?: string };
      if (code === '23505' && constraint === 'payment_receipt_uno_en_revision') {
        throw new ComprobanteEnRevisionExistente();
      }
      throw error;
    }
    await trx
      .insertInto('payment_receipt_file')
      .values({ tenant_id: this.tenant(), receipt_id: nuevo.id, content: nuevo.contenido })
      .execute();
    return aComprobante(fila);
  }

  async ultimoDe(pagoId: string): Promise<Comprobante | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('payment_receipt')
      .select(COLUMNAS)
      .where('tenant_id', '=', this.tenant())
      .where('payment_id', '=', pagoId)
      .orderBy('uploaded_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    return fila ? aComprobante(fila) : null;
  }

  async contenido(comprobanteId: string): Promise<Buffer | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('payment_receipt_file')
      .select('content')
      .where('tenant_id', '=', this.tenant())
      .where('receipt_id', '=', comprobanteId)
      .executeTakeFirst();
    return fila?.content ?? null;
  }

  async marcarRevisado(
    comprobanteId: string,
    revision: { por: string; en: Date; resultado: 'APROBADO' | 'RECHAZADO'; motivo: string | null },
  ): Promise<boolean> {
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('payment_receipt')
      .set({
        reviewed_by: revision.por,
        reviewed_at: revision.en,
        review_result: revision.resultado,
        review_reason: revision.motivo,
      })
      .where('tenant_id', '=', this.tenant())
      .where('id', '=', comprobanteId)
      .where('reviewed_at', 'is', null)
      .executeTakeFirst();
    return Number(resultado.numUpdatedRows) === 1;
  }

  async consumirCupoDiario(dia: string): Promise<boolean> {
    // Un solo UPDATE condicional: dos subidas simultáneas no superan el máximo (y el CHECK de 0 a 5 es la
    // última barrera).
    const { rows } = await sql<{ count: number }>`
      insert into receipt_upload_counter (tenant_id, day, count) values (${this.tenant()}, ${dia}, 1)
      on conflict (tenant_id, day) do update set count = receipt_upload_counter.count + 1
        where receipt_upload_counter.count < ${COMPROBANTES_POR_DIA}
      returning count
    `.execute(this.uow.transaccionActual());
    return rows.length === 1;
  }
}
