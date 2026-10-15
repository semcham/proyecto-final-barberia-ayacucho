import { Injectable } from '@nestjs/common';
import { TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from './autorizacion';
import { type FiltrosUsuarios, type UsuarioDetalle, UsuarioRepository } from './ports/usuario-repository';

export interface PaginaUsuarios {
  datos: UsuarioDetalle[];
  total: number;
  pagina: number;
  tamano: number;
}

/** Usuarios de la barbería del propietario (FR-018). Nunca incluye usuarios de otra barbería. */
@Injectable()
export class ListarUsuarios {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly usuarios: UsuarioRepository,
  ) {}

  async ejecutar(actor: Actor, filtros: FiltrosUsuarios): Promise<PaginaUsuarios> {
    await this.autorizacion.exigir(actor, 'LISTAR_USUARIOS');
    const { datos, total } = await this.uow.ejecutar(TenantId.de(actor.tenantId), () =>
      this.usuarios.listar(filtros),
    );
    return { datos, total, pagina: filtros.pagina, tamano: filtros.tamano };
  }
}
