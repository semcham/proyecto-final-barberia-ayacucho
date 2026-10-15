import { Kysely, Migrator, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { ProveedorDeMigraciones } from '../../../migrations';

/**
 * Aplica las migraciones pendientes con el rol dueño (barberias_owner). Kysely ejecuta todas las
 * pendientes en una transacción: si una falla, no queda ninguna a medias.
 */
export async function migrarHastaLaUltima(urlConexionDueno: string): Promise<void> {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: urlConexionDueno, max: 1 }) }),
  });
  try {
    const migrador = new Migrator({ db, provider: new ProveedorDeMigraciones() });
    const { error, results } = await migrador.migrateToLatest();
    for (const resultado of results ?? []) {
      console.log(`${resultado.status === 'Success' ? 'aplicada' : 'FALLÓ'}: ${resultado.migrationName}`);
    }
    if (error) throw error;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) {
    console.error('Falta DATABASE_URL_OWNER');
    process.exit(1);
  }
  migrarHastaLaUltima(url).catch((error: unknown) => {
    console.error('Error al migrar:', error);
    process.exit(1);
  });
}
