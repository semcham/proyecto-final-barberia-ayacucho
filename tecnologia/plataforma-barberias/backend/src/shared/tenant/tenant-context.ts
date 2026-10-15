import { AsyncLocalStorage } from 'node:async_hooks';
import { SinContextoDeTenant } from '../errores';
import { TenantId } from './tenant-id';

/** Datos de la solicitud en curso disponibles para auditoría y registros. */
export interface DatosSolicitud {
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

interface Contexto extends DatosSolicitud {
  tenantId: TenantId | null;
}

/**
 * Contexto de tenant por solicitud (control 2 de multi-tenancy-y-datos.md), basado en AsyncLocalStorage.
 *
 * El tenant solo se fija con el `tid` de un token ya verificado (guard de autenticación) o, en el
 * registro, con el tenant recién creado por el propio caso de uso. Nunca con datos del cliente.
 * Una vez fijado no se puede cambiar por otro dentro del mismo contexto.
 */
export class TenantContext {
  private readonly almacen = new AsyncLocalStorage<Contexto>();

  /** Ejecuta `fn` en un contexto nuevo (un contexto por solicitud o por unidad de trabajo). */
  ejecutarCon<T>(tenantId: TenantId | null, fn: () => T, datos: DatosSolicitud = {}): T {
    const padre = this.almacen.getStore();
    return this.almacen.run(
      {
        ip: datos.ip ?? padre?.ip,
        userAgent: datos.userAgent ?? padre?.userAgent,
        correlationId: datos.correlationId ?? padre?.correlationId,
        tenantId,
      },
      fn,
    );
  }

  /** Fija el tenant del contexto en curso. Falla si no hay contexto o si ya había otro tenant. */
  fijar(tenantId: TenantId): void {
    const contexto = this.almacen.getStore();
    if (!contexto) throw new SinContextoDeTenant();
    if (contexto.tenantId && !contexto.tenantId.equals(tenantId)) {
      throw new Error('El contexto ya tiene otro tenant fijado; no se puede cambiar');
    }
    contexto.tenantId = tenantId;
  }

  actual(): TenantId {
    const tenantId = this.almacen.getStore()?.tenantId;
    if (!tenantId) throw new SinContextoDeTenant();
    return tenantId;
  }

  actualOpcional(): TenantId | null {
    return this.almacen.getStore()?.tenantId ?? null;
  }

  datosSolicitud(): DatosSolicitud {
    const contexto = this.almacen.getStore();
    return { ip: contexto?.ip, userAgent: contexto?.userAgent, correlationId: contexto?.correlationId };
  }
}
