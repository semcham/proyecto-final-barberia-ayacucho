import { Injectable } from '@nestjs/common';
import {
  type FechaLocal,
  HorarioSemanal,
  KyselyUnitOfWork,
  TenantContext,
  type Tramo,
} from '../../../../shared';
import {
  type BarberoDelServicio,
  CatalogQuery,
  type Intervalo,
  type ServicioVigente,
} from '../application/ports/catalog-query';

interface FilaTramo {
  weekday: number;
  start_time: string;
  end_time: string;
}

function aHorario(filas: readonly FilaTramo[]): HorarioSemanal {
  return HorarioSemanal.crear(
    filas.map((fila) => ({
      diaSemana: fila.weekday,
      inicioMin: HorarioSemanal.minutosDe(fila.start_time),
      finMin: HorarioSemanal.minutosDe(fila.end_time),
    })),
  );
}

/**
 * T031 · `CatalogQuery` con Kysely. Usa la transacción en curso (con el tenant del token fijado: RLS) y,
 * además, filtra explícitamente por el tenant del contexto en cada consulta (principio III).
 */
@Injectable()
export class KyselyCatalogQuery extends CatalogQuery {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private get tenantId(): string {
    return this.tenantContext.actual().valor;
  }

  async servicioActivo(servicioId: string): Promise<ServicioVigente | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('service')
      .select(['id', 'name', 'price', 'duration_min'])
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', servicioId)
      .where('active', '=', true)
      .executeTakeFirst();
    return fila
      ? { servicioId: fila.id, nombre: fila.name, precio: fila.price, duracionMin: fila.duration_min }
      : null;
  }

  async barberoOfrece(barberoId: string, servicioId: string): Promise<BarberoDelServicio | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('barber')
      .innerJoin('barber_service', (join) =>
        join
          .onRef('barber_service.tenant_id', '=', 'barber.tenant_id')
          .onRef('barber_service.barber_id', '=', 'barber.id'),
      )
      .select(['barber.id', 'barber.display_name'])
      .where('barber.tenant_id', '=', this.tenantId)
      .where('barber.id', '=', barberoId)
      .where('barber.active', '=', true)
      .where('barber_service.service_id', '=', servicioId)
      .executeTakeFirst();
    return fila ? { barberoId: fila.id, nombre: fila.display_name } : null;
  }

  async tramosDelDia(barberoId: string, fecha: FechaLocal): Promise<Tramo[]> {
    const dia = fecha.diaSemana;
    const trx = this.uow.transaccionActual();
    const [atencion, disponibilidad] = await Promise.all([
      trx
        .selectFrom('business_hours')
        .select(['weekday', 'start_time', 'end_time'])
        .where('tenant_id', '=', this.tenantId)
        .where('weekday', '=', dia)
        .execute(),
      trx
        .selectFrom('working_hours')
        .select(['weekday', 'start_time', 'end_time'])
        .where('tenant_id', '=', this.tenantId)
        .where('barber_id', '=', barberoId)
        .where('weekday', '=', dia)
        .execute(),
    ]);
    return aHorario(atencion).interseccion(aHorario(disponibilidad), dia);
  }

  async bloqueosEnRango(barberoId: string, desde: Date, hasta: Date): Promise<Intervalo[]> {
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('time_off')
      .select(['starts_at', 'ends_at'])
      .where('tenant_id', '=', this.tenantId)
      .where('barber_id', '=', barberoId)
      // Solapamiento de rangos semiabiertos: inicio < hasta y fin > desde.
      .where('starts_at', '<', hasta)
      .where('ends_at', '>', desde)
      .orderBy('starts_at')
      .execute();
    return filas.map((fila) => ({ inicio: fila.starts_at, fin: fila.ends_at }));
  }

  async barbero(barberoId: string): Promise<BarberoDelServicio | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('barber')
      .select(['id', 'display_name'])
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', barberoId)
      .executeTakeFirst();
    return fila ? { barberoId: fila.id, nombre: fila.display_name } : null;
  }

  async barberosQueOfrecen(servicioId: string): Promise<BarberoDelServicio[]> {
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('barber')
      .innerJoin('barber_service', (join) =>
        join
          .onRef('barber_service.tenant_id', '=', 'barber.tenant_id')
          .onRef('barber_service.barber_id', '=', 'barber.id'),
      )
      .select(['barber.id', 'barber.display_name'])
      .where('barber.tenant_id', '=', this.tenantId)
      .where('barber.active', '=', true)
      .where('barber_service.service_id', '=', servicioId)
      .orderBy('barber.display_name')
      .orderBy('barber.id')
      .execute();
    return filas.map((fila) => ({ barberoId: fila.id, nombre: fila.display_name }));
  }
}
