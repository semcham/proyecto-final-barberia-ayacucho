import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { CorreoNoDisponible } from '../domain/errores';
import type { EstadoMembresia, Membresia } from '../domain/membresia';
import type { CodigoRol } from '../domain/rol';
import {
  type CuentaParaAutenticar,
  type NuevaCuenta,
  type PerfilUsuario,
  UsuarioRepository,
} from '../application/ports/usuario-repository';

const VIOLACION_DE_UNICIDAD = '23505';

function esCorreoRepetido(error: unknown): boolean {
  const pg = error as { code?: string; constraint?: string };
  return pg.code === VIOLACION_DE_UNICIDAD && pg.constraint === 'user_account_email_key';
}

@Injectable()
export class KyselyUsuarioRepository extends UsuarioRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async crearCuenta(cuenta: NuevaCuenta): Promise<void> {
    try {
      // Sin RETURNING: la política de lectura de user_account aún no ve la cuenta, porque su membresía
      // se crea después (ADR-015).
      await this.uow
        .transaccionActual()
        .insertInto('user_account')
        .values({
          id: cuenta.id,
          email: cuenta.correo.valor,
          full_name: cuenta.nombre.valor,
          password_hash: cuenta.hashContrasena,
        })
        .execute();
    } catch (error) {
      if (esCorreoRepetido(error)) throw new CorreoNoDisponible();
      throw error;
    }
  }

  async crearMembresia(membresia: Membresia): Promise<void> {
    const tenantId = this.tenantContext.actual().valor;
    if (membresia.tenantId !== tenantId) {
      throw new Error('La membresía no pertenece al tenant del contexto');
    }
    await this.uow
      .transaccionActual()
      .insertInto('membership')
      .values({
        id: membresia.id,
        tenant_id: tenantId,
        user_id: membresia.usuarioId,
        role_code: membresia.rol.codigo,
        status: membresia.estado,
      })
      .execute();
  }

  async resolverCuenta(correoNormalizado: string): Promise<CuentaParaAutenticar | null> {
    const { rows } = await sql<{
      user_id: string;
      password_hash: string | null;
      tenant_id: string;
      role_code: CodigoRol;
      membership_status: EstadoMembresia;
      tenant_status: 'ACTIVA' | 'SUSPENDIDA';
    }>`select * from auth_resolver_cuenta(${correoNormalizado})`.execute(this.uow.transaccionActual());
    const fila = rows[0];
    return fila
      ? {
          usuarioId: fila.user_id,
          hashContrasena: fila.password_hash,
          tenantId: fila.tenant_id,
          rol: fila.role_code,
          estadoMembresia: fila.membership_status,
          estadoBarberia: fila.tenant_status,
        }
      : null;
  }

  async perfil(usuarioId: string): Promise<PerfilUsuario | null> {
    const tenantId = this.tenantContext.actual().valor;
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('membership')
      .innerJoin('user_account', 'user_account.id', 'membership.user_id')
      .innerJoin('tenant', 'tenant.id', 'membership.tenant_id')
      .select([
        'user_account.id',
        'user_account.full_name',
        'user_account.email',
        'membership.role_code',
        'tenant.id as tenant_id',
        'tenant.name as tenant_name',
        'tenant.slug as tenant_slug',
      ])
      .where('membership.tenant_id', '=', tenantId)
      .where('membership.user_id', '=', usuarioId)
      .executeTakeFirst();
    return fila
      ? {
          id: fila.id,
          nombre: fila.full_name,
          correo: fila.email,
          rol: fila.role_code,
          barberia: { id: fila.tenant_id, nombre: fila.tenant_name, slug: fila.tenant_slug },
        }
      : null;
  }
}
