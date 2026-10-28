import { type Cobertura, coberturaHasta, planVigente } from './periodo';
import type { Plan } from './plan';

const DIA_MS = 24 * 60 * 60 * 1000;

export const ESTADOS_SUSCRIPCION = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'EXPIRED',
  'CANCELLED',
  'SUSPENDED',
] as const;

export type EstadoSuscripcion = (typeof ESTADOS_SUSCRIPCION)[number];

export interface DatosSuscripcion {
  id: string;
  tenantId: string;
  planId: string;
  estado: EstadoSuscripcion;
  iniciaEn: Date;
  vencePruebaEn: Date | null;
  /** Copia derivada de la cobertura (M2): fin del último período o, sin períodos, de la prueba. */
  finCobertura?: Date | null;
  /** Fin de la gracia mientras está en PAST_DUE (FR-030). */
  graciaHasta?: Date | null;
  suspendidaEn?: Date | null;
  motivoSuspension?: string | null;
}

/**
 * Suscripción de una barbería. Nace en prueba gratuita (RF18); en 003 avanza por la máquina de estados de
 * estado-suscripcion.ts con sus períodos pagados (periodo.ts).
 */
export class Suscripcion {
  private constructor(private readonly datos: DatosSuscripcion) {}

  /** Prueba gratuita: estado TRIAL que vence a los días de prueba del plan, sin pedir pago (FR-003, FR-004). */
  static iniciarPrueba(id: string, tenantId: string, plan: Plan, ahora: Date): Suscripcion {
    if (plan.diasPrueba === null) {
      throw new Error(`El plan ${plan.codigo} no ofrece prueba gratuita`);
    }
    const vencePruebaEn = new Date(ahora.getTime() + plan.diasPrueba * DIA_MS);
    return new Suscripcion({
      id,
      tenantId,
      planId: plan.id,
      estado: 'TRIAL',
      iniciaEn: ahora,
      vencePruebaEn,
      finCobertura: vencePruebaEn,
    });
  }

  static reconstruir(datos: DatosSuscripcion): Suscripcion {
    return new Suscripcion({ ...datos });
  }

  get id(): string {
    return this.datos.id;
  }
  get tenantId(): string {
    return this.datos.tenantId;
  }
  get planId(): string {
    return this.datos.planId;
  }
  get estado(): EstadoSuscripcion {
    return this.datos.estado;
  }
  get iniciaEn(): Date {
    return this.datos.iniciaEn;
  }
  get vencePruebaEn(): Date | null {
    return this.datos.vencePruebaEn;
  }
  get finCobertura(): Date | null {
    return this.datos.finCobertura ?? null;
  }
  get graciaHasta(): Date | null {
    return this.datos.graciaHasta ?? null;
  }
  get suspendidaEn(): Date | null {
    return this.datos.suspendidaEn ?? null;
  }
  get motivoSuspension(): string | null {
    return this.datos.motivoSuspension ?? null;
  }

  /** Cobertura de la suscripción con sus períodos pagados. */
  cobertura(periodos: Cobertura['periodos']): Cobertura {
    return { finPrueba: this.datos.vencePruebaEn, periodos };
  }

  /**
   * Plan que rige en el instante (FR-005): el del período que lo cubre; sin período, el plan registrado en
   * la suscripción (el de la prueba o el del último período).
   */
  planVigente(periodos: Cobertura['periodos'], ahora: Date): string {
    return planVigente(this.cobertura(periodos), ahora, this.datos.planId);
  }

  /** La copia derivada que corresponde a estos períodos (M2). */
  static finCoberturaDerivado(finPrueba: Date | null, periodos: Cobertura['periodos']): Date | null {
    return coberturaHasta({ finPrueba, periodos });
  }
}
