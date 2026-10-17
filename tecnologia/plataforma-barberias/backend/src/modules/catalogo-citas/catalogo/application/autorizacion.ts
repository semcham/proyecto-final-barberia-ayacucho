import { Injectable } from '@nestjs/common';
import type { Actor } from '../../../acceso-barberias';
import { AuditLog, TenantId } from '../../../../shared';
import { AccesoDenegado } from '../domain/errores';
import { type Alcance, type OperacionCatalogoCitas, PermisosCatalogoCitas } from '../domain/permisos';

/**
 * T028 · RBAC de M02 en la capa de aplicación (R22 de 001, ADR-010). Es la primera instrucción de cada
 * caso de uso protegido de los submódulos catalogo y citas. Devuelve el alcance (TODOS o PROPIOS) para
 * que el caso de uso limite el recurso a las citas o al barbero del actor.
 */
@Injectable()
export class AutorizacionCatalogoCitas {
  constructor(private readonly auditoria: AuditLog) {}

  async exigir(actor: Actor, operacion: OperacionCatalogoCitas): Promise<Alcance> {
    const alcance = PermisosCatalogoCitas.alcance(actor.rol, operacion);
    if (alcance) return alcance;
    // En una transacción propia: el caso de uso no llega a ejecutarse.
    await this.auditoria.registrarEnTransaccionPropia(
      {
        accion: 'ACCESO_DENEGADO_ROL',
        actorId: actor.usuarioId,
        recurso: `operacion:${operacion}`,
        resultado: 'DENEGADO',
      },
      TenantId.de(actor.tenantId),
    );
    throw new AccesoDenegado();
  }
}
