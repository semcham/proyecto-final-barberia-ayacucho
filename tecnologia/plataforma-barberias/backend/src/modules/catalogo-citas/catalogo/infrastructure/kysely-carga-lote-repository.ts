import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import {
  type CargaGuardada,
  CargaLoteRepository,
  ClaveDeCargaEnUso,
} from '../application/ports/catalogo-repositorios';

// T013 de 011 · Cargas en lote guardadas (catalog_batch, migración 0037). En la transacción del caso de uso, con el
// tenant del token fijado (RLS) y filtrando además por el tenant del contexto (principio III).

const VIOLACION_DE_UNICIDAD = '23505';

@Injectable()
export class KyselyCargaLoteRepository extends CargaLoteRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private get tx() {
    return this.uow.transaccionActual();
  }

  private get tenantId(): string {
    return this.tenantContext.actual().valor;
  }

  async buscar(autorId: string, clave: string): Promise<CargaGuardada | null> {
    const fila = await this.tx
      .selectFrom('catalog_batch')
      .select(['id', 'author_user_id', 'idempotency_key', 'kind', 'rows_digest', 'created_ids'])
      .where('tenant_id', '=', this.tenantId)
      .where('author_user_id', '=', autorId)
      .where('idempotency_key', '=', clave)
      .executeTakeFirst();
    if (!fila) return null;
    return {
      id: fila.id,
      autorId: fila.author_user_id,
      clave: fila.idempotency_key,
      tipo: fila.kind,
      huella: fila.rows_digest,
      ids: fila.created_ids,
    };
  }

  async guardar(carga: CargaGuardada): Promise<void> {
    try {
      await this.tx
        .insertInto('catalog_batch')
        .values({
          id: carga.id,
          tenant_id: this.tenantId,
          author_user_id: carga.autorId,
          idempotency_key: carga.clave,
          kind: carga.tipo,
          rows_digest: carga.huella,
          created_count: carga.ids.length,
          created_ids: carga.ids,
        })
        .execute();
    } catch (error) {
      const pg = error as { code?: string; constraint?: string };
      if (pg.code === VIOLACION_DE_UNICIDAD && pg.constraint === 'catalog_batch_idempotencia') {
        throw new ClaveDeCargaEnUso();
      }
      throw error;
    }
  }
}
