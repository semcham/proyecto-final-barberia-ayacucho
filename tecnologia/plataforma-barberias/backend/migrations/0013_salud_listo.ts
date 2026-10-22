import { type Kysely, sql } from 'kysely';

// Disponibilidad de la réplica (funcionalidad 006, research.md R02, data-model.md §1).
//
// GET /api/v1/salud/listo compara la última migración aplicada con la última que conoce el código, así
// que barberias_app necesita leer la tabla técnica de Kysely. Solo SELECT: nombre y fecha de cada
// migración, sin datos de negocio ni de barberías (no es una tabla de negocio: sin tenant ni RLS).
// Antes de aplicar esta migración la ruta responde 503, que es lo correcto: faltan migraciones.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`GRANT SELECT ON kysely_migration TO barberias_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE SELECT ON kysely_migration FROM barberias_app`.execute(db);
}
