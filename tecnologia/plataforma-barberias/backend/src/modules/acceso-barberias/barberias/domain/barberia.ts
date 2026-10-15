import type { NombreBarberia } from './nombre-barberia';
import type { Slug } from './slug';

export type EstadoBarberia = 'ACTIVA' | 'SUSPENDIDA';

/** Barbería (tenant): la unidad de aislamiento. Nace ACTIVA al registrarse (RF01). */
export class Barberia {
  private constructor(
    readonly id: string,
    readonly nombre: NombreBarberia,
    private slugActual: Slug,
    readonly estado: EstadoBarberia,
  ) {}

  static registrar(id: string, nombre: NombreBarberia, slug: Slug): Barberia {
    return new Barberia(id, nombre, slug, 'ACTIVA');
  }

  get slug(): Slug {
    return this.slugActual;
  }

  /** Cambia el slug cuando el preferido ya está ocupado por otra barbería. */
  usarSlug(slug: Slug): void {
    this.slugActual = slug;
  }
}
