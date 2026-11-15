import { Injectable } from '@nestjs/common';
import { AuditLog, TenantId } from '../../../../shared';
import { AccesoDenegado } from '../domain/errores';
import {
  type OperacionAsistenteReportes,
  PermisosAsistenteReportes,
  type RolEnBarberia,
} from '../domain/permisos';

/**
 * Quién ejecuta un caso de uso de M04. Tiene la misma forma que el actor que arma el host desde el token verificado
 * (M01), sin depender de M01: M04 no puede llamar a M01 (regla matriz-m04 de PR14). Igual que en M03.
 */
export interface ActorDeBarberia {
  usuarioId: string;
  tenantId: string;
  rol: RolEnBarberia;
  sesionId: string;
}

/**
 * RBAC de M04 en la capa de aplicación (R22 de 001): primera instrucción de cada caso de uso, además del guard HTTP.
 * Una denegación queda auditada en la barbería del actor, como en M03.
 */
@Injectable()
export class AutorizacionAsistenteReportes {
  constructor(private readonly auditoria: AuditLog) {}

  async exigir(actor: ActorDeBarberia, operacion: OperacionAsistenteReportes): Promise<void> {
    if (PermisosAsistenteReportes.permite(actor.rol, operacion)) return;
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
