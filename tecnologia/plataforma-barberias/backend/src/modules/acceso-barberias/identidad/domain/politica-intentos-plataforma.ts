import type { EvaluacionIntentos } from './politica-intentos';

const SEGUNDO_MS = 1000;
export const MAX_FALLOS_PLATAFORMA = 5;
export const VENTANA_PLATAFORMA_MS = 15 * 60 * SEGUNDO_MS;

/**
 * Bloqueo del ingreso del administrador (R07): 5 fallos en 15 minutos, contando los de la contraseña y los
 * del segundo factor, bloquean ese correo desde esa IP hasta que el más antiguo de esos 5 sale de la ventana.
 * Más estricto que el de las barberías (R10): esta cuenta puede activar planes sin cobro.
 */
export const PoliticaIntentosPlataforma = {
  evaluar(fallos: readonly Date[], ahora: Date): EvaluacionIntentos {
    const vigentes = fallos
      .map((fallo) => fallo.getTime())
      .filter((instante) => instante <= ahora.getTime() && ahora.getTime() - instante < VENTANA_PLATAFORMA_MS)
      .sort((a, b) => a - b);
    if (vigentes.length < MAX_FALLOS_PLATAFORMA) return { bloqueado: false, reintentarEnSegundos: 0 };
    const liberaEn = vigentes[vigentes.length - MAX_FALLOS_PLATAFORMA] + VENTANA_PLATAFORMA_MS;
    return {
      bloqueado: true,
      reintentarEnSegundos: Math.max(1, Math.ceil((liberaEn - ahora.getTime()) / SEGUNDO_MS)),
    };
  },
};
