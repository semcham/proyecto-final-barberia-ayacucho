import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { CitaSolapadaDelCliente, HorarioNoDisponible } from '../../catalogo/domain/errores';
import { RangoHorario } from '../../catalogo/domain/rango-horario';
import {
  ClaveIdempotenciaEnUso,
  type CitaConIdempotencia,
  CitaRepository,
  ConflictoConcurrente,
  type Idempotencia,
} from '../application/ports/cita-repository';
import { Cita } from '../domain/cita';

const VIOLACION_DE_EXCLUSION = '23P01';
const VIOLACION_DE_UNICIDAD = '23505';
const BLOQUEO_MUTUO = '40P01';

/**
 * T092 · Citas con Kysely (research R06, R09). La garantía de no duplicar citas es de PostgreSQL: la
 * inserción choca con `appointment_no_overlap_barber` o `appointment_no_overlap_customer` y aquí solo se
 * traduce el error. Usa la transacción del caso de uso y filtra además por el tenant del contexto.
 */
@Injectable()
export class CitaRepositoryPostgres extends CitaRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async guardar(cita: Cita, idempotencia: Idempotencia | null): Promise<void> {
    const tenantId = this.tenantContext.actual().valor;
    const trx = this.uow.transaccionActual();
    const servicio = cita.servicio;
    try {
      // Ordena las reservas simultáneas del mismo barbero (bloqueo consultivo hasta el fin de la
      // transacción). Sin él, decenas de inserciones que chocan en la restricción de exclusión se esperan
      // entre sí y PostgreSQL las aborta por bloqueo mutuo, de a una por segundo. NO es la garantía: la
      // garantía sigue siendo appointment_no_overlap_barber (principio IV); esto solo hace que el
      // conflicto se detecte al instante contra la cita ya confirmada.
      await sql`select pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${cita.barberoId}))`.execute(
        trx,
      );
      await trx
        .insertInto('appointment')
        .values({
          id: cita.id,
          tenant_id: tenantId,
          barber_id: cita.barberoId,
          service_id: servicio.servicioId,
          customer_id: cita.clienteId,
          service_name: servicio.nombre,
          price: servicio.precio,
          duration_min: servicio.duracionMin,
          starts_at: cita.rango.inicio,
          ends_at: cita.rango.fin,
          status: cita.estado,
          origin: cita.origen,
          created_by: cita.creadoPor,
          idempotency_key: idempotencia?.clave ?? null,
          request_hash: idempotencia?.hashSolicitud ?? null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
    } catch (error) {
      throw traducir(error);
    }
    await trx
      .insertInto('appointment_status_history')
      .values({
        id: uuidv7(),
        tenant_id: tenantId,
        appointment_id: cita.id,
        from_status: null,
        to_status: cita.estado,
        changed_by: cita.creadoPor,
        changed_at: new Date(),
      })
      .execute();
  }

  async buscarPorIdempotencia(autorId: string, clave: string): Promise<CitaConIdempotencia | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('appointment')
      .select([
        'id',
        'barber_id',
        'customer_id',
        'service_id',
        'service_name',
        'price',
        'duration_min',
        'starts_at',
        'ends_at',
        'status',
        'origin',
        'late_cancellation',
        'created_by',
        'request_hash',
      ])
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('created_by', '=', autorId)
      .where('idempotency_key', '=', clave)
      .executeTakeFirst();
    if (!fila) return null;
    return {
      hashSolicitud: fila.request_hash,
      cita: Cita.reconstruir({
        id: fila.id,
        barberoId: fila.barber_id,
        clienteId: fila.customer_id,
        servicio: {
          servicioId: fila.service_id,
          nombre: fila.service_name,
          precio: fila.price,
          duracionMin: fila.duration_min,
        },
        rango: RangoHorario.crear(fila.starts_at, fila.ends_at),
        estado: fila.status,
        origen: fila.origin,
        cancelacionTardia: fila.late_cancellation,
        creadoPor: fila.created_by,
      }),
    };
  }
}

/** Traduce los errores de PostgreSQL por el nombre de la restricción (R06). */
function traducir(error: unknown): unknown {
  const pg = error as { code?: string; constraint?: string };
  if (pg.code === VIOLACION_DE_EXCLUSION && pg.constraint === 'appointment_no_overlap_barber') {
    return new HorarioNoDisponible();
  }
  if (pg.code === VIOLACION_DE_EXCLUSION && pg.constraint === 'appointment_no_overlap_customer') {
    return new CitaSolapadaDelCliente();
  }
  if (pg.code === VIOLACION_DE_UNICIDAD && pg.constraint === 'appointment_idempotencia') {
    return new ClaveIdempotenciaEnUso();
  }
  // Queda posible entre reservas simultáneas del mismo cliente con barberos distintos (la restricción del
  // cliente no está ordenada por el bloqueo consultivo del barbero): el caso de uso reintenta.
  if (pg.code === BLOQUEO_MUTUO) return new ConflictoConcurrente();
  return error;
}
