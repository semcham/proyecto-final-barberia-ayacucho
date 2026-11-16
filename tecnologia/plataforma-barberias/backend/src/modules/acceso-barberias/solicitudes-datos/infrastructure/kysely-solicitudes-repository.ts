import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { FechaLocal, KyselyUnitOfWork, TenantContext } from '../../../../shared';
import {
  type FiltroBandeja,
  type SolicitudConTitular,
  SolicitudesRepository,
} from '../application/ports/solicitudes-repository';
import { SolicitudAbierta } from '../domain/errores';
import {
  type EstadoSolicitud,
  SolicitudDatos,
  type TipoSolicitud,
  type Titular,
} from '../domain/solicitud-datos';

const VIOLACION_DE_UNICIDAD = '23505';
const UNA_ABIERTA = 'data_subject_request_una_abierta';

interface Fila {
  id: string;
  tenant_id: string;
  kind: TipoSolicitud;
  subject_kind: 'CLIENTE' | 'BARBERO';
  customer_id: string | null;
  staff_membership_id: string | null;
  status: EstadoSolicitud;
  detail: string | null;
  response: string | null;
  rejection_reason: string | null;
  registered_by: string;
  on_behalf: boolean;
  received_at: Date;
  due_on: string;
  started_at: Date | null;
  closed_at: Date | null;
  closed_by: string | null;
}

function aSolicitud(fila: Fila): SolicitudDatos {
  const titular: Titular =
    fila.subject_kind === 'CLIENTE'
      ? { tipo: 'CLIENTE', clienteId: fila.customer_id as string }
      : { tipo: 'BARBERO', membresiaId: fila.staff_membership_id as string };
  return SolicitudDatos.reconstruir({
    id: fila.id,
    tenantId: fila.tenant_id,
    tipo: fila.kind,
    titular,
    estado: fila.status,
    detalle: fila.detail,
    respuesta: fila.response,
    motivo: fila.rejection_reason,
    registradaPor: fila.registered_by,
    enNombre: fila.on_behalf,
    recibidaEn: fila.received_at,
    venceEl: FechaLocal.de(fila.due_on),
    enAtencionDesde: fila.started_at,
    cerradaEn: fila.closed_at,
    cerradaPor: fila.closed_by,
  });
}

/** T011 de 007 · `data_subject_request` con Kysely, en la transacción del tenant del token. */
@Injectable()
export class KyselySolicitudesRepository extends SolicitudesRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private get tenantId(): string {
    return this.tenantContext.actual().valor;
  }

  /** Columnas de la solicitud; `due_on` (date) se lee como texto YYYY-MM-DD. */
  private seleccion() {
    return this.uow
      .transaccionActual()
      .selectFrom('data_subject_request as s')
      .select([
        's.id',
        's.tenant_id',
        's.kind',
        's.subject_kind',
        's.customer_id',
        's.staff_membership_id',
        's.status',
        's.detail',
        's.response',
        's.rejection_reason',
        's.registered_by',
        's.on_behalf',
        's.received_at',
        sql<string>`s.due_on::text`.as('due_on'),
        's.started_at',
        's.closed_at',
        's.closed_by',
      ])
      .where('s.tenant_id', '=', this.tenantId);
  }

  /** La selección con el nombre del titular: el del perfil de cliente o el de la cuenta del barbero. */
  private conNombre() {
    return this.seleccion()
      .leftJoin('customer_profile as c', (j) =>
        j.onRef('c.tenant_id', '=', 's.tenant_id').onRef('c.id', '=', 's.customer_id'),
      )
      .leftJoin('membership as m', (j) =>
        j.onRef('m.tenant_id', '=', 's.tenant_id').onRef('m.id', '=', 's.staff_membership_id'),
      )
      .leftJoin('user_account as u', 'u.id', 'm.user_id')
      .select(sql<string>`coalesce(c.full_name, u.full_name, '')`.as('nombre_titular'));
  }

  async crear(solicitud: SolicitudDatos): Promise<void> {
    if (solicitud.tenantId !== this.tenantId)
      throw new Error('La solicitud no pertenece al tenant del contexto');
    const trx = this.uow.transaccionActual();
    const { titular } = solicitud;
    // Un punto de guardado: si el índice de "una abierta" la rechaza, la transacción sigue viva para leer la
    // existente (con dos registros simultáneos, la segunda espera a la primera y ve su fila ya confirmada).
    await sql`savepoint solicitud_nueva`.execute(trx);
    try {
      await trx
        .insertInto('data_subject_request')
        .values({
          id: solicitud.id,
          tenant_id: this.tenantId,
          kind: solicitud.tipo,
          subject_kind: titular.tipo,
          customer_id: titular.tipo === 'CLIENTE' ? titular.clienteId : null,
          staff_membership_id: titular.tipo === 'BARBERO' ? titular.membresiaId : null,
          status: solicitud.estado,
          detail: solicitud.detalle,
          response: null,
          rejection_reason: null,
          registered_by: solicitud.registradaPor,
          on_behalf: solicitud.enNombre,
          received_at: solicitud.recibidaEn,
          due_on: solicitud.venceEl.toString(),
          started_at: null,
          closed_at: null,
          closed_by: null,
        })
        .execute();
    } catch (error) {
      await sql`rollback to savepoint solicitud_nueva`.execute(trx);
      const { code, constraint } = (error ?? {}) as { code?: string; constraint?: string };
      if (code === VIOLACION_DE_UNICIDAD && constraint === UNA_ABIERTA) {
        const existente = await this.abiertaDe(solicitud.tipo, titular);
        if (existente) throw new SolicitudAbierta(existente);
      }
      throw error;
    }
    await sql`release savepoint solicitud_nueva`.execute(trx);
  }

  async abiertaDe(tipo: TipoSolicitud, titular: Titular): Promise<string | null> {
    let consulta = this.uow
      .transaccionActual()
      .selectFrom('data_subject_request')
      .select('id')
      .where('tenant_id', '=', this.tenantId)
      .where('kind', '=', tipo)
      .where('status', 'in', ['RECIBIDA', 'EN_ATENCION']);
    consulta =
      titular.tipo === 'CLIENTE'
        ? consulta.where('customer_id', '=', titular.clienteId)
        : consulta.where('staff_membership_id', '=', titular.membresiaId);
    const fila = await consulta.executeTakeFirst();
    return fila?.id ?? null;
  }

  async paraActualizar(id: string): Promise<SolicitudDatos | null> {
    const fila = await this.seleccion().where('s.id', '=', id).forUpdate().executeTakeFirst();
    return fila ? aSolicitud(fila) : null;
  }

  async guardarTransicion(solicitud: SolicitudDatos): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('data_subject_request')
      .set({
        status: solicitud.estado,
        response: solicitud.respuesta,
        rejection_reason: solicitud.motivo,
        started_at: solicitud.enAtencionDesde,
        closed_at: solicitud.cerradaEn,
        closed_by: solicitud.cerradaPor,
      })
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', solicitud.id)
      .execute();
  }

  async delTitular(titular: Titular): Promise<SolicitudDatos[]> {
    const consulta =
      titular.tipo === 'CLIENTE'
        ? this.seleccion().where('s.customer_id', '=', titular.clienteId)
        : this.seleccion().where('s.staff_membership_id', '=', titular.membresiaId);
    const filas = await consulta.orderBy('s.received_at').orderBy('s.id').execute();
    return filas.map(aSolicitud);
  }

  async bandeja(filtro: FiltroBandeja): Promise<SolicitudConTitular[]> {
    const estados: EstadoSolicitud[] = filtro === 'ABIERTAS' ? ['RECIBIDA', 'EN_ATENCION'] : [filtro];
    const filas = await this.conNombre()
      .where('s.status', 'in', estados)
      .orderBy('s.received_at')
      .orderBy('s.id')
      .execute();
    return filas.map((fila) => ({
      solicitud: aSolicitud(fila),
      titular: { tipo: fila.subject_kind, nombre: fila.nombre_titular },
    }));
  }

  async conTitular(id: string): Promise<SolicitudConTitular | null> {
    const fila = await this.conNombre().where('s.id', '=', id).executeTakeFirst();
    return fila
      ? { solicitud: aSolicitud(fila), titular: { tipo: fila.subject_kind, nombre: fila.nombre_titular } }
      : null;
  }
}
