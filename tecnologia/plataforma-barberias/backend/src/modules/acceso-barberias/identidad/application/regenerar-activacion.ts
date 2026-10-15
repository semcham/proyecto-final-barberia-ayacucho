import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, TenantId, UnitOfWork } from '../../../../shared';
import { NoEncontrado, OperacionNoPermitida } from '../domain/errores';
import { type Actor, Autorizacion } from './autorizacion';
import { type EnlaceActivacion, GenerarEnlaceActivacion } from './enlace-activacion';
import { ActivacionRepository } from './ports/activacion-repository';
import { UsuarioRepository } from './ports/usuario-repository';

/** Nuevo enlace de activación para un usuario PENDIENTE; el anterior deja de servir (R14). */
@Injectable()
export class RegenerarActivacion {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly usuarios: UsuarioRepository,
    private readonly activaciones: ActivacionRepository,
    private readonly generarEnlace: GenerarEnlaceActivacion,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(actor: Actor, usuarioId: string): Promise<EnlaceActivacion> {
    await this.autorizacion.exigir(actor, 'REGENERAR_ACTIVACION');

    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const membresia = await this.usuarios.obtenerMembresia(usuarioId);
      if (!membresia) throw new NoEncontrado();
      if (membresia.estado !== 'PENDIENTE') {
        throw new OperacionNoPermitida('El usuario no está pendiente de activación.');
      }

      await this.activaciones.revocarVigentesDe(usuarioId, this.reloj.ahora());
      const enlace = await this.generarEnlace.ejecutar(actor.tenantId, usuarioId, actor.usuarioId);
      await this.auditoria.registrar({
        accion: 'ACTIVACION_REGENERADA',
        actorId: actor.usuarioId,
        recurso: `usuario:${usuarioId}`,
        resultado: 'PERMITIDO',
      });
      return enlace;
    });
  }
}
