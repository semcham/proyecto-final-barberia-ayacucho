/** Estados de la cita (RF15, research R10). Solo PENDIENTE y CONFIRMADA ocupan el horario. */
export const ESTADOS_CITA = ['PENDIENTE', 'CONFIRMADA', 'COMPLETADA', 'NO_ASISTIO', 'CANCELADA'] as const;
export type EstadoCita = (typeof ESTADOS_CITA)[number];

/** Estados activos: los que considera la restricción de exclusión (principio IV). */
export const ESTADOS_ACTIVOS: readonly EstadoCita[] = ['PENDIENTE', 'CONFIRMADA'];

export function ocupaHorario(estado: EstadoCita): boolean {
  return ESTADOS_ACTIVOS.includes(estado);
}
