import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { FuenteDeIndicador } from '../../../../../shared';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';

/** Estados de la suscripción, en el orden en que se muestran (todos aparecen, aunque sea en cero). */
export const ESTADOS_DE_SUSCRIPCION = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'EXPIRED',
  'SUSPENDED',
  'CANCELLED',
] as const;

/** Una suscripción en estos estados deja operar a la barbería (política de operación de 003; research R04 de 007). */
const DEJAN_OPERAR = new Set<string>(['TRIAL', 'ACTIVE', 'PAST_DUE']);

/** Barbería sin suscripción (no debería pasar: toda barbería nace con su prueba). */
const SIN_SUSCRIPCION = 'SIN_SUSCRIPCION';

export interface BarberiasPorEstado {
  /** No suspendidas por la plataforma y con una suscripción en TRIAL, ACTIVE o PAST_DUE. */
  activas: number;
  /** Suspendidas por el administrador (`tenant.status = SUSPENDIDA`). */
  suspendidas: number;
  porEstadoDeSuscripcion: { estado: string; barberias: number }[];
}

/**
 * T034 de 007 · Fuente de indicadores de M03 (US2, FR-012; research R01 y R04): cuántas barberías hay por estado de
 * la barbería y de su suscripción, de todas las barberías. Lee con el rol de solo lectura de la plataforma
 * (`barberias_plataforma`, sin `BYPASSRLS`, ADR-031) solo columnas que ya tenía concedidas: `tenant (id, status)` y
 * `subscription (tenant_id, status)`. Devuelve solo números: ningún id, nombre ni enlace. La registra el host.
 */
@Injectable()
export class BarberiasPorEstadoIndicador implements FuenteDeIndicador {
  readonly nombre = 'barberias';

  constructor(private readonly lectura: LecturaPlataforma) {}

  calcular(): Promise<BarberiasPorEstado> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const filas = await trx
        .selectFrom('tenant as t')
        .leftJoin('subscription as s', 's.tenant_id', 't.id')
        .select([
          't.status as barberia',
          's.status as suscripcion',
          sql<number>`count(*)::int`.as('cantidad'),
        ])
        .groupBy(['t.status', 's.status'])
        .execute();

      let activas = 0;
      let suspendidas = 0;
      const porEstado = new Map<string, number>(ESTADOS_DE_SUSCRIPCION.map((e) => [e, 0]));
      for (const fila of filas) {
        const estado = fila.suscripcion ?? SIN_SUSCRIPCION;
        porEstado.set(estado, (porEstado.get(estado) ?? 0) + fila.cantidad);
        if (fila.barberia === 'SUSPENDIDA') suspendidas += fila.cantidad;
        else if (DEJAN_OPERAR.has(estado)) activas += fila.cantidad;
      }
      return {
        activas,
        suspendidas,
        porEstadoDeSuscripcion: [...porEstado].map(([estado, barberias]) => ({ estado, barberias })),
      };
    });
  }
}
