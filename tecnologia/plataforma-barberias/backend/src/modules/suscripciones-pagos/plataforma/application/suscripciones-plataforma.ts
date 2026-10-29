import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Clock, Configuracion, TenantId, UnitOfWork } from '../../../../shared';
import { AplicarResultadoDelProveedor } from '../../pagos/application/aplicar-resultado';
import { PagoRepository } from '../../pagos/application/ports/pago-repository';
import { PaymentGateway } from '../../pagos/application/ports/payment-gateway';
import {
  aPagoVista,
  aPlanVista,
  cuentaDeTransferencia,
  type PagoVista,
  type PlanVista,
} from '../../pagos/application/vistas';
import {
  ComprobanteYaEnRevision,
  PagoAdelantadoNoPermitido,
  PlanNoContratable,
} from '../../pagos/domain/errores';
import { transicionDePago } from '../../pagos/domain/pago';
import { SuscripcionRepository } from '../../suscripciones/application/ports/suscripcion-repository';
import { NoEncontrado } from '../../suscripciones/domain/errores';
import { reactivar, suspender } from '../../suscripciones/domain/estado-suscripcion';
import { inicioDelProximoPeriodo, tienePeriodoPorAdelantado } from '../../suscripciones/domain/periodo';
import type { AdminDePlataforma } from './comprobantes-plataforma';

// T097 · US5: el administrador de la plataforma suspende y reactiva la suscripción de una barbería y activa un
// plan a mano (FR-035 a FR-037). Todo corre con el tenant de la RUTA fijado y RLS (ADR-031): la barbería que no
// existe responde 404, y nada de otra barbería se toca. Cada acción queda en el audit_log de esa barbería con el
// administrador como actor y, cuando lo lleva, el motivo (migración 0020).

/**
 * Suspende la suscripción con un motivo (FR-035). Sus fechas siguen corriendo y los pagos que se aprueben
 * extienden el período, pero la suscripción sigue suspendida hasta que se reactive (la máquina de estados no
 * mueve SUSPENDED). El propietario ve el motivo en GET /suscripcion. 409 si ya está suspendida o cancelada.
 */
@Injectable()
export class SuspenderSuscripcion {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly suscripciones: SuscripcionRepository,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  ejecutar(admin: AdminDePlataforma, barberiaId: string, motivo: string): Promise<void> {
    return this.uow.ejecutar(TenantId.de(barberiaId), async () => {
      const suscripcion = await this.suscripciones.suscripcionDelTenant({ bloquear: true });
      if (!suscripcion) throw new NoEncontrado();
      suspender(suscripcion.estado);
      const aplicada = await this.suscripciones.suspender(
        suscripcion.id,
        suscripcion.estado,
        motivo,
        this.reloj.ahora(),
      );
      if (!aplicada) throw new Error('La suscripción cambió durante la transacción a pesar del bloqueo');
      await this.auditoria.registrar({
        accion: 'SUSCRIPCION_SUSPENDIDA',
        actorId: admin.adminId,
        recurso: `suscripcion:${suscripcion.id}`,
        resultado: 'PERMITIDO',
        motivo,
      });
    });
  }
}

/**
 * Reactiva la suscripción (FR-035): queda en el estado que le corresponde por sus fechas (en prueba, activa, en
 * gracia o vencida), con los períodos que se pagaron mientras estuvo suspendida. Los días suspendidos no se
 * devuelven. 409 si no estaba suspendida.
 */
@Injectable()
export class ReactivarSuscripcion {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly suscripciones: SuscripcionRepository,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  ejecutar(admin: AdminDePlataforma, barberiaId: string): Promise<void> {
    return this.uow.ejecutar(TenantId.de(barberiaId), async () => {
      const suscripcion = await this.suscripciones.suscripcionDelTenant({ bloquear: true });
      if (!suscripcion) throw new NoEncontrado();
      const cobertura = suscripcion.cobertura(await this.suscripciones.periodos(suscripcion.id));
      const resultado = reactivar(suscripcion.estado, cobertura, this.reloj.ahora());
      if (!(await this.suscripciones.reactivar(suscripcion.id, resultado))) {
        throw new Error('La suscripción cambió durante la transacción a pesar del bloqueo');
      }
      await this.auditoria.registrar({
        accion: 'SUSCRIPCION_REACTIVADA',
        actorId: admin.adminId,
        recurso: `suscripcion:${suscripcion.id}`,
        resultado: 'PERMITIDO',
      });
    });
  }
}

export interface SolicitudDeActivacionManual {
  planId: string;
  motivo: string;
  referenciaExterna: string;
}

/**
 * Activa un período a mano (FR-036; contingencia de R08 y R15): un pago MANUAL, ya APROBADO, con el PRECIO DEL
 * PLAN como importe, el motivo y la referencia del pago hecho fuera de la plataforma. Sigue las reglas de un pago,
 * en una transacción con la suscripción bloqueada:
 * - con un comprobante en revisión, 409 COMPROBANTE_YA_EN_REVISION: primero se revisa (el dinero pudo haberse
 *   transferido, H4);
 * - con un período ya pagado por adelantado, 409 PAGO_ADELANTADO_NO_PERMITIDO;
 * - el pago abierto (Yape pendiente o transferencia sin comprobante) se anula, y su sesión en el proveedor se
 *   cancela después de confirmar;
 * - el período objetivo es la cobertura vigente (H1) y lo crea AplicarResultadoDelProveedor con la misma regla
 *   de aprobación; la suscripción avanza a su estado por fechas (salvo si está suspendida).
 * El historial del propietario lo muestra como "activación manual" con el motivo.
 */
@Injectable()
export class ActivacionManual {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly suscripciones: SuscripcionRepository,
    private readonly pagos: PagoRepository,
    private readonly aplicar: AplicarResultadoDelProveedor,
    private readonly pasarela: PaymentGateway,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(
    admin: AdminDePlataforma,
    barberiaId: string,
    solicitud: SolicitudDeActivacionManual,
  ): Promise<PagoVista> {
    const sesionesPorCancelar: string[] = [];
    const vista = await this.uow.ejecutar(TenantId.de(barberiaId), async () => {
      const suscripcion = await this.suscripciones.suscripcionDelTenant({ bloquear: true });
      if (!suscripcion) throw new NoEncontrado();
      const plan = await this.suscripciones.planPorId(solicitud.planId);
      if (!plan || !plan.esContratable) throw new PlanNoContratable();

      const ahora = this.reloj.ahora();
      const abierto = await this.pagos.abiertoDe(suscripcion.id, { bloquear: true });
      if (abierto?.estado === 'EN_REVISION') throw new ComprobanteYaEnRevision();
      const cobertura = suscripcion.cobertura(await this.suscripciones.periodos(suscripcion.id));
      if (tienePeriodoPorAdelantado(cobertura, ahora)) throw new PagoAdelantadoNoPermitido();
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
        importeCentimos: plan.precioCentimos as number,
        moneda: plan.moneda,
        metodo: 'MANUAL',
        estado: 'APROBADO',
        cubreDesde: inicioDelProximoPeriodo(cobertura, ahora),
        creadoPor: admin.adminId,
        manual: { motivo: solicitud.motivo, referenciaExterna: solicitud.referenciaExterna },
      });
      await this.auditoria.registrar({
        accion: 'ACTIVACION_MANUAL',
        actorId: admin.adminId,
        recurso: `pago:${pagoId}`,
        resultado: 'PERMITIDO',
        motivo: solicitud.motivo,
      });
      const pago = await this.aplicar.aplicarActivacionManual(pagoId);
      return aPagoVista(pago, plan, await this.pagos.periodoDe(pago.id));
    });
    // Después de confirmar: la anulación local ya ocurrió y la conciliación cierra lo que quede.
    for (const referencia of sesionesPorCancelar) {
      await this.pasarela.cancelarSesion(referencia).catch(() => false);
    }
    return vista;
  }
}

/** Planes que el administrador puede activar a mano: los mismos que contrata el propietario. */
@Injectable()
export class PlanesParaPlataforma {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly suscripciones: SuscripcionRepository,
    private readonly pasarela: PaymentGateway,
    private readonly configuracion: Configuracion,
  ) {}

  async ejecutar(_admin: AdminDePlataforma): Promise<PlanVista[]> {
    // plan es un catálogo global: no depende del tenant.
    const planes = await this.uow.ejecutarSinTenant(() => this.suscripciones.planesContratables());
    const conTransferencia = cuentaDeTransferencia(this.configuracion.pagos.cuenta) !== null;
    return planes.map((plan) => aPlanVista(plan, this.pasarela.limitesYape(), conTransferencia));
  }
}
