import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './db-types';
import type { TenantId } from '../tenant/tenant-id';

/**
 * Lecturas públicas por enlace (ADR-021, decisión 3 con la precisión del 2026-10-17). Entrada propia de
 * M06: solo la importa `modules/catalogo-citas/catalogo/infrastructure/publico/` (regla de PR14).
 *
 * - Usa su propio pool con el rol `barberias_publico` (`NOBYPASSRLS`, solo SELECT sobre columnas
 *   públicas, migración 0012).
 * - `ejecutar` SOLO abre una transacción de solo lectura, fija `app.tenant_id` para esa transacción y
 *   ejecuta la lectura: RLS filtra las filas con las mismas políticas que la vía autenticada.
 * - No lee ninguna tabla por sí misma: el tenant del enlace lo resuelve M01
 *   (`BarberiasApi.resolverSlugPublico`), porque M06 no accede a tablas de otros módulos (principio I).
 */
export class LecturaPublica {
  private constructor(private readonly db: Kysely<Database>) {}

  static conectar(urlConexion: string, maxConexiones = 10): LecturaPublica {
    return new LecturaPublica(
      new Kysely<Database>({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: urlConexion, max: maxConexiones }),
        }),
      }),
    );
  }

  async ejecutar<T>(tenantId: TenantId, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      // Debe ser la primera sentencia de la transacción.
      await sql`set transaction read only`.execute(trx);
      // true: el valor dura solo esta transacción y no pasa a otra que reutilice la conexión.
      await sql`select set_config('app.tenant_id', ${tenantId.valor}, true)`.execute(trx);
      return fn(trx);
    });
  }

  async cerrar(): Promise<void> {
    await this.db.destroy();
  }
}
