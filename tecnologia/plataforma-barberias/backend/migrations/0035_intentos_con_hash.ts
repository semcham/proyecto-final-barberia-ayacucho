import { type Kysely, sql } from 'kysely';

// T062 de 007 · US3 (FR-017 a FR-019; data-model §4 de 007; constitución 1.4.1, mejora asignada a 007): login_attempt
// deja de guardar la IP en claro. El origen se guarda solo como SHA-256(INTENTOS_SAL_IP ‖ ip), que calcula la
// aplicación (el adaptador KyselyIntentosRepository): la sal no está en la base, así que lo guardado no permite
// recuperar la IP.
//
// - Las filas existentes se BORRAN: valen 24 h y no se pueden derivar en la base sin la sal. Perderlas solo reinicia los
//   contadores de bloqueo en curso.
// - Los permisos de barberias_app (SELECT, INSERT y DELETE) no cambian.
// - Durante el cambio, las réplicas se recrean a la vez que se aplica la migración (research R09): una réplica vieja
//   que escribiera `ip` falla cerrada en lugar de guardar la IP (procedimiento, T067).

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DELETE FROM login_attempt;
    DROP INDEX IF EXISTS login_attempt_cuenta_ip;
    ALTER TABLE login_attempt DROP COLUMN ip;
    ALTER TABLE login_attempt ADD COLUMN ip_hash char(64) NOT NULL;
    CREATE INDEX login_attempt_cuenta_origen ON login_attempt (email_hash, ip_hash, attempted_at);
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DELETE FROM login_attempt;
    DROP INDEX IF EXISTS login_attempt_cuenta_origen;
    ALTER TABLE login_attempt DROP COLUMN ip_hash;
    ALTER TABLE login_attempt ADD COLUMN ip inet NOT NULL;
    CREATE INDEX login_attempt_cuenta_ip ON login_attempt (email_hash, ip, attempted_at);
  `,
    )
    .execute(db);
}
