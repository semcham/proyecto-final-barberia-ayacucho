import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './db-types';

/**
 * Lecturas entre barberías de las operaciones de la plataforma (ADR-031, constitución 1.3.1). Entrada propia
 * de M06: solo la importan las carpetas `infrastructure/plataforma/` de M03 y de M01 (regla
 * lectura-plataforma-confinada de PR14).
 *
 * - Usa su propio pool con el rol `barberias_plataforma` (`NOBYPASSRLS`, solo SELECT por columna,
 *   migraciones 0016 y 0017), que lee entre barberías por las políticas `FOR SELECT TO barberias_plataforma`.
 * - `ejecutarLectura` SOLO abre una transacción de solo lectura: no hay ninguna operación de escritura. Las
 *   escrituras se hacen siempre con el rol de la aplicación, sobre una sola barbería y con su tenant fijado.
 * - Las notificaciones del proveedor y las tareas programadas la usan solo para encontrar el tenant por una
 *   clave exacta (referencia del proveedor o id de la suscripción), nunca con datos del cliente.
 */
export class LecturaPlataforma {
  private constructor(private readonly db: Kysely<Database>) {}

  static conectar(urlConexion: string, maxConexiones = 4): LecturaPlataforma {
    return new LecturaPlataforma(
      new Kysely<Database>({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: urlConexion, max: maxConexiones }),
        }),
      }),
    );
  }

  async ejecutarLectura<T>(fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      // Debe ser la primera sentencia de la transacción.
      await sql`set transaction read only`.execute(trx);
      return fn(trx);
    });
  }

  async cerrar(): Promise<void> {
    await this.db.destroy();
  }
}
