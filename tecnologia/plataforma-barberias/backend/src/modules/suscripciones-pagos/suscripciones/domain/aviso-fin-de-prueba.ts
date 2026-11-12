import type { EstadoSuscripcion } from './suscripcion';

// "Prueba por terminar" (FR-002 de 003; FR-037 de 004, research R14). Regla pura y ÚNICA: la usan el panel del
// propietario (consultas.ts) y la tarea avisar-fin-de-prueba, así el correo sale con el mismo criterio con el que el
// panel muestra el aviso.

const DIA_MS = 24 * 60 * 60 * 1000;

/** Días antes del fin de la prueba en que se avisa que está por terminar. */
export const AVISO_FIN_DE_PRUEBA_DIAS = 3;

/** Días que faltan hasta `hasta`, redondeados hacia arriba; nunca negativos (0 sin fecha). */
export function diasRestantes(hasta: Date | null, ahora: Date): number {
  if (!hasta) return 0;
  return Math.max(0, Math.ceil((hasta.getTime() - ahora.getTime()) / DIA_MS));
}

/** En prueba, sin un período siguiente pagado y con 3 días o menos. */
export function pruebaPorTerminar(situacion: {
  estado: EstadoSuscripcion;
  diasRestantes: number;
  hayPeriodoSiguiente: boolean;
}): boolean {
  return (
    situacion.estado === 'TRIAL' &&
    !situacion.hayPeriodoSiguiente &&
    situacion.diasRestantes <= AVISO_FIN_DE_PRUEBA_DIAS
  );
}
