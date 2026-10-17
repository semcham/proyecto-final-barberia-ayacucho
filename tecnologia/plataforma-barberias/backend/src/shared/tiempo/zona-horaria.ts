import { FechaLocal } from './fecha-local';

const MINUTO_MS = 60 * 1000;

/** Fecha y minutos del día en la hora local de una barbería. */
export interface MomentoLocal {
  fecha: FechaLocal;
  /** Minutos desde la medianoche local (0 … 1439). */
  minutos: number;
}

/**
 * Hora local de una barbería (research R07 de 002). Convierte entre instantes (UTC, como se guardan en
 * `timestamptz`) y la fecha y hora locales, con `Intl.DateTimeFormat` y la base de datos de zonas del
 * entorno, sin dependencias. Hoy todas las barberías usan `America/Lima` (UTC−5, sin horario de verano),
 * pero ninguna regla da por fijo el desplazamiento.
 */
export class ZonaHoraria {
  static readonly LIMA = new ZonaHoraria('America/Lima');

  private readonly formato: Intl.DateTimeFormat;

  constructor(readonly nombre: string) {
    // Lanza RangeError si la zona no existe.
    this.formato = new Intl.DateTimeFormat('en-US', {
      timeZone: nombre,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  /** Fecha y minutos locales de un instante. */
  aLocal(instante: Date): MomentoLocal {
    const p = this.partes(instante);
    return { fecha: FechaLocal.desdeComponentes(p.anio, p.mes, p.dia), minutos: p.hora * 60 + p.minuto };
  }

  /** Fecha local de un instante (por ejemplo, "hoy" en la barbería a partir del reloj del servidor). */
  fechaDe(instante: Date): FechaLocal {
    return this.aLocal(instante).fecha;
  }

  /** Instante que corresponde a la fecha local y a los minutos del día indicados (pueden llegar a 1440). */
  aInstante(fecha: FechaLocal, minutos: number): Date {
    const comoUtc = Date.UTC(fecha.anio, fecha.mes - 1, fecha.dia) + minutos * MINUTO_MS;
    // Primera aproximación con el desplazamiento de ese momento; la segunda corrige si hubo un cambio de
    // horario entre medio (no ocurre en America/Lima, pero mantiene la conversión correcta en general).
    let instante = comoUtc - this.desplazamientoMs(new Date(comoUtc));
    instante = comoUtc - this.desplazamientoMs(new Date(instante));
    return new Date(instante);
  }

  /** Medianoche local con que empieza la fecha. */
  inicioDelDia(fecha: FechaLocal): Date {
    return this.aInstante(fecha, 0);
  }

  /** Medianoche local siguiente: el día local es el rango semiabierto [inicioDelDia, finDelDia). */
  finDelDia(fecha: FechaLocal): Date {
    return this.aInstante(fecha.sumarDias(1), 0);
  }

  /** Día de la semana de la fecha local: 0 = domingo … 6 = sábado. */
  diaSemana(fecha: FechaLocal): number {
    return fecha.diaSemana;
  }

  /** ISO 8601 con el desplazamiento local, para la API: `2026-10-20T10:00:00-05:00`. */
  formatoIso(instante: Date): string {
    const p = this.partes(instante);
    const desplazamiento = Math.round(this.desplazamientoMs(instante) / MINUTO_MS);
    const signo = desplazamiento < 0 ? '-' : '+';
    const absoluto = Math.abs(desplazamiento);
    const dos = (n: number) => String(n).padStart(2, '0');
    return (
      `${String(p.anio).padStart(4, '0')}-${dos(p.mes)}-${dos(p.dia)}T${dos(p.hora)}:${dos(p.minuto)}:${dos(p.segundo)}` +
      `${signo}${dos(Math.floor(absoluto / 60))}:${dos(absoluto % 60)}`
    );
  }

  /** Diferencia entre la hora local y UTC en un instante, en milisegundos (Lima: −5 h). */
  private desplazamientoMs(instante: Date): number {
    const p = this.partes(instante);
    const localComoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
    const sinMilisegundos = instante.getTime() - instante.getUTCMilliseconds();
    return localComoUtc - sinMilisegundos;
  }

  private partes(instante: Date) {
    const valores: Record<string, number> = {};
    for (const parte of this.formato.formatToParts(instante)) {
      if (parte.type !== 'literal') valores[parte.type] = Number(parte.value);
    }
    return {
      anio: valores.year,
      mes: valores.month,
      dia: valores.day,
      hora: valores.hour % 24,
      minuto: valores.minute,
      segundo: valores.second,
    };
  }
}
