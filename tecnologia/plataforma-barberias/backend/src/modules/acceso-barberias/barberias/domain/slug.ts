const LARGO_BASE = 120;
const LARGO_MAXIMO = 140;

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

  conSufijo(sufijo: string): Slug {
    const limpio = sufijo.toLowerCase().replace(/[^a-z0-9]/g, '');
    const base = this.valor.slice(0, LARGO_MAXIMO - limpio.length - 1).replace(/-+$/g, '');
    return new Slug(`${base}-${limpio}`);
  }
}
