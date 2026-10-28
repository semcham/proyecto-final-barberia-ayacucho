// Comportamientos del simulador (contracts/pasarela-simulada.md §3). Uno a la vez; `normal` por defecto.

export const MODOS = [
  'normal',
  'lento',
  'caido',
  'colgado',
  'duplicar',
  'firma_invalida',
  'sin_firma',
  'fuera_de_orden',
  'importe_distinto',
  'aprobar_despues',
  'rechazar',
] as const;

export type NombreModo = (typeof MODOS)[number];

export interface Modo {
  modo: NombreModo;
  /** `lento`: demora de cada respuesta y notificación. `aprobar_despues`: cuándo se aprueba la sesión. */
  retardoMs?: number;
  /** `duplicar`: cuántas veces se envía la misma notificación (mismo evento_id). */
  veces?: number;
  /** `caido`: si se indica, el puerto se vuelve a abrir solo pasado este tiempo. */
  duracionMs?: number;
}

export const MODO_NORMAL: Modo = { modo: 'normal' };

const enteroOpcional = (valor: unknown, maximo: number): number | undefined => {
  if (valor === undefined) return undefined;
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 0 || valor > maximo) {
    throw new Error('parámetro inválido');
  }
  return valor;
};

/** Valida el cuerpo de POST /control/modo. Lanza si no es un modo conocido con parámetros válidos. */
export function leerModo(cuerpo: unknown): Modo {
  const { modo, retardoMs, veces, duracionMs } = (cuerpo ?? {}) as Record<string, unknown>;
  if (typeof modo !== 'string' || !(MODOS as readonly string[]).includes(modo)) {
    throw new Error(`modo desconocido; use uno de: ${MODOS.join(', ')}`);
  }
  return {
    modo: modo as NombreModo,
    // Hasta una hora: el recorrido del quickstart usa aprobar_despues con 15 minutos (900000).
    retardoMs: enteroOpcional(retardoMs, 3_600_000),
    veces: enteroOpcional(veces, 100),
    duracionMs: enteroOpcional(duracionMs, 3_600_000),
  };
}
