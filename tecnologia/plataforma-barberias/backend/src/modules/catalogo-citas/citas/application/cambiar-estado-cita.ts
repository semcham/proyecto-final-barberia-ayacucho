import { Injectable } from '@nestjs/common';
import { type Actor, BarberiasApi } from '../../../acceso-barberias';
import { AuditLog, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { AutorizacionCatalogoCitas } from '../../catalogo/application/autorizacion';
import { BarberoRepository } from '../../catalogo/application/ports/catalogo-repositorios';
import { CatalogQuery } from '../../catalogo/application/ports/catalog-query';
import { NoEncontrado } from '../../catalogo/domain/errores';
import { CitaRepository } from './ports/cita-repository';
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
  ) {}

  async ejecutar(actor: Actor, citaId: string, destino: EstadoDestino): Promise<CitaVista> {
    const alcance = await this.autorizacion.exigir(actor, 'CAMBIAR_ESTADO_CITA');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const cita = await this.citas.buscarParaActualizar(citaId);
      if (!cita) throw new NoEncontrado();
      if (alcance === 'PROPIOS') {
        const propio = await this.barberos.porUsuario(actor.usuarioId);
        if (!propio || propio.id !== cita.barberoId) throw new NoEncontrado();
      }

      const anterior = cita.estado;
      cita.cambiarA(destino, this.reloj.ahora());
      await this.citas.actualizarEstado(cita, anterior, actor.usuarioId);
      await this.auditoria.registrar({
        accion: 'CITA_ESTADO_CAMBIADO',
        actorId: actor.usuarioId,
        recurso: `cita:${cita.id}`,
        resultado: 'PERMITIDO',
      });

      const agenda = await this.barberias.configuracionAgenda();
      const barbero = await this.catalogo.barbero(cita.barberoId);
      return aVista(cita, agenda.nombre, barbero?.nombre ?? '', new ZonaHoraria(agenda.zonaHoraria));
    });
  }
}
