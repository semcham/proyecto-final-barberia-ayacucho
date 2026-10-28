/** Acciones que restringe el estado de la suscripción (FR-006; contracts/restricciones-estado.md §1). */
export const ACCIONES_SUSCRIPCION = [
  'RESERVAR',
  'GESTIONAR_CITAS',
  'CONFIGURAR_CATALOGO',
  'GESTIONAR_USUARIOS',
  'PAGAR',
] as const;

export type AccionSuscripcion = (typeof ACCIONES_SUSCRIPCION)[number];
