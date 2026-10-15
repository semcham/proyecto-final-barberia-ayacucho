import { type Kysely, sql } from 'kysely';

// Bloqueo de la fila de la suscripción mientras se crea un usuario del personal, para que dos altas
// simultáneas no superen el límite del plan (FR-020).
//
// PostgreSQL exige privilegio UPDATE sobre al menos una columna para SELECT ... FOR UPDATE. Se concede
// solo sobre `status`, la columna que M03 actualizará al suspender o reactivar suscripciones (RF22).
// La política RLS de subscription (USING y WITH CHECK por tenant) sigue limitando qué filas se tocan.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`GRANT UPDATE (status) ON subscription TO barberias_app;`).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`REVOKE UPDATE (status) ON subscription FROM barberias_app;`).execute(db);
}
