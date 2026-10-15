import { OperacionNoPermitida } from './errores';
import { Rol } from './rol';

export type EstadoMembresia = 'PENDIENTE' | 'ACTIVA' | 'DESACTIVADA';

export interface DatosMembresia {
  id: string;
  tenantId: string;
  usuarioId: string;
  rol: Rol;
  estado: EstadoMembresia;
}

/**
 * Pertenencia de un usuario a una barbería, con un único rol (FR-016). Transiciones en data-model.md §4.
 */
export class Membresia {
  private constructor(private datos: DatosMembresia) {}

  static crearPropietario(id: string, tenantId: string, usuarioId: string): Membresia {
    return new Membresia({ id, tenantId, usuarioId, rol: Rol.PROPIETARIO, estado: 'ACTIVA' });
  }

  static crearBarberoPendiente(id: string, tenantId: string, usuarioId: string): Membresia {
    return new Membresia({ id, tenantId, usuarioId, rol: Rol.BARBERO, estado: 'PENDIENTE' });
  }

  static reconstruir(datos: DatosMembresia): Membresia {
    return new Membresia({ ...datos });
  }

  get id(): string {
    return this.datos.id;
  }
  get tenantId(): string {
    return this.datos.tenantId;
  }
  get usuarioId(): string {
    return this.datos.usuarioId;
  }
  get rol(): Rol {
    return this.datos.rol;
  }
  get estado(): EstadoMembresia {
    return this.datos.estado;
  }

  estaActiva(): boolean {
    return this.datos.estado === 'ACTIVA';
  }

  /** El usuario fijó su contraseña con el enlace de activación. */
  activar(): void {
    if (this.datos.estado !== 'PENDIENTE') {
      throw new OperacionNoPermitida('La cuenta no está pendiente de activación.');
    }
    this.datos.estado = 'ACTIVA';
  }

  /** La barbería siempre conserva un propietario activo: el propietario no puede desactivarse (FR-019). */
  desactivar(actorUsuarioId: string): void {
    if (actorUsuarioId === this.datos.usuarioId || this.datos.rol.equals(Rol.PROPIETARIO)) {
      throw new OperacionNoPermitida('No puedes desactivar tu propia cuenta de propietario.');
    }
    if (this.datos.estado === 'DESACTIVADA') {
      throw new OperacionNoPermitida('El usuario ya está desactivado.');
    }
    this.datos.estado = 'DESACTIVADA';
  }

  /** Vuelve a ACTIVA, o a PENDIENTE si el usuario nunca fijó su contraseña. */
  reactivar(tieneContrasena: boolean): void {
    if (this.datos.estado !== 'DESACTIVADA') {
      throw new OperacionNoPermitida('El usuario no está desactivado.');
    }
    this.datos.estado = tieneContrasena ? 'ACTIVA' : 'PENDIENTE';
  }
}
