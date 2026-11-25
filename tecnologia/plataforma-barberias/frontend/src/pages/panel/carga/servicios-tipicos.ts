/**
 * 011 (T027) · Servicios típicos de una barbería para empezar rápido: SOLO nombre y una duración sugerida (editable).
 * La aplicación nunca propone precios (ajuste del 2026-11-25): el precio queda vacío y la revisión marca "Falta el
 * precio" hasta que el propietario lo escriba.
 */
export const SERVICIOS_TIPICOS: readonly { nombre: string; duracionMinutos: number }[] = [
  { nombre: 'Corte', duracionMinutos: 30 },
  { nombre: 'Barba', duracionMinutos: 20 },
  { nombre: 'Corte y barba', duracionMinutos: 50 },
  { nombre: 'Cejas', duracionMinutos: 10 },
  { nombre: 'Corte para niños', duracionMinutos: 30 },
  { nombre: 'Lavado', duracionMinutos: 10 },
];
