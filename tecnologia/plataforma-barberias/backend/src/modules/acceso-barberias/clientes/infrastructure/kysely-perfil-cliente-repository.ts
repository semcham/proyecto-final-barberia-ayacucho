import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import type { PerfilClienteResumen } from '../../api-publica';
import {
  type ClienteEncontrado,
  PerfilClienteRepository,
} from '../application/ports/perfil-cliente-repository';
import type { PerfilCliente } from '../domain/perfil-cliente';

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

  async crear(perfil: PerfilCliente): Promise<void> {
    const tenantId = this.tenantContext.actual().valor;
    if (perfil.tenantId !== tenantId) throw new Error('El perfil no pertenece al tenant del contexto');
    await this.uow
      .transaccionActual()
      .insertInto('customer_profile')
      .values({
        id: perfil.id,
        tenant_id: tenantId,
        user_id: perfil.usuarioId,
        full_name: perfil.nombre.valor,
        email: perfil.correo?.valor ?? null,
        phone: perfil.telefono.valor,
        origin: perfil.origen,
        created_by: perfil.creadoPor,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
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

  async buscar(texto: string, limite: number): Promise<ClienteEncontrado[]> {
    // Los comodines de LIKE que escriba la persona se buscan literalmente.
    const literal = (valor: string) => valor.replace(/[\\%_]/g, (c) => `\\${c}`);
    const nombre = `%${literal(texto.trim().toLowerCase())}%`;
    const digitos = texto.replace(/\D/g, '');
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('customer_profile')
      .select(['id', 'full_name', 'phone', 'origin'])
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where((eb) =>
        eb.or([
          eb(sql<string>`lower(full_name)`, 'like', nombre),
          ...(digitos.length >= 3 ? [eb(sql<string>`replace(phone, ' ', '')`, 'like', `%${digitos}%`)] : []),
        ]),
      )
      .orderBy('full_name')
      .orderBy('id')
      .limit(limite)
      .execute();
    return filas.map((f) => ({ id: f.id, nombre: f.full_name, telefono: f.phone, origen: f.origin }));
  }

  async varios(clienteIds: readonly string[]): Promise<PerfilClienteResumen[]> {
    if (clienteIds.length === 0) return [];
    const filas = await this.consulta()
      .where('id', 'in', [...new Set(clienteIds)])
      .execute();
    return filas.map(aResumen);
  }
}
