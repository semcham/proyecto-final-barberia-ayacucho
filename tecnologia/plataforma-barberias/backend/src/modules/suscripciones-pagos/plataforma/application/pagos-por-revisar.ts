import { Injectable } from '@nestjs/common';
import { AuditLog, Clock, TenantId, UnitOfWork } from '../../../../shared';
import { PagoRepository } from '../../pagos/application/ports/pago-repository';
import { PagoYaRevisado } from '../../pagos/domain/errores';
import { NoEncontrado } from '../../suscripciones/domain/errores';
import type { AdminDePlataforma } from './comprobantes-plataforma';
import { MARCAS_POR_REVISAR, type PagoPorRevisar, PagosPorRevisarLectura } from './ports/pagos-por-revisar';

/** Las notificaciones sin pago se muestran durante 30 días (el proveedor las resuelve con su propio soporte). */
export const DIAS_SIN_PAGO_EN_LISTA = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

/** T090 · Lista de pagos por revisar del administrador (FR-025a), del más antiguo al más reciente. */
@Injectable()
export class PagosPorRevisar {
  constructor(
    private readonly lectura: PagosPorRevisarLectura,
    private readonly reloj: Clock,
  ) {}

  ejecutar(_admin: AdminDePlataforma): Promise<PagoPorRevisar[]> {
    return this.lectura.pendientes(new Date(this.reloj.ahora().getTime() - DIAS_SIN_PAGO_EN_LISTA * DIA_MS));
  }
}

/**
 * T090 · El administrador marca resuelto un caso por revisar con una nota (FR-025a). No mueve dinero: la
 * devolución o el cobro se hacen fuera de la plataforma. Corre con el tenant de la ruta y RLS (un pago de otra
 * barbería responde 404), una sola vez (409 si ya estaba resuelto o no tiene una marca de la lista), y queda en
 * el audit_log de la barbería con el administrador como actor (PR13). La nota se guarda en el pago, no en la
 * auditoría (sin texto libre).
 */
@Injectable()
export class ResolverRevision {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly pagos: PagoRepository,
    private readonly auditoria: AuditLog,
  ) {}

  ejecutar(admin: AdminDePlataforma, barberiaId: string, pagoId: string, nota: string): Promise<void> {
    return this.uow.ejecutar(TenantId.de(barberiaId), async () => {
      const pago = await this.pagos.porId(pagoId, { bloquear: true });
      if (!pago) throw new NoEncontrado();
      const marca = pago.marca;
      if (!marca || !(MARCAS_POR_REVISAR as readonly string[]).includes(marca)) throw new PagoYaRevisado();
      if (!(await this.pagos.resolverMarca(pago.id, marca, nota))) throw new PagoYaRevisado();
      await this.auditoria.registrar({
        accion: 'REVISION_RESUELTA',
        actorId: admin.adminId,
        recurso: `pago:${pago.id}`,
        resultado: 'PERMITIDO',
      });
    });
  }
}
