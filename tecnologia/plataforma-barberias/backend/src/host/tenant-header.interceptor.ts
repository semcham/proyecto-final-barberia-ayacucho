import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { ValorInvalido } from '../modules/acceso-barberias';

/** Nombres con los que un cliente podría intentar indicar la barbería. Nunca se aceptan (FR-023, R11). */
export const CAMPOS_DE_TENANT = ['tenantId', 'tenant_id', 'barberiaId'] as const;

/**
 * Rechaza con 400 cualquier intento de indicar el tenant desde el cliente: encabezado X-Tenant-Id o
 * parámetros de consulta (T044). Los campos del cuerpo los rechaza el ValidationPipe (forbidNonWhitelisted);
 * US3 (T094) amplía este interceptor para auditar también esos intentos.
 */
@Injectable()
export class TenantHeaderInterceptor implements NestInterceptor {
  intercept(contexto: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const solicitud = contexto.switchToHttp().getRequest<Request>();
    if (solicitud.headers['x-tenant-id'] !== undefined) {
      throw new ValorInvalido('X-Tenant-Id', 'no_permitido');
    }
    for (const campo of CAMPOS_DE_TENANT) {
      if (solicitud.query && Object.prototype.hasOwnProperty.call(solicitud.query, campo)) {
        throw new ValorInvalido(campo, 'no_permitido');
      }
    }
    return siguiente.handle();
  }
}
