// Comportamientos del simulador de WhatsApp (contracts/notification-channel.md §3, 004). Uno a la vez; `normal` por
// defecto. Herramienta de desarrollo y pruebas: nunca se despliega en producción.

export const MODOS = ['normal', 'lento', 'caido', 'colgado', 'rechazar', 'limite', 'fallar_n'] as const;

export type NombreModo = (typeof MODOS)[number];

export interface Modo {
  modo: NombreModo;
  /** `lento`: demora de cada respuesta. */
  retardoMs?: number;
  /** `caido`: si se indica, vuelve solo a `normal` pasado este tiempo. */
  duracionMs?: number;
  /** `fallar_n`: cuántos envíos fallan (503) antes de volver a aceptar. */
  veces?: number;
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
  const { modo, retardoMs, duracionMs, veces } = (cuerpo ?? {}) as Record<string, unknown>;
  if (typeof modo !== 'string' || !(MODOS as readonly string[]).includes(modo)) {
    throw new Error(`modo desconocido; use uno de: ${MODOS.join(', ')}`);
  }
  return {
    modo: modo as NombreModo,
    retardoMs: enteroOpcional(retardoMs, 600_000),
    duracionMs: enteroOpcional(duracionMs, 3_600_000),
    veces: enteroOpcional(veces, 1000),
  };
}
