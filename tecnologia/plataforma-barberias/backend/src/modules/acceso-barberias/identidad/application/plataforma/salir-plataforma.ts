import { Injectable } from '@nestjs/common';
import { Clock, UnitOfWork } from '../../../../../shared';
import type { ActorPlataforma } from '../validar-solicitud-plataforma';
import { AccesoPlataformaRepository, AuditoriaAccesoPlataforma } from '../ports/plataforma';

/**
 * T068 · El administrador cierra su sesión: el token de acceso deja de servir en la solicitud siguiente
 * (ValidarSolicitudPlataforma consulta la sesión) y el de renovación también. Queda en platform_audit_log.
 */
@Injectable()
export class SalirPlataforma {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly acceso: AccesoPlataformaRepository,
    private readonly auditoria: AuditoriaAccesoPlataforma,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(actor: ActorPlataforma): Promise<void> {
    await this.uow.ejecutarSinTenant(async () => {
      const cerrada = await this.acceso.terminarSesion(
        actor.sesionId,
        actor.adminId,
        'CERRADA',
        this.reloj.ahora(),
      );
      if (cerrada) {
        await this.auditoria.registrar({
          accion: 'ADMIN_SALIDA',
          adminId: actor.adminId,
          resultado: 'PERMITIDO',
        });
      }
    });
  }
}
