import { type Kysely, sql } from 'kysely';

// T078 · Intentos fallidos de inicio de sesión por cuenta + IP (R10, EQ-12). Tabla técnica global:
// no guarda el correo (solo su SHA-256) ni datos de ninguna barbería, y se purga a las 24 h.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE login_attempt (
      id            bigserial    PRIMARY KEY,
      email_hash    char(64)     NOT NULL,
      ip            inet         NOT NULL,
      attempted_at  timestamptz  NOT NULL DEFAULT now()
    );
    CREATE INDEX login_attempt_cuenta_ip ON login_attempt (email_hash, ip, attempted_at);
    CREATE INDEX login_attempt_antiguedad ON login_attempt (attempted_at);

    GRANT SELECT, INSERT, DELETE ON login_attempt TO barberias_app;
    GRANT USAGE ON SEQUENCE login_attempt_id_seq TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS login_attempt;`).execute(db);
}
