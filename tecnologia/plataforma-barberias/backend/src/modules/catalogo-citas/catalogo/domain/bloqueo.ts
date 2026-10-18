import { DatoInvalido } from './errores';

const MAXIMO_MS = 30 * 24 * 60 * 60 * 1000;

export interface DatosBloqueo {
  id: string;
  barberoId: string;
  inicio: Date;
  fin: Date;
  motivo: string | null;
  creadoPor: string;
}

/**
 * T053 · Bloqueo de la agenda de un barbero (RF09; FR-015, FR-016): un rango [inicio, fin) en que no
 * atiende. Sin repetición (segunda línea de corte) y de hasta 30 días. El motivo es interno: nunca sale
 * por la vía pública.
 */
export class Bloqueo {
  private constructor(
    readonly id: string,
    readonly barberoId: string,
    readonly inicio: Date,
    readonly fin: Date,
    readonly motivo: string | null,
    readonly creadoPor: string,
  ) {}

  static crear(datos: DatosBloqueo): Bloqueo {
    const { inicio, fin } = datos;
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || inicio.getTime() >= fin.getTime()) {
      throw new DatoInvalido('fin', 'inicio_no_menor_que_fin');
    }
    if (fin.getTime() - inicio.getTime() > MAXIMO_MS) throw new DatoInvalido('fin', 'mas_de_30_dias');
    const motivo = datos.motivo?.trim() ?? '';
    if ([...motivo].length > 200) throw new DatoInvalido('motivo', 'longitud');
    return new Bloqueo(
      datos.id,
      datos.barberoId,
      new Date(inicio),
      new Date(fin),
      motivo || null,
      datos.creadoPor,
    );
  }

  /** Desde la base (datos ya válidos). */
  static reconstruir(datos: DatosBloqueo): Bloqueo {
    return new Bloqueo(datos.id, datos.barberoId, datos.inicio, datos.fin, datos.motivo, datos.creadoPor);
  }
}
