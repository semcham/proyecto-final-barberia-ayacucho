import { Injectable } from '@nestjs/common';
import { TenantId, UnitOfWork } from '../../../../shared';
import {
  type ActorDeBarberia,
  AutorizacionSuscripciones,
} from '../../suscripciones/application/autorizacion';
import { SuscripcionRepository } from '../../suscripciones/application/ports/suscripcion-repository';
import { PagoRepository } from './ports/pago-repository';
import { aPagoVista, type PagoVista } from './vistas';

/** Pagos por página del historial. */
export const TAMANO_PAGINA_HISTORIAL = 20;
/** Tope de la página pedida: más allá no hay nada útil, y evita un OFFSET enorme. */
export const MAXIMA_PAGINA_HISTORIAL = 500;

export interface PaginaDeHistorial {
  pagos: PagoVista[];
  total: number;
}

/**
 * T089 · Historial de pagos de la barbería del token (RF25, HU20; FR-025), del más reciente al más antiguo,
 * paginado. Corre con el tenant del token y RLS: nunca aparece un pago de otra barbería.
 *
 * Cada pago es la vista del contrato (PagoVista): plan, importe, medio, estado, marca, período, motivo del
 * rechazo y fechas. Del número de operación, solo sus últimos 4 caracteres; nada de tarjetas (la plataforma
 * nunca las recibe, principio V), de cuentas ni del comprobante más allá del estado del pago.
 */
@Injectable()
export class HistorialDePagos {
  constructor(
    private readonly autorizacion: AutorizacionSuscripciones,
    private readonly uow: UnitOfWork,
    private readonly pagos: PagoRepository,
    private readonly suscripciones: SuscripcionRepository,
  ) {}

  async ejecutar(actor: ActorDeBarberia, pagina: number): Promise<PaginaDeHistorial> {
    await this.autorizacion.exigir(actor, 'VER_SUSCRIPCION');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const { pagos, total } = await this.pagos.historial(pagina, TAMANO_PAGINA_HISTORIAL);
      const periodos = await this.pagos.periodosDe(pagos.map((p) => p.id));
      const planes = new Map<string, { id: string; nombre: string }>();
      for (const planId of new Set(pagos.map((p) => p.planId))) {
        const plan = await this.suscripciones.planPorId(planId);
        if (!plan) throw new Error(`No existe el plan ${planId}`);
        planes.set(planId, plan);
      }
      return {
        pagos: pagos.map((p) =>
          aPagoVista(p, planes.get(p.planId) as { id: string; nombre: string }, periodos.get(p.id) ?? null),
        ),
        total,
      };
    });
  }
}
