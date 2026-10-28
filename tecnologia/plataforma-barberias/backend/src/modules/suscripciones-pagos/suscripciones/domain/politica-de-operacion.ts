import { type AccionSuscripcion } from './accion-suscripcion';
import { SuscripcionNoPermite } from './errores';
import type { EstadoSuscripcion } from './suscripcion';

export { ACCIONES_SUSCRIPCION, type AccionSuscripcion } from './accion-suscripcion';

// Qué permite cada estado de la suscripción (FR-006, FR-007; research R10). La tabla es la de
// specs/003-suscripciones-pagos/contracts/restricciones-estado.md §1, y la prueba de PR25 la compara celda
// por celda con el contrato. Las lecturas nunca se restringen.

const OPERATIVOS: readonly EstadoSuscripcion[] = ['TRIAL', 'ACTIVE', 'PAST_DUE'];
const TODOS: readonly EstadoSuscripcion[] = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'EXPIRED',
  'CANCELLED',
  'SUSPENDED',
];

/** Estados en los que se permite cada acción. */
const PERMITIDA_EN: Record<AccionSuscripcion, readonly EstadoSuscripcion[]> = {
  RESERVAR: OPERATIVOS,
  // Una barbería vencida sigue gestionando sus citas existentes (P4: A).
  GESTIONAR_CITAS: TODOS,
  CONFIGURAR_CATALOGO: OPERATIVOS,
  GESTIONAR_USUARIOS: OPERATIVOS,
  // Pagar es la salida de cualquier estado.
  PAGAR: TODOS,
};

export const PoliticaDeOperacion = {
  permite(estado: EstadoSuscripcion, accion: AccionSuscripcion): boolean {
    return PERMITIDA_EN[accion].includes(estado);
  },

  /** Lanza SuscripcionNoPermite (403) si el estado no permite la acción. */
  exigir(estado: EstadoSuscripcion, accion: AccionSuscripcion): void {
    if (!PoliticaDeOperacion.permite(estado, accion)) throw new SuscripcionNoPermite(estado, accion);
  },
};
