import type { EstadoBarberia } from '../../../domain/barberia';

/** Una barbería tal como la ve el administrador: solo su identidad y su estado (FR-038). */
export interface BarberiaDeLaPlataforma {
  id: string;
  nombre: string;
  slug: string;
  estado: EstadoBarberia;
}

/**
 * Barberías de todas las cuentas, con el rol de solo lectura de la plataforma (ADR-031), que solo ve
 * `tenant (id, name, slug, status)`: ni direcciones ni teléfonos, ni citas, clientes, catálogo o usuarios.
 */
export abstract class BarberiasPlataformaLectura {
  /**
   * Una página, ordenada por nombre. `buscar` filtra por nombre o enlace, sin distinguir mayúsculas.
   * `pagina` empieza en 1.
   */
  abstract pagina(
    buscar: string | null,
    pagina: number,
    tamano: number,
  ): Promise<{ barberias: BarberiaDeLaPlataforma[]; total: number }>;
}
