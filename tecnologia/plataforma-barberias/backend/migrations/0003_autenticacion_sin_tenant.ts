import { type Kysely, sql } from 'kysely';

// T013 · ADR-015 (estado: Propuesto, pendiente de aprobación del equipo).
// Tres funciones SECURITY DEFINER para las búsquedas que ocurren antes de conocer el tenant
// (inicio de sesión, renovación de sesión y activación de cuenta). Su dueño es barberias_auth
// (NOLOGIN BYPASSRLS): con FORCE ROW LEVEL SECURITY ni el dueño de las tablas omite RLS.
// Reglas: búsqueda por clave exacta, como máximo una fila, ningún parámetro de tenant.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    -- Para ALTER FUNCTION ... OWNER TO, el nuevo dueño necesita CREATE en el esquema.
    -- barberias_auth es NOLOGIN: solo se alcanza con SET ROLE desde barberias_owner.
    GRANT CREATE ON SCHEMA public TO barberias_auth;

    -- SELECT solo sobre las columnas que leen las funciones.
    GRANT SELECT (id, email, password_hash) ON user_account TO barberias_auth;
    GRANT SELECT (tenant_id, user_id, role_code, status) ON membership TO barberias_auth;
    GRANT SELECT (id, status) ON tenant TO barberias_auth;
    GRANT SELECT (id, tenant_id, user_id, status, refresh_token_hash, previous_token_hash) ON auth_session TO barberias_auth;
    GRANT SELECT (id, tenant_id, user_id, token_hash, expires_at, used_at, revoked_at) ON account_activation TO barberias_auth;

    CREATE FUNCTION auth_resolver_cuenta(p_email varchar)
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

    CREATE FUNCTION auth_buscar_sesion(p_token_hash char(64))
    RETURNS TABLE (
      session_id         uuid,
      tenant_id          uuid,
      user_id            uuid,
      status             varchar,
      es_token_anterior  boolean
    )
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
      SELECT s.id, s.tenant_id, s.user_id, s.status, s.refresh_token_hash <> p_token_hash
      FROM auth_session s
      WHERE s.refresh_token_hash = p_token_hash OR s.previous_token_hash = p_token_hash
      LIMIT 1
    $fn$;

    CREATE FUNCTION auth_buscar_activacion(p_token_hash char(64))
    RETURNS TABLE (
      activation_id  uuid,
      tenant_id      uuid,
      user_id        uuid,
      expires_at     timestamptz,
      used_at        timestamptz,
      revoked_at     timestamptz
    )
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
      SELECT a.id, a.tenant_id, a.user_id, a.expires_at, a.used_at, a.revoked_at
      FROM account_activation a
      WHERE a.token_hash = p_token_hash
      LIMIT 1
    $fn$;

    ALTER FUNCTION auth_resolver_cuenta(varchar) OWNER TO barberias_auth;
    ALTER FUNCTION auth_buscar_sesion(char) OWNER TO barberias_auth;
    ALTER FUNCTION auth_buscar_activacion(char) OWNER TO barberias_auth;

    REVOKE ALL ON FUNCTION auth_resolver_cuenta(varchar) FROM PUBLIC;
    REVOKE ALL ON FUNCTION auth_buscar_sesion(char) FROM PUBLIC;
    REVOKE ALL ON FUNCTION auth_buscar_activacion(char) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION auth_resolver_cuenta(varchar) TO barberias_app;
    GRANT EXECUTE ON FUNCTION auth_buscar_sesion(char) TO barberias_app;
    GRANT EXECUTE ON FUNCTION auth_buscar_activacion(char) TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DROP FUNCTION IF EXISTS auth_buscar_activacion(char);
    DROP FUNCTION IF EXISTS auth_buscar_sesion(char);
    DROP FUNCTION IF EXISTS auth_resolver_cuenta(varchar);
    REVOKE SELECT ON account_activation, auth_session, tenant, membership, user_account FROM barberias_auth;
    REVOKE CREATE ON SCHEMA public FROM barberias_auth;
  `,
    )
    .execute(db);
}
