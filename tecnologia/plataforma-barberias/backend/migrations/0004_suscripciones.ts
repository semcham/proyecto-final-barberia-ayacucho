import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T060 · M03 Suscripciones: catálogo global de planes y suscripción por barbería (RLS).
// Plan TRIAL: 14 días y 5 usuarios incluido el propietario (valores por validar con el modelo comercial, R13).

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE plan (
      id           uuid PRIMARY KEY,
      code         varchar(32) NOT NULL UNIQUE,
      trial_days   int         CHECK (trial_days > 0),
      max_users    int         NOT NULL CHECK (max_users > 0),
      max_barbers  int         NOT NULL CHECK (max_barbers > 0),
      ai_enabled   boolean     NOT NULL DEFAULT false
    );
    INSERT INTO plan (id, code, trial_days, max_users, max_barbers, ai_enabled)
    VALUES ('01923a00-0000-7000-8000-000000000001', 'TRIAL', 14, 5, 5, false);

    CREATE TABLE subscription (
      id                  uuid PRIMARY KEY,
      tenant_id           uuid        NOT NULL UNIQUE REFERENCES tenant (id),
      plan_id             uuid        NOT NULL REFERENCES plan (id),
      status              varchar(16) NOT NULL
                          CHECK (status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED', 'SUSPENDED')),
      started_at          timestamptz NOT NULL,
      trial_ends_at       timestamptz,
      current_period_end  timestamptz,
      UNIQUE (tenant_id, id),
      CHECK (status <> 'TRIAL' OR trial_ends_at IS NOT NULL)
    );
    CREATE INDEX subscription_estado_periodo ON subscription (status, current_period_end);

    ${rlsPorTenant('subscription')}

    GRANT SELECT ON plan TO barberias_app;
    GRANT SELECT, INSERT ON subscription TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS subscription; DROP TABLE IF EXISTS plan;`).execute(db);
}
