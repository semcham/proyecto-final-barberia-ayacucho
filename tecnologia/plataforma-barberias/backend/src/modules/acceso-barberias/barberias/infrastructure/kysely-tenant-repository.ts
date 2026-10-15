import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork } from '../../../../shared';
import { TenantRepository } from '../application/ports/tenant-repository';
import type { Barberia, EstadoBarberia } from '../domain/barberia';

const INTENTOS_DE_SLUG = 5;

@Injectable()
export class KyselyTenantRepository extends TenantRepository {
  constructor(private readonly uow: KyselyUnitOfWork) {
    super();
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
}
