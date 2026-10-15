import { ValorInvalido } from './errores';

/** Roles del personal de una barbería en esta funcionalidad: el propietario administra todo; el barbero atiende. */
export const CODIGOS_ROL = ['PROPIETARIO', 'BARBERO'] as const;
export type CodigoRol = (typeof CODIGOS_ROL)[number];

export class Rol {
  private constructor(readonly codigo: CodigoRol) {}

  static readonly PROPIETARIO = new Rol('PROPIETARIO');
  static readonly BARBERO = new Rol('BARBERO');

  static de(codigo: string): Rol {
    if (codigo === 'PROPIETARIO') return Rol.PROPIETARIO;
    if (codigo === 'BARBERO') return Rol.BARBERO;
    throw new ValorInvalido('rol', 'no_permitido');
  }

  /** El propietario solo puede crear usuarios con rol BARBERO (FR-015, FR-017). */
  esAsignablePorPropietario(): boolean {
    return this.codigo === 'BARBERO';
  }

  equals(otro: Rol): boolean {
    return this.codigo === otro.codigo;
  }
}
