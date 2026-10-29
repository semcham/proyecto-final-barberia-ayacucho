import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';
import {
  type BarberiaDeLaPlataforma,
  BarberiasPlataformaLectura,
} from '../../application/plataforma/ports/barberias-plataforma';

/** `%`, `_` y `\` del texto buscado se escapan: se buscan tal cual, no como comodines de LIKE. */
function patron(buscar: string): string {
  return `%${buscar.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * T096 · Listado de barberías del administrador con el rol de solo lectura de la plataforma (ADR-031). Solo las
 * columnas que ese rol puede leer de `tenant` (id, name, slug, status): nada de negocio (FR-038).
 */
@Injectable()
export class BarberiasPlataformaKysely extends BarberiasPlataformaLectura {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  pagina(
    buscar: string | null,
    pagina: number,
    tamano: number,
  ): Promise<{ barberias: BarberiaDeLaPlataforma[]; total: number }> {
    return this.lectura.ejecutarLectura(async (trx) => {
      let consulta = trx.selectFrom('tenant');
      if (buscar) {
        const texto = patron(buscar);
        consulta = consulta.where((eb) => eb.or([eb('name', 'ilike', texto), eb('slug', 'ilike', texto)]));
      }
      // En la misma transacción, una consulta tras otra: la página y el total ven las mismas filas.
      const filas = await consulta
        .select(['id', 'name', 'slug', 'status'])
        .orderBy(sql`lower(name)`)
        .orderBy('id')
        .limit(tamano)
        .offset((pagina - 1) * tamano)
        .execute();
      const conteo = await consulta.select(sql<number>`count(*)::int`.as('total')).executeTakeFirstOrThrow();
      return {
        barberias: filas.map((f) => ({ id: f.id, nombre: f.name, slug: f.slug, estado: f.status })),
        total: conteo.total,
      };
    });
  }
}
