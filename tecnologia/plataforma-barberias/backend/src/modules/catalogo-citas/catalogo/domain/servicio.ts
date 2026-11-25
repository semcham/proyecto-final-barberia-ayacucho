import { DatoInvalido } from './errores';

const PRECIO = /^[0-9]{1,5}(\.[0-9]{1,2})?$/;

export interface DatosServicio {
  nombre: string;
  descripcion?: string | null;
  /** Soles como texto decimal: "25", "25.5" o "25.50" (0 a 99 999,99). */
  precio: string;
  duracionMin: number;
}

/** Un problema de un campo: el mismo par que lleva `DatoInvalido` en sus detalles. */
export interface ProblemaDeCampo {
  campo: string;
  problema: string;
}

// Cada regla devuelve su problema o null. Son la ÚNICA fuente de las reglas de un servicio: las usan la creación y la
// edición (que fallan con el primer problema) y la carga en lote de 011 (que los muestra todos).

function problemaDeNombre(nombre: string): ProblemaDeCampo | null {
  const largo = [...nombre.trim()].length;
  return largo < 2 || largo > 80 ? { campo: 'nombre', problema: 'longitud' } : null;
}

function problemaDeDescripcion(descripcion: string | null | undefined): ProblemaDeCampo | null {
  return [...(descripcion?.trim() ?? '')].length > 300
    ? { campo: 'descripcion', problema: 'longitud' }
    : null;
}

function problemaDePrecio(precio: string): ProblemaDeCampo | null {
  return PRECIO.test(precio) ? null : { campo: 'precio', problema: 'formato' };
}

function problemaDeDuracion(duracion: number): ProblemaDeCampo | null {
  if (!Number.isInteger(duracion) || duracion < 5 || duracion > 480) {
    return { campo: 'duracionMinutos', problema: 'rango' };
  }
  return duracion % 5 !== 0 ? { campo: 'duracionMinutos', problema: 'multiplo_de_5' } : null;
}

/**
 * 011 (research R02): todos los problemas de unos datos de servicio, en el orden en que se comprueban al crear uno.
 * Lista vacía = datos válidos.
 */
export function problemasDeServicio(datos: DatosServicio): ProblemaDeCampo[] {
  return [
    problemaDeNombre(datos.nombre),
    problemaDeDescripcion(datos.descripcion),
    problemaDePrecio(datos.precio),
    problemaDeDuracion(datos.duracionMin),
  ].filter((p): p is ProblemaDeCampo => p !== null);
}

function exigir(problema: ProblemaDeCampo | null): void {
  if (problema) throw new DatoInvalido(problema.campo, problema.problema);
}

function nombreValido(nombre: string): string {
  exigir(problemaDeNombre(nombre));
  return nombre.trim();
}

function descripcionValida(descripcion: string | null | undefined): string | null {
  exigir(problemaDeDescripcion(descripcion));
  const limpia = descripcion?.trim() ?? '';
  return limpia === '' ? null : limpia;
}

/** Precio normalizado a dos decimales, como lo guarda `numeric(10,2)`: "25.5" → "25.50". */
function precioValido(precio: string): string {
  exigir(problemaDePrecio(precio));
  const [enteros, decimales = ''] = precio.split('.');
  return `${Number(enteros)}.${decimales.padEnd(2, '0')}`;
}

function duracionValida(duracion: number): number {
  exigir(problemaDeDuracion(duracion));
  return duracion;
}

/**
 * T053 · Servicio del catálogo (RF07; FR-006 a FR-008; R12). No se elimina: se desactiva. Las citas
 * guardan su propia copia de nombre, precio y duración, así que editarlo no las cambia.
 */
export class Servicio {
  private constructor(
    readonly id: string,
    private _nombre: string,
    private _descripcion: string | null,
    private _precio: string,
    private _duracionMin: number,
    private _activo: boolean,
  ) {}

  static crear(id: string, datos: DatosServicio): Servicio {
    return new Servicio(
      id,
      nombreValido(datos.nombre),
      descripcionValida(datos.descripcion),
      precioValido(datos.precio),
      duracionValida(datos.duracionMin),
      true,
    );
  }

  /** Desde la base (datos ya válidos). */
  static reconstruir(datos: DatosServicio & { id: string; activo: boolean }): Servicio {
    return new Servicio(
      datos.id,
      datos.nombre,
      datos.descripcion ?? null,
      datos.precio,
      datos.duracionMin,
      datos.activo,
    );
  }

  get nombre(): string {
    return this._nombre;
  }
  get descripcion(): string | null {
    return this._descripcion;
  }
  get precio(): string {
    return this._precio;
  }
  get duracionMin(): number {
    return this._duracionMin;
  }
  get activo(): boolean {
    return this._activo;
  }

  editar(cambios: Partial<DatosServicio>): void {
    if (cambios.nombre !== undefined) this._nombre = nombreValido(cambios.nombre);
    if (cambios.descripcion !== undefined) this._descripcion = descripcionValida(cambios.descripcion);
    if (cambios.precio !== undefined) this._precio = precioValido(cambios.precio);
    if (cambios.duracionMin !== undefined) this._duracionMin = duracionValida(cambios.duracionMin);
  }

  desactivar(): void {
    this._activo = false;
  }

  activar(): void {
    this._activo = true;
  }
}
