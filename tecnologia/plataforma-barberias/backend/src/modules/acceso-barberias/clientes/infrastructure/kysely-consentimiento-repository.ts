import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { ConsentimientoRepository } from '../application/ports/consentimiento-repository';
import type { Consentimiento } from '../domain/consentimiento';

/** T084 · Consentimientos en la transacción en curso, con el tenant del contexto (RLS y filtro explícito). */
@Injectable()
export class KyselyConsentimientoRepository extends ConsentimientoRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async registrar(clienteId: string, consentimiento: Consentimiento, ip: string | null): Promise<void> {
    await this.uow
      .transaccionActual()
      .insertInto('consent_record')
      .values({
        id: uuidv7(),
        tenant_id: this.tenantContext.actual().valor,
        customer_id: clienteId,
        document: 'POLITICA_DATOS',
        text_version: consentimiento.version,
        method: consentimiento.metodo,
        recorded_by: consentimiento.registradoPor,
        ip,
        accepted_at: new Date(),
      })
      .execute();
  }
}
