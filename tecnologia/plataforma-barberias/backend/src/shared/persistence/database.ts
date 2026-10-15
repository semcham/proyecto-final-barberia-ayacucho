import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './db-types';

export type BaseDeDatos = Kysely<Database>;

/** Token de inyección de la conexión Kysely (pool del rol barberias_app). */
export const BASE_DE_DATOS = Symbol('BASE_DE_DATOS');

export function crearBaseDeDatos(urlConexion: string, maxConexiones = 10): BaseDeDatos {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: urlConexion, max: maxConexiones }) }),
  });
}

/** Comprobación de salud para el balanceador (GET /salud). */
export class VerificadorBaseDeDatos {
  constructor(private readonly db: BaseDeDatos) {}

  async responde(): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.db);
      return true;
    } catch {
      return false;
    }
  }
}
