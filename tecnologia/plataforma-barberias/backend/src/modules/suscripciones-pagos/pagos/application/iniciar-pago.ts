import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Clock, Configuracion, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
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
import { referenciaDeTransferencia } from '../domain/transferencia';
import { PagoRepository } from './ports/pago-repository';
import { PaymentGateway, ProveedorNoDisponible } from './ports/payment-gateway';
import { aPagoVista, type CuentaDeTransferencia, cuentaDeTransferencia, type PagoVista } from './vistas';

export interface SolicitudDePago {
  planId: string;
  medio: 'YAPE' | 'TRANSFERENCIA';
}

/** Lo que el propietario necesita para transferir (FR-019): la cuenta, el importe exacto y la referencia. */
export interface DatosDeTransferencia extends CuentaDeTransferencia {
  importeCentimos: number;
  referencia: string;
}

export interface PagoIniciado {
  /** true: se creó un pago nuevo (201); false: se devolvió el pago abierto igual (200). */
  creado: boolean;
  pago: PagoVista;
  urlPago: string | null;
  transferencia: DatosDeTransferencia | null;
}

type Desenlace = { tipo: 'LISTO'; creado: boolean; pago: Pago; plan: Plan } | { tipo: 'PROVEEDOR_CAIDO' };

const ALFABETO_REFERENCIA = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/**
 * T045 y T080 · Iniciar el pago de un período con Yape o por transferencia (FR-008 a FR-012, FR-019; R04,
 * R05). Todo ocurre en UNA transacción con la suscripción bloqueada, así dos intentos simultáneos se ejecutan
 * de a uno y dejan un solo pago:
 * 1. con un comprobante en revisión, 409 COMPROBANTE_YA_EN_REVISION y no se anula nada (H4);
 * 2. con un período ya pagado por adelantado, 409 PAGO_ADELANTADO_NO_PERMITIDO;
 * 3. el mismo intento devuelve el pago abierto (200): con Yape, si su sesión sigue vigente; por
 *    transferencia, si sigue esperando el comprobante. Si no, el pago abierto se anula (H3);
 * 4. el pago nuevo guarda el importe del plan (FR-005b) y su período objetivo `covers_after` (H1);
 * 5. Yape: la sesión se crea en el proveedor después de insertar; si no responde, el pago queda ANULADO y se
 *    responde 503 con la alternativa de transferencia (SC-005). Transferencia: queda ESPERANDO_COMPROBANTE con
 *    la referencia `SUS-…` y los datos de la cuenta de la plataforma.
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
    const { pago, plan, creado } = desenlace;
    const cuenta = cuentaDeTransferencia(this.configuracion.pagos.cuenta);
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => ({
      creado,
      pago: aPagoVista(pago, plan, await this.pagos.periodoDe(pago.id)),
      urlPago: pago.urlPago,
      transferencia:
        pago.metodo === 'TRANSFERENCIA' && cuenta && pago.referenciaTransferencia
          ? { ...cuenta, importeCentimos: pago.importeCentimos, referencia: pago.referenciaTransferencia }
          : null,
    }));
  }

  private async enTransaccion(
    actor: ActorDeBarberia,
    solicitud: SolicitudDePago,
    sesionesPorCancelar: string[],
  ): Promise<Desenlace> {
    const plan = await this.suscripciones.planPorId(solicitud.planId);
    if (!plan || !plan.esContratable) throw new PlanNoContratable();
    const precio = plan.precioCentimos as number;
    if (solicitud.medio === 'YAPE') {
      const { minimoCentimos, maximoCentimos } = this.pasarela.limitesYape();
      if (precio < minimoCentimos || precio > maximoCentimos) throw new MedioNoDisponible('YAPE');
    } else if (!cuentaDeTransferencia(this.configuracion.pagos.cuenta)) {
      // Sin la cuenta de la plataforma configurada no hay a dónde transferir.
      throw new MedioNoDisponible('TRANSFERENCIA');
    }

    const suscripcion = await this.suscripciones.suscripcionDelTenant({ bloquear: true });
    if (!suscripcion) throw new Error('La barbería no tiene una suscripción');
    const ahora = this.reloj.ahora();
    const abierto = await this.pagos.abiertoDe(suscripcion.id, { bloquear: true });
    if (abierto?.estado === 'EN_REVISION') throw new ComprobanteYaEnRevision();
    const cobertura = suscripcion.cobertura(await this.suscripciones.periodos(suscripcion.id));
    if (tienePeriodoPorAdelantado(cobertura, ahora)) throw new PagoAdelantadoNoPermitido();

    if (abierto && esReutilizable(abierto, plan.id, solicitud.medio, ahora)) {
      return { tipo: 'LISTO', creado: false, pago: abierto, plan };
    }
    if (abierto) {
      const anulado = transicionDePago(abierto, { tipo: 'ANULAR' });
      await this.pagos.cambiar(abierto.id, { desde: abierto.estado, hacia: anulado.estado, marca: null });
      if (abierto.referenciaProveedor) sesionesPorCancelar.push(abierto.referenciaProveedor);
    }

    const pagoId = uuidv7();
    const porTransferencia = solicitud.medio === 'TRANSFERENCIA';
    await this.pagos.insertar({
      id: pagoId,
      suscripcionId: suscripcion.id,
      planId: plan.id,
      importeCentimos: precio,
      moneda: plan.moneda,
      metodo: solicitud.medio,
      estado: porTransferencia ? 'ESPERANDO_COMPROBANTE' : 'PENDIENTE',
      cubreDesde: inicioDelProximoPeriodo(cobertura, ahora),
      creadoPor: actor.usuarioId,
      ...(porTransferencia ? { referenciaTransferencia: this.referencia(actor.tenantId, ahora) } : {}),
    });

    if (!porTransferencia) {
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
    }
    await this.auditoria.registrar({
      accion: 'PAGO_INICIADO',
      actorId: actor.usuarioId,
      recurso: `pago:${pagoId}`,
      resultado: 'PERMITIDO',
    });
    return { tipo: 'LISTO', creado: true, pago: (await this.pagos.porId(pagoId)) as Pago, plan };
  }

  /** `SUS-` + tenant + año y mes de la barbería + 4 al azar (R05). */
  private referencia(tenantId: string, ahora: Date): string {
    const mes = ZonaHoraria.LIMA.fechaDe(ahora).toString().slice(0, 7);
    const aleatorio = Array.from(
      { length: 4 },
      () => ALFABETO_REFERENCIA[randomInt(ALFABETO_REFERENCIA.length)],
    ).join('');
    return referenciaDeTransferencia(tenantId, mes, aleatorio);
  }
}
