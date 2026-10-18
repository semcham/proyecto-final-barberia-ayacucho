/** Intervalo semiabierto [inicioMin, finMin) en minutos locales del día. */
export interface IntervaloDelDia {
  inicioMin: number;
  finMin: number;
}

export type MotivoConflicto = 'EN_BLOQUEO' | 'FUERA_DEL_HORARIO_DE_ATENCION' | 'FUERA_DE_DISPONIBILIDAD';

const contiene = (tramos: readonly IntervaloDelDia[], cita: IntervaloDelDia) =>
  tramos.some((t) => t.inicioMin <= cita.inicioMin && cita.finMin <= t.finMin);

/**
 * T104 · Marca "en conflicto" de una cita activa (FR-005, FR-016; R10). No se guarda: se calcula al leer la
 * agenda con los bloqueos y los tramos vigentes, así que deja de aparecer al borrar el bloqueo o al volver a
 * ampliar el horario. Función pura en minutos locales del día de la cita.
 */
export const MarcaConflicto = {
  de(entrada: {
    cita: IntervaloDelDia;
    bloqueos: readonly IntervaloDelDia[];
    atencion: readonly IntervaloDelDia[];
    disponibilidad: readonly IntervaloDelDia[];
  }): MotivoConflicto | null {
    const { cita } = entrada;
    if (entrada.bloqueos.some((b) => b.inicioMin < cita.finMin && cita.inicioMin < b.finMin))
      return 'EN_BLOQUEO';
    if (!contiene(entrada.atencion, cita)) return 'FUERA_DEL_HORARIO_DE_ATENCION';
    if (!contiene(entrada.disponibilidad, cita)) return 'FUERA_DE_DISPONIBILIDAD';
    return null;
  },
};
