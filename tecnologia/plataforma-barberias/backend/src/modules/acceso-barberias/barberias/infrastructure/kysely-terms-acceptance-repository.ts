import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { type DatosSolicitud, KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { TermsAcceptanceRepository } from '../application/ports/terms-acceptance-repository';
import type { AceptacionTerminos } from '../domain/aceptacion-terminos';

@Injectable()
export class KyselyTermsAcceptanceRepository extends TermsAcceptanceRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async registrar(
    usuarioId: string,
    aceptacion: AceptacionTerminos,
    solicitud: DatosSolicitud,
  ): Promise<void> {
    await this.uow
      .transaccionActual()
      .insertInto('terms_acceptance')
      .values({
        id: uuidv7(),
        tenant_id: this.tenantContext.actual().valor,
        user_id: usuarioId,
        document: aceptacion.documento,
        text_version: aceptacion.version,
        ip: solicitud.ip ?? null,
      })
      .execute();
  }
}
