import { Injectable } from '@nestjs/common';
import { Clock, TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from './autorizacion';
import { SesionRepository } from './ports/sesion-repository';

/**
 * Cierre de sesión (RF04, FR-011): marca CERRADA la sesión del token. Desde ese momento el token de acceso
 * y el de renovación dejan de servir, porque el guard comprueba la sesión en cada solicitud (R09).
 */
@Injectable()
export class CerrarSesion {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly sesiones: SesionRepository,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(actor: Actor): Promise<void> {
    await this.autorizacion.exigir(actor, 'CERRAR_SESION');
    await this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const sesion = await this.sesiones.obtener(actor.sesionId);
      if (!sesion) return;
      sesion.cerrar(this.reloj.ahora());
      await this.sesiones.guardar(sesion);
    });
  }
}
