import type { CodigoRol } from '../../domain/rol';

/** Reclamaciones del token de acceso (R07): usuario, barbería (tenant), rol y sesión. */
export interface ReclamacionesAcceso {
  sub: string;
  tid: string;
  rol: CodigoRol;
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
}
