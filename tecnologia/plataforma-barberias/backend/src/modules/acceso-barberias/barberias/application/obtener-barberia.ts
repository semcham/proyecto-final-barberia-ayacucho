import { Injectable } from '@nestjs/common';
import { TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { type ConfiguracionBarberia, TenantRepository } from './ports/tenant-repository';

/** T050 · Datos, enlace y antelación de la barbería del token (RF03; PROPIETARIO y BARBERO). */
@Injectable()
export class ObtenerBarberia {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly tenants: TenantRepository,
  ) {}

  async ejecutar(actor: Actor): Promise<ConfiguracionBarberia> {
    await this.autorizacion.exigir(actor, 'VER_BARBERIA');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const configuracion = await this.tenants.configuracion(actor.tenantId);
      if (!configuracion) throw new Error('La barbería del token no existe');
      return configuracion;
    });
  }
}
