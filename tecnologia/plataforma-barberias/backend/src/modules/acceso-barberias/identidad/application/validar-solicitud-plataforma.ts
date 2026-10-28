import { Injectable } from '@nestjs/common';
import { TokenSigner } from './ports/token-signer';

/**
 * Quién ejecuta una operación de la plataforma (ADR-031). No tiene tenant: cada escritura sobre una barbería
 * la elige el administrador en la ruta y corre con el tenant de esa barbería fijado.
 */
export interface ActorPlataforma {
  adminId: string;
  rol: 'ADMIN_PLATAFORMA';
  sesionId: string;
}

/**
 * Valida el token de una ruta @Plataforma(): firma, audiencia "plataforma" y ausencia de `tid`. Un token de
 * barbería nunca pasa. La comprobación de la sesión de plataforma en la base (vigente, no cerrada ni
 * revocada) se agrega con la sesión del administrador (fase 5 de 003, T068), del mismo modo que
 * ValidarSolicitud lo hace con la sesión de barbería.
 */
@Injectable()
export class ValidarSolicitudPlataforma {
  constructor(private readonly firmador: TokenSigner) {}

  async ejecutar(token: string): Promise<ActorPlataforma> {
    const { sub, sid } = await this.firmador.verificarPlataforma(token);
    return { adminId: sub, rol: 'ADMIN_PLATAFORMA', sesionId: sid };
  }
}
