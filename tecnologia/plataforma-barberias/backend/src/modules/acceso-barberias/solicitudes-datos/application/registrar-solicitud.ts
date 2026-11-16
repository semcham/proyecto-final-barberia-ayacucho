import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { SolicitudAbierta } from '../domain/errores';
import { SolicitudDatos, type TipoSolicitud, type Titular } from '../domain/solicitud-datos';
import { aVista, ContextoSolicitudes, recursoAuditado, type VistaSolicitud } from './comun';
import { SolicitudesRepository } from './ports/solicitudes-repository';

export interface DatosNuevaSolicitud {
  tipo: TipoSolicitud;
  detalle?: string | null;
}

/**
 * T012 de 007 · Registra una solicitud nueva y la audita sin texto (FR-001 a FR-004, FR-009, FR-011). Lo comparten el
 * registro por el titular y el registro "en nombre de". NO consulta la política de la suscripción: es un derecho del
 * titular y vale en cualquier estado (spec, Asunciones).
 */
@Injectable()
export class RegistroDeSolicitud {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly solicitudes: SolicitudesRepository,
    private readonly contexto: ContextoSolicitudes,
    private readonly auditoria: AuditLog,
  ) {}

  ejecutar(
    actor: Actor,
    datos: DatosNuevaSolicitud,
    titularDe: () => Promise<Titular>,
    enNombre: boolean,
  ): Promise<VistaSolicitud> {
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const titular = await titularDe();
      const recibidaEn = this.contexto.ahora();
      const hoy = await this.contexto.hoy(recibidaEn);
      const solicitud = SolicitudDatos.registrar({
        id: uuidv7(),
        tenantId: actor.tenantId,
        tipo: datos.tipo,
        titular,
        detalle: datos.detalle ?? null,
        registradaPor: actor.usuarioId,
        enNombre,
        recibidaEn,
        fechaLocal: hoy,
      });
      const existente = await this.solicitudes.abiertaDe(solicitud.tipo, titular);
      if (existente) throw new SolicitudAbierta(existente);
      await this.solicitudes.crear(solicitud);
      await this.auditoria.registrar({
        accion: 'SOLICITUD_DATOS_REGISTRADA',
        actorId: actor.usuarioId,
        recurso: recursoAuditado(solicitud),
        resultado: 'PERMITIDO',
      });
      return aVista(solicitud, hoy);
    });
  }
}

/** POST /datos-personales/solicitudes: el cliente o el barbero, sobre sus propios datos (FR-001, FR-002). */
@Injectable()
export class RegistrarSolicitud {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly registro: RegistroDeSolicitud,
    private readonly contexto: ContextoSolicitudes,
  ) {}

  async ejecutar(actor: Actor, datos: DatosNuevaSolicitud): Promise<VistaSolicitud> {
    await this.autorizacion.exigir(actor, 'REGISTRAR_SOLICITUD_DATOS');
    return this.registro.ejecutar(actor, datos, () => this.contexto.titularDe(actor), false);
  }
}
