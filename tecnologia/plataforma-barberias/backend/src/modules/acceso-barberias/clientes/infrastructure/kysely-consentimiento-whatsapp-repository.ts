import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { ConsentimientoWhatsappRepository } from '../application/ports/consentimiento-whatsapp-repository';
import type { ConsentimientoVigente } from '../domain/consentimiento-whatsapp';

/**
 * T117 de 004 · `whatsapp_consent` en la transacción en curso, filtrada además por el tenant. Solo INSERT y
 * UPDATE (withdrawn_at): la evidencia del consentimiento se conserva.
 */
@Injectable()
export class KyselyConsentimientoWhatsappRepository extends ConsentimientoWhatsappRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async vigente(clienteId: string): Promise<ConsentimientoVigente | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('whatsapp_consent')
      .select(['id', 'number', 'text_version', 'accepted_at'])
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('customer_id', '=', clienteId)
      .where('withdrawn_at', 'is', null)
      .executeTakeFirst();
    return fila
      ? { id: fila.id, numero: fila.number, version: fila.text_version, aceptadoEn: fila.accepted_at }
      : null;
  }

  async registrar(
    clienteId: string,
    consentimiento: { id: string; numero: string; version: string; en: Date },
  ): Promise<void> {
    await this.uow
      .transaccionActual()
      .insertInto('whatsapp_consent')
      .values({
        id: consentimiento.id,
        tenant_id: this.tenantContext.actual().valor,
        customer_id: clienteId,
        number: consentimiento.numero,
        text_version: consentimiento.version,
        accepted_at: consentimiento.en,
      })
      .execute();
  }

  async retirar(id: string, en: Date): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('whatsapp_consent')
      .set({ withdrawn_at: en })
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', id)
      .where('withdrawn_at', 'is', null)
      .execute();
  }
}
