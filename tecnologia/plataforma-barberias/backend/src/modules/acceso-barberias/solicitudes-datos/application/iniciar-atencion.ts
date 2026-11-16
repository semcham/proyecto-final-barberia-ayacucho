import { Injectable } from '@nestjs/common';
import { AuditLog, TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { SolicitudNoEncontrada } from '../domain/errores';
import { aVistaEnBandeja, ContextoSolicitudes, recursoAuditado, type VistaSolicitudEnBandeja } from './comun';
import { SolicitudesRepository } from './ports/solicitudes-repository';

/**
 * T012 de 007 · POST /datos-personales/solicitudes/{id}/atencion: el propietario pasa una RECIBIDA a EN_ATENCION, con
 * la fila bloqueada, y lo audita sin texto. La de otra barbería responde 404, igual que una que no existe.
 */
@Injectable()
export class IniciarAtencion {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly solicitudes: SolicitudesRepository,
    private readonly contexto: ContextoSolicitudes,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, id: string): Promise<VistaSolicitudEnBandeja> {
    await this.autorizacion.exigir(actor, 'ATENDER_SOLICITUDES_DATOS');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const solicitud = await this.solicitudes.paraActualizar(id);
      if (!solicitud) throw new SolicitudNoEncontrada();
      const ahora = this.contexto.ahora();
      solicitud.iniciarAtencion(ahora);
      await this.solicitudes.guardarTransicion(solicitud);
      await this.auditoria.registrar({
        accion: 'SOLICITUD_DATOS_EN_ATENCION',
        actorId: actor.usuarioId,
        recurso: recursoAuditado(solicitud),
        resultado: 'PERMITIDO',
      });
      const conTitular = await this.solicitudes.conTitular(id);
      if (!conTitular) throw new SolicitudNoEncontrada();
      return aVistaEnBandeja(conTitular, await this.contexto.hoy(ahora));
    });
  }
}
