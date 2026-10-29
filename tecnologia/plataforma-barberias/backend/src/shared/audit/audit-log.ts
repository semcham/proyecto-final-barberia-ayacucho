import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { KyselyUnitOfWork } from '../persistence/kysely-unit-of-work';
import { TenantContext } from '../tenant/tenant-context';
import type { TenantId } from '../tenant/tenant-id';

export type AccionAuditada =
  | 'BARBERIA_REGISTRADA'
  | 'USUARIO_CREADO'
  | 'USUARIO_DESACTIVADO'
  | 'USUARIO_REACTIVADO'
  | 'ACTIVACION_REGENERADA'
  | 'ACCESO_DENEGADO_ROL'
  | 'ACCESO_TENANT_AJENO'
  | 'SESION_REUTILIZADA'
  | 'SESION_RENOVADA_EN_GRACIA'
  // Funcionalidad 002 (research R19).
  | 'CLIENTE_REGISTRADO'
  | 'CLIENTE_UNIDO'
  | 'CLIENTE_PRESENCIAL_REGISTRADO'
  | 'BARBERIA_CAMBIADA'
  | 'ENLACE_CAMBIADO'
  | 'SERVICIO_DESACTIVADO'
  | 'BARBERO_DESACTIVADO'
  | 'BLOQUEO_CON_CONFLICTO'
  | 'CAMBIO_CON_CONFLICTO'
  | 'CITA_RESERVADA'
  | 'CITA_CANCELADA'
  | 'CITA_ESTADO_CAMBIADO'
  // Funcionalidad 003 (FR-031, FR-037).
  | 'PAGO_INICIADO'
  | 'PAGO_APROBADO'
  | 'SUSCRIPCION_ACTIVADA'
  | 'SUSCRIPCION_EN_GRACIA'
  | 'SUSCRIPCION_VENCIDA'
  // US3: transferencia con comprobante (FR-037). Sin el contenido, el nombre ni el número del comprobante.
  | 'COMPROBANTE_SUBIDO'
  | 'COMPROBANTE_APROBADO'
  | 'COMPROBANTE_RECHAZADO'
  // US4: un caso de la lista de pagos por revisar se marca resuelto (FR-025a). La nota queda en el pago.
  | 'REVISION_RESUELTA'
  // US5: administración de barberías y suscripciones (FR-034 a FR-037), con el administrador como actor.
  | 'BARBERIA_SUSPENDIDA'
  | 'BARBERIA_REACTIVADA'
  | 'SUSCRIPCION_SUSPENDIDA'
  | 'SUSCRIPCION_REACTIVADA'
  | 'ACTIVACION_MANUAL';

export interface EntradaAuditoria {
  accion: AccionAuditada;
  actorId: string | null;
  recurso?: string;
  resultado: 'PERMITIDO' | 'DENEGADO';
  /** Fecha que le correspondía a la acción (transiciones automáticas, FR-031); por defecto, ahora. */
  en?: Date;
  /**
   * FR-037: el motivo que escribió el administrador, de 5 a 300 caracteres. Solo BARBERIA_SUSPENDIDA,
   * SUSCRIPCION_SUSPENDIDA y ACTIVACION_MANUAL lo llevan (la migración 0020 rechaza un motivo en otra acción):
   * el resto de la auditoría sigue sin texto libre.
   */
  motivo?: string;
}

/** Puerto de auditoría de acciones sensibles (R17, EQ-13). El tenant sale siempre del contexto. */
export abstract class AuditLog {
  /** Registra dentro de la transacción en curso: si el caso de uso se revierte, el registro también. */
  abstract registrar(entrada: EntradaAuditoria): Promise<void>;

  /** Registra en una transacción propia: para denegaciones, cuyo caso de uso no llega a confirmarse. */
  abstract registrarEnTransaccionPropia(entrada: EntradaAuditoria, tenantId: TenantId): Promise<void>;
}

@Injectable()
export class KyselyAuditLog extends AuditLog {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async registrar(entrada: EntradaAuditoria): Promise<void> {
    await this.insertar(entrada, this.tenantContext.actual());
  }

  async registrarEnTransaccionPropia(entrada: EntradaAuditoria, tenantId: TenantId): Promise<void> {
    await this.uow.ejecutarAparte(tenantId, () => this.insertar(entrada, tenantId));
  }

  private async insertar(entrada: EntradaAuditoria, tenantId: TenantId): Promise<void> {
    const solicitud = this.tenantContext.datosSolicitud();
    await this.uow
      .transaccionActual()
      .insertInto('audit_log')
      .values({
        id: uuidv7(),
        tenant_id: tenantId.valor,
        actor_id: entrada.actorId,
        action: entrada.accion,
        resource: entrada.recurso?.slice(0, 80) ?? null,
        result: entrada.resultado,
        ip: solicitud.ip ?? null,
        correlation_id: solicitud.correlationId?.slice(0, 64) ?? null,
        reason: entrada.motivo ?? null,
        ...(entrada.en ? { at: entrada.en } : {}),
      })
      .execute();
  }
}
