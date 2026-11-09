import { type Kysely, sql } from 'kysely';

// T025 · Funcionalidad 004: rechazos de los enlaces de acción por origen (FR-031, research R07; data-model.md
// §5). Tabla técnica de intentos sin barbería (constitución 1.4.1, principio III): sin tenant_id ni RLS, y el
// origen solo como SHA-256 de la IP con la sal ENLACES_SAL_IP, nunca la IP en claro. Se purga a las 24 h
// (tarea purgar-intentos-enlaces, fase 4), por eso barberias_app tiene DELETE, como en login_attempt (0006).

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE action_link_attempt (
      id            bigserial    PRIMARY KEY,
      ip_hash       char(64)     NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
      attempted_at  timestamptz  NOT NULL DEFAULT now()
    );
    CREATE INDEX action_link_attempt_origen ON action_link_attempt (ip_hash, attempted_at);
    CREATE INDEX action_link_attempt_fecha ON action_link_attempt (attempted_at);

    GRANT SELECT, INSERT, DELETE ON action_link_attempt TO barberias_app;
    GRANT USAGE ON SEQUENCE action_link_attempt_id_seq TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS action_link_attempt;`).execute(db);
}
