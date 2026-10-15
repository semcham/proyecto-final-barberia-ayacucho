import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { Clock, TenantContext } from '../../../../shared';
import type { CodigoRol } from '../domain/rol';
import { Sesion } from '../domain/sesion';
import { SesionRepository } from './ports/sesion-repository';
import { TokenSigner } from './ports/token-signer';
import { generarTokenOpaco, hashDeToken } from './tokens-opacos';

export interface SesionEmitida {
  tokenAcceso: string;
  expiraEn: number;
  /** Token opaco de renovación: va solo en la cookie HttpOnly, nunca en el cuerpo de la respuesta. */
  tokenRenovacion: string;
  sesionId: string;
}

/**
 * Crea una sesión para el usuario en el tenant del contexto y firma su token de acceso (R08).
 * La usan el registro de la barbería y el inicio de sesión; debe ejecutarse dentro de su UnitOfWork.
 */
@Injectable()
export class EmitirSesion {
  constructor(
    private readonly sesiones: SesionRepository,
    private readonly firmador: TokenSigner,
    private readonly reloj: Clock,
    private readonly tenantContext: TenantContext,
  ) {}

  async ejecutar(usuarioId: string, rol: CodigoRol): Promise<SesionEmitida> {
    const tenantId = this.tenantContext.actual();
    const tokenRenovacion = generarTokenOpaco();
    const sesion = Sesion.iniciar(
      uuidv7(),
      tenantId.valor,
      usuarioId,
      hashDeToken(tokenRenovacion),
      this.reloj.ahora(),
    );
    await this.sesiones.crear(sesion, this.tenantContext.datosSolicitud());
    const acceso = await this.firmador.firmar({ sub: usuarioId, tid: tenantId.valor, rol, sid: sesion.id });
    return {
      tokenAcceso: acceso.token,
      expiraEn: acceso.expiraEnSegundos,
      tokenRenovacion,
      sesionId: sesion.id,
    };
  }
}
