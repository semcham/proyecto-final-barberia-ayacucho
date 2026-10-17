import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T006 · Cuenta de cliente (funcionalidad 002, RF05, ADR-020).
//
// - membership admite el rol CLIENTE (una membresía por barbería donde el cliente se une). El índice
//   membership_staff_one_tenant de 001 no cambia: el personal sigue en una sola barbería.
// - customer_profile: datos del cliente en cada barbería, con o sin cuenta (cliente presencial, FR-035).
// - consent_record: evidencia del consentimiento por barbería (FR-024), inmutable para la aplicación.
// - auth_resolver_cuenta (ADR-015) pasa de JOIN a LEFT JOIN: devuelve la cuenta aunque no tenga
//   membresía de personal, para verificar la contraseña de un cliente por el mismo camino de tiempo
//   constante. Conserva la firma (un parámetro, sin tenant), la salida y LIMIT 1. Revisión obligatoria
//   según ADR-015.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE membership DROP CONSTRAINT membership_role_code_check;
    ALTER TABLE membership ADD CONSTRAINT membership_role_code_check
      CHECK (role_code IN ('PROPIETARIO', 'BARBERO', 'CLIENTE'));

    CREATE TABLE customer_profile (
      id          uuid PRIMARY KEY,
      tenant_id   uuid         NOT NULL REFERENCES tenant (id),
      user_id     uuid         REFERENCES user_account (id),
      full_name   varchar(120) NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
      email       varchar(254) CHECK (email IS NULL OR email = lower(btrim(email))),
      phone       varchar(20)  NOT NULL CHECK (phone ~ '^\\+?[0-9 ]{6,20}$'),
      origin      varchar(16)  NOT NULL CHECK (origin IN ('EN_LINEA', 'PRESENCIAL')),
      created_by  uuid,
      created_at  timestamptz  NOT NULL DEFAULT now(),
      updated_at  timestamptz  NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, id),
      -- Con cuenta, el correo es obligatorio; sin cuenta (presencial), lo registró el propietario.
      CHECK (user_id IS NULL OR email IS NOT NULL),
      CHECK (user_id IS NOT NULL OR created_by IS NOT NULL)
    );
    -- Un perfil por cuenta y barbería (los presenciales no tienen cuenta).
    CREATE UNIQUE INDEX customer_profile_cuenta ON customer_profile (tenant_id, user_id)
      WHERE user_id IS NOT NULL;
    CREATE INDEX customer_profile_nombre ON customer_profile (tenant_id, lower(full_name));
    CREATE INDEX customer_profile_telefono ON customer_profile (tenant_id, phone);

    CREATE TABLE consent_record (
      id            uuid PRIMARY KEY,
      tenant_id     uuid        NOT NULL REFERENCES tenant (id),
      customer_id   uuid        NOT NULL,
      document      varchar(32) NOT NULL CHECK (document IN ('POLITICA_DATOS')),
      text_version  varchar(32) NOT NULL,
      method        varchar(16) NOT NULL CHECK (method IN ('EN_LINEA', 'PRESENCIAL')),
      recorded_by   uuid,
      ip            inet,
      accepted_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, customer_id) REFERENCES customer_profile (tenant_id, id),
      -- Un consentimiento anotado por el propietario exige saber quién lo anotó (FR-024, FR-035).
      CHECK (method <> 'PRESENCIAL' OR recorded_by IS NOT NULL)
    );
    CREATE INDEX consent_record_cliente ON consent_record (tenant_id, customer_id);

    ${rlsPorTenant('customer_profile')}
    ${rlsPorTenant('consent_record')}

    GRANT SELECT, INSERT ON customer_profile TO barberias_app;
    GRANT UPDATE (full_name, phone, updated_at) ON customer_profile TO barberias_app;
    -- Inmutable para la aplicación.
    GRANT SELECT, INSERT ON consent_record TO barberias_app;

    CREATE OR REPLACE FUNCTION auth_resolver_cuenta(p_email varchar)
    RETURNS TABLE (
      user_id            uuid,
      password_hash      varchar,
      tenant_id          uuid,
      role_code          varchar,
      membership_status  varchar,
      tenant_status      varchar
    )
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
      SELECT u.id, u.password_hash, m.tenant_id, m.role_code, m.status, t.status
      FROM user_account u
      LEFT JOIN membership m ON m.user_id = u.id AND m.role_code IN ('PROPIETARIO', 'BARBERO')
      LEFT JOIN tenant t ON t.id = m.tenant_id
      WHERE u.email = p_email
      LIMIT 1
    $fn$;

    -- CREATE OR REPLACE conserva dueño y permisos; se repiten para que la migración sea explícita.
    ALTER FUNCTION auth_resolver_cuenta(varchar) OWNER TO barberias_auth;
    REVOKE ALL ON FUNCTION auth_resolver_cuenta(varchar) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION auth_resolver_cuenta(varchar) TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE OR REPLACE FUNCTION auth_resolver_cuenta(p_email varchar)
    RETURNS TABLE (
      user_id            uuid,
      password_hash      varchar,
      tenant_id          uuid,
      role_code          varchar,
      membership_status  varchar,
      tenant_status      varchar
    )
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
      SELECT u.id, u.password_hash, m.tenant_id, m.role_code, m.status, t.status
      FROM user_account u
      JOIN membership m ON m.user_id = u.id AND m.role_code IN ('PROPIETARIO', 'BARBERO')
      JOIN tenant t ON t.id = m.tenant_id
      WHERE u.email = p_email
      LIMIT 1
    $fn$;

    DROP TABLE IF EXISTS consent_record;
    DROP TABLE IF EXISTS customer_profile;
    -- Con FORCE ROW LEVEL SECURITY ni el dueño ve filas sin tenant: se quita FORCE solo para borrar.
    ALTER TABLE membership NO FORCE ROW LEVEL SECURITY;
    DELETE FROM membership WHERE role_code = 'CLIENTE';
    ALTER TABLE membership FORCE ROW LEVEL SECURITY;
    ALTER TABLE membership DROP CONSTRAINT membership_role_code_check;
    ALTER TABLE membership ADD CONSTRAINT membership_role_code_check
      CHECK (role_code IN ('PROPIETARIO', 'BARBERO'));
  `,
    )
    .execute(db);
}
