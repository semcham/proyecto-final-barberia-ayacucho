import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T011 · Núcleo de identidad: tenant, role, user_account (RLS por membresía, ADR-015), membership y audit_log.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE tenant (
      id          uuid PRIMARY KEY,
      name        varchar(120) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
      slug        varchar(140) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
      status      varchar(16)  NOT NULL DEFAULT 'ACTIVA' CHECK (status IN ('ACTIVA', 'SUSPENDIDA')),
      created_at  timestamptz  NOT NULL DEFAULT now()
    );

    CREATE TABLE role (
      code        varchar(24)  PRIMARY KEY,
      description varchar(120) NOT NULL
    );
    INSERT INTO role (code, description) VALUES
      ('ADMIN_PLATAFORMA', 'Administrador de la plataforma'),
      ('PROPIETARIO',      'Propietario de la barbería; administra todo en su barbería'),
      ('BARBERO',          'Barbero de la barbería'),
      ('CLIENTE',          'Cliente que reserva citas');

    CREATE TABLE user_account (
      id                 uuid PRIMARY KEY,
      email              varchar(254) NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
      full_name          varchar(120) NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
      password_hash      varchar(255),
      is_platform_admin  boolean      NOT NULL DEFAULT false,
      created_at         timestamptz  NOT NULL DEFAULT now()
    );

    CREATE TABLE membership (
      id          uuid PRIMARY KEY,
      tenant_id   uuid        NOT NULL REFERENCES tenant (id),
      user_id     uuid        NOT NULL REFERENCES user_account (id),
      role_code   varchar(24) NOT NULL REFERENCES role (code) CHECK (role_code IN ('PROPIETARIO', 'BARBERO')),
      status      varchar(16) NOT NULL CHECK (status IN ('PENDIENTE', 'ACTIVA', 'DESACTIVADA')),
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, user_id),
      UNIQUE (tenant_id, id)
    );
    -- Un usuario del personal pertenece a una sola barbería (supuesto de la especificación).
    CREATE UNIQUE INDEX membership_staff_one_tenant ON membership (user_id)
      WHERE role_code IN ('PROPIETARIO', 'BARBERO');
    CREATE UNIQUE INDEX one_owner_per_tenant ON membership (tenant_id) WHERE role_code = 'PROPIETARIO';
    CREATE INDEX membership_tenant_role_status ON membership (tenant_id, role_code, status);

    CREATE TABLE audit_log (
      id              uuid PRIMARY KEY,
      tenant_id       uuid        NOT NULL REFERENCES tenant (id),
      actor_id        uuid,
      action          varchar(48) NOT NULL,
      resource        varchar(80),
      result          varchar(12) NOT NULL CHECK (result IN ('PERMITIDO', 'DENEGADO')),
      ip              inet,
      correlation_id  varchar(64),
      at              timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_log_tenant_at ON audit_log (tenant_id, at);

    ${rlsPorTenant('membership')}
    ${rlsPorTenant('audit_log')}

    -- ADR-015: user_account no tiene tenant_id, pero el rol de aplicación solo ve las cuentas con
    -- membresía en el tenant actual (la subconsulta sobre membership ya está filtrada por RLS).
    ALTER TABLE user_account ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_account FORCE ROW LEVEL SECURITY;
    CREATE POLICY cuentas_del_tenant ON user_account FOR SELECT
      USING (EXISTS (SELECT 1 FROM membership m WHERE m.user_id = user_account.id));
    CREATE POLICY cuentas_del_tenant_upd ON user_account FOR UPDATE
      USING (EXISTS (SELECT 1 FROM membership m WHERE m.user_id = user_account.id));
    -- La cuenta se crea antes que su membresía: la inserción no puede usar RETURNING.
    CREATE POLICY alta_de_cuenta ON user_account FOR INSERT WITH CHECK (true);

    GRANT SELECT, INSERT ON tenant TO barberias_app;
    GRANT SELECT ON role TO barberias_app;
    -- Sin SELECT sobre password_hash: solo la lee auth_resolver_cuenta (ADR-015).
    GRANT SELECT (id, email, full_name, is_platform_admin, created_at) ON user_account TO barberias_app;
    GRANT INSERT ON user_account TO barberias_app;
    GRANT UPDATE (password_hash, full_name) ON user_account TO barberias_app;
    GRANT SELECT, INSERT ON membership TO barberias_app;
    GRANT UPDATE (status, updated_at) ON membership TO barberias_app;
    -- Inmutable para la aplicación (EQ-13).
    GRANT SELECT, INSERT ON audit_log TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS membership;
    DROP TABLE IF EXISTS user_account;
    DROP TABLE IF EXISTS role;
    DROP TABLE IF EXISTS tenant;
  `,
    )
    .execute(db);
}
