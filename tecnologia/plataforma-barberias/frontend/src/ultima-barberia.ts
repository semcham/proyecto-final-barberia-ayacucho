// La última barbería cuya página pública se abrió en este navegador, para ofrecer "Ingresar" en ella cuando el
// cliente llega sin sesión a una pantalla suya (por ejemplo, /mis-citas). Solo guarda datos públicos (el enlace y
// el nombre que muestra la propia página), nunca datos de la persona ni de su sesión. El almacenamiento puede no
// estar disponible (ventana privada, datos bloqueados): todo va con try/catch y sin él la interfaz funciona igual.

const CLAVE = 'barberias.ultimaBarberia';
// Mismo formato que el enlace de la barbería (tenant.slug); otro valor se ignora.
const FORMATO_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LARGO_MAXIMO_SLUG = 140;
const LARGO_MAXIMO_NOMBRE = 200;

export interface UltimaBarberia {
  slug: string;
  nombre: string;
}

function valida(valor: unknown): valor is UltimaBarberia {
  if (typeof valor !== 'object' || valor === null) return false;
  const { slug, nombre } = valor as Record<string, unknown>;
  return (
    typeof slug === 'string' &&
    slug.length <= LARGO_MAXIMO_SLUG &&
    FORMATO_SLUG.test(slug) &&
    typeof nombre === 'string' &&
    nombre.trim().length > 0 &&
    nombre.length <= LARGO_MAXIMO_NOMBRE
  );
}

export const ultimaBarberia = {
  leer(): UltimaBarberia | null {
    try {
      const guardado = localStorage.getItem(CLAVE);
      if (!guardado) return null;
      const valor: unknown = JSON.parse(guardado);
      return valida(valor) ? { slug: valor.slug, nombre: valor.nombre } : null;
    } catch {
      return null;
    }
  },
  guardar(barberia: UltimaBarberia): void {
    if (!valida(barberia)) return;
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ slug: barberia.slug, nombre: barberia.nombre }));
    } catch {
      // Sin almacenamiento disponible no se recuerda nada; la página funciona igual.
    }
  },
  olvidar(): void {
    try {
      localStorage.removeItem(CLAVE);
    } catch {
      // Igual que arriba.
    }
  },
};
