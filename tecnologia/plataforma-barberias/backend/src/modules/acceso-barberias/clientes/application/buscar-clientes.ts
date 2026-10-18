import { Injectable } from '@nestjs/common';
import { TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { ValorInvalido } from '../../identidad/domain/errores';
import { type ClienteEncontrado, PerfilClienteRepository } from './ports/perfil-cliente-repository';

const MAXIMO_RESULTADOS = 20;

/**
 * T108 · Buscar clientes de la barbería por nombre o teléfono (R14), para elegirlos en la cita presencial.
 * Solo el PROPIETARIO; nunca ve clientes de otras barberías (RLS y filtro por el tenant del token).
 */
@Injectable()
export class BuscarClientes {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly perfiles: PerfilClienteRepository,
  ) {}

  async ejecutar(actor: Actor, texto: string): Promise<ClienteEncontrado[]> {
    await this.autorizacion.exigir(actor, 'BUSCAR_CLIENTES');
    const limpio = texto.trim();
    if (limpio.length < 2 || limpio.length > 60) throw new ValorInvalido('buscar', 'longitud');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), () =>
      this.perfiles.buscar(limpio, MAXIMO_RESULTADOS),
    );
  }
}
