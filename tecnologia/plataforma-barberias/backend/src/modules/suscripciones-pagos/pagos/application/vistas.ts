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
  mediosDisponibles: ('YAPE' | 'TRANSFERENCIA')[];
}

/**
 * Medios con los que se puede pagar el plan (FR-009, FR-019): Yape, si el importe está dentro de los límites
 * del proveedor; transferencia, para todo plan contratable si la plataforma configuró su cuenta.
 */
export function aPlanVista(plan: Plan, limitesYape: LimitesDelMedio, conTransferencia: boolean): PlanVista {
  const precio = plan.precioCentimos;
  const contratable = plan.esContratable && precio !== null;
  const conYape =
    contratable &&
    precio !== null &&
    precio >= limitesYape.minimoCentimos &&
    precio <= limitesYape.maximoCentimos;
  const medios: PlanVista['mediosDisponibles'] = [];
  if (conYape) medios.push('YAPE');
  if (contratable && conTransferencia) medios.push('TRANSFERENCIA');
  return {
    id: plan.id,
    codigo: plan.codigo,
    nombre: plan.nombre,
    precioCentimos: precio ?? 0,
    moneda: plan.moneda,
    maxUsuarios: plan.maxUsuarios,
    maxBarberos: plan.maxBarberos,
    mediosDisponibles: medios,
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
  /** Solo MANUAL (FR-036): el historial muestra "activación manual" con su motivo. */
  motivoActivacion: string | null;
  numeroOperacionFinal: string | null;
  creadoEn: Date;
  aprobadoEn: Date | null;
}

/** Datos de la cuenta de la plataforma para transferir (variables PAGOS_CUENTA_*), o null si falta alguno. */
export interface CuentaDeTransferencia {
  banco: string;
  titular: string;
  numeroCuenta: string;
  cci: string;
}

export function cuentaDeTransferencia(cuenta: {
  banco?: string;
  titular?: string;
  numero?: string;
  cci?: string;
}): CuentaDeTransferencia | null {
  const { banco, titular, numero, cci } = cuenta;
  return banco && titular && numero && cci ? { banco, titular, numeroCuenta: numero, cci } : null;
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
    motivoActivacion: pago.motivoActivacion,
    numeroOperacionFinal: pago.numeroOperacionFinal,
    creadoEn: pago.creadoEn,
    aprobadoEn: pago.aprobadoEn,
  };
}
