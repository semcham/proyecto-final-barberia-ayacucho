// Reglas de la transferencia con comprobante (R05; FR-019 a FR-022b). Dominio puro.

/** Días hacia atrás que se aceptan para la fecha de la transferencia. */
export const DIAS_ATRAS_TRANSFERENCIA = 30;
/** Comprobantes por barbería y por día (FR-020a; CHECK de receipt_upload_counter). */
export const COMPROBANTES_POR_DIA = 5;
/** Días que espera un pago por transferencia sin comprobante antes de expirar (data-model.md §3). */
export const DIAS_ESPERA_COMPROBANTE = 7;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Número de operación normalizado: solo letras y dígitos, en mayúsculas (los bancos lo muestran con espacios
 * o guiones). Entre 6 y 40 caracteres (CHECK de payment.bank_operation_number); si no, null. El mismo número
 * escrito de otra forma da el mismo valor, así que la unicidad global no se evita con un guion.
 */
export function normalizarNumeroOperacion(texto: string): string | null {
  const normalizado = texto
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s.\-_/]/g, '');
  return /^[A-Z0-9]{6,40}$/.test(normalizado) ? normalizado : null;
}

/**
 * La fecha de la transferencia (`AAAA-MM-DD`, día de calendario de la barbería) es válida si existe, no es
 * posterior a hoy y no tiene más de 30 días.
 */
export function esFechaTransferenciaValida(fecha: string, hoy: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const instante = Date.parse(`${fecha}T00:00:00Z`);
  // Date.parse acepta el 31 de febrero y lo corre al 3 de marzo: se vuelve a formatear para descartarlo.
  if (Number.isNaN(instante) || new Date(instante).toISOString().slice(0, 10) !== fecha) return false;
  const dia = Date.parse(`${hoy}T00:00:00Z`);
  return instante <= dia && dia - instante <= DIAS_ATRAS_TRANSFERENCIA * DIA_MS;
}

/**
 * Referencia que el propietario escribe en la transferencia (R05): `SUS-` + 6 caracteres del tenant + año y
 * mes + 4 aleatorios, todo en mayúsculas y sin más guiones (CHECK `^SUS-[A-Z0-9]{4,28}$`).
 */
export function referenciaDeTransferencia(tenantId: string, mes: string, aleatorio: string): string {
  const tenant = tenantId.replace(/-/g, '').slice(-6).toUpperCase();
  return `SUS-${tenant}${mes.replace('-', '')}${aleatorio.toUpperCase()}`;
}
