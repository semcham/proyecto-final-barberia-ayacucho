import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { sql } from 'kysely';
import { Adelanto, type EstadoAdelanto } from '../domain/adelanto';
import { generarCodigoDeReserva } from '../domain/codigo-reserva';
import { NumeroOperacionRepetido, PagoYaRegistrado } from '../domain/errores';
import {
  type AdelantoGuardado,
  type AdelantoNuevo,
  AdelantoRepository,
  type PagoDeAdelanto,
  type PagoNuevo,
} from '../application/ports/adelanto-repository';

/** Intentos con códigos distintos antes de rendirse (con 31^6 códigos por barbería, chocar dos veces es rarísimo). */
const INTENTOS_DE_CODIGO = 5;

const COLUMNAS = [
  'id',
  'appointment_id',
  'customer_id',
  'customer_user_id',
  'code',
  'amount_cents',
  'service_price_cents',
  'service_name',
  'starts_at',
  'time_zone',
  'qr_file_id',
  'due_at',
  'review_limit_at',
  'status',
  'resolved_at',
  'refunded_at',
] as const;

interface Fila {
  id: string;
  appointment_id: string;
  customer_id: string;
  customer_user_id: string;
  code: string;
  amount_cents: number;
  service_price_cents: number;
  service_name: string;
  starts_at: Date;
  time_zone: string;
  qr_file_id: string;
  due_at: Date;
  review_limit_at: Date;
  status: EstadoAdelanto;
  resolved_at: Date | null;
  refunded_at: Date | null;
}

function aAdelanto(f: Fila): AdelantoGuardado {
  return {
    id: f.id,
    citaId: f.appointment_id,
    clienteId: f.customer_id,
    usuarioClienteId: f.customer_user_id,
    codigo: f.code,
    montoCentimos: f.amount_cents,
    precioCentimos: f.service_price_cents,
    servicio: f.service_name,
    inicio: f.starts_at,
    zonaHoraria: f.time_zone,
    qrArchivoId: f.qr_file_id,
    horaLimite: f.due_at,
    limiteRevision: f.review_limit_at,
    estado: f.status,
    resueltoEn: f.resolved_at,
    devueltoEn: f.refunded_at,
  };
}

/**
 * T029 de 008 · booking_deposit y booking_deposit_payment con Kysely, en la transacción en curso, con RLS y filtro
 * explícito por la barbería del contexto. El código de la reserva sale de node:crypto (research R07).
 */
@Injectable()
export class KyselyAdelantoRepository extends AdelantoRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private tenant(): string {
    return this.tenantContext.actual().valor;
  }

  async crear(nuevo: AdelantoNuevo): Promise<AdelantoGuardado> {
    const trx = this.uow.transaccionActual();
    for (let intento = 1; intento <= INTENTOS_DE_CODIGO; intento += 1) {
      // ON CONFLICT (tenant_id, code) DO NOTHING: un código repetido no aborta la transacción de la reserva.
      const fila = await trx
        .insertInto('booking_deposit')
        .values({
          id: uuidv7(),
          tenant_id: this.tenant(),
          appointment_id: nuevo.citaId,
          customer_id: nuevo.clienteId,
          customer_user_id: nuevo.usuarioClienteId,
          code: generarCodigoDeReserva((n) => randomBytes(n)),
          amount_cents: nuevo.montoCentimos,
          service_price_cents: nuevo.precioCentimos,
          service_name: nuevo.servicio,
          starts_at: nuevo.inicio,
          time_zone: nuevo.zonaHoraria,
          qr_file_id: nuevo.qrArchivoId,
          due_at: nuevo.horaLimite,
          review_limit_at: nuevo.limiteRevision,
        })
        .onConflict((oc) => oc.columns(['tenant_id', 'code']).doNothing())
        .returning(COLUMNAS)
        .executeTakeFirst();
      if (fila) return aAdelanto(fila);
    }
    throw new Error('No se pudo generar un código de reserva único');
  }

  async deCita(citaId: string, opciones: { bloquear?: boolean } = {}): Promise<AdelantoGuardado | null> {
    let consulta = this.uow
      .transaccionActual()
      .selectFrom('booking_deposit')
      .select(COLUMNAS)
      .where('tenant_id', '=', this.tenant())
      .where('appointment_id', '=', citaId);
    if (opciones.bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila ? aAdelanto(fila) : null;
  }

  async deCitas(citaIds: readonly string[]): Promise<AdelantoGuardado[]> {
    if (citaIds.length === 0) return [];
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('booking_deposit')
      .select(COLUMNAS)
      .where('tenant_id', '=', this.tenant())
      .where('appointment_id', 'in', [...citaIds])
      .execute();
    return filas.map(aAdelanto);
  }

  async ultimosPagos(adelantoIds: readonly string[]): Promise<Map<string, PagoDeAdelanto>> {
    if (adelantoIds.length === 0) return new Map();
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('booking_deposit_payment')
      .select([
        'id',
        'deposit_id',
        'operation_number',
        'file_id',
        'registered_at',
        'registered_by',
        'review_result',
        'reviewed_at',
        'rejection_reason',
      ])
      .distinctOn('deposit_id')
      .where('tenant_id', '=', this.tenant())
      .where('deposit_id', 'in', [...adelantoIds])
      .orderBy('deposit_id')
      .orderBy('registered_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return new Map(
      filas.map((f) => [
        f.deposit_id,
        {
          id: f.id,
          adelantoId: f.deposit_id,
          numeroOperacion: f.operation_number,
          archivoId: f.file_id,
          registradoEn: f.registered_at,
          registradoPor: f.registered_by,
          resultado: f.review_result,
          revisadoEn: f.reviewed_at,
          motivoRechazo: f.rejection_reason,
        },
      ]),
    );
  }

  async registrarPago(nuevo: PagoNuevo): Promise<void> {
    try {
      await this.uow
        .transaccionActual()
        .insertInto('booking_deposit_payment')
        .values({
          id: nuevo.id,
          tenant_id: this.tenant(),
          deposit_id: nuevo.adelantoId,
          operation_number: nuevo.numeroOperacion,
          file_id: nuevo.archivoId,
          registered_at: nuevo.registradoEn,
          registered_by: nuevo.registradoPor,
        })
        .execute();
    } catch (error) {
      const { code, constraint } = (error ?? {}) as { code?: string; constraint?: string };
      if (code === '23505' && constraint === 'booking_deposit_payment_numero_unico') {
        throw new NumeroOperacionRepetido();
      }
      if (code === '23505' && constraint === 'booking_deposit_payment_uno_vigente') {
        throw new PagoYaRegistrado();
      }
      throw error;
    }
  }

  async revisarPago(
    pagoId: string,
    revision: { resultado: 'CONFIRMADO' | 'RECHAZADO'; por: string; en: Date; motivo: string | null },
  ): Promise<boolean> {
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('booking_deposit_payment')
      .set({
        review_result: revision.resultado,
        reviewed_at: revision.en,
        reviewed_by: revision.por,
        rejection_reason: revision.motivo,
      })
      .where('tenant_id', '=', this.tenant())
      .where('id', '=', pagoId)
      .where('review_result', 'is', null)
      .executeTakeFirst();
    return Number(resultado.numUpdatedRows) === 1;
  }

  async porEstado(estado: EstadoAdelanto, limite: number): Promise<AdelantoGuardado[]> {
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('booking_deposit')
      .select(COLUMNAS)
      .where('tenant_id', '=', this.tenant())
      .where('status', '=', estado)
      .orderBy('due_at')
      .orderBy('id')
      .limit(limite)
      .execute();
    return filas.map(aAdelanto);
  }

  async cambiarEstado(
    adelantoId: string,
    cambio: { desde: EstadoAdelanto; hacia: EstadoAdelanto; en: Date },
  ): Promise<boolean> {
    // resolved_at: nulo mientras sigue pendiente; la primera vez que se resuelve, la fecha (CHECK resuelto).
    const resuelto = Adelanto.estaPendiente(cambio.hacia)
      ? null
      : sql<Date>`coalesce(resolved_at, ${cambio.en})`;
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('booking_deposit')
      .set({ status: cambio.hacia, resolved_at: resuelto })
      .where('tenant_id', '=', this.tenant())
      .where('id', '=', adelantoId)
      .where('status', '=', cambio.desde)
      .executeTakeFirst();
    return Number(resultado.numUpdatedRows) === 1;
  }
}
