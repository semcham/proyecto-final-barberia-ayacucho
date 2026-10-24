import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork } from '../../../../shared';
import type { ConfiguracionAgenda, DatosPublicosBarberia } from '../../api-publica';
import {
  type CambiosBarberia,
  type ConfiguracionBarberia,
  TenantRepository,
} from '../application/ports/tenant-repository';
import type { Barberia, EstadoBarberia } from '../domain/barberia';
import { EnlaceNoDisponible } from '../domain/errores';

const INTENTOS_DE_SLUG = 5;
const VIOLACION_DE_UNICIDAD = '23505';

/** Solo columnas públicas (FR-018 de 002). */
function aDatosPublicos(fila: {
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  description: string | null;
  timezone: string;
}): DatosPublicosBarberia {
  return {
    nombre: fila.name,
    slug: fila.slug,
    direccion: fila.address,
    telefono: fila.phone,
    descripcion: fila.description,
    zonaHoraria: fila.timezone,
  };
}

@Injectable()
export class KyselyTenantRepository extends TenantRepository {
  constructor(private readonly uow: KyselyUnitOfWork) {
    super();
  }

  async configuracion(id: string): Promise<ConfiguracionBarberia | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('tenant')
      .select(['name', 'slug', 'address', 'phone', 'description', 'timezone', 'cancel_min_notice_minutes'])
      .where('id', '=', id)
      .executeTakeFirst();
    return fila
      ? {
          nombre: fila.name,
          slug: fila.slug,
          direccion: fila.address,
          telefono: fila.phone,
          descripcion: fila.description,
          zonaHoraria: fila.timezone,
          antelacionCancelacionMinutos: fila.cancel_min_notice_minutes,
        }
      : null;
  }

  async actualizar(id: string, cambios: CambiosBarberia): Promise<void> {
    const valores = {
      ...(cambios.nombre !== undefined && { name: cambios.nombre }),
      ...(cambios.slug !== undefined && { slug: cambios.slug }),
      ...(cambios.direccion !== undefined && { address: cambios.direccion }),
      ...(cambios.telefono !== undefined && { phone: cambios.telefono }),
      ...(cambios.descripcion !== undefined && { description: cambios.descripcion }),
      ...(cambios.antelacionCancelacionMinutos !== undefined && {
        cancel_min_notice_minutes: cambios.antelacionCancelacionMinutos,
      }),
    };
    if (Object.keys(valores).length === 0) return;
    try {
      // La política tenant_edicion ya impide tocar otra barbería; el filtro por id lo hace explícito.
      const resultado = await this.uow
        .transaccionActual()
        .updateTable('tenant')
        .set(valores)
        .where('id', '=', id)
        .executeTakeFirst();
      if (Number(resultado.numUpdatedRows) !== 1) throw new Error('La barbería del contexto no existe');
    } catch (error) {
      const pg = error as { code?: string; constraint?: string };
      if (pg.code === VIOLACION_DE_UNICIDAD && pg.constraint === 'tenant_slug_key')
        throw new EnlaceNoDisponible();
      throw error;
    }
  }

  async insertar(barberia: Barberia): Promise<void> {
    const preferido = barberia.slug;
    for (let intento = 0; intento < INTENTOS_DE_SLUG; intento += 1) {
      if (intento > 0) barberia.usarSlug(preferido.conSufijo(randomBytes(3).toString('hex')));
      // ON CONFLICT DO NOTHING: un slug ocupado no aborta la transacción del registro.
      const resultado = await this.uow
        .transaccionActual()
        .insertInto('tenant')
        .values({
          id: barberia.id,
          name: barberia.nombre.valor,
          slug: barberia.slug.valor,
          status: barberia.estado,
        })
        .onConflict((conflicto) => conflicto.column('slug').doNothing())
        .executeTakeFirst();
      if (Number(resultado.numInsertedOrUpdatedRows ?? 0) === 1) return;
    }
    throw new Error('No se encontró un slug libre para la barbería');
  }

  async estado(id: string): Promise<EstadoBarberia | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('tenant')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirst();
    return fila?.status ?? null;
  }

  async idActivaPorSlug(slug: string): Promise<string | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('tenant')
      .select('id')
      .where('slug', '=', slug)
      .where('status', '=', 'ACTIVA')
      .executeTakeFirst();
    return fila?.id ?? null;
  }

  async datosPublicos(id: string): Promise<DatosPublicosBarberia | null> {
    // Solo columnas públicas (FR-018): ni el estado ni datos de cuentas salen de aquí.
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('tenant')
      .select(['name', 'slug', 'address', 'phone', 'description', 'timezone'])
      .where('id', '=', id)
      .where('status', '=', 'ACTIVA')
      .executeTakeFirst();
    return fila ? aDatosPublicos(fila) : null;
  }

  async datosPublicosPorSlug(slug: string): Promise<{ id: string; barberia: DatosPublicosBarberia } | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('tenant')
      .select(['id', 'name', 'slug', 'address', 'phone', 'description', 'timezone'])
      .where('slug', '=', slug)
      .where('status', '=', 'ACTIVA')
      .executeTakeFirst();
    return fila ? { id: fila.id, barberia: aDatosPublicos(fila) } : null;
  }

  async configuracionAgenda(id: string): Promise<ConfiguracionAgenda | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('tenant')
      .select(['name', 'timezone', 'cancel_min_notice_minutes'])
      .where('id', '=', id)
      .executeTakeFirst();
    return fila
      ? {
          nombre: fila.name,
          zonaHoraria: fila.timezone,
          antelacionCancelacionMinutos: fila.cancel_min_notice_minutes,
        }
      : null;
  }
}
