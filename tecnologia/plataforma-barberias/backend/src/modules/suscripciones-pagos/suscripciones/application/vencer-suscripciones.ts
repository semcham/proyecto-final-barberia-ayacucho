import { Injectable } from '@nestjs/common';
import { Clock, procesarCadaUno, type ResultadoDeTarea, TenantId, UnitOfWork } from '../../../../shared';
import { AvanzarSuscripcion } from './avanzar-suscripcion';
import { SuscripcionRepository } from './ports/suscripcion-repository';
import { type SuscripcionPorVencer, SuscripcionesPorVencer } from './ports/suscripciones-por-vencer';

const LOTE = 100;

/**
 * T058 · Tarea `vencer-suscripciones` (RF22; FR-029 a FR-033; ADR-024, research R08). La ejecuta el ejecutor
 * de M06 en una sola réplica a la vez, pero la garantía de "una sola vez" no depende de eso:
 * - lee por la vía de la plataforma, en lotes de 100, las suscripciones con una fecha ya pasada (fin de la
 *   prueba, del período o de la gracia) o que empiezan un período de otro plan;
 * - procesa CADA barbería en su propia transacción, con su tenant y RLS: bloquea la suscripción con
 *   `FOR UPDATE SKIP LOCKED` (si la tiene otra transacción, por ejemplo una aprobación en curso, la deja para
 *   la próxima corrida) y aplica los pasos de la máquina de estados como transiciones condicionales,
 *   auditadas con la fecha que les correspondía (FR-031);
 * - un error en una barbería no detiene el resto, y una corrida interrumpida se retoma en la siguiente sin
 *   repetir lo ya hecho (FR-032). Un pago aprobado al mismo tiempo deja la suscripción activa (FR-033).
 */
@Injectable()
export class VencerSuscripciones {
  constructor(
    private readonly porVencer: SuscripcionesPorVencer,
    private readonly suscripciones: SuscripcionRepository,
    private readonly avanzar: AvanzarSuscripcion,
    private readonly uow: UnitOfWork,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(): Promise<ResultadoDeTarea> {
    const ahora = this.reloj.ahora();
    const total: ResultadoDeTarea = { procesados: 0, fallidos: 0 };
    let despuesDe: string | null = null;
    for (;;) {
      const lote = await this.porVencer.pendientes(ahora, despuesDe, LOTE);
      if (lote.length === 0) break;
      const resultado = await procesarCadaUno(lote, (elemento) => this.vencer(elemento, ahora));
      total.procesados += resultado.procesados;
      total.fallidos += resultado.fallidos;
      if (lote.length < LOTE) break;
      despuesDe = lote[lote.length - 1].suscripcionId;
    }
    return total;
  }

  private vencer(elemento: SuscripcionPorVencer, ahora: Date): Promise<boolean> {
    return this.uow.ejecutar(TenantId.de(elemento.tenantId), async () => {
      const suscripcion = await this.suscripciones.suscripcionDelTenant({
        bloquear: true,
        saltarSiBloqueada: true,
      });
      if (!suscripcion || suscripcion.id !== elemento.suscripcionId) return false;
      const pasos = await this.avanzar.ejecutar(suscripcion, ahora);
      return pasos.length > 0;
    });
  }
}
