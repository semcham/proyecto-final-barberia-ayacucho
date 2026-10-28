import { ErrorDeAplicacion } from '../../../../shared/nucleo';
import {
  type Cobertura,
  finDeGracia,
  periodoVigente,
  primerPeriodoEmpezado,
  ultimoPeriodoEmpezado,
} from './periodo';
import type { EstadoSuscripcion } from './suscripcion';

// Máquina de estados de la suscripción (data-model.md §2, research R12; FR-029 a FR-035). Dominio puro.
//
// - El estado "por fechas" sale solo de la cobertura (prueba y períodos pagados).
// - Las transiciones automáticas (tarea de vencimiento y aprobación de un pago) avanzan de a UN paso por la
//   línea de tiempo, con la fecha que les correspondía (FR-031): con la tarea detenida, varios pasos seguidos
//   llevan al estado por fechas y cada uno se audita por separado.
// - SUSPENDED y CANCELLED no cambian solos. Al reactivar se recalcula por fechas (FR-035).

export type EstadoPorFechas = Extract<EstadoSuscripcion, 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED'>;

export interface SituacionSuscripcion {
  estado: EstadoSuscripcion;
  /** Plan con el que está la suscripción ahora (subscription.plan_id). */
  planId: string;
  cobertura: Cobertura;
}

export interface PasoDeSuscripcion {
  desde: EstadoSuscripcion;
  hacia: EstadoSuscripcion;
  /** Instante que le correspondía a la transición (auditoría, FR-031). */
  fecha: Date;
  /** Plan que empieza a regir, si cambia (el del período que empieza). */
  planId: string | null;
  /** Fin de la gracia, al pasar a PAST_DUE. */
  graciaHasta: Date | null;
}

export class TransicionDeSuscripcionInvalida extends ErrorDeAplicacion {
  readonly codigo = 'TRANSICION_DE_SUSCRIPCION_INVALIDA';

  constructor(desde: EstadoSuscripcion, accion: string) {
    super(`La suscripción en estado ${desde} no admite ${accion}`, [{ estado: desde, accion }]);
  }
}

/** Estado que corresponde a la cobertura en el instante (sin suspensión ni cancelación). */
export function estadoPorFechas(cobertura: Cobertura, ahora: Date): EstadoPorFechas {
  if (periodoVigente(cobertura, ahora)) return 'ACTIVE';
  const ultimo = ultimoPeriodoEmpezado(cobertura, ahora);
  if (!ultimo) {
    const enPrueba = cobertura.finPrueba !== null && ahora.getTime() < cobertura.finPrueba.getTime();
    return enPrueba ? 'TRIAL' : 'EXPIRED';
  }
  return ahora.getTime() < finDeGracia(ultimo.fin).getTime() ? 'PAST_DUE' : 'EXPIRED';
}

function paso(
  desde: EstadoSuscripcion,
  hacia: EstadoSuscripcion,
  fecha: Date,
  extra: { planId?: string; graciaHasta?: Date } = {},
): PasoDeSuscripcion {
  return { desde, hacia, fecha, planId: extra.planId ?? null, graciaHasta: extra.graciaHasta ?? null };
}

/**
 * Próxima transición automática, o null si no hay nada que cambiar (una transición repetida no hace nada,
 * FR-032). La aplican la tarea de vencimiento y la aprobación de un pago, con la suscripción bloqueada.
 */
export function siguientePaso(situacion: SituacionSuscripcion, ahora: Date): PasoDeSuscripcion | null {
  const { estado, planId, cobertura } = situacion;
  const vigente = periodoVigente(cobertura, ahora);
  switch (estado) {
    case 'TRIAL': {
      const primero = primerPeriodoEmpezado(cobertura, ahora);
      if (primero) return paso('TRIAL', 'ACTIVE', primero.inicio, { planId: primero.planId });
      if (cobertura.finPrueba && ahora.getTime() >= cobertura.finPrueba.getTime()) {
        return paso('TRIAL', 'EXPIRED', cobertura.finPrueba);
      }
      return null;
    }
    case 'ACTIVE': {
      if (vigente) {
        return vigente.planId === planId
          ? null
          : paso('ACTIVE', 'ACTIVE', vigente.inicio, { planId: vigente.planId });
      }
      const ultimo = ultimoPeriodoEmpezado(cobertura, ahora);
      if (!ultimo) return null;
      return paso('ACTIVE', 'PAST_DUE', ultimo.fin, { graciaHasta: finDeGracia(ultimo.fin) });
    }
    case 'PAST_DUE': {
      // Activada por un pago aprobado: corresponde al instante de la aprobación.
      if (vigente) return paso('PAST_DUE', 'ACTIVE', ahora, { planId: vigente.planId });
      const ultimo = ultimoPeriodoEmpezado(cobertura, ahora);
      if (!ultimo) return null;
      const fin = finDeGracia(ultimo.fin);
      return ahora.getTime() >= fin.getTime() ? paso('PAST_DUE', 'EXPIRED', fin) : null;
    }
    case 'EXPIRED':
      return vigente ? paso('EXPIRED', 'ACTIVE', ahora, { planId: vigente.planId }) : null;
    case 'SUSPENDED':
    case 'CANCELLED':
      return null;
  }
}

/** El administrador suspende (FR-035): desde cualquier estado salvo SUSPENDED y CANCELLED. */
export function suspender(estado: EstadoSuscripcion): 'SUSPENDED' {
  if (estado === 'SUSPENDED' || estado === 'CANCELLED') {
    throw new TransicionDeSuscripcionInvalida(estado, 'SUSPENDER');
  }
  return 'SUSPENDED';
}

/**
 * El administrador reactiva (FR-035): la suscripción queda en el estado que le corresponde por sus fechas;
 * los días suspendidos no se devuelven.
 */
export function reactivar(
  estado: EstadoSuscripcion,
  cobertura: Cobertura,
  ahora: Date,
): { estado: EstadoPorFechas; planId: string | null; graciaHasta: Date | null } {
  if (estado !== 'SUSPENDED') throw new TransicionDeSuscripcionInvalida(estado, 'REACTIVAR');
  const nuevo = estadoPorFechas(cobertura, ahora);
  const vigente = periodoVigente(cobertura, ahora);
  const ultimo = ultimoPeriodoEmpezado(cobertura, ahora);
  return {
    estado: nuevo,
    planId: nuevo === 'ACTIVE' && vigente ? vigente.planId : null,
    graciaHasta: nuevo === 'PAST_DUE' && ultimo ? finDeGracia(ultimo.fin) : null,
  };
}
