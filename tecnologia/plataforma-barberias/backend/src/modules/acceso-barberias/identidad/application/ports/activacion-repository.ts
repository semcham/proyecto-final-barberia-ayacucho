import type { Activacion } from '../../domain/activacion';

/**
 * Enlaces de activación del tenant del contexto (filtro explícito por tenant además de RLS), salvo
 * `buscarPorHash`, que usa la función auth_buscar_activacion antes de conocer el tenant (ADR-015).
 */
export abstract class ActivacionRepository {
  abstract crear(activacion: Activacion, hashToken: string, creadaPor: string): Promise<void>;
  /** Revoca los enlaces aún utilizables del usuario (al regenerar uno nuevo). */
  abstract revocarVigentesDe(usuarioId: string, ahora: Date): Promise<void>;
  abstract buscarPorHash(hashToken: string): Promise<Activacion | null>;
  /** Marca la activación como usada solo si nadie la usó antes; false si otra solicitud se adelantó. */
  abstract marcarUsada(activacion: Activacion): Promise<boolean>;
  /** ¿El usuario ya activó su cuenta alguna vez (es decir, fijó su contraseña)? */
  abstract tieneActivacionUsada(usuarioId: string): Promise<boolean>;
}
