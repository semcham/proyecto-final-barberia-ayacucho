import { DatoInvalido } from './errores';

const PRECIO = /^[0-9]{1,5}(\.[0-9]{1,2})?$/;

export interface DatosServicio {
  nombre: string;
  descripcion?: string | null;
  /** Soles como texto decimal: "25", "25.5" o "25.50" (0 a 99 999,99). */
  precio: string;
  duracionMin: number;
}

function nombreValido(nombre: string): string {
  const limpio = nombre.trim();
  const largo = [...limpio].length;
  if (largo < 2 || largo > 80) throw new DatoInvalido('nombre', 'longitud');
  return limpio;
}

function descripcionValida(descripcion: string | null | undefined): string | null {
  const limpia = descripcion?.trim() ?? '';
  if ([...limpia].length > 300) throw new DatoInvalido('descripcion', 'longitud');
  return limpia === '' ? null : limpia;
}

/** Precio normalizado a dos decimales, como lo guarda `numeric(10,2)`: "25.5" → "25.50". */
function precioValido(precio: string): string {
  if (!PRECIO.test(precio)) throw new DatoInvalido('precio', 'formato');
  const [enteros, decimales = ''] = precio.split('.');
  return `${Number(enteros)}.${decimales.padEnd(2, '0')}`;
}

function duracionValida(duracion: number): number {
  if (!Number.isInteger(duracion) || duracion < 5 || duracion > 480) {
    throw new DatoInvalido('duracionMinutos', 'rango');
  }
  if (duracion % 5 !== 0) throw new DatoInvalido('duracionMinutos', 'multiplo_de_5');
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
