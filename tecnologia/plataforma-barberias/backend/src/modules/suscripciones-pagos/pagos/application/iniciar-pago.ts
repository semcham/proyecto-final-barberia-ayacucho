import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Clock, Configuracion, TenantId, UnitOfWork } from '../../../../shared';
import {
  type ActorDeBarberia,
  AutorizacionSuscripciones,
} from '../../suscripciones/application/autorizacion';
import { SuscripcionRepository } from '../../suscripciones/application/ports/suscripcion-repository';
import { inicioDelProximoPeriodo, tienePeriodoPorAdelantado } from '../../suscripciones/domain/periodo';
import type { Plan } from '../../suscripciones/domain/plan';
import {
  ComprobanteYaEnRevision,
  MedioNoDisponible,
  PagoAdelantadoNoPermitido,
  PagoEnLineaNoDisponible,
  PlanNoContratable,
} from '../domain/errores';
import { esReutilizable, type Pago, transicionDePago } from '../domain/pago';
import { PagoRepository } from './ports/pago-repository';
import { PaymentGateway, ProveedorNoDisponible } from './ports/payment-gateway';
import { aPagoVista, type PagoVista } from './vistas';

export interface SolicitudDePago {
  planId: string;
  medio: 'YAPE' | 'TRANSFERENCIA';
}

export interface PagoIniciado {
  /** true: se creó un pago nuevo (201); false: se devolvió el pago abierto igual (200). */
  creado: boolean;
  pago: PagoVista;
  urlPago: string | null;
  transferencia: null;
}

type Desenlace = { tipo: 'LISTO'; creado: boolean; pago: Pago; plan: Plan } | { tipo: 'PROVEEDOR_CAIDO' };

/**
 * T045 · Iniciar el pago de un período con Yape (FR-008 a FR-012, R04). Todo ocurre en UNA transacción con
 * la suscripción bloqueada, así dos intentos simultáneos se ejecutan de a uno y dejan un solo pago:
 * 1. con un comprobante en revisión, 409 COMPROBANTE_YA_EN_REVISION y no se anula nada (H4);
 * 2. con un período ya pagado por adelantado, 409 PAGO_ADELANTADO_NO_PERMITIDO;
 * 3. el mismo intento con la sesión de pago vigente devuelve el pago abierto (200); si la sesión venció, o
 *    es otro plan o medio, el pago abierto se anula y su sesión se intenta cancelar (H3);
 * 4. el pago nuevo guarda el importe del plan (FR-005b) y su período objetivo `covers_after` (H1);
 * 5. la sesión se crea en el proveedor después de insertar; si el proveedor no responde, el pago queda
 *    ANULADO y se responde 503 con la alternativa de transferencia (SC-005).
 */
@Injectable()
export class IniciarPago {
  constructor(
    private readonly autorizacion: AutorizacionSuscripciones,
    private readonly uow: UnitOfWork,
    private readonly suscripciones: SuscripcionRepository,
    private readonly pagos: PagoRepository,
    private readonly pasarela: PaymentGateway,
    private readonly auditoria: AuditLog,
    private readonly configuracion: Configuracion,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(actor: ActorDeBarberia, solicitud: SolicitudDePago): Promise<PagoIniciado> {
    await this.autorizacion.exigir(actor, 'PAGAR_SUSCRIPCION');
    const sesionesPorCancelar: string[] = [];
    const desenlace = await this.uow.ejecutar(TenantId.de(actor.tenantId), () =>
      this.enTransaccion(actor, solicitud, sesionesPorCancelar),
    );
    // Después de confirmar: la anulación local ya ocurrió y la conciliación cierra lo que quede.
    for (const referencia of sesionesPorCancelar) {
      await this.pasarela.cancelarSesion(referencia).catch(() => false);
    }
    if (desenlace.tipo === 'PROVEEDOR_CAIDO') throw new PagoEnLineaNoDisponible();
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => ({
      creado: desenlace.creado,
      pago: aPagoVista(desenlace.pago, desenlace.plan, await this.pagos.periodoDe(desenlace.pago.id)),
      urlPago: desenlace.pago.urlPago,
      transferencia: null,
    }));
  }

  private async enTransaccion(
    actor: ActorDeBarberia,
    solicitud: SolicitudDePago,
    sesionesPorCancelar: string[],
  ): Promise<Desenlace> {
    // La transferencia con comprobante llega con US3.
    if (solicitud.medio !== 'YAPE') throw new MedioNoDisponible(solicitud.medio);
    const plan = await this.suscripciones.planPorId(solicitud.planId);
    if (!plan || !plan.esContratable) throw new PlanNoContratable();
    const precio = plan.precioCentimos as number;
    const { minimoCentimos, maximoCentimos } = this.pasarela.limitesYape();
    if (precio < minimoCentimos || precio > maximoCentimos) throw new MedioNoDisponible('YAPE');

    const suscripcion = await this.suscripciones.suscripcionDelTenant({ bloquear: true });
    if (!suscripcion) throw new Error('La barbería no tiene una suscripción');
    const ahora = this.reloj.ahora();
    const abierto = await this.pagos.abiertoDe(suscripcion.id, { bloquear: true });
    if (abierto?.estado === 'EN_REVISION') throw new ComprobanteYaEnRevision();
    const cobertura = suscripcion.cobertura(await this.suscripciones.periodos(suscripcion.id));
    if (tienePeriodoPorAdelantado(cobertura, ahora)) throw new PagoAdelantadoNoPermitido();

    if (abierto && esReutilizable(abierto, plan.id, 'YAPE', ahora)) {
      return { tipo: 'LISTO', creado: false, pago: abierto, plan };
    }
    if (abierto) {
      const anulado = transicionDePago(abierto, { tipo: 'ANULAR' });
      await this.pagos.cambiar(abierto.id, { desde: abierto.estado, hacia: anulado.estado, marca: null });
      if (abierto.referenciaProveedor) sesionesPorCancelar.push(abierto.referenciaProveedor);
    }

    const pagoId = uuidv7();
    await this.pagos.insertar({
      id: pagoId,
      suscripcionId: suscripcion.id,
      planId: plan.id,
      importeCentimos: precio,
      moneda: plan.moneda,
      metodo: 'YAPE',
      estado: 'PENDIENTE',
      cubreDesde: inicioDelProximoPeriodo(cobertura, ahora),
      creadoPor: actor.usuarioId,
    });

    let sesion;
    try {
      sesion = await this.pasarela.crearSesionDePago({
        pagoId,
        importeCentimos: precio,
        moneda: plan.moneda,
        descripcion: `Suscripción · plan ${plan.nombre}`,
        metodo: 'YAPE',
        urlRetorno: this.configuracion.pagos.urlRetorno,
      });
    } catch (error) {
      if (!(error instanceof ProveedorNoDisponible)) throw error;
      await this.pagos.cambiar(pagoId, { desde: 'PENDIENTE', hacia: 'ANULADO', marca: null });
      return { tipo: 'PROVEEDOR_CAIDO' };
    }
    await this.pagos.fijarSesion(pagoId, {
      referencia: sesion.referenciaProveedor,
      url: sesion.urlPago,
      expiraEn: sesion.expiraEn,
    });
    await this.auditoria.registrar({
      accion: 'PAGO_INICIADO',
      actorId: actor.usuarioId,
      recurso: `pago:${pagoId}`,
      resultado: 'PERMITIDO',
    });
    return { tipo: 'LISTO', creado: true, pago: (await this.pagos.porId(pagoId)) as Pago, plan };
  }
}
