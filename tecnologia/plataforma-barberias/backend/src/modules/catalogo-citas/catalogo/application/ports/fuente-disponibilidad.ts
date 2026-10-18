import type { FechaLocal } from '../../../../../shared';
import type { IntervaloMin } from '../../domain/calculadora-horarios';

export interface ConsultaDelDia {
  servicioId: string;
  /** Barbero pedido; sin él, todos los que ofrecen el servicio. */
  barberoId?: string;
  fecha: FechaLocal;
  /** Día local como rango de instantes [desde, hasta), ya convertido con la zona de la barbería. */
  desde: Date;
  hasta: Date;
}

export interface BarberoDelDia {
  barberoId: string;
  activo: boolean;
  ofreceServicio: boolean;
  /** Disponibilidad del día de la semana, en minutos locales. */
  disponibilidad: IntervaloMin[];
}

/** Bloqueo (sin estado) o cita activa de un barbero que toca el día. Sin motivo ni cliente. */
export interface OcupacionDelDia {
  barberoId: string;
  inicio: Date;
  fin: Date;
  estadoCita?: string;
}

export interface DatosDelDia {
  /** Duración del servicio si está activo en la barbería; null si no existe o está inactivo. */
  duracionMin: number | null;
  /** Horario de atención del día de la semana, en minutos locales. */
  atencion: IntervaloMin[];
  /** Candidatos ordenados por nombre. */
  barberos: BarberoDelDia[];
  ocupacion: OcupacionDelDia[];
}

/**
 * T069 · Lo que necesita el cálculo de horarios de un día: catálogo del día y ocupación por barbero. Tiene
 * dos implementaciones con las mismas reglas: la pública (ADR-021, rol barberias_publico, columnas públicas)
 * y la autenticada (transacción con el tenant del token).
 */
export abstract class FuenteDisponibilidad {
  abstract datosDelDia(consulta: ConsultaDelDia): Promise<DatosDelDia>;
}
