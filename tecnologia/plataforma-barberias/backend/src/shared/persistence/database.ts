import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { ULTIMA_MIGRACION } from '../../../migrations';
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

/**
 * Disponibilidad de la réplica (GET /salud/listo, 006 R02): la base responde y la última migración aplicada
 * es la última que conoce el código (o una posterior, durante un despliegue). Necesita la migración 0013
 * (SELECT sobre kysely_migration); antes de ella, o ante cualquier error, la réplica no está lista.
 */
export class VerificadorMigraciones {
  /** Las migraciones no se deshacen: una vez al día, solo se vuelve a comprobar que la base responde. */
  private alDia = false;

  constructor(
    private readonly db: BaseDeDatos,
    private readonly ultima: string = ULTIMA_MIGRACION,
  ) {}

  async lista(): Promise<boolean> {
    try {
      if (this.alDia) {
        await sql`select 1`.execute(this.db);
        return true;
      }
      const { rows } = await sql<{
        ultima: string | null;
      }>`select max(name) as ultima from kysely_migration`.execute(this.db);
      const aplicada = rows[0]?.ultima ?? null;
      this.alDia = aplicada !== null && aplicada >= this.ultima;
      return this.alDia;
    } catch {
      return false;
    }
  }
}
