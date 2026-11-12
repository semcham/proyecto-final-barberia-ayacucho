import { SinTiempoParaAdelanto } from './errores';

// T008 de 008 · Monto y plazos del adelanto (research R04; FR-006, FR-007, FR-018; aclaración Q1). Reglas puras,
// en céntimos enteros (convención de 003). Se calculan una vez, al reservar, y se guardan con el adelanto: los
// cambios de la configuración no tocan las citas ya hechas (FR-004).

const MINUTO_MS = 60_000;
/** La hora límite deja al menos este margen antes del inicio. */
const MARGEN_ANTES_DEL_INICIO_MS = 30 * MINUTO_MS;
/** El límite máximo adicional no pasa de inicio − 2 h ... */
const REVISION_ANTES_DEL_INICIO_MS = 120 * MINUTO_MS;
/** ... ni de la hora límite + 24 h. */
const REVISION_DESPUES_DE_LA_HORA_LIMITE_MS = 24 * 60 * MINUTO_MS;

export type TipoAdelanto = 'FIJO' | 'PORCENTAJE';

/** Cómo se calcula el monto: fijo (100 a 50 000 céntimos) o porcentaje (1 a 100) del precio del servicio. */
export type ReglaDeMonto =
  | { readonly tipo: 'FIJO'; readonly montoCentimos: number }
  | { readonly tipo: 'PORCENTAJE'; readonly porcentaje: number };

/** La regla del monto y el plazo para pagar (10 a 1440 minutos), tal como está configurada al reservar. */
export type ReglaDeAdelanto = ReglaDeMonto & { readonly plazoMinutos: number };

/** Lo que se guarda con el adelanto al reservar. */
export interface AdelantoCalculado {
  montoCentimos: number;
  horaLimite: Date;
  limiteRevision: Date;
}

export const PoliticaAdelanto = {
  /**
   * Monto del adelanto en céntimos: el fijo, o el porcentaje del precio redondeado al céntimo (mitad hacia
   * arriba). Nunca mayor que el precio. Precio cero, o un porcentaje que redondea a cero → null (sin adelanto).
   */
  monto(regla: ReglaDeMonto, precioCentimos: number): number | null {
    if (precioCentimos <= 0) return null;
    const bruto =
      regla.tipo === 'FIJO'
        ? regla.montoCentimos
        : Math.floor((precioCentimos * regla.porcentaje + 50) / 100);
    const monto = Math.min(bruto, precioCentimos);
    return monto > 0 ? monto : null;
  },

  /**
   * Hora límite de pago: min(reserva + plazo, inicio − 30 min). Si no queda después de la reserva, no hay tiempo
   * para pagar: SIN_TIEMPO_PARA_ADELANTO.
   */
  horaLimite(reservadaEn: Date, inicio: Date, plazoMinutos: number): Date {
    const limite = Math.min(
      reservadaEn.getTime() + plazoMinutos * MINUTO_MS,
      inicio.getTime() - MARGEN_ANTES_DEL_INICIO_MS,
    );
    if (limite <= reservadaEn.getTime()) throw new SinTiempoParaAdelanto();
    return new Date(limite);
  },

  /**
   * Límite máximo adicional para revisar un pago registrado: min(inicio − 2 h, hora límite + 24 h); si eso queda
   * antes de la hora límite, el inicio (aclaración Q1). Nunca antes de la hora límite ni después del inicio.
   */
  limiteRevision(horaLimite: Date, inicio: Date): Date {
    const limite = Math.min(
      inicio.getTime() - REVISION_ANTES_DEL_INICIO_MS,
      horaLimite.getTime() + REVISION_DESPUES_DE_LA_HORA_LIMITE_MS,
    );
    return new Date(limite < horaLimite.getTime() ? inicio.getTime() : limite);
  },

  /** Todo junto, al reservar. null si el servicio no lleva adelanto (precio cero). */
  calcular(
    regla: ReglaDeAdelanto,
    cita: { precioCentimos: number; reservadaEn: Date; inicio: Date },
  ): AdelantoCalculado | null {
    const montoCentimos = PoliticaAdelanto.monto(regla, cita.precioCentimos);
    if (montoCentimos === null) return null;
    const horaLimite = PoliticaAdelanto.horaLimite(cita.reservadaEn, cita.inicio, regla.plazoMinutos);
    return {
      montoCentimos,
      horaLimite,
      limiteRevision: PoliticaAdelanto.limiteRevision(horaLimite, cita.inicio),
    };
  },
};
