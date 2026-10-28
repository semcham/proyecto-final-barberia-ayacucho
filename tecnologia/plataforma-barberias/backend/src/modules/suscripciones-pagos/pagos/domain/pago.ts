import { ComprobanteYaEnRevision, TransicionDePagoInvalida } from './errores';

// Máquina de estados del pago (data-model.md §3; FR-012, FR-012a, FR-017, FR-017a, FR-021, FR-022c).
// Dominio puro. La regla de aprobación (período objetivo y tope por adelantado) la decide periodo.ts:
// aquí solo se dice si el pago debe aplicar un período.

export const ESTADOS_PAGO = [
  'PENDIENTE',
  'ESPERANDO_COMPROBANTE',
  'EN_REVISION',
  'APROBADO',
  'RECHAZADO',
  'ANULADO',
  'EXPIRADO',
] as const;
export type EstadoPago = (typeof ESTADOS_PAGO)[number];

/** Marcas para la lista del administrador (FR-025a). Son marcas, no estados (L1). */
export const MARCAS_REVISION = [
  'DUPLICADO',
  'IMPORTE_DISTINTO',
  'APROBADO_TRAS_RECHAZO',
  'DEVOLUCION',
  'NUMERO_REPETIDO',
] as const;
export type MarcaRevision = (typeof MARCAS_REVISION)[number];

export const METODOS_PAGO = ['YAPE', 'TRANSFERENCIA', 'MANUAL'] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export const ESTADOS_ABIERTOS: readonly EstadoPago[] = ['PENDIENTE', 'ESPERANDO_COMPROBANTE', 'EN_REVISION'];

/** Lo que informa el proveedor (notificación o consulta de la conciliación). */
export type ResultadoProveedor = 'APROBADO' | 'RECHAZADO' | 'PENDIENTE' | 'EXPIRADO' | 'DEVUELTO';

export type EventoPago =
  | { tipo: 'PROVEEDOR'; estado: ResultadoProveedor; importeCentimos: number; moneda: string }
  /** Otro plan o medio elegido, el mismo intento con la sesión vencida, o el proveedor caído al crear. */
  | { tipo: 'ANULAR' }
  /** 24 h sin respuesta final (Yape) o 7 días sin comprobante (transferencia). */
  | { tipo: 'EXPIRAR' }
  | { tipo: 'COMPROBANTE_SUBIDO' }
  | { tipo: 'APROBAR_REVISION' }
  | { tipo: 'RECHAZAR_REVISION' };

export interface PagoActual {
  estado: EstadoPago;
  metodo: MetodoPago;
  importeCentimos: number;
  moneda: string;
  marca: MarcaRevision | null;
}

/** Efecto registrado del evento (provider_event.effect). */
export type EfectoDelEvento = 'APLICADO' | 'SIN_EFECTO' | 'REVISION';

export interface TransicionDePago {
  estado: EstadoPago;
  marca: MarcaRevision | null;
  /** El pago quedó aprobado y debe aplicar su período (sujeto a la regla de aprobación). */
  aplicarPeriodo: boolean;
  efecto: EfectoDelEvento;
}

/** Importe en céntimos enteros y positivos (FR-005b): sin decimales flotantes. */
export function esImporteValido(importeCentimos: number): boolean {
  return Number.isSafeInteger(importeCentimos) && importeCentimos > 0;
}

const sinEfecto = (pago: PagoActual): TransicionDePago => ({
  estado: pago.estado,
  marca: pago.marca,
  aplicarPeriodo: false,
  efecto: 'SIN_EFECTO',
});
const aplicada = (estado: EstadoPago): TransicionDePago => ({
  estado,
  marca: null,
  aplicarPeriodo: estado === 'APROBADO',
  efecto: 'APLICADO',
});
const enRevision = (estado: EstadoPago, marca: MarcaRevision): TransicionDePago => ({
  estado,
  marca,
  aplicarPeriodo: false,
  efecto: 'REVISION',
});

function eventoDelProveedor(
  pago: PagoActual,
  evento: Extract<EventoPago, { tipo: 'PROVEEDOR' }>,
): TransicionDePago {
  // Las transferencias y las activaciones manuales no pasan por el proveedor.
  if (pago.metodo !== 'YAPE') return sinEfecto(pago);
  const mismoImporte = evento.importeCentimos === pago.importeCentimos && evento.moneda === pago.moneda;
  switch (pago.estado) {
    case 'PENDIENTE':
      if (evento.estado === 'APROBADO') {
        return mismoImporte ? aplicada('APROBADO') : enRevision('APROBADO', 'IMPORTE_DISTINTO');
      }
      if (evento.estado === 'RECHAZADO' || evento.estado === 'EXPIRADO') {
        return aplicada(evento.estado === 'RECHAZADO' ? 'RECHAZADO' : 'EXPIRADO');
      }
      return sinEfecto(pago);
    case 'ANULADO':
    case 'EXPIRADO':
      // El dinero recibido nunca se ignora (FR-012a).
      if (evento.estado !== 'APROBADO') return sinEfecto(pago);
      return mismoImporte ? aplicada('APROBADO') : enRevision('APROBADO', 'IMPORTE_DISTINTO');
    case 'RECHAZADO':
      return evento.estado === 'APROBADO'
        ? enRevision('RECHAZADO', 'APROBADO_TRAS_RECHAZO')
        : sinEfecto(pago);
    case 'APROBADO':
      return evento.estado === 'DEVUELTO' ? enRevision('APROBADO', 'DEVOLUCION') : sinEfecto(pago);
    default:
      return sinEfecto(pago);
  }
}

/** Orden de la plataforma: una combinación fuera de la tabla es un error de programación. */
function ordenDeLaPlataforma(
  pago: PagoActual,
  evento: Exclude<EventoPago, { tipo: 'PROVEEDOR' }>,
): TransicionDePago {
  const clave = `${pago.estado}:${evento.tipo}`;
  switch (clave) {
    case 'PENDIENTE:ANULAR':
    case 'ESPERANDO_COMPROBANTE:ANULAR':
      return aplicada('ANULADO');
    case 'PENDIENTE:EXPIRAR':
    case 'ESPERANDO_COMPROBANTE:EXPIRAR':
      return aplicada('EXPIRADO');
    case 'ESPERANDO_COMPROBANTE:COMPROBANTE_SUBIDO':
      return aplicada('EN_REVISION');
    case 'EN_REVISION:APROBAR_REVISION':
      return aplicada('APROBADO');
    case 'EN_REVISION:RECHAZAR_REVISION':
      return aplicada('RECHAZADO');
    case 'EN_REVISION:ANULAR':
      // El dinero pudo haberse transferido: un pago en revisión nunca se anula (H4, FR-021).
      throw new ComprobanteYaEnRevision();
    default:
      throw new TransicionDePagoInvalida(pago.estado, evento.tipo);
  }
}

export function transicionDePago(pago: PagoActual, evento: EventoPago): TransicionDePago {
  return evento.tipo === 'PROVEEDOR' ? eventoDelProveedor(pago, evento) : ordenDeLaPlataforma(pago, evento);
}

/** Un pago tal como lo guarda la plataforma (data-model.md §1.2). Importes en céntimos enteros. */
export interface Pago {
  id: string;
  tenantId: string;
  suscripcionId: string;
  planId: string;
  importeCentimos: number;
  moneda: string;
  metodo: MetodoPago;
  estado: EstadoPago;
  /** Período objetivo (covers_after): la cobertura vigente al iniciar el pago (H1). */
  cubreDesde: Date;
  marca: MarcaRevision | null;
  referenciaProveedor: string | null;
  urlPago: string | null;
  sesionExpiraEn: Date | null;
  numeroOperacionFinal: string | null;
  motivoRechazo: string | null;
  creadoPor: string;
  creadoEn: Date;
  aprobadoEn: Date | null;
  cerradoEn: Date | null;
}

/** El pago abierto se reutiliza solo si es el mismo intento y su sesión de pago sigue vigente (FR-012, H3). */
export function esReutilizable(pago: Pago, planId: string, metodo: MetodoPago, ahora: Date): boolean {
  return (
    pago.estado === 'PENDIENTE' &&
    pago.metodo === metodo &&
    pago.planId === planId &&
    pago.urlPago !== null &&
    pago.sesionExpiraEn !== null &&
    pago.sesionExpiraEn.getTime() > ahora.getTime()
  );
}
