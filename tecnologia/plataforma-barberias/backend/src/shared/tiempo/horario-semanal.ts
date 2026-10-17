import { ErrorDeAplicacion } from '../errores';

/** Un tramo semanal: día de la semana (0 = domingo … 6 = sábado) y minutos locales [inicio, fin). */
export interface Tramo {
  diaSemana: number;
  inicioMin: number;
  finMin: number;
}

/** Tramos inválidos: fuera de rango, con inicio ≥ fin o solapados en el mismo día. */
export class HorarioInvalido extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  constructor(problema: 'dia' | 'rango' | 'inicio_no_menor_que_fin' | 'solape', diaSemana?: number) {
    super('Revisa los tramos del horario.', [{ campo: 'tramos', problema, diaSemana }]);
  }
}

const MINUTOS_DIA = 24 * 60;

/**
 * Horario semanal en tramos locales (horario de atención de la barbería y disponibilidad de cada
 * barbero; FR-002, FR-013 de 002). Objeto de valor puro y genérico: no conoce barberías ni barberos.
 * Los tramos de un día son semiabiertos [inicio, fin): dos tramos contiguos (09:00–13:00 y 13:00–19:00)
 * no se solapan.
 */
export class HorarioSemanal {
  private constructor(private readonly tramos: readonly Tramo[]) {}

  static vacio(): HorarioSemanal {
    return new HorarioSemanal([]);
  }

  static crear(tramos: readonly Tramo[]): HorarioSemanal {
    for (const t of tramos) {
      if (!Number.isInteger(t.diaSemana) || t.diaSemana < 0 || t.diaSemana > 6) {
        throw new HorarioInvalido('dia', t.diaSemana);
      }
      if (
        !Number.isInteger(t.inicioMin) ||
        !Number.isInteger(t.finMin) ||
        t.inicioMin < 0 ||
        t.finMin > MINUTOS_DIA
      ) {
        throw new HorarioInvalido('rango', t.diaSemana);
      }
      if (t.inicioMin >= t.finMin) throw new HorarioInvalido('inicio_no_menor_que_fin', t.diaSemana);
    }
    const ordenados = [...tramos].sort((a, b) => a.diaSemana - b.diaSemana || a.inicioMin - b.inicioMin);
    for (let i = 1; i < ordenados.length; i++) {
      const anterior = ordenados[i - 1];
      const actual = ordenados[i];
      if (anterior.diaSemana === actual.diaSemana && actual.inicioMin < anterior.finMin) {
        throw new HorarioInvalido('solape', actual.diaSemana);
      }
    }
    return new HorarioSemanal(ordenados.map((t) => ({ ...t })));
  }

  /** Convierte 'HH:MM' o 'HH:MM:SS' (como devuelve PostgreSQL el tipo time) en minutos del día. */
  static minutosDe(hora: string): number {
    const partes = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hora);
    if (!partes) throw new HorarioInvalido('rango');
    const minutos = Number(partes[1]) * 60 + Number(partes[2]);
    if (Number(partes[1]) > 24 || Number(partes[2]) > 59 || minutos > MINUTOS_DIA) {
      throw new HorarioInvalido('rango');
    }
    return minutos;
  }

  /** Minutos del día en formato 'HH:MM'. */
  static horaDe(minutos: number): string {
    return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
  }

  todos(): readonly Tramo[] {
    return this.tramos;
  }

  tramosDe(diaSemana: number): readonly Tramo[] {
    return this.tramos.filter((t) => t.diaSemana === diaSemana);
  }

  estaVacio(): boolean {
    return this.tramos.length === 0;
  }

  /** Verdadero si cada tramo de `otro` cae entero dentro de algún tramo de este horario (FR-013). */
  contiene(otro: HorarioSemanal): boolean {
    return otro.tramos.every((t) =>
      this.tramosDe(t.diaSemana).some(
        (propio) => propio.inicioMin <= t.inicioMin && t.finMin <= propio.finMin,
      ),
    );
  }

  /** Intersección con otro horario en un día: los minutos en que ambos están abiertos. */
  interseccion(otro: HorarioSemanal, diaSemana: number): Tramo[] {
    const resultado: Tramo[] = [];
    for (const a of this.tramosDe(diaSemana)) {
      for (const b of otro.tramosDe(diaSemana)) {
        const inicioMin = Math.max(a.inicioMin, b.inicioMin);
        const finMin = Math.min(a.finMin, b.finMin);
        if (inicioMin < finMin) resultado.push({ diaSemana, inicioMin, finMin });
      }
    }
    return resultado.sort((x, y) => x.inicioMin - y.inicioMin);
  }
}
