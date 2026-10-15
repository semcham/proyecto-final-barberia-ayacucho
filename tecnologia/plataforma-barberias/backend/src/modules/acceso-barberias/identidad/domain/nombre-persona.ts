import { ValorInvalido } from './errores';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Nombre de una persona usuaria: 2–120 caracteres tras recortar espacios, sin caracteres de control. */
export class NombrePersona {
  private constructor(readonly valor: string) {}

  static crear(entrada: string, campo = 'nombre'): NombrePersona {
    const valor = entrada.trim();
    if (CONTROL.test(valor)) throw new ValorInvalido(campo, 'caracteres_no_permitidos');
    const longitud = [...valor].length;
    if (longitud < 2) throw new ValorInvalido(campo, 'muy_corto');
    if (longitud > 120) throw new ValorInvalido(campo, 'demasiado_largo');
    return new NombrePersona(valor);
  }
}
