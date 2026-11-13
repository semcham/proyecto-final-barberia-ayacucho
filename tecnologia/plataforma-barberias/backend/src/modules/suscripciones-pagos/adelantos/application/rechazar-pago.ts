import { Injectable } from '@nestjs/common';
import { AuditLog, BusDeEventos, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import type { ResumenDeAdelanto } from '../../adelantos-api';
import { SuscripcionesApi } from '../../suscripciones-api';
import {
  type ActorDeBarberia,
  AutorizacionSuscripciones,
} from '../../suscripciones/application/autorizacion';
import { NoEncontrado } from '../../suscripciones/domain/errores';
import { Adelanto } from '../domain/adelanto';
import { motivoDeRechazo } from '../domain/motivo-rechazo';
import { AdelantoRepository } from './ports/adelanto-repository';
import { aResumen } from './vista-adelanto';

/**
 * T041 de 008 · El propietario rechaza el pago registrado de un adelanto (US3-2; FR-014, FR-029):
 * - solo el propietario (REVISAR_ADELANTO), con la barbería del token; la suscripción debe permitir
 *   GESTIONAR_CITAS (research R12: se permite en todo estado, para resolver las pendientes);
 * - con un motivo de 5 a 300 caracteres (validado antes de abrir la transacción);
 * - con el adelanto bloqueado: POR_REVISAR → POR_PAGAR con la hora límite ORIGINAL; el registro rechazado se conserva
 *   con su motivo y el número sigue sin poder repetirse (research R07);
 * - publica PagoDeAdelantoRechazado (al cliente, con el motivo) y audita sin el motivo ni el número.
 * No cambia la cita: sigue PENDIENTE, con el horario retenido.
 */
@Injectable()
export class RechazarPagoDeAdelanto {
  constructor(
    private readonly autorizacion: AutorizacionSuscripciones,
    private readonly uow: UnitOfWork,
    private readonly adelantos: AdelantoRepository,
    private readonly suscripciones: SuscripcionesApi,
    private readonly eventos: BusDeEventos,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(
    actor: ActorDeBarberia,
    citaId: string,
    motivoRecibido: string | undefined,
  ): Promise<ResumenDeAdelanto> {
    await this.autorizacion.exigir(actor, 'REVISAR_ADELANTO');
    const motivo = motivoDeRechazo(motivoRecibido);
    const tenant = TenantId.de(actor.tenantId);

    return this.uow.ejecutar(tenant, async () => {
      await this.suscripciones.exigirOperacion(tenant, 'GESTIONAR_CITAS');
      const adelanto = await this.adelantos.deCita(citaId, { bloquear: true });
      if (!adelanto) throw new NoEncontrado();
      const nuevoEstado = Adelanto.rechazar(adelanto.estado);
      const ahora = this.reloj.ahora();

      const pago = (await this.adelantos.ultimosPagos([adelanto.id])).get(adelanto.id);
      if (!pago || pago.resultado !== null) throw new Error('Un adelanto POR_REVISAR sin registro vigente');
      await this.adelantos.revisarPago(pago.id, {
        resultado: 'RECHAZADO',
        por: actor.usuarioId,
        en: ahora,
        motivo,
      });
      const cambiado = await this.adelantos.cambiarEstado(adelanto.id, {
        desde: adelanto.estado,
        hacia: nuevoEstado,
        en: ahora,
      });
      if (!cambiado) throw new Error('El adelanto cambió durante la transacción a pesar del bloqueo');

      const zona = new ZonaHoraria(adelanto.zonaHoraria);
      // contracts/eventos.md §1: con el motivo (lo lee el cliente) y sin el número de operación (FR-024).
      await this.eventos.publicar({
        tipo: 'PagoDeAdelantoRechazado',
        payload: {
          citaId: adelanto.citaId,
          clienteId: adelanto.clienteId,
          servicio: adelanto.servicio,
          inicio: zona.formatoIso(adelanto.inicio),
          zonaHoraria: adelanto.zonaHoraria,
          montoCentimos: adelanto.montoCentimos,
          codigo: adelanto.codigo,
          horaLimite: zona.formatoIso(adelanto.horaLimite),
          motivo,
        },
      });
      // Sin texto libre en la auditoría (como en 003): el motivo queda en el registro de pago.
      await this.auditoria.registrar({
        accion: 'ADELANTO_PAGO_RECHAZADO',
        actorId: actor.usuarioId,
        recurso: `cita:${adelanto.citaId};${nuevoEstado}`,
        resultado: 'PERMITIDO',
      });

      const actualizado = await this.adelantos.deCita(citaId);
      const ultimo = (await this.adelantos.ultimosPagos([adelanto.id])).get(adelanto.id) ?? null;
      if (!actualizado) throw new Error('El adelanto desapareció en la transacción');
      return aResumen(actualizado, ultimo);
    });
  }
}
