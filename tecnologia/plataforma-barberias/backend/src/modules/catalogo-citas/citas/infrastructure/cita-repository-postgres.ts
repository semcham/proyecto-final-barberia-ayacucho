import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import {
  CitaCambio,
  CitaSolapadaDelCliente,
  EnlaceNoValido,
  HorarioNoDisponible,
} from '../../catalogo/domain/errores';
import { RangoHorario } from '../../catalogo/domain/rango-horario';
import {
  type AccionDeEnlaceCita,
  type AutorDeReprogramacion,
  ClaveIdempotenciaEnUso,
  type CitaAntesDeReprogramar,
  type CitaConIdempotencia,
  CitaRepository,
  ConflictoConcurrente,
  type Idempotencia,
} from '../application/ports/cita-repository';
import { Cita } from '../domain/cita';
import type { EstadoCita } from '../domain/estado-cita';

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
    const fila = await this.consulta()
      .select('request_hash')
      .where('created_by', '=', autorId)
      .where('idempotency_key', '=', clave)
      .executeTakeFirst();
    return fila ? { hashSolicitud: fila.request_hash, cita: aCita(fila) } : null;
  }

  async buscarParaActualizar(
    id: string,
    opciones: { saltarSiBloqueada?: boolean } = {},
  ): Promise<Cita | null> {
    let consulta = this.consulta().where('id', '=', id).forUpdate();
    if (opciones.saltarSiBloqueada) consulta = consulta.skipLocked();
    const fila = await consulta.executeTakeFirst();
    return fila ? aCita(fila) : null;
  }

  async confirmarAsistencia(cita: Cita): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('appointment')
      .set({ client_confirmed_at: cita.confirmadaPorClienteEn, updated_at: new Date() })
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', cita.id)
      .execute();
  }

  async registrarUsoDeEnlace(citaId: string, linkHash: string, accion: AccionDeEnlaceCita): Promise<void> {
    try {
      await this.uow
        .transaccionActual()
        .insertInto('appointment_link_use')
        .values({
          id: uuidv7(),
          tenant_id: this.tenantContext.actual().valor,
          appointment_id: citaId,
          link_hash: linkHash,
          action: accion,
        })
        .execute();
    } catch (error) {
      const pg = error as { code?: string; constraint?: string };
      if (pg.code === VIOLACION_DE_UNICIDAD && pg.constraint === 'appointment_link_use_un_uso') {
        throw new EnlaceNoValido();
      }
      throw error;
    }
  }

  async enlaceUsado(linkHash: string): Promise<boolean> {
    // UNIQUE (link_hash) es global, pero la lectura va con RLS: un hash de otra barbería no se ve (y su enlace,
    // firmado para otra barbería, ya no llega hasta aquí).
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('appointment_link_use')
      .select('id')
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('link_hash', '=', linkHash)
      .executeTakeFirst();
    return fila !== undefined;
  }

  async actualizarEstado(cita: Cita, anterior: EstadoCita, autorId: string | null): Promise<void> {
    const tenantId = this.tenantContext.actual().valor;
    const trx = this.uow.transaccionActual();
    const ahora = new Date();
    const cancelacion = cita.cancelacion;
    await trx
      .updateTable('appointment')
      .set({
        status: cita.estado,
        // 004: cancelar, completar y no asistió suben la versión (invalida los enlaces de acción).
        version: cita.version,
        updated_at: ahora,
        // Al cancelar: quién, cuándo, el motivo y la marca de tardía (FR-038, FR-039).
        ...(cita.estado === 'CANCELADA' &&
          cancelacion && {
            late_cancellation: cita.cancelacionTardia,
            cancelled_by: cancelacion.por,
            cancelled_at: cancelacion.en,
            cancel_reason: cancelacion.motivo,
          }),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', cita.id)
      .execute();
    await trx
      .insertInto('appointment_status_history')
      .values({
        id: uuidv7(),
        tenant_id: tenantId,
        appointment_id: cita.id,
        from_status: anterior,
        to_status: cita.estado,
        changed_by: autorId,
        changed_at: ahora,
      })
      .execute();
  }

  async buscarPorId(id: string): Promise<Cita | null> {
    const fila = await this.consulta().where('id', '=', id).executeTakeFirst();
    return fila ? aCita(fila) : null;
  }

  async reprogramar(cita: Cita, antes: CitaAntesDeReprogramar, autor: AutorDeReprogramacion): Promise<void> {
    const tenantId = this.tenantContext.actual().valor;
    const trx = this.uow.transaccionActual();
    const ahora = new Date();
    try {
      // Los bloqueos consultivos de los dos barberos (el de antes y el de después), siempre en el mismo orden:
      // dos cambios cruzados (A → B y B → A) se ordenan en lugar de bloquearse mutuamente (R03). Como en
      // `guardar`, NO son la garantía: la garantía es la restricción de exclusión (principio IV).
      for (const barberoId of [...new Set([antes.barberoId, cita.barberoId])].sort()) {
        await sql`select pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${barberoId}))`.execute(trx);
      }
      // La misma fila (R01): si mientras tanto otra operación la cambió (versión) o dejó de estar activa, no
      // se toca nada (0 filas → CitaCambio).
      const resultado = await trx
        .updateTable('appointment')
        .set({
          barber_id: cita.barberoId,
          starts_at: cita.rango.inicio,
          ends_at: cita.rango.fin,
          status: cita.estado,
          version: cita.version,
          client_confirmed_at: null,
          updated_at: ahora,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', cita.id)
        .where('version', '=', antes.version)
        .where('status', 'in', ['PENDIENTE', 'CONFIRMADA'])
        .executeTakeFirst();
      if (Number(resultado.numUpdatedRows) === 0) throw new CitaCambio();
    } catch (error) {
      throw traducir(error);
    }
    await trx
      .insertInto('appointment_reschedule')
      .values({
        id: uuidv7(),
        tenant_id: tenantId,
        appointment_id: cita.id,
        from_barber_id: antes.barberoId,
        from_starts_at: antes.inicio,
        to_barber_id: cita.barberoId,
        to_starts_at: cita.rango.inicio,
        changed_by: autor.usuarioId,
        via: autor.via,
        changed_at: ahora,
      })
      .execute();
    // Una cita PENDIENTE reprogramada queda CONFIRMADA (FR-007): el cambio de estado va al historial con su
    // autor; por enlace, sin usuario (changed_by nulo, migración 0027).
    if (antes.estado !== cita.estado) {
      await trx
        .insertInto('appointment_status_history')
        .values({
          id: uuidv7(),
          tenant_id: tenantId,
          appointment_id: cita.id,
          from_status: antes.estado,
          to_status: cita.estado,
          changed_by: autor.usuarioId,
          changed_at: ahora,
        })
        .execute();
    }
  }

  async porIds(ids: readonly string[]): Promise<Cita[]> {
    if (ids.length === 0) return [];
    const filas = await this.consulta()
      .where('id', 'in', [...ids])
      .execute();
    return filas.map(aCita);
  }

  async delRango(desde: Date, hasta: Date, barberoId?: string): Promise<Cita[]> {
    let consulta = this.consulta().where('starts_at', '>=', desde).where('starts_at', '<', hasta);
    if (barberoId) consulta = consulta.where('barber_id', '=', barberoId);
    const filas = await consulta.orderBy('starts_at').orderBy('id').execute();
    return filas.map(aCita);
  }

  async delCliente(
    clienteId: string,
    pagina: number,
    tamano: number,
  ): Promise<{ total: number; citas: Cita[] }> {
    const { total } = await this.uow
      .transaccionActual()
      .selectFrom('appointment')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('customer_id', '=', clienteId)
      .executeTakeFirstOrThrow();
    const filas = await this.consulta()
      .where('customer_id', '=', clienteId)
      .orderBy('starts_at', 'desc')
      .orderBy('id', 'desc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)
      .execute();
    return { total: Number(total), citas: filas.map(aCita) };
  }

  /** Columnas de la cita, filtradas por el tenant del contexto. */
  private consulta() {
    return this.uow
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
        'version',
        'client_confirmed_at',
      ])
      .where('tenant_id', '=', this.tenantContext.actual().valor);
  }
}

function aCita(fila: {
  id: string;
  barber_id: string;
  customer_id: string;
  service_id: string;
  service_name: string;
  price: string;
  duration_min: number;
  starts_at: Date;
  ends_at: Date;
  status: EstadoCita;
  origin: 'EN_LINEA' | 'PRESENCIAL';
  late_cancellation: boolean;
  created_by: string;
  version: number;
  client_confirmed_at: Date | null;
}): Cita {
  return Cita.reconstruir({
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
    version: fila.version,
    confirmadaPorClienteEn: fila.client_confirmed_at,
  });
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
