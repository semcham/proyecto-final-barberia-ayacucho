import type { AlcanceDeCuota } from '../../domain/errores';
import type { LimitesDeCuota } from '../../domain/politica-cuota';

// T041 de 005 · Puerto de las cuotas del asistente (research R08, principio VIII: en PostgreSQL, compartidas entre
// réplicas). Corre en la transacción del llamador, con el tenant del token. La implementación es
// infrastructure/kysely-cuotas.ts.

/** Una de las dos cuotas está agotada: el llamador revierte la transacción (no sube ninguna). */
export class AlcanceAgotado extends Error {
  constructor(readonly alcance: AlcanceDeCuota) {
    super(`Cuota del asistente agotada (${alcance})`);
    this.name = 'AlcanceAgotado';
  }
}

/** Preguntas usadas en el día, contando la que se acaba de sumar. */
export interface UsoDeLaCuota {
  usuario: number;
  barberia: number;
}

export abstract class CuotasDelAsistente {
  /**
   * Suma una pregunta a la cuota del usuario y a la de la barbería en el día local `dia`, de forma atómica y sin
   * pasarse del límite (también con varias réplicas a la vez). Si alguna está agotada lanza AlcanceAgotado.
   */
  abstract sumar(usuarioId: string, dia: string, limites: LimitesDeCuota): Promise<UsoDeLaCuota>;
  /** Devuelve la pregunta a las dos cuotas (el proveedor falló). */
  abstract devolver(usuarioId: string, dia: string): Promise<void>;
}
