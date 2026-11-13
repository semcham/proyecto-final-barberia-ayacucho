import { Injectable } from '@nestjs/common';
import { type Actor, BarberiasApi } from '../../../acceso-barberias';
import { AdelantoResuelto, AdelantosApi, SuscripcionesApi } from '../../../suscripciones-pagos';
import { AuditLog, BusDeEventos, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { AutorizacionCatalogoCitas } from '../../catalogo/application/autorizacion';
import { CatalogQuery } from '../../catalogo/application/ports/catalog-query';
import { NoEncontrado } from '../../catalogo/domain/errores';
import { CitaRepository } from './ports/cita-repository';
import { programarRecordatorio } from './recordatorio-de-cita';
import { aVista, type CitaVista } from './reservar-cita';

/**
 * T042 de 008 · El propietario confirma el adelanto de una cita (US3-1, US3-4, US3-5; FR-012, FR-013, FR-015, FR-029;
 * research R01, R06, R08). Es la transición de la CITA (M02 es su dueño), en UNA transacción:
 * 1. bloquea la cita (FOR UPDATE) y, dentro de AdelantosApi.confirmar, el adelanto: siempre en ese orden, el mismo
 *    que el vencimiento (fase 5), así dos operaciones simultáneas se ordenan sin bloqueo mutuo;
 * 2. el adelanto pasa de POR_REVISAR a CONFIRMADO (transición condicional) y la cita, con `aprobar`, de PENDIENTE a
 *    CONFIRMADA;
 * 3. publica AdelantoConfirmado, que hace las veces de CitaCreada (un solo aviso al cliente, con el saldo), programa
 *    el recordatorio de 004 si faltan 2 h o más, y audita.
 * Repetir la confirmación (o la segunda de dos simultáneas) responde 200 sin cambios, sin evento ni auditoría.
 */
@Injectable()
export class ConfirmarAdelanto {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly citas: CitaRepository,
    private readonly adelantos: AdelantosApi,
    private readonly catalogo: CatalogQuery,
    private readonly barberias: BarberiasApi,
    private readonly suscripciones: SuscripcionesApi,
    private readonly eventos: BusDeEventos,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(actor: Actor, citaId: string): Promise<CitaVista> {
    await this.autorizacion.exigir(actor, 'REVISAR_ADELANTO');
    const tenant = TenantId.de(actor.tenantId);
    return this.uow.ejecutar(tenant, async () => {
      // Resolver una pendiente se permite con la suscripción en cualquier estado (research R12).
      await this.suscripciones.exigirOperacion(tenant, 'GESTIONAR_CITAS');
      const cita = await this.citas.buscarParaActualizar(citaId);
      if (!cita) throw new NoEncontrado();
      const ahora = this.reloj.ahora();
      const { efecto, adelanto } = await this.adelantos.confirmar(cita.id, actor.usuarioId, ahora);

      const agenda = await this.barberias.configuracionAgenda();
      const barbero = (await this.catalogo.barbero(cita.barberoId))?.nombre ?? '';
      if (efecto) {
        // La cita ya no espera su adelanto (p. ej., se canceló): se revierte todo, también el adelanto.
        if (cita.estado !== 'PENDIENTE') throw new AdelantoResuelto();
        const anterior = cita.estado;
        cita.aprobar();
        await this.citas.actualizarEstado(cita, anterior, actor.usuarioId);
        await this.auditoria.registrar({
          accion: 'ADELANTO_CONFIRMADO',
          actorId: actor.usuarioId,
          recurso: `cita:${cita.id};${adelanto.estado}`,
          resultado: 'PERMITIDO',
        });
        const zona = new ZonaHoraria(agenda.zonaHoraria);
        // contracts/eventos.md §1 de 008: en lugar de CitaCreada, que la reserva pendiente no publicó (R08).
        await this.eventos.publicar({
          tipo: 'AdelantoConfirmado',
          payload: {
            citaId: cita.id,
            version: cita.version,
            clienteId: cita.clienteId,
            servicio: cita.servicio.nombre,
            barbero,
            inicio: zona.formatoIso(cita.rango.inicio),
            fin: zona.formatoIso(cita.rango.fin),
            zonaHoraria: agenda.zonaHoraria,
            montoCentimos: adelanto.montoCentimos,
            saldoCentimos: adelanto.saldoCentimos,
          },
        });
        // El recordatorio de 004 (FR-025): solo ahora que la cita está confirmada, si faltan 2 h o más.
        await programarRecordatorio(this.eventos, cita, { barbero, zonaHoraria: agenda.zonaHoraria, ahora });
      }
      return { ...aVista(cita, agenda, barbero), adelanto };
    });
  }
}
