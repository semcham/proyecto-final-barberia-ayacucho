/**
 * T068 · Cálculo de horarios libres (research R08). Función pura: no conoce zonas horarias, base de datos ni
 * reloj. Todo llega en minutos locales del día consultado (0 … 1440); la conversión desde instantes la hace
 * `ConsultarHorarios` con `ZonaHoraria`. La usan la vía pública y la autenticada, así que las dos ofrecen
 * exactamente las mismas horas.
 */

const MINUTOS_DIA = 24 * 60;
/** Solo estas citas ocupan el horario (las mismas que considera la restricción de exclusión). */
const ESTADOS_QUE_OCUPAN: readonly string[] = ['PENDIENTE', 'CONFIRMADA'];

/** Intervalo semiabierto [inicioMin, finMin) en minutos locales del día. */
export interface IntervaloMin {
  inicioMin: number;
  finMin: number;
}

/** Un bloqueo (sin `estadoCita`) o una cita (con su estado) del barbero en el día. */
export interface OcupacionMin extends IntervaloMin {
  estadoCita?: string;
}

export interface BarberoParaCalculo {
  barberoId: string;
  activo: boolean;
  /** Tiene asignado el servicio consultado. */
  ofreceServicio: boolean;
  /** Disponibilidad semanal del barbero para el día de la semana consultado. */
  disponibilidad: readonly IntervaloMin[];
  /** Bloqueos y citas que tocan el día; pueden empezar antes o terminar después (se recortan). */
  ocupado: readonly OcupacionMin[];
}

export interface EntradaCalculoHorarios {
  /** Horario de atención de la barbería para el día de la semana consultado (vacío: cerrado). */
  atencion: readonly IntervaloMin[];
  /** Candidatos en el orden en que se listan (por nombre). */
  barberos: readonly BarberoParaCalculo[];
  duracionMin: number;
  pasoMin: number;
  /** Días desde hoy (fecha local de la barbería) hasta la fecha consultada. */
  diasDesdeHoy: number;
  /** Minutos locales de "ahora"; solo cuentan si la fecha consultada es hoy. */
  ahoraMin: number;
  horizonteDias: number;
  /** Barbero pedido; sin él, "cualquier barbero". */
  barberoId?: string;
}

export interface HoraLibre {
  inicioMin: number;
  /** Barberos libres para empezar a esa hora, en el orden de `barberos`. */
  barberoIds: string[];
}

export function calcularHorariosLibres(entrada: EntradaCalculoHorarios): HoraLibre[] {
  const { diasDesdeHoy, horizonteDias, duracionMin, pasoMin } = entrada;
  if (diasDesdeHoy < 0 || diasDesdeHoy > horizonteDias || duracionMin <= 0 || pasoMin <= 0) return [];
  // Hoy solo cuentan los inicios posteriores a "ahora" (un inicio igual a ahora ya pasó).
  const primerInicio = diasDesdeHoy === 0 ? entrada.ahoraMin + 1 : 0;

  const libresPorBarbero = entrada.barberos
    .filter((b) => b.activo && b.ofreceServicio && (!entrada.barberoId || b.barberoId === entrada.barberoId))
    .map((b) => ({
      barberoId: b.barberoId,
      ventanas: restar(
        interseccion(entrada.atencion, b.disponibilidad),
        b.ocupado.filter((o) => o.estadoCita === undefined || ESTADOS_QUE_OCUPAN.includes(o.estadoCita)),
      ),
    }));

  const resultado: HoraLibre[] = [];
  for (let inicio = 0; inicio + duracionMin <= MINUTOS_DIA; inicio += pasoMin) {
    if (inicio < primerInicio) continue;
    const fin = inicio + duracionMin;
    const barberoIds = libresPorBarbero
      .filter(({ ventanas }) => ventanas.some((v) => v.inicioMin <= inicio && fin <= v.finMin))
      .map(({ barberoId }) => barberoId);
    if (barberoIds.length > 0) resultado.push({ inicioMin: inicio, barberoIds });
  }
  return resultado;
}

/** Minutos en que están abiertos los dos conjuntos de tramos, ordenados. */
function interseccion(a: readonly IntervaloMin[], b: readonly IntervaloMin[]): IntervaloMin[] {
  const resultado: IntervaloMin[] = [];
  for (const x of a) {
    for (const y of b) {
      const inicioMin = Math.max(x.inicioMin, y.inicioMin);
      const finMin = Math.min(x.finMin, y.finMin);
      if (inicioMin < finMin) resultado.push({ inicioMin, finMin });
    }
  }
  return resultado.sort((p, q) => p.inicioMin - q.inicioMin);
}

/** Ventanas menos ocupaciones (recortadas al día). */
function restar(ventanas: readonly IntervaloMin[], ocupado: readonly IntervaloMin[]): IntervaloMin[] {
  const huecos = ocupado
    .map((o) => ({ inicioMin: Math.max(0, o.inicioMin), finMin: Math.min(MINUTOS_DIA, o.finMin) }))
    .filter((o) => o.inicioMin < o.finMin)
    .sort((p, q) => p.inicioMin - q.inicioMin);
  const resultado: IntervaloMin[] = [];
  for (const ventana of ventanas) {
    let desde = ventana.inicioMin;
    for (const hueco of huecos) {
      if (hueco.finMin <= desde || hueco.inicioMin >= ventana.finMin) continue;
      if (hueco.inicioMin > desde) resultado.push({ inicioMin: desde, finMin: hueco.inicioMin });
      desde = Math.max(desde, hueco.finMin);
      if (desde >= ventana.finMin) break;
    }
    if (desde < ventana.finMin) resultado.push({ inicioMin: desde, finMin: ventana.finMin });
  }
  return resultado;
}
