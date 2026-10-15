import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { TenantContext } from '../tenant/tenant-context';
import type { TenantId } from '../tenant/tenant-id';
import { BASE_DE_DATOS, type BaseDeDatos } from './database';
import type { Database } from './db-types';
import { UnitOfWork } from './unit-of-work';

interface TransaccionEnCurso {
  trx: Transaction<Database>;
  tenantId: TenantId | null;
}

/**
 * Implementación con Kysely (R03). En cada transacción ejecuta
 * `set_config('app.tenant_id', <tenant>, true)`: el `true` limita el valor a la transacción, así no pasa
 * a otra solicitud que reutilice la misma conexión del pool.
 */
@Injectable()
export class KyselyUnitOfWork extends UnitOfWork {
  private readonly almacen = new AsyncLocalStorage<TransaccionEnCurso>();

  constructor(
    @Inject(BASE_DE_DATOS) private readonly db: BaseDeDatos,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async ejecutar<T>(tenantId: TenantId, fn: () => Promise<T>): Promise<T> {
    const enCurso = this.almacen.getStore();
    if (enCurso) {
      if (!enCurso.tenantId || !enCurso.tenantId.equals(tenantId)) {
        throw new Error('Ya hay una transacción en curso con otro tenant (o sin tenant)');
      }
      return fn();
    }
    return this.abrir(tenantId, fn);
  }

  async ejecutarSinTenant<T>(fn: () => Promise<T>): Promise<T> {
    if (this.almacen.getStore()) throw new Error('Ya hay una transacción en curso');
    return this.db
      .transaction()
      .execute((trx) =>
        this.almacen.run({ trx, tenantId: null }, () => this.tenantContext.ejecutarCon(null, fn)),
      );
  }

  async fijarTenant(tenantId: TenantId): Promise<void> {
    const enCurso = this.almacen.getStore();
    if (!enCurso) throw new Error('fijarTenant requiere una transacción abierta con ejecutarSinTenant');
    if (enCurso.tenantId) throw new Error('La transacción ya tiene un tenant fijado');
    await sql`select set_config('app.tenant_id', ${tenantId.valor}, true)`.execute(enCurso.trx);
    enCurso.tenantId = tenantId;
    this.tenantContext.fijar(tenantId);
  }

  async ejecutarAparte<T>(tenantId: TenantId, fn: () => Promise<T>): Promise<T> {
    // Se sale del almacén actual para que los repositorios usen la transacción nueva.
    return this.almacen.exit(() => this.abrir(tenantId, fn));
  }

  /** Transacción en curso, para los repositorios (capa de infraestructura). */
  transaccionActual(): Transaction<Database> {
    const enCurso = this.almacen.getStore();
    if (!enCurso) throw new Error('No hay una transacción en curso: usa UnitOfWork en el caso de uso');
    return enCurso.trx;
  }

  private abrir<T>(tenantId: TenantId, fn: () => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId.valor}, true)`.execute(trx);
      return this.almacen.run({ trx, tenantId }, () => this.tenantContext.ejecutarCon(tenantId, fn));
    });
  }
}
