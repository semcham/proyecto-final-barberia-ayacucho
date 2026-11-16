import { Injectable } from '@nestjs/common';
import { TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { aVista, ContextoSolicitudes, type VistaSolicitud } from './comun';
import { SolicitudesRepository } from './ports/solicitudes-repository';

/**
 * T012 de 007 · GET /datos-personales/solicitudes/mias (FR-006): las solicitudes del titular de la sesión en la
 * barbería del token, con su estado, plazo y respuesta. Nunca las de otra persona.
 */
@Injectable()
export class MisSolicitudes {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly solicitudes: SolicitudesRepository,
    private readonly contexto: ContextoSolicitudes,
  ) {}

  async ejecutar(actor: Actor): Promise<VistaSolicitud[]> {
    await this.autorizacion.exigir(actor, 'VER_MIS_SOLICITUDES_DATOS');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const titular = await this.contexto.titularDe(actor);
      const hoy = await this.contexto.hoy();
      return (await this.solicitudes.delTitular(titular)).map((s) => aVista(s, hoy));
    });
  }
}
