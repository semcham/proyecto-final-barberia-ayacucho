import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T012 · Sesiones (R08) y tokens de activación de cuenta (R14), ambas tablas por tenant con RLS.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE auth_session (
      id                   uuid PRIMARY KEY,
      tenant_id            uuid         NOT NULL,
      user_id              uuid         NOT NULL,
      refresh_token_hash   char(64)     NOT NULL UNIQUE,
      previous_token_hash  char(64),
      status               varchar(16)  NOT NULL DEFAULT 'ACTIVA' CHECK (status IN ('ACTIVA', 'CERRADA', 'REVOCADA')),
      created_at           timestamptz  NOT NULL DEFAULT now(),
      last_used_at         timestamptz  NOT NULL DEFAULT now(),
      absolute_expires_at  timestamptz  NOT NULL,
      ended_at             timestamptz,
      ip                   inet,
      user_agent           varchar(200),
      FOREIGN KEY (tenant_id, user_id) REFERENCES membership (tenant_id, user_id),
      UNIQUE (tenant_id, id),
      CHECK ((status = 'ACTIVA') = (ended_at IS NULL))
    );
    CREATE INDEX auth_session_usuario ON auth_session (tenant_id, user_id, status);
    CREATE INDEX auth_session_token_anterior ON auth_session (previous_token_hash);

    CREATE TABLE account_activation (
      id          uuid PRIMARY KEY,
      tenant_id   uuid        NOT NULL,
      user_id     uuid        NOT NULL,
      token_hash  char(64)    NOT NULL UNIQUE,
      expires_at  timestamptz NOT NULL,
      used_at     timestamptz,
      revoked_at  timestamptz,
      created_by  uuid        NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (tenant_id, user_id) REFERENCES membership (tenant_id, user_id),
      UNIQUE (tenant_id, id)
    );
    CREATE INDEX account_activation_usuario ON account_activation (tenant_id, user_id);

    ${rlsPorTenant('auth_session')}
    ${rlsPorTenant('account_activation')}

    -- DELETE para la purga de sesiones terminadas hace más de 30 días (R08).
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_session TO barberias_app;
    GRANT SELECT, INSERT ON account_activation TO barberias_app;
    GRANT UPDATE (used_at, revoked_at) ON account_activation TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS account_activation; DROP TABLE IF EXISTS auth_session;`).execute(db);
}
