import { Injectable } from '@nestjs/common';
import { type Actor, BarberiasApi, ClientesApi } from '../../../acceso-barberias';
import { SuscripcionesApi } from '../../../suscripciones-pagos';
import { AuditLog, BusDeEventos, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { AutorizacionCatalogoCitas } from '../../catalogo/application/autorizacion';
import { CatalogQuery } from '../../catalogo/application/ports/catalog-query';
import { NoEncontrado } from '../../catalogo/domain/errores';
import { CitaRepository } from './ports/cita-repository';
import { aVista, type CitaVista } from './reservar-cita';

/**
 * T117 · Cancelar una cita (RF14; FR-036 a FR-039). La fila queda bloqueada (`FOR UPDATE`) hasta el fin de
 * la transacción. El CLIENTE solo cancela sus citas (cualquier otra es, para él, inexistente: 404) y hasta
 * la hora de inicio; si quedan menos minutos que la antelación de la barbería, la cancelación es tardía. El
 * PROPIETARIO cancela cualquier cita activa de su barbería, nunca tardía. Al cancelar, la restricción de
 * exclusión deja de considerar la cita: el horario queda libre de inmediato (FR-037).
 */
@Injectable()
export class CancelarCita {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly citas: CitaRepository,
    private readonly clientes: ClientesApi,
    private readonly catalogo: CatalogQuery,
    private readonly barberias: BarberiasApi,
    private readonly reloj: Clock,
    private readonly auditoria: AuditLog,
    private readonly suscripciones: SuscripcionesApi,
    private readonly eventos: BusDeEventos,
  ) {}

  async ejecutar(actor: Actor, citaId: string, motivo?: string | null): Promise<CitaVista> {
    const alcance = await this.autorizacion.exigir(actor, 'CANCELAR_CITA');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      // FR-006 (003): las citas existentes se gestionan en cualquier estado (P4: A); la política lo decide.
      await this.suscripciones.exigirOperacion(TenantId.de(actor.tenantId), 'GESTIONAR_CITAS');
      const cita = await this.citas.buscarParaActualizar(citaId);
      if (!cita) throw new NoEncontrado();
      if (alcance === 'PROPIOS') {
        const perfil = await this.clientes.perfilDeSesion(actor.usuarioId);
        if (!perfil || perfil.clienteId !== cita.clienteId) throw new NoEncontrado();
      }

      const agenda = await this.barberias.configuracionAgenda();
      const anterior = cita.estado;
      cita.cancelar(
        { rol: actor.rol === 'CLIENTE' ? 'CLIENTE' : 'PROPIETARIO', usuarioId: actor.usuarioId },
        this.reloj.ahora(),
        agenda.antelacionCancelacionMinutos,
        motivo,
      );
      await this.citas.actualizarEstado(cita, anterior, actor.usuarioId);
      await this.auditoria.registrar({
        accion: 'CITA_CANCELADA',
        actorId: actor.usuarioId,
        recurso: `cita:${cita.id}`,
        resultado: 'PERMITIDO',
      });

      const barbero = await this.catalogo.barbero(cita.barberoId);
      // 004 (T067, FR-010; contracts/eventos.md §3): en la misma transacción; solo lo que el aviso necesita.
      const zona = new ZonaHoraria(agenda.zonaHoraria);
      await this.eventos.publicar({
        tipo: 'CitaCancelada',
        payload: {
          citaId: cita.id,
          clienteId: cita.clienteId,
          servicio: cita.servicio.nombre,
          barbero: barbero?.nombre ?? '',
          ...(barbero?.usuarioId && { barberoUsuarioId: barbero.usuarioId }),
          inicio: zona.formatoIso(cita.rango.inicio),
          zonaHoraria: agenda.zonaHoraria,
          canceladaPor: actor.rol === 'CLIENTE' ? 'CLIENTE' : 'PROPIETARIO',
          tardia: cita.cancelacionTardia,
        },
      });
      return aVista(cita, agenda, barbero?.nombre ?? '');
    });
  }
}
