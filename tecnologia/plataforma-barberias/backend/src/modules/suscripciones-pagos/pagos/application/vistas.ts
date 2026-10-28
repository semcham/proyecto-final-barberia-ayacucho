import type { Plan } from '../../suscripciones/domain/plan';
import type { EstadoPago, MarcaRevision, MetodoPago, Pago } from '../domain/pago';
import type { LimitesDelMedio } from './ports/payment-gateway';

// Vistas de la API de 003 (contracts/openapi.yaml: Plan, Pago). Sin datos del pagador ni el número de
// operación completo (solo sus últimos 4 caracteres).

export interface PlanVista {
  id: string;
  codigo: string;
  nombre: string;
  /** El plan de prueba no tiene precio: 0. */
  precioCentimos: number;
  moneda: string;
  maxUsuarios: number;
  maxBarberos: number;
  mediosDisponibles: 'YAPE'[];
}

/**
 * Medios con los que se puede pagar el plan. Yape, si el importe está dentro de los límites del proveedor
 * (FR-009). La transferencia se suma con US3.
 */
export function aPlanVista(plan: Plan, limitesYape: LimitesDelMedio): PlanVista {
  const precio = plan.precioCentimos;
  const conYape =
    plan.esContratable &&
    precio !== null &&
    precio >= limitesYape.minimoCentimos &&
    precio <= limitesYape.maximoCentimos;
  return {
    id: plan.id,
    codigo: plan.codigo,
    nombre: plan.nombre,
    precioCentimos: precio ?? 0,
    moneda: plan.moneda,
    maxUsuarios: plan.maxUsuarios,
    maxBarberos: plan.maxBarberos,
    mediosDisponibles: conYape ? ['YAPE'] : [],
  };
}

export interface PagoVista {
  id: string;
  plan: { id: string; nombre: string };
  importeCentimos: number;
  moneda: string;
  medio: MetodoPago;
  estado: EstadoPago;
  marca: MarcaRevision | null;
  periodo: { iniciaEn: Date; terminaEn: Date } | null;
  motivoRechazo: string | null;
  numeroOperacionFinal: string | null;
  creadoEn: Date;
  aprobadoEn: Date | null;
}

export function aPagoVista(
  pago: Pago,
  plan: { id: string; nombre: string },
  periodo: { inicio: Date; fin: Date } | null,
): PagoVista {
  return {
    id: pago.id,
    plan: { id: plan.id, nombre: plan.nombre },
    importeCentimos: pago.importeCentimos,
    moneda: pago.moneda,
    medio: pago.metodo,
    estado: pago.estado,
    marca: pago.marca,
    periodo: periodo ? { iniciaEn: periodo.inicio, terminaEn: periodo.fin } : null,
    motivoRechazo: pago.motivoRechazo,
    numeroOperacionFinal: pago.numeroOperacionFinal,
    creadoEn: pago.creadoEn,
    aprobadoEn: pago.aprobadoEn,
  };
}
