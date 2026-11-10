import { type Kysely, sql } from 'kysely';

// Funcionalidad 004, fase 4 (T079, T094; decisión del responsable del 2026-11-09): un cambio de estado hecho por
// un enlace de acción (cancelar sin sesión) no tiene un usuario que lo firme; el cliente puede ser presencial y no
// tener cuenta. appointment_status_history.changed_by pasa a admitir NULL, con el mismo significado que en
// appointment_reschedule (0023): nulo = por enlace. Las filas existentes no cambian. Sin cambios de permisos ni
// de RLS.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE appointment_status_history ALTER COLUMN changed_by DROP NOT NULL;`).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Solo se puede volver atrás si no quedó ninguna fila por enlace.
  await sql.raw(`ALTER TABLE appointment_status_history ALTER COLUMN changed_by SET NOT NULL;`).execute(db);
}
