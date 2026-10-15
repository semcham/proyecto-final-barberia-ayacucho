import type { Correo } from './correo';
import { ValorInvalido } from './errores';

const MINIMO = 10;
const MAXIMO = 128;

// Lista corta de contraseñas comunes de 10 o más caracteres (R16). Se compara sin distinguir mayúsculas.
const COMUNES = new Set([
  '1234567890',
  '0123456789',
  '12345678910',
  '1q2w3e4r5t',
  'qwertyuiop',
  'asdfghjkl1',
  'password12',
  'password123',
  'contrasena1',
  'contraseña1',
  'contrasena123',
  'contraseña123',
  'barberia123',
  'barbería123',
  'ayacucho123',
  'iloveyou12',
  'aaaaaaaaaa',
  '1111111111',
  'abc1234567',
  'qwerty1234',
]);

/**
 * Contraseña en texto plano, válida según la política del proyecto (guía NIST SP 800-63B): longitud antes
 * que composición. Solo vive en memoria el tiempo justo para calcular su hash; nunca se guarda ni se registra.
 */
export class Contrasena {
  private constructor(readonly valor: string) {}

  static crear(texto: string, correo?: Correo): Contrasena {
    const longitud = [...texto].length;
    if (longitud < MINIMO) throw new ValorInvalido('contrasena', 'muy_corta');
    if (longitud > MAXIMO) throw new ValorInvalido('contrasena', 'demasiado_larga');
    const minusculas = texto.toLowerCase();
    if (COMUNES.has(minusculas)) throw new ValorInvalido('contrasena', 'muy_comun');
    if (
      correo &&
      (minusculas.includes(correo.valor) ||
        (correo.parteLocal.length >= 4 && minusculas.includes(correo.parteLocal)))
    ) {
      throw new ValorInvalido('contrasena', 'contiene_correo');
    }
    return new Contrasena(texto);
  }

  toString(): string {
    return '[contraseña oculta]';
  }

  toJSON(): string {
    return '[contraseña oculta]';
  }
}
