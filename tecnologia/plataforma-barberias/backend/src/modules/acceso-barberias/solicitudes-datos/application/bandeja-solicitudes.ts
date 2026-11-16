import { Injectable } from '@nestjs/common';
import { TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { aVistaEnBandeja, ContextoSolicitudes, type VistaSolicitudEnBandeja } from './comun';
import { type FiltroBandeja, SolicitudesRepository } from './ports/solicitudes-repository';

/**
 * T012 de 007 · GET /datos-personales/solicitudes (FR-005, FR-006): la bandeja del propietario, solo de su barbería,
 * con el titular, el plazo y si está vencida. Por defecto, las abiertas.
 */
@Injectable()
export class BandejaSolicitudes {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly solicitudes: SolicitudesRepository,
    private readonly contexto: ContextoSolicitudes,
  ) {}

  async ejecutar(actor: Actor, filtro: FiltroBandeja = 'ABIERTAS'): Promise<VistaSolicitudEnBandeja[]> {
    await this.autorizacion.exigir(actor, 'ATENDER_SOLICITUDES_DATOS');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const hoy = await this.contexto.hoy();
      return (await this.solicitudes.bandeja(filtro)).map((s) => aVistaEnBandeja(s, hoy));
    });
  }
}
