import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { HorarioSemanal, KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { ESTADOS_ACTIVOS } from '../../citas/domain/estado-cita';
import {
  BarberoRepository,
  BloqueoRepository,
  type CitaActiva,
  CitasActivasQuery,
  HorarioRepository,
  ServicioRepository,
} from '../application/ports/catalogo-repositorios';
import { Barbero } from '../domain/barbero';
import { Bloqueo } from '../domain/bloqueo';
import { NombreDuplicado, UsuarioYaVinculado } from '../domain/errores';
import { Servicio } from '../domain/servicio';

// T054 · Repositorios Kysely del catálogo. Usan la transacción en curso (tenant del token fijado: RLS) y
// filtran además por el tenant del contexto en cada consulta (principio III).

const VIOLACION_DE_UNICIDAD = '23505';

function traducirUnicidad(error: unknown): unknown {
  const pg = error as { code?: string; constraint?: string };
  if (pg.code !== VIOLACION_DE_UNICIDAD) return error;
  if (pg.constraint === 'service_nombre_unico') return new NombreDuplicado();
  if (pg.constraint === 'barber_usuario_unico') return new UsuarioYaVinculado();
  return error;
}

/** Base común: transacción en curso y tenant del contexto (decorada para que Nest herede sus dependencias). */
@Injectable()
abstract class RepositorioDelTenant {
  constructor(
    protected readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {}

  protected get tx() {
    return this.uow.transaccionActual();
  }

  protected get tenantId(): string {
    return this.tenantContext.actual().valor;
  }
}

@Injectable()
export class KyselyServicioRepository extends RepositorioDelTenant implements ServicioRepository {
  private consulta() {
    return this.tx
      .selectFrom('service')
      .select(['id', 'name', 'description', 'price', 'duration_min', 'active'])
      .where('tenant_id', '=', this.tenantId);
  }

  private static aServicio(fila: {
    id: string;
    name: string;
    description: string | null;
    price: string;
    duration_min: number;
    active: boolean;
  }): Servicio {
    return Servicio.reconstruir({
      id: fila.id,
      nombre: fila.name,
      descripcion: fila.description,
      precio: fila.price,
      duracionMin: fila.duration_min,
      activo: fila.active,
    });
  }

  async listar(): Promise<Servicio[]> {
    const filas = await this.consulta().orderBy('name').orderBy('id').execute();
    return filas.map(KyselyServicioRepository.aServicio);
  }

  async porId(id: string): Promise<Servicio | null> {
    const fila = await this.consulta().where('id', '=', id).executeTakeFirst();
    return fila ? KyselyServicioRepository.aServicio(fila) : null;
  }

  async existentes(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const filas = await this.tx
      .selectFrom('service')
      .select('id')
      .where('tenant_id', '=', this.tenantId)
      .where('id', 'in', [...ids])
      .execute();
    return filas.map((f) => f.id);
  }

  async crear(servicio: Servicio): Promise<void> {
    try {
      await this.tx
        .insertInto('service')
        .values({
          id: servicio.id,
          tenant_id: this.tenantId,
          name: servicio.nombre,
          description: servicio.descripcion,
          price: servicio.precio,
          duration_min: servicio.duracionMin,
          active: servicio.activo,
        })
        .execute();
    } catch (error) {
      throw traducirUnicidad(error);
    }
  }

  async actualizar(servicio: Servicio): Promise<void> {
    try {
      await this.tx
        .updateTable('service')
        .set({
          name: servicio.nombre,
          description: servicio.descripcion,
          price: servicio.precio,
          duration_min: servicio.duracionMin,
          active: servicio.activo,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', this.tenantId)
        .where('id', '=', servicio.id)
        .execute();
    } catch (error) {
      throw traducirUnicidad(error);
    }
  }
}

@Injectable()
export class KyselyBarberoRepository extends RepositorioDelTenant implements BarberoRepository {
  private async cargar(condicion: { id?: string; usuarioId?: string }): Promise<Barbero[]> {
    let consulta = this.tx
      .selectFrom('barber')
      .select(['id', 'display_name', 'user_id', 'active'])
      .where('tenant_id', '=', this.tenantId);
    if (condicion.id) consulta = consulta.where('id', '=', condicion.id);
    if (condicion.usuarioId) consulta = consulta.where('user_id', '=', condicion.usuarioId);
    const filas = await consulta.orderBy('display_name').orderBy('id').execute();
    if (filas.length === 0) return [];
    const asignaciones = await this.tx
      .selectFrom('barber_service')
      .select(['barber_id', 'service_id'])
      .where('tenant_id', '=', this.tenantId)
      .where(
        'barber_id',
        'in',
        filas.map((f) => f.id),
      )
      .execute();
    return filas.map((f) =>
      Barbero.reconstruir({
        id: f.id,
        nombre: f.display_name,
        usuarioId: f.user_id,
        activo: f.active,
        servicioIds: asignaciones.filter((a) => a.barber_id === f.id).map((a) => a.service_id),
      }),
    );
  }

  listar(): Promise<Barbero[]> {
    return this.cargar({});
  }

  async porId(id: string): Promise<Barbero | null> {
    return (await this.cargar({ id }))[0] ?? null;
  }

  async porUsuario(usuarioId: string): Promise<Barbero | null> {
    return (await this.cargar({ usuarioId }))[0] ?? null;
  }

  async contarActivos(): Promise<number> {
    const fila = await this.tx
      .selectFrom('barber')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('tenant_id', '=', this.tenantId)
      .where('active', '=', true)
      .executeTakeFirstOrThrow();
    return Number(fila.total);
  }

  async crear(barbero: Barbero): Promise<void> {
    try {
      await this.tx
        .insertInto('barber')
        .values({
          id: barbero.id,
          tenant_id: this.tenantId,
          user_id: barbero.usuarioId,
          display_name: barbero.nombre,
          active: barbero.activo,
        })
        .execute();
    } catch (error) {
      throw traducirUnicidad(error);
    }
    await this.insertarServicios(barbero);
  }

  async actualizar(barbero: Barbero): Promise<void> {
    try {
      await this.tx
        .updateTable('barber')
        .set({
          user_id: barbero.usuarioId,
          display_name: barbero.nombre,
          active: barbero.activo,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', this.tenantId)
        .where('id', '=', barbero.id)
        .execute();
    } catch (error) {
      throw traducirUnicidad(error);
    }
    await this.tx
      .deleteFrom('barber_service')
      .where('tenant_id', '=', this.tenantId)
      .where('barber_id', '=', barbero.id)
      .execute();
    await this.insertarServicios(barbero);
  }

  private async insertarServicios(barbero: Barbero): Promise<void> {
    const servicioIds = barbero.servicioIds;
    if (servicioIds.length === 0) return;
    await this.tx
      .insertInto('barber_service')
      .values(
        servicioIds.map((servicioId) => ({
          tenant_id: this.tenantId,
          barber_id: barbero.id,
          service_id: servicioId,
        })),
      )
      .execute();
  }
}

interface FilaTramo {
  weekday: number;
  start_time: string;
  end_time: string;
}

function aHorario(filas: readonly FilaTramo[]): HorarioSemanal {
  return HorarioSemanal.crear(
    filas.map((f) => ({
      diaSemana: f.weekday,
      inicioMin: HorarioSemanal.minutosDe(f.start_time),
      finMin: HorarioSemanal.minutosDe(f.end_time),
    })),
  );
}

@Injectable()
export class KyselyHorarioRepository extends RepositorioDelTenant implements HorarioRepository {
  async atencion(): Promise<HorarioSemanal> {
    const filas = await this.tx
      .selectFrom('business_hours')
      .select(['weekday', 'start_time', 'end_time'])
      .where('tenant_id', '=', this.tenantId)
      .execute();
    return aHorario(filas);
  }

  async reemplazarAtencion(horario: HorarioSemanal): Promise<void> {
    await this.tx.deleteFrom('business_hours').where('tenant_id', '=', this.tenantId).execute();
    const tramos = horario.todos();
    if (tramos.length === 0) return;
    await this.tx
      .insertInto('business_hours')
      .values(
        tramos.map((t) => ({
          id: uuidv7(),
          tenant_id: this.tenantId,
          weekday: t.diaSemana,
          start_time: HorarioSemanal.horaDe(t.inicioMin),
          end_time: HorarioSemanal.horaDe(t.finMin),
        })),
      )
      .execute();
  }

  async disponibilidad(barberoId: string): Promise<HorarioSemanal> {
    const filas = await this.tx
      .selectFrom('working_hours')
      .select(['weekday', 'start_time', 'end_time'])
      .where('tenant_id', '=', this.tenantId)
      .where('barber_id', '=', barberoId)
      .execute();
    return aHorario(filas);
  }

  async reemplazarDisponibilidad(barberoId: string, horario: HorarioSemanal): Promise<void> {
    await this.tx
      .deleteFrom('working_hours')
      .where('tenant_id', '=', this.tenantId)
      .where('barber_id', '=', barberoId)
      .execute();
    const tramos = horario.todos();
    if (tramos.length === 0) return;
    await this.tx
      .insertInto('working_hours')
      .values(
        tramos.map((t) => ({
          id: uuidv7(),
          tenant_id: this.tenantId,
          barber_id: barberoId,
          weekday: t.diaSemana,
          start_time: HorarioSemanal.horaDe(t.inicioMin),
          end_time: HorarioSemanal.horaDe(t.finMin),
        })),
      )
      .execute();
  }
}

@Injectable()
export class KyselyBloqueoRepository extends RepositorioDelTenant implements BloqueoRepository {
  private consulta(barberoId: string) {
    return this.tx
      .selectFrom('time_off')
      .select(['id', 'barber_id', 'starts_at', 'ends_at', 'reason', 'created_by'])
      .where('tenant_id', '=', this.tenantId)
      .where('barber_id', '=', barberoId);
  }

  private static aBloqueo(fila: {
    id: string;
    barber_id: string;
    starts_at: Date;
    ends_at: Date;
    reason: string | null;
    created_by: string;
  }): Bloqueo {
    return Bloqueo.reconstruir({
      id: fila.id,
      barberoId: fila.barber_id,
      inicio: fila.starts_at,
      fin: fila.ends_at,
      motivo: fila.reason,
      creadoPor: fila.created_by,
    });
  }

  async futuros(barberoId: string, desde: Date): Promise<Bloqueo[]> {
    const filas = await this.consulta(barberoId).where('ends_at', '>', desde).orderBy('starts_at').execute();
    return filas.map(KyselyBloqueoRepository.aBloqueo);
  }

  async porId(barberoId: string, id: string): Promise<Bloqueo | null> {
    const fila = await this.consulta(barberoId).where('id', '=', id).executeTakeFirst();
    return fila ? KyselyBloqueoRepository.aBloqueo(fila) : null;
  }

  async crear(bloqueo: Bloqueo): Promise<void> {
    await this.tx
      .insertInto('time_off')
      .values({
        id: bloqueo.id,
        tenant_id: this.tenantId,
        barber_id: bloqueo.barberoId,
        starts_at: bloqueo.inicio,
        ends_at: bloqueo.fin,
        reason: bloqueo.motivo,
        created_by: bloqueo.creadoPor,
      })
      .execute();
  }

  async eliminar(id: string): Promise<void> {
    await this.tx
      .deleteFrom('time_off')
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', id)
      .execute();
  }
}

@Injectable()
export class KyselyCitasActivasQuery extends RepositorioDelTenant implements CitasActivasQuery {
  private consulta() {
    return this.tx
      .selectFrom('appointment')
      .select(['id', 'barber_id', 'service_name', 'starts_at', 'ends_at'])
      .where('tenant_id', '=', this.tenantId)
      .where('status', 'in', [...ESTADOS_ACTIVOS]);
  }

  private static aCita(fila: {
    id: string;
    barber_id: string;
    service_name: string;
    starts_at: Date;
    ends_at: Date;
  }): CitaActiva {
    return {
      id: fila.id,
      barberoId: fila.barber_id,
      servicio: fila.service_name,
      inicio: fila.starts_at,
      fin: fila.ends_at,
    };
  }

  async deBarberoEnRango(barberoId: string, desde: Date, hasta: Date): Promise<CitaActiva[]> {
    const filas = await this.consulta()
      .where('barber_id', '=', barberoId)
      .where('starts_at', '<', hasta)
      .where('ends_at', '>', desde)
      .orderBy('starts_at')
      .execute();
    return filas.map(KyselyCitasActivasQuery.aCita);
  }

  async futuras(filtro: { barberoId?: string; servicioId?: string }, desde: Date): Promise<CitaActiva[]> {
    let consulta = this.consulta().where('starts_at', '>=', desde);
    if (filtro.barberoId) consulta = consulta.where('barber_id', '=', filtro.barberoId);
    if (filtro.servicioId) consulta = consulta.where('service_id', '=', filtro.servicioId);
    const filas = await consulta.orderBy('starts_at').execute();
    return filas.map(KyselyCitasActivasQuery.aCita);
  }
}
