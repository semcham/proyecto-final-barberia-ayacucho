const SEGUNDO_MS = 1000;
export const MAX_FALLOS = 5;
export const VENTANA_MS = 60 * SEGUNDO_MS;
export const HISTORIAL_MS = 24 * 60 * 60 * SEGUNDO_MS;
const ESPERA_INICIAL_S = 60;
const ESPERA_MAXIMA_S = 900;

export interface EvaluacionIntentos {
  bloqueado: boolean;
  reintentarEnSegundos: number;
}

/**
 * Límite de intentos de inicio de sesión por cuenta + IP (R10, EQ-12).
 *
 * Hay bloqueo cuando los últimos 5 fallos ocurrieron dentro de 60 s. Dura desde el último fallo:
 * 60 s la primera racha y el doble en cada racha siguiente de 5 fallos (60, 120, 240, 480, como máximo
 * 900 s). La primera espera es de 60 s (no de 30) para que el sexto intento hecho en el mismo minuto se
 * rechace siempre, como pide EQ-12. Los intentos rechazados por bloqueo no cuentan como fallos.
 * Un inicio de sesión correcto borra los fallos, así que la espera vuelve a empezar.
 */
export const PoliticaIntentos = {
  evaluar(fallos: readonly Date[], ahora: Date): EvaluacionIntentos {
    const vigentes = fallos
      .map((fallo) => fallo.getTime())
      .filter((instante) => ahora.getTime() - instante < HISTORIAL_MS)
      .sort((a, b) => a - b);
    if (vigentes.length < MAX_FALLOS) return { bloqueado: false, reintentarEnSegundos: 0 };

    const ultimo = vigentes[vigentes.length - 1];
    const quintoDesdeElFinal = vigentes[vigentes.length - MAX_FALLOS];
    if (ultimo - quintoDesdeElFinal > VENTANA_MS) return { bloqueado: false, reintentarEnSegundos: 0 };

    const racha = Math.floor(vigentes.length / MAX_FALLOS);
    const esperaS = Math.min(ESPERA_INICIAL_S * 2 ** (racha - 1), ESPERA_MAXIMA_S);
    const restanteMs = ultimo + esperaS * SEGUNDO_MS - ahora.getTime();
    return restanteMs > 0
      ? { bloqueado: true, reintentarEnSegundos: Math.ceil(restanteMs / SEGUNDO_MS) }
      : { bloqueado: false, reintentarEnSegundos: 0 };
  },
};
