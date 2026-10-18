import { DatoInvalido } from './errores';

export interface DatosBarbero {
  nombre: string;
  usuarioId: string | null;
  servicioIds: readonly string[];
}

function nombreValido(nombre: string): string {
  const limpio = nombre.trim();
  const largo = [...limpio].length;
  if (largo < 2 || largo > 80) throw new DatoInvalido('nombre', 'longitud');
  return limpio;
}

/**
 * T053 · Barbero del catálogo (RF08; FR-009 a FR-011). Su nombre visible es público; el vínculo con un
 * usuario del personal es opcional y solo sirve para que ese usuario gestione su disponibilidad y su
 * agenda. No se elimina: se desactiva y conserva su historial.
 */
export class Barbero {
  private readonly servicios: Set<string>;

  private constructor(
    readonly id: string,
    private _nombre: string,
    private _usuarioId: string | null,
    private _activo: boolean,
    servicioIds: readonly string[],
  ) {
    this.servicios = new Set(servicioIds);
  }

  static crear(id: string, datos: DatosBarbero): Barbero {
    return new Barbero(id, nombreValido(datos.nombre), datos.usuarioId, true, datos.servicioIds);
  }

  /** Desde la base (datos ya válidos). */
  static reconstruir(datos: DatosBarbero & { id: string; activo: boolean }): Barbero {
    return new Barbero(datos.id, datos.nombre, datos.usuarioId, datos.activo, datos.servicioIds);
  }

  get nombre(): string {
    return this._nombre;
  }
  get usuarioId(): string | null {
    return this._usuarioId;
  }
  get activo(): boolean {
    return this._activo;
  }
  /** Servicios asignados, en el orden en que se asignaron. */
  get servicioIds(): string[] {
    return [...this.servicios];
  }

  renombrar(nombre: string): void {
    this._nombre = nombreValido(nombre);
  }

  vincular(usuarioId: string | null): void {
    this._usuarioId = usuarioId;
  }

  asignar(servicioId: string): void {
    this.servicios.add(servicioId);
  }

  quitar(servicioId: string): void {
    this.servicios.delete(servicioId);
  }

  reemplazarServicios(servicioIds: readonly string[]): void {
    this.servicios.clear();
    for (const id of servicioIds) this.servicios.add(id);
  }

  ofrece(servicioId: string): boolean {
    return this.servicios.has(servicioId);
  }

  desactivar(): void {
    this._activo = false;
  }

  reactivar(): void {
    this._activo = true;
  }
}
