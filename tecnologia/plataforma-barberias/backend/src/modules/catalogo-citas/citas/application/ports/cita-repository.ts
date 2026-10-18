import type { Cita } from '../../domain/cita';
import type { EstadoCita } from '../../domain/estado-cita';

/** Datos de idempotencia de una reserva (research R09): se guardan en la propia fila de la cita. */
export interface Idempotencia {
  clave: string;
  /** SHA-256 del cuerpo normalizado de la reserva. */
  hashSolicitud: string;
}

export interface CitaConIdempotencia {
  cita: Cita;
  hashSolicitud: string | null;
}

/**
 * La clave de idempotencia ya la usó otra reserva del mismo autor, confirmada mientras esta se procesaba
 * (índice único `appointment_idempotencia`). No es un error para el cliente: el caso de uso vuelve a
 * buscar la cita en una transacción nueva (R09).
 */
export class ClaveIdempotenciaEnUso extends Error {
  constructor() {
    super('La clave de idempotencia ya está en uso');
    this.name = 'ClaveIdempotenciaEnUso';
  }
}

/**
 * PostgreSQL abortó la transacción por un bloqueo mutuo (40P01) entre inserciones simultáneas que chocan
 * en las restricciones de exclusión. La transacción se puede reintentar entera: al reintentar, la cita que
 * ganó ya está confirmada y el conflicto se detecta sin esperas.
 */
export class ConflictoConcurrente extends Error {
  constructor() {
    super('Bloqueo mutuo entre reservas simultáneas');
    this.name = 'ConflictoConcurrente';
  }
}

/** Citas de la barbería del contexto (filtro explícito por tenant además de RLS). */
export abstract class CitaRepository {
  /**
   * Inserta la cita y la primera fila de su historial en la transacción en curso. Traduce la violación de
   * las restricciones de exclusión a `HorarioNoDisponible` (barbero) o `CitaSolapadaDelCliente`
   * (cliente), y la del índice de idempotencia a `ClaveIdempotenciaEnUso`.
   */
  abstract guardar(cita: Cita, idempotencia: Idempotencia | null): Promise<void>;
  /** Cita reservada por `autorId` con esa clave de idempotencia, o null. */
  abstract buscarPorIdempotencia(autorId: string, clave: string): Promise<CitaConIdempotencia | null>;
  /**
   * La cita con su fila bloqueada (`FOR UPDATE`) hasta el fin de la transacción, o null: dos cambios de
   * estado simultáneos se atienden uno después del otro (R10).
   */
  abstract buscarParaActualizar(id: string): Promise<Cita | null>;
  /** Guarda el estado nuevo y agrega la fila del historial (inmutable) con su autor. */
  abstract actualizarEstado(cita: Cita, anterior: EstadoCita, autorId: string): Promise<void>;
  /** Citas (en cualquier estado) que empiezan en [desde, hasta), opcionalmente de un barbero, por inicio. */
  abstract delRango(desde: Date, hasta: Date, barberoId?: string): Promise<Cita[]>;
}
