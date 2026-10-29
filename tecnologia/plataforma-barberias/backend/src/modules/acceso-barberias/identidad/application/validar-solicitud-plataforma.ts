import { Injectable } from '@nestjs/common';
import { Clock } from '../../../../shared';
import { NoAutenticado } from '../domain/errores';
import { SesionesPlataformaVigentes } from './ports/plataforma';
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
 * Valida el token de una ruta @Plataforma(): firma, audiencia "plataforma" y ausencia de `tid` (un token de
 * barbería nunca pasa), y además que su sesión de plataforma siga ACTIVA, sin pasar su vida máxima, y que la
 * cuenta siga activa (T068), del mismo modo que ValidarSolicitud lo hace con la sesión de barbería. Así, salir
 * invalida el token en la solicitud siguiente, en cualquier réplica.
 */
@Injectable()
export class ValidarSolicitudPlataforma {
  constructor(
    private readonly firmador: TokenSigner,
    private readonly sesiones: SesionesPlataformaVigentes,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(token: string): Promise<ActorPlataforma> {
    const { sub, sid } = await this.firmador.verificarPlataforma(token);
    if (!(await this.sesiones.vigente(sid, sub, this.reloj.ahora()))) throw new NoAutenticado();
    return { adminId: sub, rol: 'ADMIN_PLATAFORMA', sesionId: sid };
  }
}
