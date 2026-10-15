import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { ValorInvalido } from '../modules/acceso-barberias';
import { AuditLog, TenantId } from '../shared';
import type { SolicitudConActor } from './solicitud';

/** Nombres con los que un cliente podría intentar indicar la barbería. Nunca se aceptan (FR-023, R11). */
export const CAMPOS_DE_TENANT = ['tenantId', 'tenant_id', 'barberiaId'] as const;

/** Dónde vino el intento: encabezado, parámetro de consulta o campo del cuerpo. */
function intentoExplicito(solicitud: SolicitudConActor): string | null {
  if (solicitud.headers['x-tenant-id'] !== undefined) return 'X-Tenant-Id';
  for (const campo of CAMPOS_DE_TENANT) {
    if (solicitud.query && Object.prototype.hasOwnProperty.call(solicitud.query, campo)) return campo;
    const cuerpo: unknown = solicitud.body;
    if (cuerpo && typeof cuerpo === 'object' && Object.prototype.hasOwnProperty.call(cuerpo, campo))
      return campo;
  }
  return null;
}

/**
 * Rechaza con 400 cualquier intento explícito de indicar la barbería desde el cliente (T044, T094): el
 * encabezado X-Tenant-Id o los campos tenantId, tenant_id o barberiaId en la consulta o en el cuerpo. Si la
 * solicitud está autenticada, el intento queda auditado como ACCESO_TENANT_AJENO en la barbería del token
 * (escenario 4 de US3). Corre antes del ValidationPipe, así que la operación nunca llega a ejecutarse.
 */
@Injectable()
export class TenantHeaderInterceptor implements NestInterceptor {
  constructor(private readonly auditoria: AuditLog) {}

  async intercept(contexto: ExecutionContext, siguiente: CallHandler): Promise<Observable<unknown>> {
    const solicitud = contexto.switchToHttp().getRequest<SolicitudConActor>();
    const campo = intentoExplicito(solicitud);
    if (!campo) return siguiente.handle();

    const actor = solicitud.actor;
    if (actor) {
      await this.auditoria.registrarEnTransaccionPropia(
        {
          accion: 'ACCESO_TENANT_AJENO',
          actorId: actor.usuarioId,
          recurso: `${solicitud.method} ${solicitud.path} (${campo})`,
          resultado: 'DENEGADO',
        },
        TenantId.de(actor.tenantId),
      );
    }
    throw new ValorInvalido(campo, 'no_permitido');
  }
}
