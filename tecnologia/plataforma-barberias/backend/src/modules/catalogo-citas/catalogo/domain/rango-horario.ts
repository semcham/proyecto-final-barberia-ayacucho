import { ErrorDeAplicacion } from '../../../../shared/nucleo';

export class RangoInvalido extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  constructor() {
    super('El inicio debe ser anterior al fin.', [{ campo: 'rango', problema: 'inicio_no_menor_que_fin' }]);
  }
}

const MINUTO_MS = 60 * 1000;

/**
 * T025 · Rango de tiempo semiabierto [inicio, fin), como la columna `period` de las citas. Dos rangos
 * contiguos (10:00–10:30 y 10:30–11:00) no se solapan.
 */
export class RangoHorario {
  private constructor(
    readonly inicio: Date,
    readonly fin: Date,
  ) {}

  static crear(inicio: Date, fin: Date): RangoHorario {
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || inicio.getTime() >= fin.getTime()) {
      throw new RangoInvalido();
    }
    return new RangoHorario(new Date(inicio), new Date(fin));
  }

  static desde(inicio: Date, duracionMinutos: number): RangoHorario {
    return RangoHorario.crear(inicio, new Date(inicio.getTime() + duracionMinutos * MINUTO_MS));
  }

  seSolapaCon(otro: RangoHorario): boolean {
    return this.inicio.getTime() < otro.fin.getTime() && otro.inicio.getTime() < this.fin.getTime();
  }

  /** Verdadero si `otro` cabe entero dentro de este rango. */
  contieneEnteramente(otro: RangoHorario): boolean {
    return this.inicio.getTime() <= otro.inicio.getTime() && otro.fin.getTime() <= this.fin.getTime();
  }

  duracionMinutos(): number {
    return Math.round((this.fin.getTime() - this.inicio.getTime()) / MINUTO_MS);
  }
}
