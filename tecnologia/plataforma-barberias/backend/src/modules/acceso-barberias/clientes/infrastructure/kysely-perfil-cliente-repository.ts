import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import type { PerfilClienteResumen } from '../../api-publica';
import { PerfilClienteRepository } from '../application/ports/perfil-cliente-repository';

const COLUMNAS = ['id', 'full_name', 'phone'] as const;

function aResumen(fila: { id: string; full_name: string; phone: string }): PerfilClienteResumen {
  return { clienteId: fila.id, nombre: fila.full_name, telefono: fila.phone };
}

/** Lecturas de `customer_profile` en la transacción en curso, filtradas además por el tenant del contexto. */
@Injectable()
export class KyselyPerfilClienteRepository extends PerfilClienteRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private consulta() {
    return this.uow
      .transaccionActual()
      .selectFrom('customer_profile')
      .select(COLUMNAS)
      .where('tenant_id', '=', this.tenantContext.actual().valor);
  }

  async porUsuario(usuarioId: string): Promise<PerfilClienteResumen | null> {
    const fila = await this.consulta().where('user_id', '=', usuarioId).executeTakeFirst();
    return fila ? aResumen(fila) : null;
  }

  async porId(clienteId: string): Promise<PerfilClienteResumen | null> {
    const fila = await this.consulta().where('id', '=', clienteId).executeTakeFirst();
    return fila ? aResumen(fila) : null;
  }

  async varios(clienteIds: readonly string[]): Promise<PerfilClienteResumen[]> {
    if (clienteIds.length === 0) return [];
    const filas = await this.consulta()
      .where('id', 'in', [...new Set(clienteIds)])
      .execute();
    return filas.map(aResumen);
  }
}
