import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { Clock, TenantContext, type TenantId } from '../../../../shared';
import { Suscripcion } from '../domain/suscripcion';
import { SuscripcionRepository } from './ports/suscripcion-repository';

export const PLAN_DE_PRUEBA = 'TRIAL';

export interface ResumenSuscripcion {
  estado: 'TRIAL';
  plan: string;
  iniciaEn: Date;
  venceEn: Date;
}

/**
 * Inicia la prueba gratuita de una barbería recién registrada (RF18). No abre su propia transacción:
 * participa en la del llamador para que el registro sea indivisible (FR-002, R12).
 */
@Injectable()
export class IniciarPruebaGratuita {
  constructor(
    private readonly suscripciones: SuscripcionRepository,
    private readonly reloj: Clock,
    private readonly tenantContext: TenantContext,
  ) {}

  async ejecutar(tenantId: TenantId): Promise<ResumenSuscripcion> {
    if (!this.tenantContext.actual().equals(tenantId)) {
      throw new Error('La prueba gratuita debe iniciarse dentro de la transacción del mismo tenant');
    }
    const plan = await this.suscripciones.planPorCodigo(PLAN_DE_PRUEBA);
    const suscripcion = Suscripcion.iniciarPrueba(uuidv7(), tenantId.valor, plan, this.reloj.ahora());
    await this.suscripciones.crear(suscripcion);
    return {
      estado: 'TRIAL',
      plan: plan.codigo,
      iniciaEn: suscripcion.iniciaEn,
      venceEn: suscripcion.vencePruebaEn as Date,
    };
  }
}
