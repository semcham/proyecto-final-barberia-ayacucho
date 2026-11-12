import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { PreferenciaAvisoRepository } from '../application/ports/preferencia-aviso-repository';
import type { PreferenciaAviso } from '../domain/preferencia-aviso';

/** T117 de 004 · `customer_notification_preference` en la transacción en curso, filtrada además por el tenant. */
@Injectable()
export class KyselyPreferenciaAvisoRepository extends PreferenciaAvisoRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async obtener(clienteId: string): Promise<PreferenciaAviso | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('customer_notification_preference')
      .select(['channel', 'whatsapp_number'])
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('customer_id', '=', clienteId)
      .executeTakeFirst();
    return fila ? { canal: fila.channel, numero: fila.whatsapp_number } : null;
  }

  async guardar(clienteId: string, preferencia: PreferenciaAviso): Promise<void> {
    const ahora = new Date();
    await this.uow
      .transaccionActual()
      .insertInto('customer_notification_preference')
      .values({
        tenant_id: this.tenantContext.actual().valor,
        customer_id: clienteId,
        channel: preferencia.canal,
        whatsapp_number: preferencia.numero,
        updated_at: ahora,
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'customer_id']).doUpdateSet({
          channel: preferencia.canal,
          whatsapp_number: preferencia.numero,
          updated_at: ahora,
        }),
      )
      .execute();
  }
}
