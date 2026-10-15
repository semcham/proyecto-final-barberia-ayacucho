import type { Contrasena } from '../../domain/contrasena';

/** Puerto de hash de contraseñas (R06). La contraseña nunca se guarda ni se registra en texto plano. */
export abstract class PasswordHasher {
  abstract hash(contrasena: Contrasena): Promise<string>;

  /** Devuelve false ante cualquier fallo (hash corrupto incluido); nunca lanza por una contraseña errada. */
  abstract verificar(hashGuardado: string, texto: string): Promise<boolean>;

  /**
   * Hace el mismo trabajo que `verificar` contra un hash ficticio y devuelve false. Se usa cuando el correo
   * no existe, para que el tiempo de respuesta no revele si la cuenta existe (FR-009).
   */
  abstract verificarFicticio(texto: string): Promise<false>;
}
