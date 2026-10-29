import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import {
  type CambioDePago,
  EventoProveedorRepository,
  type EventoDelProveedor,
  PagoRepository,
  type PagoNuevo,
  YaHayPagoAbierto,
} from '../application/ports/pago-repository';
import { NumeroOperacionYaAprobado } from '../domain/errores';
import { ESTADOS_ABIERTOS, type MarcaRevision, type Pago } from '../domain/pago';

const COLUMNAS = [
  'id',
  'tenant_id',
  'subscription_id',
  'plan_id',
  'amount_cents',
  'currency',
  'method',
  'status',
  'covers_after',
  'review',
  'provider_reference',
  'checkout_url',
  'checkout_url_expires_at',
  'bank_operation_last4',
  'transfer_reference',
  'rejection_reason',
  'created_by',
  'created_at',
  'approved_at',
  'closed_at',
] as const;

// `date` como texto: el driver lo convertiría en un Date a la medianoche local y podría correr el día.
const FECHA_TRANSFERENCIA = sql<string | null>`to_char(transfer_date, 'YYYY-MM-DD')`.as(
  'fecha_transferencia',
);
const NUMERO_APROBADO = 'payment_numero_operacion_aprobado';

interface FilaPago {
  id: string;
  tenant_id: string;
  subscription_id: string;
  plan_id: string;
  amount_cents: number;
  currency: string;
  method: Pago['metodo'];
  status: Pago['estado'];
  covers_after: Date;
  review: Pago['marca'];
  provider_reference: string | null;
  checkout_url: string | null;
  checkout_url_expires_at: Date | null;
  bank_operation_last4: string | null;
  transfer_reference: string | null;
  fecha_transferencia: string | null;
  rejection_reason: string | null;
  created_by: string;
  created_at: Date;
  approved_at: Date | null;
  closed_at: Date | null;
}

function aPago(f: FilaPago): Pago {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    suscripcionId: f.subscription_id,
    planId: f.plan_id,
    importeCentimos: f.amount_cents,
    moneda: f.currency,
    metodo: f.method,
    estado: f.status,
    cubreDesde: f.covers_after,
    marca: f.review,
    referenciaProveedor: f.provider_reference,
    urlPago: f.checkout_url,
    sesionExpiraEn: f.checkout_url_expires_at,
    numeroOperacionFinal: f.bank_operation_last4,
    referenciaTransferencia: f.transfer_reference,
    fechaTransferencia: f.fecha_transferencia,
    motivoRechazo: f.rejection_reason,
    creadoPor: f.created_by,
    creadoEn: f.created_at,
    aprobadoEn: f.approved_at,
    cerradoEn: f.closed_at,
  };
}

const esViolacionDe = (error: unknown, restriccion: string) => {
  const { code, constraint } = (error ?? {}) as { code?: string; constraint?: string };
  return code === '23505' && constraint === restriccion;
};

/** T043 · Pagos de la barbería del contexto, con RLS y filtro explícito por tenant. */
@Injectable()
export class KyselyPagoRepository extends PagoRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private consulta() {
    return this.uow
      .transaccionActual()
      .selectFrom('payment')
      .select([...COLUMNAS, FECHA_TRANSFERENCIA])
      .where('tenant_id', '=', this.tenantContext.actual().valor);
  }

  async porId(id: string, opciones: { bloquear?: boolean } = {}): Promise<Pago | null> {
    let consulta = this.consulta().where('id', '=', id);
    if (opciones.bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila ? aPago(fila) : null;
  }

  async abiertoDe(suscripcionId: string, opciones: { bloquear?: boolean } = {}): Promise<Pago | null> {
    let consulta = this.consulta()
      .where('subscription_id', '=', suscripcionId)
      .where('status', 'in', [...ESTADOS_ABIERTOS]);
    if (opciones.bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila ? aPago(fila) : null;
  }

  async insertar(pago: PagoNuevo): Promise<void> {
    const trx = this.uow.transaccionActual();
    await sql`savepoint pago_nuevo`.execute(trx);
    try {
      await trx
        .insertInto('payment')
        .values({
          id: pago.id,
          tenant_id: this.tenantContext.actual().valor,
          subscription_id: pago.suscripcionId,
          plan_id: pago.planId,
          amount_cents: pago.importeCentimos,
          currency: pago.moneda,
          method: pago.metodo,
          status: pago.estado,
          covers_after: pago.cubreDesde,
          created_by: pago.creadoPor,
          transfer_reference: pago.referenciaTransferencia ?? null,
        })
        .execute();
    } catch (error) {
      await sql`rollback to savepoint pago_nuevo`.execute(trx);
      if (esViolacionDe(error, 'payment_un_pago_abierto')) throw new YaHayPagoAbierto();
      throw error;
    }
    await sql`release savepoint pago_nuevo`.execute(trx);
  }

  async fijarSesion(id: string, sesion: { referencia: string; url: string; expiraEn: Date }): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('payment')
      .set({
        provider_reference: sesion.referencia,
        checkout_url: sesion.url,
        checkout_url_expires_at: sesion.expiraEn,
      })
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', id)
      .execute();
  }

  async cambiar(id: string, cambio: CambioDePago): Promise<boolean> {
    const cierra = ESTADOS_ABIERTOS.includes(cambio.desde) && !ESTADOS_ABIERTOS.includes(cambio.hacia);
    const aprueba = cambio.hacia === 'APROBADO' && cambio.desde !== 'APROBADO';
    let resultado;
    try {
      resultado = await this.uow
        .transaccionActual()
        .updateTable('payment')
        .set({
          status: cambio.hacia,
          ...(cambio.marca ? { review: cambio.marca } : {}),
          ...(aprueba ? { approved_at: sql<Date>`now()` } : {}),
          ...(cierra ? { closed_at: sql<Date>`now()` } : {}),
        })
        .where('tenant_id', '=', this.tenantContext.actual().valor)
        .where('id', '=', id)
        .where('status', '=', cambio.desde)
        .executeTakeFirst();
    } catch (error) {
      // El índice global payment_numero_operacion_aprobado (FR-022b): la transacción entera se deshace,
      // también el período que se acababa de insertar.
      if (esViolacionDe(error, NUMERO_APROBADO)) throw new NumeroOperacionYaAprobado();
      throw error;
    }
    return Number(resultado.numUpdatedRows) === 1;
  }

  async fijarDatosDeTransferencia(
    id: string,
    datos: { numeroOperacion: string; fecha: string },
  ): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('payment')
      .set({ bank_operation_number: datos.numeroOperacion, transfer_date: datos.fecha })
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', id)
      .execute();
  }

  async fijarMotivoRechazo(id: string, motivo: string): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('payment')
      .set({ rejection_reason: motivo })
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', id)
      .execute();
  }

  async historial(pagina: number, tamano: number): Promise<{ pagos: Pago[]; total: number }> {
    const filas = await this.consulta()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)
      .execute();
    const { total } = await this.uow
      .transaccionActual()
      .selectFrom('payment')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .executeTakeFirstOrThrow();
    return { pagos: filas.map(aPago), total: Number(total) };
  }

  async periodosDe(ids: readonly string[]): Promise<Map<string, { inicio: Date; fin: Date }>> {
    if (ids.length === 0) return new Map();
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('subscription_period')
      .select(['payment_id', 'starts_at', 'ends_at'])
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('payment_id', 'in', [...ids])
      .execute();
    return new Map(filas.map((f) => [f.payment_id, { inicio: f.starts_at, fin: f.ends_at }]));
  }

  async resolverMarca(id: string, marca: MarcaRevision, nota: string): Promise<boolean> {
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('payment')
      .set({ review_resolved_at: sql<Date>`now()`, review_note: nota })
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', id)
      .where('review', '=', marca)
      .where('review_resolved_at', 'is', null)
      .executeTakeFirst();
    return Number(resultado.numUpdatedRows) === 1;
  }

  async numeroOperacion(id: string): Promise<string | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('payment')
      .select('bank_operation_number')
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('id', '=', id)
      .executeTakeFirst();
    return fila?.bank_operation_number ?? null;
  }

  async periodoDe(id: string): Promise<{ inicio: Date; fin: Date } | null> {
    const fila = await this.uow
      .transaccionActual()
      .selectFrom('subscription_period')
      .select(['starts_at', 'ends_at'])
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('payment_id', '=', id)
      .executeTakeFirst();
    return fila ? { inicio: fila.starts_at, fin: fila.ends_at } : null;
  }
}

/**
 * T043 · provider_event (tabla de la plataforma): solo INSERT, sin leer ni actualizar (C1). Sin destino en
 * ON CONFLICT a propósito: ON CONFLICT (event_id) exigiría SELECT sobre event_id; event_id es la única clave
 * única de la tabla, así que el efecto es el mismo.
 */
@Injectable()
export class KyselyEventoProveedorRepository extends EventoProveedorRepository {
  constructor(private readonly uow: KyselyUnitOfWork) {
    super();
  }

  async registrar(evento: EventoDelProveedor): Promise<boolean> {
    const resultado = await this.uow
      .transaccionActual()
      .insertInto('provider_event')
      .values({
        event_id: evento.eventoId,
        provider_reference: evento.referencia,
        reported_status: evento.estado,
        amount_cents: evento.importeCentimos,
        currency: evento.moneda.slice(0, 3),
        tenant_id: evento.tenantId,
        payment_id: evento.pagoId,
        effect: evento.efecto,
      })
      .onConflict((oc) => oc.doNothing())
      .executeTakeFirst();
    return Number(resultado.numInsertedOrUpdatedRows ?? 0) === 1;
  }
}
