import { Injectable } from '@nestjs/common';
import { Clock, procesarCadaUno, type ResultadoDeTarea, TenantId, UnitOfWork } from '../../../../shared';
import { AplicarResultadoDelProveedor } from './aplicar-resultado';
import { type PagoPendiente, UbicacionDePagos } from './ports/pago-repository';
import { PagoDesconocido, type PagoEnProveedor, PaymentGateway } from './ports/payment-gateway';

const MINUTO_MS = 60 * 1000;
/** Antigüedad mínima para conciliar un pago en línea pendiente (FR-026). */
export const CONCILIAR_DESPUES_MS = 10 * MINUTO_MS;
/** Un pago en línea pendiente durante 24 h sin respuesta final queda expirado (FR-027). */
export const EXPIRAR_DESPUES_MS = 24 * 60 * MINUTO_MS;
const LOTE = 100;

/**
 * T046 · Tarea `conciliar-pagos` (principio V; FR-026 a FR-028; ADR-024). La ejecuta el ejecutor de M06 en
 * una sola réplica a la vez:
 * - busca por la vía de la plataforma los pagos en línea PENDIENTE de más de 10 minutos;
 * - consulta cada uno en el proveedor y aplica su estado real con la MISMA función que la notificación,
 *   en una transacción con el tenant del pago (un solo efecto aunque la notificación llegue a la vez);
 * - expira los que llevan 24 h sin respuesta final; una aprobación posterior se aplica o queda DUPLICADO
 *   (FR-012a);
 * - con el proveedor caído, el pago no cambia y se reintenta en la siguiente corrida (cuenta como fallido).
 */
@Injectable()
export class ConciliarPagos {
  constructor(
    private readonly ubicaciones: UbicacionDePagos,
    private readonly pasarela: PaymentGateway,
    private readonly aplicar: AplicarResultadoDelProveedor,
    private readonly uow: UnitOfWork,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(): Promise<ResultadoDeTarea> {
    const ahora = this.reloj.ahora();
    const pendientes = await this.ubicaciones.pendientesCreadosAntesDe(
      new Date(ahora.getTime() - CONCILIAR_DESPUES_MS),
      LOTE,
    );
    return procesarCadaUno(pendientes, (pendiente) => this.conciliar(pendiente, ahora));
  }

  private async conciliar(pendiente: PagoPendiente, ahora: Date): Promise<boolean> {
    // Fuera de la transacción: la consulta al proveedor no retiene bloqueos. ProveedorNoDisponible se
    // propaga: el pago no cambia.
    let enProveedor: PagoEnProveedor | null = null;
    if (pendiente.referenciaProveedor) {
      try {
        enProveedor = await this.pasarela.consultarPago(pendiente.referenciaProveedor);
      } catch (error) {
        if (!(error instanceof PagoDesconocido)) throw error;
      }
    }
    const vencido = ahora.getTime() - pendiente.creadoEn.getTime() >= EXPIRAR_DESPUES_MS;
    const cambio = await this.uow.ejecutar(TenantId.de(pendiente.tenantId), async () => {
      if (enProveedor && enProveedor.estado !== 'PENDIENTE') {
        const { efecto } = await this.aplicar.ejecutar(pendiente.pagoId, {
          tipo: 'PROVEEDOR',
          estado: enProveedor.estado,
          importeCentimos: enProveedor.importeCentimos,
          moneda: enProveedor.moneda,
        });
        return efecto === 'SIN_EFECTO' ? 'NINGUNO' : 'APLICADO';
      }
      if (!vencido) return 'NINGUNO';
      const { efecto } = await this.aplicar.ejecutar(
        pendiente.pagoId,
        { tipo: 'EXPIRAR' },
        { siSigueEn: 'PENDIENTE' },
      );
      return efecto === 'SIN_EFECTO' ? 'NINGUNO' : 'EXPIRADO';
    });
    if (cambio === 'EXPIRADO' && pendiente.referenciaProveedor) {
      await this.pasarela.cancelarSesion(pendiente.referenciaProveedor).catch(() => false);
    }
    return cambio !== 'NINGUNO';
  }
}
