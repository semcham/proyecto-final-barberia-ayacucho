import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, TenantId, UnitOfWork } from '../../../../shared';
import { NoEncontrado } from '../domain/errores';
import { type Actor, Autorizacion } from './autorizacion';
import { ActivacionRepository } from './ports/activacion-repository';
import { SesionRepository } from './ports/sesion-repository';
import { type UsuarioDetalle, UsuarioRepository } from './ports/usuario-repository';

/**
 * Desactivar o reactivar un usuario de la barbería (FR-018, FR-019). Solo cambia el estado: el rol es fijo.
 * Desactivar revoca sus sesiones en la misma transacción y conserva sus datos.
 */
@Injectable()
export class ActualizarUsuario {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly usuarios: UsuarioRepository,
    private readonly sesiones: SesionRepository,
    private readonly activaciones: ActivacionRepository,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(actor: Actor, usuarioId: string, estado: 'ACTIVA' | 'DESACTIVADA'): Promise<UsuarioDetalle> {
    await this.autorizacion.exigir(actor, 'ACTUALIZAR_USUARIO');

    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const membresia = await this.usuarios.obtenerMembresia(usuarioId);
      if (!membresia) throw new NoEncontrado();

      if (estado === 'DESACTIVADA') {
        // El dominio impide que el propietario se desactive a sí mismo (422).
        membresia.desactivar(actor.usuarioId);
        await this.usuarios.actualizarEstado(membresia);
        await this.sesiones.revocarTodasDe(usuarioId, this.reloj.ahora());
      } else {
        // El propietario siempre tiene contraseña; el personal la tiene si ya activó su cuenta.
        const tieneContrasena =
          membresia.rol.codigo === 'PROPIETARIO' || (await this.activaciones.tieneActivacionUsada(usuarioId));
        membresia.reactivar(tieneContrasena);
        await this.usuarios.actualizarEstado(membresia);
      }

      await this.auditoria.registrar({
        accion: estado === 'DESACTIVADA' ? 'USUARIO_DESACTIVADO' : 'USUARIO_REACTIVADO',
        actorId: actor.usuarioId,
        recurso: `usuario:${usuarioId}`,
        resultado: 'PERMITIDO',
      });

      const usuario = await this.usuarios.obtener(usuarioId);
      if (!usuario) throw new NoEncontrado();
      return usuario;
    });
  }
}
