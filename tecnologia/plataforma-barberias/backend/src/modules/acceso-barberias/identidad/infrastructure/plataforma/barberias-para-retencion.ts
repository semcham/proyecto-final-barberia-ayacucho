import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';
import { BarberiasParaRetencion } from '../../application/ports/enlace-de-cuenta-repository';

/**
 * T045 de 010 · Barberías a recorrer en la retención de los enlaces de cuenta, con el rol de solo lectura de la
 * plataforma (ADR-031): solo `tenant.id`, que ese rol ya puede leer. No lee `account_link` (no tiene permiso): cada
 * barbería se purga después con su tenant y RLS. En orden aleatorio, para que con más barberías que el máximo
 * ninguna se quede siempre fuera.
 */
@Injectable()
export class BarberiasParaRetencionPlataforma extends BarberiasParaRetencion {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  listar(maximo: number): Promise<string[]> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const filas = await trx
        .selectFrom('tenant')
        .select('id')
        .orderBy(sql`random()`)
        .limit(maximo)
        .execute();
      return filas.map((f) => f.id);
    });
  }
}
