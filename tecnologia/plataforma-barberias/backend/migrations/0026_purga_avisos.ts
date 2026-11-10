import { type Kysely, sql } from 'kysely';

// Funcionalidad 004, fase 3 (T066 y T073; research R17; data-model.md §4 y §7): la tarea enviar-avisos de M05
// purga los avisos en estado final de más de 90 días. Para eso barberias_app necesita DELETE sobre notification,
// que 0024 no daba (decisión del responsable del 2026-11-09, la misma que para outbox_event en la fase 1).
//
// La tabla sigue con RLS forzada (0024): el rol de la aplicación solo borra filas de la barbería fijada en la
// transacción, una barbería por vez. barberias_plataforma y barberias_auth no reciben nada.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`GRANT DELETE ON notification TO barberias_app;`).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`REVOKE DELETE ON notification FROM barberias_app;`).execute(db);
}
