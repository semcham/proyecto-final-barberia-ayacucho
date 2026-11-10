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

/** La cita tal como se leyó antes de reprogramarla: el UPDATE condicional exige que siga igual (R01). */
export interface CitaAntesDeReprogramar {
  barberoId: string;
  inicio: Date;
  estado: EstadoCita;
  version: number;
}

export type AccionDeEnlaceCita = 'CONFIRMAR' | 'REPROGRAMAR' | 'CANCELAR';

/** Quién reprogramó y por dónde: por sesión hay usuario; por enlace (fase 4), no. */
export type AutorDeReprogramacion = { via: 'SESION'; usuarioId: string } | { via: 'ENLACE'; usuarioId: null };

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
  /**
   * Guarda el estado nuevo (y, si se canceló, quién, cuándo, el motivo y la marca de tardía) y agrega la
   * fila del historial (inmutable) con su autor.
   */
  /** `autorId` null: el cambio lo hizo el cliente por un enlace de acción, sin sesión (004, migración 0027). */
  abstract actualizarEstado(cita: Cita, anterior: EstadoCita, autorId: string | null): Promise<void>;
  /** 004 (FR-028): guarda la confirmación de asistencia del cliente (`client_confirmed_at`). */
  abstract confirmarAsistencia(cita: Cita): Promise<void>;
  /**
   * 004 (contracts/enlaces-de-accion.md §3): anota el USO de un enlace en la transacción en curso, con el SHA-256
   * del token. Un segundo uso (también simultáneo, en otra réplica) choca con UNIQUE (link_hash) y se traduce a
   * `EnlaceNoValido`. `usado` dice si ese hash ya tiene uso (para el GET, que no consume).
   */
  abstract registrarUsoDeEnlace(citaId: string, linkHash: string, accion: AccionDeEnlaceCita): Promise<void>;
  abstract enlaceUsado(linkHash: string): Promise<boolean>;
  /** La cita sin bloquear su fila, o null. La reprogramación la vuelve a comprobar al escribir (R01). */
  abstract buscarPorId(id: string): Promise<Cita | null>;
  /**
   * 004 (T048; research R01 a R03) · Guarda la cita ya reprogramada en la MISMA fila, en la transacción en
   * curso: toma los bloqueos consultivos de los dos barberos (en orden, sin bloqueo mutuo) y hace un UPDATE
   * condicional (misma versión y aún activa). La violación de las restricciones de exclusión se traduce a
   * `HorarioNoDisponible` o `CitaSolapadaDelCliente`; 0 filas, a `CitaCambio`; el bloqueo mutuo (40P01), a
   * `ConflictoConcurrente` (el caso de uso reintenta la transacción entera). Agrega la fila inmutable de
   * `appointment_reschedule` y, si la cita estaba PENDIENTE, la del historial de estados.
   */
  abstract reprogramar(
    cita: Cita,
    antes: CitaAntesDeReprogramar,
    autor: AutorDeReprogramacion,
  ): Promise<void>;
  /** Citas (en cualquier estado) que empiezan en [desde, hasta), opcionalmente de un barbero, por inicio. */
  abstract delRango(desde: Date, hasta: Date, barberoId?: string): Promise<Cita[]>;
  /**
   * Una página de las citas de un cliente (en cualquier estado), por inicio descendente (índice
   * `appointment_cliente`), con el total de todas las páginas.
   */
  abstract delCliente(
    clienteId: string,
    pagina: number,
    tamano: number,
  ): Promise<{ total: number; citas: Cita[] }>;
}
