import { Injectable } from '@nestjs/common';
import { AuditLog, TenantId } from '../../../../shared';
import { AccesoDenegado } from '../domain/errores';
import { type Operacion, Permisos } from '../domain/permisos';
import type { CodigoRol } from '../domain/rol';

/**
 * Quién ejecuta un caso de uso protegido. Lo construye el host a partir del token ya verificado y de la
 * comprobación de sesión, membresía y barbería (ValidarSolicitud). Nunca a partir de datos del cliente.
 */
export interface Actor {
  usuarioId: string;
  tenantId: string;
  rol: CodigoRol;
  sesionId: string;
}

/**
 * RBAC en la capa de aplicación (R22, ADR-010). Es la primera instrucción de cada caso de uso protegido,
 * de modo que el permiso se exige en cualquier punto de entrada (HTTP o, en el futuro, herramientas de IA
 * de M04), no solo detrás del guard HTTP.
 */
@Injectable()
export class Autorizacion {
  constructor(private readonly auditoria: AuditLog) {}

  async exigir(actor: Actor, operacion: Operacion): Promise<void> {
    if (Permisos.permite(actor.rol, operacion)) return;
    // Se registra en una transacción propia: el caso de uso no llega a ejecutarse.
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
