import { ValorInvalido } from './errores';

/**
 * Roles con membresía en una barbería. El propietario administra todo y el barbero atiende (personal,
 * funcionalidad 001); el cliente reserva (funcionalidad 002, ADR-020). Una cuenta es o personal de una
 * sola barbería o cliente de una o más, nunca ambas cosas.
 */
export const CODIGOS_ROL = ['PROPIETARIO', 'BARBERO', 'CLIENTE'] as const;
export type CodigoRol = (typeof CODIGOS_ROL)[number];

/** Roles del personal: los únicos que cuentan en el límite de usuarios y aparecen en la lista de usuarios. */
export const CODIGOS_ROL_PERSONAL = ['PROPIETARIO', 'BARBERO'] as const;
export type CodigoRolPersonal = (typeof CODIGOS_ROL_PERSONAL)[number];

export class Rol {
  private constructor(readonly codigo: CodigoRol) {}

  static readonly PROPIETARIO = new Rol('PROPIETARIO');
  static readonly BARBERO = new Rol('BARBERO');
  static readonly CLIENTE = new Rol('CLIENTE');

  static de(codigo: string): Rol {
    if (codigo === 'PROPIETARIO') return Rol.PROPIETARIO;
    if (codigo === 'BARBERO') return Rol.BARBERO;
    if (codigo === 'CLIENTE') return Rol.CLIENTE;
    throw new ValorInvalido('rol', 'no_permitido');
  }

  /** El propietario solo puede crear usuarios con rol BARBERO (FR-015, FR-017 de 001). */
  esAsignablePorPropietario(): boolean {
    return this.codigo === 'BARBERO';
  }

  esDelPersonal(): boolean {
    return this.codigo === 'PROPIETARIO' || this.codigo === 'BARBERO';
  }

  equals(otro: Rol): boolean {
    return this.codigo === otro.codigo;
  }
}
