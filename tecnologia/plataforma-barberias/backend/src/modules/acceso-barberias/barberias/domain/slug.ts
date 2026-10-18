import { ValorInvalido } from '../../identidad/domain/errores';
import { EnlaceNoDisponible } from './errores';

const LARGO_BASE = 120;
const LARGO_MAXIMO = 140;
const FORMATO = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LARGO_EDICION_MINIMO = 3;
const LARGO_EDICION_MAXIMO = 60;
/**
 * Palabras que no pueden ser el enlace de una barbería (research R15 de 002): rutas de la aplicación y
 * nombres que podrían confundirse con la plataforma.
 */
const RESERVADAS: ReadonlySet<string> = new Set([
  'api',
  'app',
  'admin',
  'publico',
  'ingresar',
  'registro',
  'activar',
  'login',
  'salud',
  'soporte',
  'ayuda',
  'www',
  'static',
  'assets',
  'mis-citas',
  'barberias-ayacucho',
]);

/**
 * Identificador público de la barbería en URL (lo usará el catálogo público, RF10). Solo [a-z0-9-], sin
 * guiones al inicio, al final ni repetidos. Es único: si choca, se le agrega un sufijo.
 */
export class Slug {
  private constructor(readonly valor: string) {}

  static desdeNombre(nombre: string): Slug {
    const base = nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // quita tildes: "Barbería" → "Barberia", "Ñaño" → "Nano"
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, LARGO_BASE)
      .replace(/-+$/g, '');
    return new Slug(base || 'barberia');
  }

  /**
   * Enlace elegido por el propietario (FR-003 de 002, T049): 3–60 caracteres [a-z0-9-], sin guiones al
   * inicio, al final ni repetidos, y fuera de la lista de palabras reservadas.
   */
  static paraEdicion(valor: string): Slug {
    const largo = valor.length;
    if (largo < LARGO_EDICION_MINIMO || largo > LARGO_EDICION_MAXIMO) {
      throw new ValorInvalido('slug', 'longitud');
    }
    if (!FORMATO.test(valor)) throw new ValorInvalido('slug', 'formato');
    // Misma respuesta que un enlace ocupado: no hace falta explicar por qué no está disponible.
    if (RESERVADAS.has(valor)) throw new EnlaceNoDisponible();
    return new Slug(valor);
  }

  conSufijo(sufijo: string): Slug {
    const limpio = sufijo.toLowerCase().replace(/[^a-z0-9]/g, '');
    const base = this.valor.slice(0, LARGO_MAXIMO - limpio.length - 1).replace(/-+$/g, '');
    return new Slug(`${base}-${limpio}`);
  }
}
