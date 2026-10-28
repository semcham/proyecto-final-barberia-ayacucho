import { Injectable } from '@nestjs/common';
import { TenantId, UnitOfWork } from '../../../../shared';
import { AplicarResultadoDelProveedor } from './aplicar-resultado';
import { EventoProveedorRepository, UbicacionDePagos } from './ports/pago-repository';
import { PaymentGateway } from './ports/payment-gateway';

export type DesenlaceNotificacion = 'APLICADO' | 'SIN_EFECTO' | 'REVISION' | 'SIN_PAGO' | 'REPETIDO';

/** El evento ya se había procesado: se deshace la transacción y se responde 200 sin efecto. */
class EventoRepetido extends Error {}

/**
 * T045 · Notificación del proveedor (FR-013 a FR-018; research R03). Sin token de usuario: la firma la
 * verifica el adaptador (lanza FirmaInvalida). El tenant se encuentra por la referencia exacta, con la vía de
 * la plataforma (ADR-031), y todo lo demás corre en UNA transacción con ese tenant y RLS (FR-015):
 * 1. bloquear la suscripción y el pago, calcular la transición y aplicarla (AplicarResultadoDelProveedor);
 * 2. insertar el evento ya con su efecto: el rol de la aplicación solo puede insertarlo (C1), y si el
 *    `evento_id` ya existía la transacción se deshace entera y se responde 200 sin efecto (FR-016).
 * Los eventos del mismo pago se ejecutan de a uno por el bloqueo, así que el repetido siempre lo ve.
 * Ningún dato del pagador llega aquí: el adaptador solo entrega los campos del contrato (FR-013b).
 */
@Injectable()
export class RecibirNotificacion {
  constructor(
    private readonly pasarela: PaymentGateway,
    private readonly ubicaciones: UbicacionDePagos,
    private readonly eventos: EventoProveedorRepository,
    private readonly aplicar: AplicarResultadoDelProveedor,
    private readonly uow: UnitOfWork,
  ) {}

  async ejecutar(
    cuerpoCrudo: Buffer,
    encabezados: Record<string, string | string[] | undefined>,
  ): Promise<DesenlaceNotificacion> {
    const notificacion = this.pasarela.verificarNotificacion(cuerpoCrudo, encabezados);
    const evento = {
      eventoId: notificacion.eventoId,
      referencia: notificacion.referencia,
      estado: notificacion.estado,
      importeCentimos: notificacion.importeCentimos,
      moneda: notificacion.moneda,
    };
    const ubicacion = await this.ubicaciones.porReferencia(notificacion.referencia);
    if (!ubicacion) {
      // Pago desconocido: queda registrado para la revisión del administrador (FR-016).
      const nuevo = await this.uow.ejecutarSinTenant(() =>
        this.eventos.registrar({ ...evento, tenantId: null, pagoId: null, efecto: 'SIN_PAGO' }),
      );
      return nuevo ? 'SIN_PAGO' : 'REPETIDO';
    }
    try {
      return await this.uow.ejecutar(TenantId.de(ubicacion.tenantId), async () => {
        const { efecto } = await this.aplicar.ejecutar(ubicacion.pagoId, {
          tipo: 'PROVEEDOR',
          estado: notificacion.estado,
          importeCentimos: notificacion.importeCentimos,
          moneda: notificacion.moneda,
        });
        const nuevo = await this.eventos.registrar({
          ...evento,
          tenantId: ubicacion.tenantId,
          pagoId: ubicacion.pagoId,
          efecto,
        });
        if (!nuevo) throw new EventoRepetido();
        return efecto;
      });
    } catch (error) {
      if (error instanceof EventoRepetido) return 'REPETIDO';
      throw error;
    }
  }
}
