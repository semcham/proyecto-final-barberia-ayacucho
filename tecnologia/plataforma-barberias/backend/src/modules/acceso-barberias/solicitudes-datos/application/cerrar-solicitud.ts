import { Injectable } from '@nestjs/common';
import { AuditLog, TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { SolicitudNoEncontrada } from '../domain/errores';
import { aVistaEnBandeja, ContextoSolicitudes, recursoAuditado, type VistaSolicitudEnBandeja } from './comun';
import { SolicitudesRepository } from './ports/solicitudes-repository';

export interface DatosCierre {
  resultado: 'ATENDIDA' | 'RECHAZADA';
  respuesta?: string | null;
  motivo?: string | null;
}

/**
 * T012 de 007 · POST /datos-personales/solicitudes/{id}/cierre (FR-004, FR-007, FR-008): el propietario la atiende
 * (con la respuesta: qué hizo a mano y qué se conserva) o la rechaza (con el motivo). El sistema NO borra, corrige ni
 * exporta ningún dato: solo registra la respuesta. Se audita sin el texto.
 */
@Injectable()
export class CerrarSolicitud {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly solicitudes: SolicitudesRepository,
    private readonly contexto: ContextoSolicitudes,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, id: string, datos: DatosCierre): Promise<VistaSolicitudEnBandeja> {
    await this.autorizacion.exigir(actor, 'ATENDER_SOLICITUDES_DATOS');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const solicitud = await this.solicitudes.paraActualizar(id);
      if (!solicitud) throw new SolicitudNoEncontrada();
      const ahora = this.contexto.ahora();
      if (datos.resultado === 'ATENDIDA') solicitud.atender(datos.respuesta, actor.usuarioId, ahora);
      else solicitud.rechazar(datos.motivo, actor.usuarioId, ahora);
      await this.solicitudes.guardarTransicion(solicitud);
      await this.auditoria.registrar({
        accion: datos.resultado === 'ATENDIDA' ? 'SOLICITUD_DATOS_ATENDIDA' : 'SOLICITUD_DATOS_RECHAZADA',
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
