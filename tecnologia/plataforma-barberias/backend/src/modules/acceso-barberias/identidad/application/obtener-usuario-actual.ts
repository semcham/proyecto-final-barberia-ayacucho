import { Injectable } from '@nestjs/common';
import { TenantId, UnitOfWork } from '../../../../shared';
import { NoAutenticado } from '../domain/errores';
import { type Actor, Autorizacion } from './autorizacion';
import { type PerfilUsuario, UsuarioRepository } from './ports/usuario-repository';

/** Datos del usuario autenticado y de su barbería (GET /auth/yo). */
@Injectable()
export class ObtenerUsuarioActual {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly usuarios: UsuarioRepository,
  ) {}

  async ejecutar(actor: Actor): Promise<PerfilUsuario> {
    await this.autorizacion.exigir(actor, 'VER_USUARIO_ACTUAL');
    const perfil = await this.uow.ejecutar(TenantId.de(actor.tenantId), () =>
      this.usuarios.perfil(actor.usuarioId),
    );
    if (!perfil) throw new NoAutenticado();
    return perfil;
  }
}
