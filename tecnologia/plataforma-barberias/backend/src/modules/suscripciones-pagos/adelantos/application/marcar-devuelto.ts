import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, TenantId, UnitOfWork } from '../../../../shared';
import type { ResumenDeAdelanto } from '../../adelantos-api';
import { SuscripcionesApi } from '../../suscripciones-api';
import {
  type ActorDeBarberia,
  AutorizacionSuscripciones,
} from '../../suscripciones/application/autorizacion';
import { NoEncontrado } from '../../suscripciones/domain/errores';
import { Adelanto } from '../domain/adelanto';
import { AdelantoRepository } from './ports/adelanto-repository';
import { aResumen } from './vista-adelanto';

/**
 * T057 de 008 · El propietario marca que devolvió el adelanto (US5-6; FR-022, FR-029; aclaración Q2):
 * - solo el propietario (REVISAR_ADELANTO), con la barbería del token (otra barbería o una cita sin adelanto: 404);
 *   la suscripción debe permitir GESTIONAR_CITAS (research R12: se permite en todo estado);
 * - con el adelanto bloqueado, solo desde POR_DEVOLVER → DEVUELTO, con la fecha y quién (transición condicional); un
 *   adelanto retenido, pendiente, confirmado o ya devuelto responde 409 ADELANTO_NO_POR_DEVOLVER sin cambios;
 * - audita ADELANTO_DEVUELTO sin datos del pago (ni el número ni la captura). No hay aviso (plan, paso 7).
 * La plataforma no mueve dinero: solo anota lo que el propietario hizo en su propia aplicación.
 */
@Injectable()
export class MarcarAdelantoDevuelto {
  constructor(
    private readonly autorizacion: AutorizacionSuscripciones,
    private readonly uow: UnitOfWork,
    private readonly adelantos: AdelantoRepository,
    private readonly suscripciones: SuscripcionesApi,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(actor: ActorDeBarberia, citaId: string): Promise<ResumenDeAdelanto> {
    await this.autorizacion.exigir(actor, 'REVISAR_ADELANTO');
    const tenant = TenantId.de(actor.tenantId);

    return this.uow.ejecutar(tenant, async () => {
      await this.suscripciones.exigirOperacion(tenant, 'GESTIONAR_CITAS');
      const adelanto = await this.adelantos.deCita(citaId, { bloquear: true });
      if (!adelanto) throw new NoEncontrado();
      const nuevoEstado = Adelanto.marcarDevuelto(adelanto.estado);
      const ahora = this.reloj.ahora();
      const marcado = await this.adelantos.marcarDevuelto(adelanto.id, { por: actor.usuarioId, en: ahora });
      if (!marcado) throw new Error('El adelanto cambió durante la transacción a pesar del bloqueo');
      await this.auditoria.registrar({
        accion: 'ADELANTO_DEVUELTO',
        actorId: actor.usuarioId,
        recurso: `cita:${adelanto.citaId};${nuevoEstado}`,
        resultado: 'PERMITIDO',
      });

      const actualizado = await this.adelantos.deCita(citaId);
      if (!actualizado) throw new Error('El adelanto desapareció en la transacción');
      const ultimo = (await this.adelantos.ultimosPagos([adelanto.id])).get(adelanto.id) ?? null;
      return aResumen(actualizado, ultimo);
    });
  }
}
