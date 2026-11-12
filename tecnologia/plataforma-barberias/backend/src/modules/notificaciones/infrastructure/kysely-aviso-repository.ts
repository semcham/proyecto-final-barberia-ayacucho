import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork, TenantContext } from '../../../shared';
import { type AvisoReclamado, AvisoRepository, type NuevoAviso } from '../application/ports/aviso-repository';
import type { CanalDeAviso } from '../application/ports/notification-channel';
import {
  type CodigoErrorAviso,
  ESTADOS_FINALES,
  type TipoAviso,
  type TipoDestinatario,
} from '../domain/aviso';

/**
 * T070 de 004 · Avisos con Kysely (data-model.md §4). Usa la transacción del caso de uso (o del despacho) y filtra
 * además por el tenant del contexto. El contenido del mensaje sale del evento de origen (`outbox_event`, misma
 * barbería): el aviso no guarda texto ni datos de contacto (R12).
 */
@Injectable()
export class KyselyAvisoRepository extends AvisoRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private get tenantId(): string {
    return this.tenantContext.actual().valor;
  }

  async crear(avisos: readonly NuevoAviso[]): Promise<number> {
    if (avisos.length === 0) return 0;
    const resultado = await this.uow
      .transaccionActual()
      .insertInto('notification')
      .values(
        avisos.map((aviso) => ({
          id: aviso.id,
          tenant_id: this.tenantId,
          event_id: aviso.eventoId,
          kind: aviso.tipo,
          recipient_kind: aviso.destinatario.tipo,
          recipient_ref: aviso.destinatario.ref,
          appointment_id: aviso.citaId,
          channel_planned: aviso.canalPrevisto,
          discard_after: aviso.descartarDespues,
        })),
      )
      // FR-012: el mismo evento nunca crea dos avisos para el mismo destinatario.
      .onConflict((oc) => oc.constraint('notification_un_aviso_por_destinatario').doNothing())
      .executeTakeFirst();
    return Number(resultado.numInsertedOrUpdatedRows ?? 0);
  }

  async reclamar(id: string, ahora: Date, plazoMs: number): Promise<AvisoReclamado | null> {
    const trx = this.uow.transaccionActual();
    const fila = await trx
      .selectFrom('notification')
      .select([
        'id',
        'kind',
        'recipient_kind',
        'recipient_ref',
        'appointment_id',
        'attempts',
        'discard_after',
        'event_id',
      ])
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', id)
      .where((eb) =>
        eb.or([
          eb.and([
            eb('status', '=', 'PENDIENTE'),
            eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', ahora)]),
          ]),
          // Reclamado por una réplica que cayó antes de anotar el resultado (ADR-025).
          eb.and([eb('status', '=', 'ENVIANDO'), eb('claimed_until', '<', ahora)]),
        ]),
      )
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!fila) return null;

    await trx
      .updateTable('notification')
      .set({ status: 'ENVIANDO', claimed_until: new Date(ahora.getTime() + plazoMs) })
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', id)
      .execute();

    const evento = await trx
      .selectFrom('outbox_event')
      .select(['type', 'payload'])
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', fila.event_id)
      .executeTakeFirst();
    return {
      id: fila.id,
      tipo: fila.kind as TipoAviso,
      destinatario: { tipo: fila.recipient_kind as TipoDestinatario, ref: fila.recipient_ref },
      citaId: fila.appointment_id,
      intentos: fila.attempts,
      descartarDespues: fila.discard_after,
      evento: evento ? { tipo: evento.type, payload: evento.payload } : null,
    };
  }

  async marcarEnviado(
    id: string,
    canal: CanalDeAviso,
    ahora: Date,
    opciones: { respaldo?: boolean; intentos?: number } = {},
  ): Promise<void> {
    await this.reclamado(id)
      .set({
        status: opciones.respaldo ? 'ENVIADO_RESPALDO' : 'ENVIADO',
        channel_used: canal,
        sent_at: ahora,
        claimed_until: null,
        last_error: null,
        ...(opciones.intentos !== undefined && { attempts: opciones.intentos }),
      })
      .execute();
  }

  async reintentar(
    id: string,
    intentos: number,
    proximoIntento: Date,
    error: CodigoErrorAviso,
  ): Promise<void> {
    await this.reclamado(id)
      .set({
        status: 'PENDIENTE',
        attempts: intentos,
        next_attempt_at: proximoIntento,
        claimed_until: null,
        last_error: error,
      })
      .execute();
  }

  async finalizar(
    id: string,
    estado: 'FALLIDO' | 'DESCARTADO',
    intentos: number,
    error?: CodigoErrorAviso | null,
  ): Promise<void> {
    await this.reclamado(id)
      .set({
        status: estado,
        attempts: intentos,
        claimed_until: null,
        next_attempt_at: null,
        ...(error !== undefined && { last_error: error }),
      })
      .execute();
  }

  async descartarRecordatoriosDe(citaId: string): Promise<number> {
    const resultado = await this.uow
      .transaccionActual()
      .updateTable('notification')
      .set({ status: 'DESCARTADO', next_attempt_at: null })
      .where('tenant_id', '=', this.tenantId)
      .where('appointment_id', '=', citaId)
      .where('kind', '=', 'RECORDATORIO')
      .where('status', '=', 'PENDIENTE')
      .executeTakeFirst();
    return Number(resultado.numUpdatedRows);
  }

  async purgar(limite: Date, lote: number): Promise<number> {
    const trx = this.uow.transaccionActual();
    const resultado = await trx
      .deleteFrom('notification')
      .where(
        'id',
        'in',
        trx
          .selectFrom('notification')
          .select('id')
          .where('tenant_id', '=', this.tenantId)
          .where('status', 'in', ESTADOS_FINALES)
          .where('created_at', '<', limite)
          .orderBy('created_at')
          .limit(lote),
      )
      .executeTakeFirst();
    return Number(resultado.numDeletedRows);
  }

  /** UPDATE de un aviso que esta réplica tiene reclamado (sigue ENVIANDO). */
  private reclamado(id: string) {
    return this.uow
      .transaccionActual()
      .updateTable('notification')
      .where('tenant_id', '=', this.tenantId)
      .where('id', '=', id)
      .where('status', '=', 'ENVIANDO');
  }
}
