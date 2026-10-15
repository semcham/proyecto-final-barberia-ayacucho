import { Injectable } from '@nestjs/common';
import { TenantId, UnitOfWork } from '../../../../shared';
import { NoEncontrado } from '../domain/errores';
import { type Actor, Autorizacion } from './autorizacion';
import { type UsuarioDetalle, UsuarioRepository } from './ports/usuario-repository';

/** Un usuario de la barbería del propietario. Uno de otra barbería responde 404, como si no existiera. */
@Injectable()
export class ObtenerUsuario {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly usuarios: UsuarioRepository,
  ) {}

  async ejecutar(actor: Actor, usuarioId: string): Promise<UsuarioDetalle> {
    await this.autorizacion.exigir(actor, 'VER_USUARIO');
    const usuario = await this.uow.ejecutar(TenantId.de(actor.tenantId), () =>
      this.usuarios.obtener(usuarioId),
    );
    if (!usuario) throw new NoEncontrado();
    return usuario;
  }
}
