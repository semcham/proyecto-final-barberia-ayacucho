import type { Correo } from '../../identidad/domain/correo';
import { ValorInvalido } from '../../identidad/domain/errores';
import type { NombrePersona } from '../../identidad/domain/nombre-persona';

const FORMATO_TELEFONO = /^\+?[0-9 ]{6,20}$/;

/** Teléfono de contacto del cliente (HU06): dígitos y espacios, con + opcional, de 6 a 20 caracteres. */
export class Telefono {
  private constructor(readonly valor: string) {}

  static crear(valor: string): Telefono {
    const limpio = typeof valor === 'string' ? valor.trim() : '';
    if (!FORMATO_TELEFONO.test(limpio)) throw new ValorInvalido('telefono', 'formato');
    return new Telefono(limpio);
  }
}

export type OrigenPerfil = 'EN_LINEA' | 'PRESENCIAL';

interface DatosPerfil {
  id: string;
  tenantId: string;
  usuarioId: string | null;
  nombre: NombrePersona;
  correo: Correo | null;
  telefono: Telefono;
  origen: OrigenPerfil;
  creadoPor: string | null;
}

/**
 * T083 · Perfil del cliente en UNA barbería (RF05; ADR-020): cada barbería tiene el suyo y no ve los de
 * otras. Con cuenta (en línea) lleva el correo de la cuenta; el presencial (FR-035) lo registra el
 * propietario y puede no tener correo.
 */
export class PerfilCliente {
  private constructor(private readonly datos: DatosPerfil) {}

  static enLinea(entrada: {
    id: string;
    tenantId: string;
    usuarioId: string;
    nombre: NombrePersona;
    correo: Correo;
    telefono: Telefono;
  }): PerfilCliente {
    return new PerfilCliente({ ...entrada, origen: 'EN_LINEA', creadoPor: null });
  }

  static presencial(entrada: {
    id: string;
    tenantId: string;
    nombre: NombrePersona;
    correo: Correo | null;
    telefono: Telefono;
    creadoPor: string;
  }): PerfilCliente {
    return new PerfilCliente({ ...entrada, usuarioId: null, origen: 'PRESENCIAL' });
  }

  get id(): string {
    return this.datos.id;
  }
  get tenantId(): string {
    return this.datos.tenantId;
  }
  get usuarioId(): string | null {
    return this.datos.usuarioId;
  }
  get nombre(): NombrePersona {
    return this.datos.nombre;
  }
  get correo(): Correo | null {
    return this.datos.correo;
  }
  get telefono(): Telefono {
    return this.datos.telefono;
  }
  get origen(): OrigenPerfil {
    return this.datos.origen;
  }
  get creadoPor(): string | null {
    return this.datos.creadoPor;
  }
}
