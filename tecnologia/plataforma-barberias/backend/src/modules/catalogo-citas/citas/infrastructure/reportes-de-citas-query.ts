import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import {
  type ActividadDeCitas,
  type ConteosDeCitas,
  ReportesDeCitasQuery,
  type ServicioSolicitado,
} from '../application/ports/reportes-de-citas';

const numero = (valor: string | number | null | undefined) => Number(valor ?? 0);

/**
 * T009 de 005 · Agregados de `appointment` por período con Kysely (data-model §4 de 005). Solo SELECT: una prueba de
 * arquitectura comprueba que este archivo no escribe (catalogo-citas-api-solo-lectura.spec.ts). El rango usa el índice
 * `appointment (tenant_id, starts_at)` de 002, y cada consulta filtra por el tenant del contexto además de RLS.
 */
@Injectable()
export class KyselyReportesDeCitasQuery extends ReportesDeCitasQuery {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private get tenantId(): string {
    return this.tenantContext.actual().valor;
  }

  private delPeriodo(inicio: Date, fin: Date) {
    return this.uow
      .transaccionActual()
      .selectFrom('appointment')
      .where('appointment.tenant_id', '=', this.tenantId)
      .where('appointment.starts_at', '>=', inicio)
      .where('appointment.starts_at', '<', fin);
  }

  async conteos(inicio: Date, fin: Date): Promise<ConteosDeCitas> {
    const fila = await this.delPeriodo(inicio, fin)
      .select([
        sql<string>`count(*)`.as('total'),
        sql<string>`count(*) FILTER (WHERE status = 'PENDIENTE')`.as('pendientes'),
        sql<string>`count(*) FILTER (WHERE status = 'CONFIRMADA')`.as('confirmadas'),
        sql<string>`count(*) FILTER (WHERE status = 'COMPLETADA')`.as('completadas'),
        sql<string>`count(*) FILTER (WHERE status = 'NO_ASISTIO')`.as('no_asistio'),
        sql<string>`count(*) FILTER (WHERE status = 'CANCELADA')`.as('canceladas'),
        sql<string>`count(*) FILTER (WHERE status = 'CANCELADA' AND late_cancellation)`.as('tardias'),
      ])
      .executeTakeFirstOrThrow();
    return {
      total: numero(fila.total),
      pendientes: numero(fila.pendientes),
      confirmadas: numero(fila.confirmadas),
      completadas: numero(fila.completadas),
      noAsistio: numero(fila.no_asistio),
      canceladas: numero(fila.canceladas),
      canceladasTardias: numero(fila.tardias),
    };
  }

  async serviciosMasSolicitados(inicio: Date, fin: Date, limite: number): Promise<ServicioSolicitado[]> {
    const filas = await this.delPeriodo(inicio, fin)
      .where('appointment.status', '<>', 'CANCELADA')
      .select(['appointment.service_name', sql<string>`count(*)`.as('citas')])
      .groupBy('appointment.service_name')
      .orderBy(sql`count(*)`, 'desc')
      .orderBy('appointment.service_name')
      .limit(limite)
      .execute();
    return filas.map((fila) => ({ nombre: fila.service_name, citas: numero(fila.citas) }));
  }

  async actividad(inicio: Date, fin: Date, zonaHoraria: string): Promise<ActividadDeCitas> {
    const [porBarbero, porDia, totales] = await Promise.all([
      this.delPeriodo(inicio, fin)
        .innerJoin('barber', (join) =>
          join
            .onRef('barber.tenant_id', '=', 'appointment.tenant_id')
            .onRef('barber.id', '=', 'appointment.barber_id'),
        )
        .select(['barber.id', 'barber.display_name', sql<string>`count(*)`.as('citas')])
        .groupBy(['barber.id', 'barber.display_name'])
        .orderBy(sql`count(*)`, 'desc')
        .orderBy('barber.display_name')
        .orderBy('barber.id')
        .execute(),
      this.delPeriodo(inicio, fin)
        .select([
          sql<number>`EXTRACT(ISODOW FROM appointment.starts_at AT TIME ZONE ${zonaHoraria})::int`.as('dia'),
          sql<string>`count(*)`.as('citas'),
        ])
        .groupBy(sql`1`)
        .execute(),
      this.delPeriodo(inicio, fin)
        .select([
          sql<string>`count(*) FILTER (WHERE status = 'CANCELADA' AND late_cancellation)`.as('tardias'),
          sql<string>`count(*) FILTER (WHERE status = 'NO_ASISTIO')`.as('no_asistio'),
        ])
        .executeTakeFirstOrThrow(),
    ]);
    const citasDelDia = new Map(porDia.map((fila) => [numero(fila.dia), numero(fila.citas)]));
    return {
      porBarbero: porBarbero.map((fila) => ({
        barberoId: fila.id,
        barbero: fila.display_name,
        citas: numero(fila.citas),
      })),
      porDiaDeSemana: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, citas: citasDelDia.get(dia) ?? 0 })),
      cancelacionesTardias: numero(totales.tardias),
      noAsistencias: numero(totales.no_asistio),
    };
  }
}
