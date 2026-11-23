// T039 de 010 · Límites de las solicitudes y de los usos fallidos de los enlaces de cuenta (research R08; FR-012,
// FR-020). Regla pura: recibe los intentos de la última hora (por cuenta y por origen) y decide. Los contadores viven
// en PostgreSQL (account_link_attempt, principio VIII), nunca en Redis.

export type TipoIntentoEnlace = 'REENVIO' | 'RECUPERACION' | 'USO_FALLIDO';

export const VENTANA_LIMITE_ENLACES_MS = 60 * 60 * 1000;

export interface LimiteDeEnlace {
  /** Máximo por cuenta en la ventana; null si el tipo no tiene cuenta (USO_FALLIDO). */
  porCuenta: number | null;
  porOrigen: number;
}

/** Por hora: reenvío 3 por cuenta y 20 por origen; recuperación 3 y 10; usos fallidos 20 por origen. */
export const LIMITES_DE_ENLACES: Readonly<Record<TipoIntentoEnlace, LimiteDeEnlace>> = {
  REENVIO: { porCuenta: 3, porOrigen: 20 },
  RECUPERACION: { porCuenta: 3, porOrigen: 10 },
  USO_FALLIDO: { porCuenta: null, porOrigen: 20 },
};

export interface IntentosRecientes {
  porCuenta: readonly Date[];
  porOrigen: readonly Date[];
}

export type DecisionLimite = { permitido: true } | { permitido: false; reintentarEnSegundos: number };

/**
 * Segundos hasta que la ventana deje lugar para un intento más, o 0 si ya hay lugar. Con `n` intentos y un máximo
 * `maximo`, hay que esperar a que salga de la ventana el intento número `n - maximo + 1` (contando desde el más viejo).
 */
function esperaPara(intentos: readonly Date[], maximo: number, ahora: Date): number {
  const enVentana = intentos
    .map((fecha) => fecha.getTime())
    .filter((t) => t > ahora.getTime() - VENTANA_LIMITE_ENLACES_MS)
    .sort((x, y) => x - y);
  if (enVentana.length < maximo) return 0;
  const libera = enVentana[enVentana.length - maximo] + VENTANA_LIMITE_ENLACES_MS;
  return Math.max(1, Math.ceil((libera - ahora.getTime()) / 1000));
}

/** ¿Se permite un intento más de `tipo` ahora? Si no, cuántos segundos esperar (el mayor de los dos límites). */
export function evaluarLimiteDeEnlace(
  tipo: TipoIntentoEnlace,
  intentos: IntentosRecientes,
  ahora: Date,
): DecisionLimite {
  const limite = LIMITES_DE_ENLACES[tipo];
  const espera = Math.max(
    limite.porCuenta === null ? 0 : esperaPara(intentos.porCuenta, limite.porCuenta, ahora),
    esperaPara(intentos.porOrigen, limite.porOrigen, ahora),
  );
  return espera === 0 ? { permitido: true } : { permitido: false, reintentarEnSegundos: espera };
}
