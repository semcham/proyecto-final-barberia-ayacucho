import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { CorreoNoDisponible } from '../domain/errores';
import type { Membresia } from '../domain/membresia';
import { type NuevaCuenta, UsuarioRepository } from '../application/ports/usuario-repository';

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
}
