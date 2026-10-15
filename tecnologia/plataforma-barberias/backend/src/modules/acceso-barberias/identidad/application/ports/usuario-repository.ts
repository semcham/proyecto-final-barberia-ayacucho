import type { Correo } from '../../domain/correo';
import type { EstadoMembresia, Membresia } from '../../domain/membresia';
import type { NombrePersona } from '../../domain/nombre-persona';
import type { CodigoRol } from '../../domain/rol';

/** Resultado de auth_resolver_cuenta (ADR-015): lo necesario para autenticar antes de conocer el tenant. */
export interface CuentaParaAutenticar {
  usuarioId: string;
  hashContrasena: string | null;
  tenantId: string;
  rol: CodigoRol;
  estadoMembresia: EstadoMembresia;
  estadoBarberia: 'ACTIVA' | 'SUSPENDIDA';
}

/** Usuario autenticado con su barbería (respuesta de /auth/yo y de inicio de sesión). */
export interface PerfilUsuario {
  id: string;
  nombre: string;
  correo: string;
  rol: CodigoRol;
  barberia: { id: string; nombre: string; slug: string };
}

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
  /** Búsqueda por correo antes de conocer el tenant, vía la función SECURITY DEFINER (ADR-015). */
  abstract resolverCuenta(correoNormalizado: string): Promise<CuentaParaAutenticar | null>;
  /** Perfil del usuario dentro del tenant del contexto. */
  abstract perfil(usuarioId: string): Promise<PerfilUsuario | null>;
}
