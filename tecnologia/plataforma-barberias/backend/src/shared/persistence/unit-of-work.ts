import type { TenantId } from '../tenant/tenant-id';

/**
 * Puerto de unidad de trabajo (R03). Los casos de uso delimitan aquí sus transacciones sin conocer la
 * base de datos. Los repositorios de cualquier módulo participan en la transacción en curso.
 */
export abstract class UnitOfWork {
  /** Ejecuta `fn` en una transacción con el tenant fijado en la base (RLS) y en el contexto. */
  abstract ejecutar<T>(tenantId: TenantId, fn: () => Promise<T>): Promise<T>;

  /**
   * Ejecuta `fn` en una transacción sin tenant: para lo que ocurre antes de conocerlo (registro de una
   * barbería, inicio de sesión). Con RLS, sin tenant no se ve ninguna fila de tablas por tenant.
   */
  abstract ejecutarSinTenant<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * Fija el tenant dentro de una transacción abierta con `ejecutarSinTenant`. Solo para el registro,
   * donde el tenant nace dentro de la misma transacción, o tras resolverlo de forma segura (ADR-015).
   */
  abstract fijarTenant(tenantId: TenantId): Promise<void>;

  /** Ejecuta `fn` en una transacción nueva e independiente de la actual (p. ej. auditoría de una denegación). */
  abstract ejecutarAparte<T>(tenantId: TenantId, fn: () => Promise<T>): Promise<T>;
}
