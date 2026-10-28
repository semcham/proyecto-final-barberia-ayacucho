import { Injectable } from '@nestjs/common';
import { TenantContext, type TenantId } from '../../../../shared';
import type { AccionSuscripcion } from '../domain/accion-suscripcion';
import { PoliticaDeOperacion } from '../domain/politica-de-operacion';
import type { EstadoSuscripcion } from '../domain/suscripcion';
import { SuscripcionRepository } from './ports/suscripcion-repository';

export interface EstadoOperativo {
  estado: EstadoSuscripcion;
  aceptaReservas: boolean;
  configuracionEditable: boolean;
  /** Mensaje para quien quiere reservar cuando la barbería no acepta reservas; si acepta, null. */
  mensaje: string | null;
}

const NO_ACEPTA_RESERVAS = 'Esta barbería no acepta reservas por ahora';

/**
 * Restricciones por estado de la suscripción (FR-006, FR-007; research R10; contracts/restricciones-estado.md).
 * Corre en la transacción del llamador (M02 o M01), con su tenant y RLS, como `obtenerLimiteBarberos`.
 */
@Injectable()
export class ExigirOperacion {
  constructor(
    private readonly suscripciones: SuscripcionRepository,
    private readonly tenantContext: TenantContext,
  ) {}

  /** Lanza SuscripcionNoPermite (403 SUSCRIPCION_NO_PERMITE) si el estado no permite la acción. */
  async exigir(tenantId: TenantId, accion: AccionSuscripcion): Promise<void> {
    PoliticaDeOperacion.exigir(await this.estado(tenantId), accion);
  }

  async estadoOperativo(tenantId: TenantId): Promise<EstadoOperativo> {
    const estado = await this.estado(tenantId);
    const aceptaReservas = PoliticaDeOperacion.permite(estado, 'RESERVAR');
    return {
      estado,
      aceptaReservas,
      configuracionEditable: PoliticaDeOperacion.permite(estado, 'CONFIGURAR_CATALOGO'),
      mensaje: aceptaReservas ? null : NO_ACEPTA_RESERVAS,
    };
  }

  private async estado(tenantId: TenantId): Promise<EstadoSuscripcion> {
    if (!this.tenantContext.actual().equals(tenantId)) {
      throw new Error(
        'El estado de la suscripción debe consultarse dentro de la transacción del mismo tenant',
      );
    }
    const suscripcion = await this.suscripciones.suscripcionDelTenant();
    if (!suscripcion) throw new Error('La barbería no tiene una suscripción');
    return suscripcion.estado;
  }
}
