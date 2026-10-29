import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, TenantId, UnitOfWork } from '../../../../shared';
import { AplicarResultadoDelProveedor } from '../../pagos/application/aplicar-resultado';
import { type ArchivoComprobante, LectorDeComprobantes } from '../../pagos/application/comprobantes';
import { AlmacenComprobantes } from '../../pagos/application/ports/almacen-comprobantes';
import { PagoRepository } from '../../pagos/application/ports/pago-repository';
import { aPagoVista, type PagoVista } from '../../pagos/application/vistas';
import { ImporteDistinto, PagoYaRevisado } from '../../pagos/domain/errores';
import { SuscripcionRepository } from '../../suscripciones/application/ports/suscripcion-repository';
import { NoEncontrado } from '../../suscripciones/domain/errores';
import { type ComprobantePorRevisar, ColaDeComprobantesLectura } from './ports/cola-de-comprobantes';

/**
 * El administrador de la plataforma tal como lo deja el AuthGuard en una ruta @Plataforma() (ADR-031). M03 no
 * depende de M01: basta con su id.
 */
export interface AdminDePlataforma {
  adminId: string;
}

export type Revision =
  { resultado: 'APROBADO'; importeTransferidoCentimos: number } | { resultado: 'RECHAZADO'; motivo: string };

/** T081 · Cola de comprobantes en revisión de todas las barberías (FR-022), del más antiguo al más reciente. */
@Injectable()
export class ColaDeComprobantes {
  constructor(private readonly cola: ColaDeComprobantesLectura) {}

  ejecutar(_admin: AdminDePlataforma): Promise<ComprobantePorRevisar[]> {
    return this.cola.enRevision();
  }
}

export interface DetalleDePagoVista {
  pago: PagoVista;
  /** Número de operación COMPLETO: solo aquí, leído con el tenant de la barbería fijado (H2). */
  numeroOperacion: string | null;
  fechaTransferencia: string | null;
}

/**
 * T081 · Detalle de un pago para revisarlo. Corre con el tenant de la ruta y RLS: un pago de otra barbería
 * responde 404 aunque el id exista (el administrador elige la barbería, nunca la cruza).
 */
@Injectable()
export class DetalleDePago {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly pagos: PagoRepository,
    private readonly suscripciones: SuscripcionRepository,
  ) {}

  ejecutar(_admin: AdminDePlataforma, barberiaId: string, pagoId: string): Promise<DetalleDePagoVista> {
    return this.uow.ejecutar(TenantId.de(barberiaId), async () => {
      const pago = await this.pagos.porId(pagoId);
      if (!pago) throw new NoEncontrado();
      const plan = await this.suscripciones.planPorId(pago.planId);
      if (!plan) throw new Error(`No existe el plan ${pago.planId}`);
      return {
        pago: aPagoVista(pago, plan, await this.pagos.periodoDe(pago.id)),
        numeroOperacion: await this.pagos.numeroOperacion(pago.id),
        fechaTransferencia: pago.fechaTransferencia,
      };
    });
  }
}

/** T081 · El administrador ve el comprobante, con el tenant de la ruta (FR-041: solo con sesión). */
@Injectable()
export class VerComprobante {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly lector: LectorDeComprobantes,
  ) {}

  ejecutar(_admin: AdminDePlataforma, barberiaId: string, pagoId: string): Promise<ArchivoComprobante> {
    return this.uow.ejecutar(TenantId.de(barberiaId), () => this.lector.ultimo(pagoId));
  }
}

/**
 * T081 · Revisión del comprobante (FR-022 a FR-024; R05), en UNA transacción con el tenant de la ruta y la
 * suscripción y el pago bloqueados, en el mismo orden que la notificación y la conciliación:
 * - una sola vez: si el pago ya no está EN_REVISION, 409 PAGO_YA_REVISADO (dos revisiones simultáneas se
 *   atienden de a una y la segunda lo recibe);
 * - aprobar exige el importe transferido exacto (422 IMPORTE_DISTINTO, sin cambiar nada) y crea el período
 *   con la misma función que el pago en línea; un número de operación ya aprobado en cualquier barbería
 *   responde 409 NUMERO_OPERACION_YA_APROBADO y no deja nada (tampoco el período);
 * - rechazar exige un motivo (5 a 300 caracteres) y deja al propietario iniciar otro pago.
 *
 * Queda en el audit_log de la barbería, con el administrador como actor y el pago como recurso; el motivo se
 * guarda con el comprobante (audit_log no admite texto libre, para que no entren datos personales).
 */
@Injectable()
export class RevisarComprobante {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly suscripciones: SuscripcionRepository,
    private readonly pagos: PagoRepository,
    private readonly almacen: AlmacenComprobantes,
    private readonly aplicar: AplicarResultadoDelProveedor,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  ejecutar(
    admin: AdminDePlataforma,
    barberiaId: string,
    pagoId: string,
    revision: Revision,
  ): Promise<PagoVista> {
    return this.uow.ejecutar(TenantId.de(barberiaId), async () => {
      await this.suscripciones.suscripcionDelTenant({ bloquear: true });
      const pago = await this.pagos.porId(pagoId, { bloquear: true });
      if (!pago || pago.metodo !== 'TRANSFERENCIA') throw new NoEncontrado();
      if (pago.estado !== 'EN_REVISION') throw new PagoYaRevisado();
      const comprobante = await this.almacen.ultimoDe(pago.id);
      if (!comprobante || comprobante.revisadoEn !== null) throw new PagoYaRevisado();

      if (revision.resultado === 'APROBADO') {
        if (revision.importeTransferidoCentimos !== pago.importeCentimos) throw new ImporteDistinto();
        await this.aplicar.ejecutar(pago.id, { tipo: 'APROBAR_REVISION' }, { siSigueEn: 'EN_REVISION' });
      } else {
        // El CHECK de la base exige el motivo en el mismo momento en que el pago queda RECHAZADO.
        await this.pagos.fijarMotivoRechazo(pago.id, revision.motivo);
        await this.aplicar.ejecutar(pago.id, { tipo: 'RECHAZAR_REVISION' }, { siSigueEn: 'EN_REVISION' });
      }
      const marcado = await this.almacen.marcarRevisado(comprobante.id, {
        por: admin.adminId,
        en: this.reloj.ahora(),
        resultado: revision.resultado,
        motivo: revision.resultado === 'RECHAZADO' ? revision.motivo : null,
      });
      if (!marcado) throw new PagoYaRevisado();
      await this.auditoria.registrar({
        accion: revision.resultado === 'APROBADO' ? 'COMPROBANTE_APROBADO' : 'COMPROBANTE_RECHAZADO',
        actorId: admin.adminId,
        recurso: `pago:${pago.id}`,
        resultado: 'PERMITIDO',
      });

      const revisado = await this.pagos.porId(pago.id);
      const plan = await this.suscripciones.planPorId(pago.planId);
      if (!revisado || !plan) throw new Error('El pago o su plan desaparecieron en la transacción');
      return aPagoVista(revisado, plan, await this.pagos.periodoDe(pago.id));
    });
  }
}
