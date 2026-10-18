import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { CorreoNoDisponible } from '../domain/errores';
import type { EstadoMembresia, Membresia } from '../domain/membresia';
import { CODIGOS_ROL_PERSONAL, type CodigoRol } from '../domain/rol';
import { Membresia as MembresiaDominio } from '../domain/membresia';
import { Rol } from '../domain/rol';
import {
  type CuentaParaAutenticar,
  type FiltrosUsuarios,
  type NuevaCuenta,
  type PerfilUsuario,
  type UsuarioDetalle,
  UsuarioRepository,
} from '../application/ports/usuario-repository';

const COLUMNAS_DETALLE = [
  'user_account.id',
  'user_account.full_name',
  'user_account.email',
  'membership.role_code',
  'membership.status',
  'membership.created_at',
] as const;

interface FilaDetalle {
  id: string;
  full_name: string;
  email: string;
  role_code: CodigoRol;
  status: EstadoMembresia;
  created_at: Date;
}

function aDetalle(fila: FilaDetalle): UsuarioDetalle {
  return {
    id: fila.id,
    nombre: fila.full_name,
    correo: fila.email,
    rol: fila.role_code,
    estado: fila.status,
    creadoEn: fila.created_at,
  };
}

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
    // Desde 0009 la función hace LEFT JOIN: una cuenta sin membresía de personal trae nulos (ADR-020).
    const { rows } = await sql<{
      user_id: string;
      password_hash: string | null;
      tenant_id: string | null;
      role_code: CodigoRol | null;
      membership_status: EstadoMembresia | null;
      tenant_status: 'ACTIVA' | 'SUSPENDIDA' | null;
    }>`select * from auth_resolver_cuenta(${correoNormalizado})`.execute(this.uow.transaccionActual());
    const fila = rows[0];
    if (!fila) return null;
    return {
      usuarioId: fila.user_id,
      hashContrasena: fila.password_hash,
      personal:
        fila.tenant_id && fila.role_code && fila.membership_status && fila.tenant_status
          ? {
              tenantId: fila.tenant_id,
              rol: fila.role_code,
              estadoMembresia: fila.membership_status,
              estadoBarberia: fila.tenant_status,
            }
          : null,
    };
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

  /**
   * Usuarios del personal de la barbería. Los clientes (funcionalidad 002, ADR-020) también tienen
   * membresía, pero no aparecen en la lista de usuarios ni se gestionan con estas operaciones.
   */
  private consultaDetalle() {
    return this.uow
      .transaccionActual()
      .selectFrom('membership')
      .innerJoin('user_account', 'user_account.id', 'membership.user_id')
      .where('membership.tenant_id', '=', this.tenantContext.actual().valor)
      .where('membership.role_code', 'in', CODIGOS_ROL_PERSONAL);
  }

  async listar(filtros: FiltrosUsuarios): Promise<{ datos: UsuarioDetalle[]; total: number }> {
    let consulta = this.consultaDetalle();
    if (filtros.rol) consulta = consulta.where('membership.role_code', '=', filtros.rol);
    if (filtros.estado) consulta = consulta.where('membership.status', '=', filtros.estado);

    const { total } = await consulta
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirstOrThrow();
    const filas = await consulta
      .select(COLUMNAS_DETALLE)
      // El propietario primero; después, el personal por antigüedad.
      .orderBy((eb) => eb.case().when('membership.role_code', '=', 'PROPIETARIO').then(0).else(1).end())
      .orderBy('membership.created_at')
      .orderBy('user_account.id')
      .limit(filtros.tamano)
      .offset((filtros.pagina - 1) * filtros.tamano)
      .execute();
    return { datos: filas.map(aDetalle), total: Number(total) };
  }

  async obtener(usuarioId: string): Promise<UsuarioDetalle | null> {
    const fila = await this.consultaDetalle()
      .select(COLUMNAS_DETALLE)
      .where('membership.user_id', '=', usuarioId)
      .executeTakeFirst();
    return fila ? aDetalle(fila) : null;
  }

  async obtenerMembresia(usuarioId: string): Promise<Membresia | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('membership')
      .select(['id', 'tenant_id', 'user_id', 'role_code', 'status'])
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('user_id', '=', usuarioId)
      // Solo personal: activar, desactivar o regenerar la activación no aplica a clientes (404).
      .where('role_code', 'in', CODIGOS_ROL_PERSONAL)
      .executeTakeFirst();
    return fila
      ? MembresiaDominio.reconstruir({
          id: fila.id,
          tenantId: fila.tenant_id,
          usuarioId: fila.user_id,
          rol: Rol.de(fila.role_code),
          estado: fila.status,
        })
      : null;
  }

  async membresiaEnContexto(usuarioId: string): Promise<Membresia | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('membership')
      .select(['id', 'tenant_id', 'user_id', 'role_code', 'status'])
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('user_id', '=', usuarioId)
      .executeTakeFirst();
    return fila
      ? MembresiaDominio.reconstruir({
          id: fila.id,
          tenantId: fila.tenant_id,
          usuarioId: fila.user_id,
          rol: Rol.de(fila.role_code),
          estado: fila.status,
        })
      : null;
  }

  async contarPersonalVigente(): Promise<number> {
    const { total } = await this.uow
      .transaccionActual()
      .selectFrom('membership')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('status', 'in', ['PENDIENTE', 'ACTIVA'])
      // Los clientes no consumen el cupo de usuarios del plan (ADR-020).
      .where('role_code', 'in', CODIGOS_ROL_PERSONAL)
      .executeTakeFirstOrThrow();
    return Number(total);
  }

  async actualizarEstado(membresia: Membresia): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('membership')
      .set({ status: membresia.estado, updated_at: new Date() })
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', membresia.id)
      .execute();
  }

  async fijarContrasena(usuarioId: string, hashContrasena: string): Promise<void> {
    // RLS de user_account: solo se actualiza si la cuenta tiene membresía en el tenant del contexto.
    // Sin RETURNING ni lectura de password_hash (barberias_app no puede leer esa columna).
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('user_account')
      .set({ password_hash: hashContrasena })
      .where('id', '=', usuarioId)
      .executeTakeFirst();
    if (Number(resultado.numUpdatedRows) !== 1) throw new Error('No se pudo fijar la contraseña');
  }
}
