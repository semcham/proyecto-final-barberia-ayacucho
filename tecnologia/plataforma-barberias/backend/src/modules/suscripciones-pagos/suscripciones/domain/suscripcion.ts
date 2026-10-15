import type { Plan } from './plan';

const DIA_MS = 24 * 60 * 60 * 1000;

export type EstadoSuscripcion = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';

export interface DatosSuscripcion {
  id: string;
  tenantId: string;
  planId: string;
  estado: EstadoSuscripcion;
  iniciaEn: Date;
  vencePruebaEn: Date | null;
}

/** Suscripción de una barbería. En esta funcionalidad solo nace en prueba gratuita (RF18). */
export class Suscripcion {
  private constructor(private readonly datos: DatosSuscripcion) {}

  /** Prueba gratuita: estado TRIAL que vence a los días de prueba del plan, sin pedir pago (FR-003, FR-004). */
  static iniciarPrueba(id: string, tenantId: string, plan: Plan, ahora: Date): Suscripcion {
    if (plan.diasPrueba === null) {
      throw new Error(`El plan ${plan.codigo} no ofrece prueba gratuita`);
    }
    return new Suscripcion({
      id,
      tenantId,
      planId: plan.id,
      estado: 'TRIAL',
      iniciaEn: ahora,
      vencePruebaEn: new Date(ahora.getTime() + plan.diasPrueba * DIA_MS),
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
}
