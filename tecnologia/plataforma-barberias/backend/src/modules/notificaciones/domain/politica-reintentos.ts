// T069 de 004 · Reintentos de un aviso (FR-032, FR-033; research R13, ADR-012). Regla pura de M05:
// - esperas de 30 s, 2 min, 10 min, 30 min y 1 h entre intentos, con ±20 % de variación;
// - hasta 6 intentos por aviso de correo; un error permanente (destinatario inválido) no se reintenta;
// - con el circuito del canal abierto no se consume un intento: se vuelve a probar al terminar la pausa (30 s);
// - pasado `discard_after` (24 h para un aviso de cita), el aviso queda FALLIDO.

export const ESPERAS_MS: readonly number[] = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000];
export const INTENTOS_MAXIMOS = 6;
export const VARIACION = 0.2;
/** La pausa del circuito del canal (R13): con el circuito abierto, se vuelve a probar a los 30 s. */
export const ESPERA_CON_CIRCUITO_ABIERTO_MS = 30_000;

export type Fallo = 'TEMPORAL' | 'PERMANENTE' | 'CIRCUITO_ABIERTO';

export type DecisionTrasFallo =
  { estado: 'PENDIENTE'; intentos: number; proximoIntento: Date } | { estado: 'FALLIDO'; intentos: number };

/** Espera después del intento fallido número `intento` (1, 2, ...), con ±20 %. `azar` ∈ [0, 1]. */
export function esperaTras(intento: number, azar: () => number = Math.random): number {
  const base = ESPERAS_MS[Math.min(Math.max(intento, 1), ESPERAS_MS.length) - 1];
  return base * (1 + (azar() * 2 - 1) * VARIACION);
}

export function trasFallo(entrada: {
  intentos: number;
  fallo: Fallo;
  ahora: Date;
  descartarDespues: Date;
  azar?: () => number;
}): DecisionTrasFallo {
  const { fallo, ahora, descartarDespues } = entrada;
  // Con el circuito abierto no se llamó al canal: el intento no cuenta.
  const intentos = fallo === 'CIRCUITO_ABIERTO' ? entrada.intentos : entrada.intentos + 1;
  if (fallo === 'PERMANENTE') return { estado: 'FALLIDO', intentos };
  if (ahora.getTime() >= descartarDespues.getTime()) return { estado: 'FALLIDO', intentos };
  if (intentos >= INTENTOS_MAXIMOS) return { estado: 'FALLIDO', intentos };

  const espera =
    fallo === 'CIRCUITO_ABIERTO' ? ESPERA_CON_CIRCUITO_ABIERTO_MS : esperaTras(intentos, entrada.azar);
  const proximoIntento = new Date(ahora.getTime() + espera);
  // Si el próximo intento ya cae fuera del plazo, el aviso no llegará a tiempo: FALLIDO ahora.
  if (proximoIntento.getTime() >= descartarDespues.getTime()) return { estado: 'FALLIDO', intentos };
  return { estado: 'PENDIENTE', intentos, proximoIntento };
}
