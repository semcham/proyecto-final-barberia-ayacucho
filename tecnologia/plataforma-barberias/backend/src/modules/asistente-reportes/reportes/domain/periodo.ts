import { ErrorDeAplicacion, FechaInvalida, FechaLocal } from '../../../../shared/nucleo';

// T021 de 005 · El período de los reportes (FR-020, data-model §4, research R10): dos fechas LOCALES de la barbería,
// `desde` y `hasta`, ambas incluidas, de a lo sumo 366 días. Regla de dominio pura: la conversión a instantes la hace
// quien llama con la zona horaria de la barbería (`rango`).

export const MAXIMO_DIAS_DEL_PERIODO = 366;

type Campo = 'desde' | 'hasta';
export type ProblemaDelPeriodo = 'obligatorio' | 'formato' | 'posterior_a_hasta' | 'maximo_366_dias';
type Problema = ProblemaDelPeriodo;

const NOMBRE: Record<Campo, string> = { desde: 'de inicio', hasta: 'de fin' };

const MENSAJE: Record<Problema, (campo: Campo) => string> = {
  obligatorio: (campo) => `Elige la fecha ${NOMBRE[campo]} del período.`,
  formato: (campo) => `La fecha ${NOMBRE[campo]} no es una fecha válida (AAAA-MM-DD).`,
  posterior_a_hasta: () => 'La fecha de inicio debe ser anterior o igual a la de fin.',
  maximo_366_dias: () => `El período puede tener como máximo ${MAXIMO_DIAS_DEL_PERIODO} días.`,
};

/** Un período que no se puede consultar: 422 VALIDACION con el campo a corregir (contracts/openapi.yaml de 005). */
export class PeriodoInvalido extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  /** El contrato de GET /reportes pide 422 (el código VALIDACION es 400 en el resto de las rutas). */
  readonly estadoHttp = 422;

  constructor(
    campo: Campo,
    readonly problema: Problema,
  ) {
    super(MENSAJE[problema](campo), [{ campo, problema }]);
  }
}

function leer(campo: Campo, valor: string | undefined): FechaLocal {
  if (valor === undefined || valor.trim() === '') throw new PeriodoInvalido(campo, 'obligatorio');
  try {
    return FechaLocal.de(valor.trim());
  } catch (error) {
    if (error instanceof FechaInvalida) throw new PeriodoInvalido(campo, 'formato');
    throw error;
  }
}

export class Periodo {
  private constructor(
    readonly desde: FechaLocal,
    readonly hasta: FechaLocal,
  ) {}

  /** Valida en orden: la fecha de inicio, la de fin, el orden y el largo. */
  static crear(desde: string | undefined, hasta: string | undefined): Periodo {
    const inicio = leer('desde', desde);
    const fin = leer('hasta', hasta);
    if (fin.diasDesde(inicio) < 0) throw new PeriodoInvalido('desde', 'posterior_a_hasta');
    const periodo = new Periodo(inicio, fin);
    if (periodo.dias > MAXIMO_DIAS_DEL_PERIODO) throw new PeriodoInvalido('hasta', 'maximo_366_dias');
    return periodo;
  }

  /** Días del período, contando los dos extremos. */
  get dias(): number {
    return this.hasta.diasDesde(this.desde) + 1;
  }

  /**
   * El período como rango semiabierto de instantes: [inicio del día `desde`, inicio del día siguiente a `hasta`), con
   * la función de la zona horaria de la barbería (ZonaHoraria.inicioDelDia). Las citas cuentan por su hora de inicio.
   */
  rango(inicioDelDia: (fecha: FechaLocal) => Date): { inicio: Date; fin: Date } {
    return { inicio: inicioDelDia(this.desde), fin: inicioDelDia(this.hasta.sumarDias(1)) };
  }
}
