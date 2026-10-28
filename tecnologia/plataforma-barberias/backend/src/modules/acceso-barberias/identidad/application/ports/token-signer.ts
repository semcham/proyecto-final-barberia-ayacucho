import type { CodigoRol } from '../../domain/rol';

/** Reclamaciones del token de acceso (R07): usuario, barbería (tenant), rol y sesión. */
export interface ReclamacionesAcceso {
  sub: string;
  tid: string;
  rol: CodigoRol;
  sid: string;
}

/**
 * Reclamaciones del token del administrador de la plataforma (ADR-031, R07): administrador y sesión de
 * plataforma, con `aud: "plataforma"` y SIN `tid`. No sirve en ninguna operación de barbería.
 */
export interface ReclamacionesPlataforma {
  sub: string;
  sid: string;
}

export interface TokenFirmado {
  token: string;
  expiraEnSegundos: number;
}

/** Puerto de firma y verificación del token de acceso. */
export abstract class TokenSigner {
  abstract firmar(reclamaciones: ReclamacionesAcceso): Promise<TokenFirmado>;

  /** Lanza NoAutenticado si el token falta, venció, fue alterado o no cumple el formato esperado. */
  abstract verificar(token: string): Promise<ReclamacionesAcceso>;

  /** Token de plataforma: otra audiencia, sin tenant y de vida corta (10 minutos). */
  abstract firmarPlataforma(reclamaciones: ReclamacionesPlataforma): Promise<TokenFirmado>;

  /**
   * Lanza NoAutenticado si no es un token de plataforma válido. Un token de barbería nunca pasa (otra
   * audiencia), ni uno de plataforma con `tid`.
   */
  abstract verificarPlataforma(token: string): Promise<ReclamacionesPlataforma>;
}
