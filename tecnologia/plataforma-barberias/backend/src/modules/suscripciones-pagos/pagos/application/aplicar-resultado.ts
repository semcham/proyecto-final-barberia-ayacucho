import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Clock } from '../../../../shared';
import { AvanzarSuscripcion } from '../../suscripciones/application/avanzar-suscripcion';
import { SuscripcionRepository } from '../../suscripciones/application/ports/suscripcion-repository';
import { PeriodoYaCubierto } from '../../suscripciones/domain/errores';
import { decidirAprobacion } from '../../suscripciones/domain/periodo';
import {
  type EfectoDelEvento,
  type EstadoPago,
  type EventoPago,
  type MarcaRevision,
  type Pago,
  transicionDePago,
} from '../domain/pago';
import { PagoRepository } from './ports/pago-repository';

export interface ResultadoDeAplicar {
  efecto: EfectoDelEvento;
  pago: Pago;
}

/**
 * T045 · Función ÚNICA que aplica a un pago lo que informa el proveedor (notificación o conciliación) o una
 * orden de la plataforma (FR-015, FR-028). Corre en la transacción del llamador, con el tenant del pago
 * fijado, y bloquea primero la suscripción y después el pago: así la notificación, la conciliación, la
 * revisión y el inicio de un pago se ejecutan de a uno por barbería y producen un solo efecto.
 *
 * Regla de aprobación (data-model.md §3, H1): si el período objetivo del pago ya está tomado, o el período
 * excedería el tope de uno por adelantado, el pago queda APROBADO con la marca DUPLICADO y sin período. Las
 * restricciones EXCLUDE y UNIQUE de la base son la última barrera. `current_period_end` se actualiza en la
 * misma transacción (M2), y la suscripción avanza al estado que le corresponde (una barbería vencida que
 * paga vuelve a aceptar reservas de inmediato, SC-008).
 */
@Injectable()
export class AplicarResultadoDelProveedor {
  constructor(
    private readonly pagos: PagoRepository,
    private readonly suscripciones: SuscripcionRepository,
    private readonly avanzar: AvanzarSuscripcion,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  /**
   * `siSigueEn`: solo para órdenes de la plataforma; si el pago ya no está en ese estado (lo cambió otra
   * vía mientras tanto), no hace nada.
   */
  async ejecutar(
    pagoId: string,
    evento: EventoPago,
    opciones: { siSigueEn?: EstadoPago } = {},
  ): Promise<ResultadoDeAplicar> {
    const sinBloquear = await this.pagos.porId(pagoId);
    if (!sinBloquear) throw new Error('El pago no existe en la barbería de la transacción');
    const suscripcion = await this.suscripciones.suscripcionDelTenant({ bloquear: true });
    if (!suscripcion || suscripcion.id !== sinBloquear.suscripcionId) {
      throw new Error('El pago no pertenece a la suscripción de la barbería');
    }
    const pago = (await this.pagos.porId(pagoId, { bloquear: true })) as Pago;
    if (opciones.siSigueEn && pago.estado !== opciones.siSigueEn) return { efecto: 'SIN_EFECTO', pago };

    const transicion = transicionDePago(pago, evento);
    if (transicion.efecto === 'SIN_EFECTO') return { efecto: 'SIN_EFECTO', pago };

    const ahora = this.reloj.ahora();
    let marca: MarcaRevision | null = transicion.marca;
    let efecto: EfectoDelEvento = transicion.efecto;
    let periodoCreado = false;
    if (transicion.aplicarPeriodo) {
      const periodos = await this.suscripciones.periodos(suscripcion.id);
      const decision = decidirAprobacion(suscripcion.cobertura(periodos), pago.cubreDesde, ahora);
      if (decision.tipo === 'PERIODO') {
        try {
          await this.suscripciones.insertarPeriodo({
            id: uuidv7(),
            suscripcionId: suscripcion.id,
            pagoId: pago.id,
            planId: pago.planId,
            inicio: decision.inicio,
            fin: decision.fin,
          });
          periodoCreado = true;
        } catch (error) {
          if (!(error instanceof PeriodoYaCubierto)) throw error;
        }
      }
      if (!periodoCreado) {
        // El dinero recibido nunca se ignora (FR-012a): aprobado, marcado para el administrador.
        marca = 'DUPLICADO';
        efecto = 'REVISION';
      }
    }

    const aplicado = await this.pagos.cambiar(pago.id, {
      desde: pago.estado,
      hacia: transicion.estado,
      marca,
    });
    if (!aplicado) throw new Error('El pago cambió durante la transacción a pesar del bloqueo');
    if (transicion.estado === 'APROBADO' && pago.estado !== 'APROBADO') {
      await this.auditoria.registrar({
        accion: 'PAGO_APROBADO',
        actorId: null,
        recurso: `pago:${pago.id}`,
        resultado: 'PERMITIDO',
      });
    }
    if (periodoCreado) await this.avanzar.ejecutar(suscripcion, ahora);
    return { efecto, pago: (await this.pagos.porId(pago.id)) as Pago };
  }
}
