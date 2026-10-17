import { ErrorDeAplicacion } from '../errores';

/** Fecha mal formada o inexistente (por ejemplo, 2026-02-30). */
export class FechaInvalida extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  constructor(valor: string) {
    super('Revisa la fecha enviada.', [{ campo: 'fecha', problema: 'formato', valor }]);
  }
}

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Fecha del calendario local de una barbería (`YYYY-MM-DD`), sin hora ni zona (research R07 de 002).
 * Objeto de valor puro: lo puede usar el dominio. La conversión a instantes la hace `ZonaHoraria`.
 */
export class FechaLocal {
  private constructor(
    readonly anio: number,
    readonly mes: number,
    readonly dia: number,
  ) {}

  static de(valor: string): FechaLocal {
    const partes = FORMATO.exec(valor);
    if (!partes) throw new FechaInvalida(valor);
    const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
    const utc = new Date(Date.UTC(anio, mes - 1, dia));
    if (utc.getUTCFullYear() !== anio || utc.getUTCMonth() !== mes - 1 || utc.getUTCDate() !== dia) {
      throw new FechaInvalida(valor);
    }
    return new FechaLocal(anio, mes, dia);
  }

  /** Construye la fecha a partir de componentes ya validados (uso interno de `ZonaHoraria`). */
  static desdeComponentes(anio: number, mes: number, dia: number): FechaLocal {
    return FechaLocal.de(
      `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
    );
  }

  /** Día de la semana: 0 = domingo … 6 = sábado (como `weekday` en la base). */
  get diaSemana(): number {
    return new Date(Date.UTC(this.anio, this.mes - 1, this.dia)).getUTCDay();
  }

  sumarDias(dias: number): FechaLocal {
    const utc = new Date(Date.UTC(this.anio, this.mes - 1, this.dia) + dias * DIA_MS);
    return new FechaLocal(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
  }

  /** Días desde `otra` hasta esta fecha (negativo si esta es anterior). */
  diasDesde(otra: FechaLocal): number {
    return Math.round(
      (Date.UTC(this.anio, this.mes - 1, this.dia) - Date.UTC(otra.anio, otra.mes - 1, otra.dia)) / DIA_MS,
    );
  }

  equals(otra: FechaLocal): boolean {
    return this.anio === otra.anio && this.mes === otra.mes && this.dia === otra.dia;
  }

  toString(): string {
    return `${String(this.anio).padStart(4, '0')}-${String(this.mes).padStart(2, '0')}-${String(this.dia).padStart(2, '0')}`;
  }
}
