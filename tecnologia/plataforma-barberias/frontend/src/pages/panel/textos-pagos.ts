import type { EstadoPago, Pago } from '../../api/suscripcion';

// Textos de los pagos para el propietario (specs/003-suscripciones-pagos/data-model.md §3, "Cómo se muestran
// al propietario"). Los cuatro primeros estados y la marca DUPLICADO son los del contrato; el resto, sus
// equivalentes en el mismo registro. Una sola fuente para el estado actual, el resultado del pago y el
// historial.

export const ESTADOS_PAGO: Record<EstadoPago, string> = {
  PENDIENTE: 'pendiente de confirmación',
  ESPERANDO_COMPROBANTE: 'esperando comprobante',
  EN_REVISION: 'comprobante en revisión',
  APROBADO: 'aprobado',
  RECHAZADO: 'rechazado',
  ANULADO: 'anulado',
  EXPIRADO: 'expirado',
};

export const MEDIOS_PAGO: Record<Pago['medio'], string> = {
  YAPE: 'Yape',
  TRANSFERENCIA: 'Transferencia',
  MANUAL: 'Activación manual',
};

/**
 * Lo que ve el propietario de un pago: el estado y, si el pago aprobado quedó duplicado, "pago duplicado (en
 * revisión)". Las demás marcas son de la revisión del administrador y no cambian el texto del propietario.
 */
export function textoDelPago(pago: Pick<Pago, 'estado' | 'marca'>): string {
  if (pago.estado === 'APROBADO' && pago.marca === 'DUPLICADO') return 'pago duplicado (en revisión)';
  return ESTADOS_PAGO[pago.estado];
}
