import type { Correo } from '../../domain/correo';
import type { Membresia } from '../../domain/membresia';
import type { NombrePersona } from '../../domain/nombre-persona';

export interface NuevaCuenta {
  id: string;
  correo: Correo;
  nombre: NombrePersona;
  /** Hash Argon2id; null mientras el usuario no activa su cuenta (US4). */
  hashContrasena: string | null;
}

/**
 * Cuentas (`user_account`, con RLS por membresía, ADR-015) y membresías del tenant del contexto.
 * Toda consulta sobre `membership` filtra por el tenant del contexto además de RLS.
 */
export abstract class UsuarioRepository {
  /** Lanza CorreoNoDisponible si el correo ya pertenece a otra cuenta (FR-006). */
  abstract crearCuenta(cuenta: NuevaCuenta): Promise<void>;
  abstract crearMembresia(membresia: Membresia): Promise<void>;
}
