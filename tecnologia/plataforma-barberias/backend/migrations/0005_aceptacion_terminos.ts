import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T061 · Evidencia de lo que aceptó el propietario al registrarse (FR-005), por barbería con RLS.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE terms_acceptance (
      id            uuid PRIMARY KEY,
      tenant_id     uuid        NOT NULL,
      user_id       uuid        NOT NULL,
      document      varchar(32) NOT NULL CHECK (document IN ('TERMINOS', 'POLITICA_DATOS')),
      text_version  varchar(32) NOT NULL,
      accepted_at   timestamptz NOT NULL DEFAULT now(),
      ip            inet,
      FOREIGN KEY (tenant_id, user_id) REFERENCES membership (tenant_id, user_id),
      UNIQUE (tenant_id, id)
    );
    CREATE INDEX terms_acceptance_usuario ON terms_acceptance (tenant_id, user_id);

    ${rlsPorTenant('terms_acceptance')}

    -- Evidencia inmutable para la aplicación.
    GRANT SELECT, INSERT ON terms_acceptance TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS terms_acceptance;`).execute(db);
}
