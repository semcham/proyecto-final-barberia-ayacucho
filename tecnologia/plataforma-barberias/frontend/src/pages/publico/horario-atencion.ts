import type { components } from '../../api/schema-002';
import { fechaIsoDeBarberia } from '../../hora-barberia';

type Tramo = components['schemas']['TramoHorario'];

/** Días de la semana como los guarda la API (0 = domingo); se muestran de lunes a domingo. */
const NOMBRE_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN = [1, 2, 3, 4, 5, 6, 0];

export interface DiaDeAtencion {
  dia: number;
  nombre: string;
  /** "09:00 – 13:00", uno por tramo; vacío si ese día no atiende. */
  tramos: string[];
  esHoy: boolean;
}

/**
 * El horario de atención del catálogo público (`horario.tramos`), de lunes a domingo, con los tramos de cada día en
 * orden y el día de hoy marcado en la zona de la barbería. Solo lo que entrega la API: sin tramos, ningún día.
 */
export function diasDeAtencion(tramos: readonly Tramo[], zona: string, ahora = new Date()): DiaDeAtencion[] {
  if (tramos.length === 0) return [];
  const hoy = new Date(`${fechaIsoDeBarberia(ahora, zona)}T12:00:00Z`).getUTCDay();
  return ORDEN.map((dia) => ({
    dia,
    nombre: NOMBRE_DIA[dia],
    tramos: tramos
      .filter((t) => t.diaSemana === dia)
      .sort((x, y) => x.inicio.localeCompare(y.inicio))
      .map((t) => `${t.inicio.slice(0, 5)} – ${t.fin.slice(0, 5)}`),
    esHoy: dia === hoy,
  }));
}
