import { Injectable } from '@nestjs/common';
import { AuditLog, TenantId } from '../../../../shared';
import { AccesoDenegado } from '../domain/errores';
import { type OperacionSuscripciones, PermisosSuscripciones, type RolEnBarberia } from '../domain/permisos';

/**
 * Quién ejecuta un caso de uso de M03 en una ruta de barbería. Tiene la misma forma que el actor que arma
 * el host desde el token verificado (M01), sin depender de M01: M03 solo llama a M06 (matriz de PR14).
 */
export interface ActorDeBarberia {
  usuarioId: string;
  tenantId: string;
  rol: RolEnBarberia;
  sesionId: string;
}

/**
 * RBAC de M03 en la capa de aplicación (R22 de 001, ADR-010): primera instrucción de cada caso de uso
 * protegido, además del guard HTTP. Una denegación queda auditada en la barbería del actor.
 */
@Injectable()
export class AutorizacionSuscripciones {
  constructor(private readonly auditoria: AuditLog) {}

  async exigir(actor: ActorDeBarberia, operacion: OperacionSuscripciones): Promise<void> {
    if (PermisosSuscripciones.permite(actor.rol, operacion)) return;
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
