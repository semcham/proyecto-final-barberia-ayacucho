import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { detectarTipoComprobante } from '../../pagos/domain/tipo-de-archivo';
import { type ArchivoAdelanto, ArchivosAdelanto } from '../application/ports/archivos-adelanto';

/**
 * T016 de 008 · Archivos del adelanto en PostgreSQL (booking_deposit_file, como payment_receipt_file de 003 y
 * ADR-023): contenido `bytea` con su tipo verificado por los bytes, tamaño y SHA-256, en la barbería del contexto y
 * con RLS. Ninguna URL pública; el rol de la plataforma no lee esta tabla.
 */
@Injectable()
export class ArchivosAdelantoPostgres extends ArchivosAdelanto {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private tenant(): string {
    return this.tenantContext.actual().valor;
  }

  async guardar(nuevo: {
    id: string;
    clase: 'QR' | 'CAPTURA';
    contenido: Buffer;
    por: string;
  }): Promise<string> {
    // Segunda barrera: el caso de uso ya lo verificó; aquí no se guarda nada que no sea JPEG, PNG o PDF.
    const tipo = detectarTipoComprobante(nuevo.contenido);
    if (!tipo) throw new Error('Se intentó guardar un archivo del adelanto sin un tipo verificado');
    await this.uow
      .transaccionActual()
      .insertInto('booking_deposit_file')
      .values({
        id: nuevo.id,
        tenant_id: this.tenant(),
        kind: nuevo.clase,
        content_type: tipo,
        size_bytes: nuevo.contenido.length,
        sha256: createHash('sha256').update(nuevo.contenido).digest('hex'),
        content: nuevo.contenido,
        created_by: nuevo.por,
      })
      .execute();
    return nuevo.id;
  }

  async leer(id: string): Promise<ArchivoAdelanto | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('booking_deposit_file')
      .select(['id', 'kind', 'content_type', 'content'])
      .where('tenant_id', '=', this.tenant())
      .where('id', '=', id)
      .executeTakeFirst();
    return fila ? { id: fila.id, clase: fila.kind, tipo: fila.content_type, contenido: fila.content } : null;
  }
}
