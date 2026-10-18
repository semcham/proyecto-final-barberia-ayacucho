import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Configuracion, TenantContext, TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { Correo } from '../../identidad/domain/correo';
import { NombrePersona } from '../../identidad/domain/nombre-persona';
import { Consentimiento } from '../domain/consentimiento';
import { PerfilCliente, Telefono } from '../domain/perfil-cliente';
import { ConsentimientoRepository } from './ports/consentimiento-repository';
import { type ClienteEncontrado, PerfilClienteRepository } from './ports/perfil-cliente-repository';

export interface DatosClientePresencial {
  nombre: string;
  telefono: string;
  correo?: string | null;
  consentimientoVerbal?: boolean;
  versionPoliticaDatos: string;
}

/**
 * T108 · Registrar un cliente presencial sin cuenta (FR-035; R14). Solo el PROPIETARIO. Exige que la
 * persona haya aceptado verbalmente la política de datos vigente: queda un consentimiento PRESENCIAL con
 * quién lo anotó (FR-024). El perfil no se une solo a una cuenta creada después.
 */
@Injectable()
export class RegistrarClientePresencial {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly perfiles: PerfilClienteRepository,
    private readonly consentimientos: ConsentimientoRepository,
    private readonly configuracion: Configuracion,
    private readonly tenantContext: TenantContext,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, datos: DatosClientePresencial): Promise<ClienteEncontrado> {
    await this.autorizacion.exigir(actor, 'REGISTRAR_CLIENTE_PRESENCIAL');
    const consentimiento = Consentimiento.presencial(
      datos.consentimientoVerbal,
      datos.versionPoliticaDatos,
      this.configuracion.versionPoliticaDatos,
      actor.usuarioId,
    );
    const perfil = PerfilCliente.presencial({
      id: uuidv7(),
      tenantId: actor.tenantId,
      nombre: NombrePersona.crear(datos.nombre),
      correo: datos.correo ? Correo.crear(datos.correo) : null,
      telefono: Telefono.crear(datos.telefono),
      creadoPor: actor.usuarioId,
    });

    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      await this.perfiles.crear(perfil);
      await this.consentimientos.registrar(
        perfil.id,
        consentimiento,
        this.tenantContext.datosSolicitud().ip ?? null,
      );
      await this.auditoria.registrar({
        accion: 'CLIENTE_PRESENCIAL_REGISTRADO',
        actorId: actor.usuarioId,
        recurso: `cliente:${perfil.id}`,
        resultado: 'PERMITIDO',
      });
      return {
        id: perfil.id,
        nombre: perfil.nombre.valor,
        telefono: perfil.telefono.valor,
        origen: perfil.origen,
      };
    });
  }
}
