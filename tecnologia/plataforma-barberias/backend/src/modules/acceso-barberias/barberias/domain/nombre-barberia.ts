import { ValorInvalido } from '../../identidad/domain/errores';

// Caracteres de control (incluye saltos de línea y NUL): no tienen sentido en un nombre comercial.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Nombre comercial de la barbería: 2–120 caracteres tras recortar espacios. Se permiten duplicados. */
export class NombreBarberia {
  private constructor(readonly valor: string) {}

  static crear(entrada: string): NombreBarberia {
    const valor = entrada.trim();
    if (CONTROL.test(valor)) throw new ValorInvalido('nombreBarberia', 'caracteres_no_permitidos');
    const longitud = [...valor].length;
    if (longitud < 2) throw new ValorInvalido('nombreBarberia', 'muy_corto');
    if (longitud > 120) throw new ValorInvalido('nombreBarberia', 'demasiado_largo');
    return new NombreBarberia(valor);
  }
}
