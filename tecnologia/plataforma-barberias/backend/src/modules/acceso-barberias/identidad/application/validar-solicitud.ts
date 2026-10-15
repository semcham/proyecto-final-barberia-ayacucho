import { Injectable } from '@nestjs/common';
import { Clock, TenantId, UnitOfWork } from '../../../../shared';
import { NoAutenticado } from '../domain/errores';
import type { Actor } from './autorizacion';
import { SesionRepository } from './ports/sesion-repository';
import { TokenSigner } from './ports/token-signer';

/**
 * Valida el token de acceso de una solicitud protegida (R09). Además de la firma, comprueba en la base,
 * dentro del tenant del token, que la sesión siga vigente, que la membresía siga activa con el mismo rol
 * y que la barbería esté activa. Así un cierre de sesión o una desactivación surten efecto de inmediato.
 */
@Injectable()
export class ValidarSolicitud {
  constructor(
    private readonly firmador: TokenSigner,
    private readonly sesiones: SesionRepository,
    private readonly uow: UnitOfWork,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(token: string): Promise<Actor> {
    const reclamaciones = await this.firmador.verificar(token);
    return this.uow.ejecutar(TenantId.de(reclamaciones.tid), async () => {
      const estado = await this.sesiones.estadoDeAcceso(reclamaciones.sid, reclamaciones.sub);
      const valida =
        estado !== null &&
        estado.sesion.estaVigente(this.reloj.ahora()) &&
        estado.membresiaActiva &&
        estado.rolMembresia === reclamaciones.rol &&
        estado.barberiaActiva;
      if (!valida) throw new NoAutenticado();
      return {
        usuarioId: reclamaciones.sub,
        tenantId: reclamaciones.tid,
        rol: reclamaciones.rol,
        sesionId: reclamaciones.sid,
      };
    });
  }
}
