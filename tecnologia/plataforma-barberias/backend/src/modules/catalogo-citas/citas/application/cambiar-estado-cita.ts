import { Injectable } from '@nestjs/common';
import { type Actor, BarberiasApi } from '../../../acceso-barberias';
import { AdelantoPendiente, AdelantosApi, SuscripcionesApi } from '../../../suscripciones-pagos';
import { AuditLog, BusDeEventos, Clock, TenantId, UnitOfWork } from '../../../../shared';
import { AutorizacionCatalogoCitas } from '../../catalogo/application/autorizacion';
import { BarberoRepository } from '../../catalogo/application/ports/catalogo-repositorios';
import { CatalogQuery } from '../../catalogo/application/ports/catalog-query';
import { NoEncontrado } from '../../catalogo/domain/errores';
import { CitaRepository } from './ports/cita-repository';
import { anularRecordatorio } from './recordatorio-de-cita';
import { aVista, type CitaVista } from './reservar-cita';

export type EstadoDestino = 'CONFIRMADA' | 'COMPLETADA' | 'NO_ASISTIO';

/**
 * T105 · Cambiar el estado de una cita desde la barbería (RF15; FR-041 a FR-043; R10). La fila queda
 * bloqueada (`FOR UPDATE`) hasta el fin de la transacción: de dos cambios simultáneos, el segundo ve el
 * estado que dejó el primero y recibe `TRANSICION_INVALIDA`. El BARBERO solo opera las citas del barbero
 * vinculado a su usuario; cualquier otra es, para él, inexistente (404). Historial y auditoría en la misma
 * transacción.
 */
@Injectable()
export class CambiarEstadoCita {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly citas: CitaRepository,
    private readonly barberos: BarberoRepository,
    private readonly catalogo: CatalogQuery,
    private readonly barberias: BarberiasApi,
    private readonly reloj: Clock,
    private readonly auditoria: AuditLog,
    private readonly suscripciones: SuscripcionesApi,
    private readonly eventos: BusDeEventos,
    private readonly adelantos: AdelantosApi,
  ) {}

  async ejecutar(actor: Actor, citaId: string, destino: EstadoDestino): Promise<CitaVista> {
    const alcance = await this.autorizacion.exigir(actor, 'CAMBIAR_ESTADO_CITA');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      // FR-006 (003): las citas existentes se gestionan en cualquier estado (P4: A); la política lo decide.
      await this.suscripciones.exigirOperacion(TenantId.de(actor.tenantId), 'GESTIONAR_CITAS');
      const cita = await this.citas.buscarParaActualizar(citaId);
      if (!cita) throw new NoEncontrado();
      if (alcance === 'PROPIOS') {
        const propio = await this.barberos.porUsuario(actor.usuarioId);
        if (!propio || propio.id !== cita.barberoId) throw new NoEncontrado();
      }

      // 008 (research R15): una cita con adelanto se confirma solo con la confirmación del adelanto, que exige un pago
      // registrado; aprobarla aquí la dejaría confirmada sin revisar el pago. 409 para el propietario y el barbero.
      if (destino === 'CONFIRMADA' && (await this.adelantos.deCita(cita.id))) throw new AdelantoPendiente();

      const anterior = cita.estado;
      const ahora = this.reloj.ahora();
      cita.cambiarA(destino, ahora);
      await this.citas.actualizarEstado(cita, anterior, actor.usuarioId);
      await this.auditoria.registrar({
        accion: 'CITA_ESTADO_CAMBIADO',
        actorId: actor.usuarioId,
        recurso: `cita:${cita.id}`,
        resultado: 'PERMITIDO',
      });
      // 008 (T058; FR-021): si no asistió, el adelanto confirmado queda RETENIDO. Completada, sigue CONFIRMADO: ya se
      // descontó del precio (FR-020).
      if (destino === 'NO_ASISTIO') {
        const adelanto = await this.adelantos.alNoAsistir(cita.id, ahora);
        if (adelanto) {
          await this.auditoria.registrar({
            accion: 'ADELANTO_RESUELTO',
            actorId: actor.usuarioId,
            recurso: `cita:${cita.id};${adelanto}`,
            resultado: 'PERMITIDO',
          });
        }
      }
      // T089 (004, R09): completada o no asistió, ya no hace falta recordarla (y sus enlaces dejan de valer).
      if (destino !== 'CONFIRMADA') await anularRecordatorio(this.eventos, cita.id);

      const agenda = await this.barberias.configuracionAgenda();
      const barbero = await this.catalogo.barbero(cita.barberoId);
      return aVista(cita, agenda, barbero?.nombre ?? '');
    });
  }
}
