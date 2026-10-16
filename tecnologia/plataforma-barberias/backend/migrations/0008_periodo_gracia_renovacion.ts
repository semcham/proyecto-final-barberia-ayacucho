import { type Kysely, sql } from 'kysely';

// Período de gracia en la rotación del token de renovación (FR-008a, research R23, ADR-019).
//
// - rotated_at: cuándo el token vigente reemplazó al anterior (inicio de la ventana de gracia).
// - grace_used_at: cuándo se aceptó el token anterior dentro de la ventana (un solo uso).
// - superseded_token_hash: token vigente que el uso de la gracia dejó sin efecto; presentarlo revoca
//   la sesión (posible robo dentro de la ventana).
//
// Toca la superficie de ADR-015: auth_buscar_sesion también busca por superseded_token_hash y
// barberias_auth gana SELECT solo sobre esa columna. La función conserva su firma (un parámetro, sin
// tenant) y sigue devolviendo como máximo una fila. Revisión obligatoria según ADR-015.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE auth_session
      ADD COLUMN rotated_at            timestamptz,
      ADD COLUMN grace_used_at         timestamptz,
      ADD COLUMN superseded_token_hash char(64);

    CREATE UNIQUE INDEX auth_session_token_reemplazado
      ON auth_session (superseded_token_hash) WHERE superseded_token_hash IS NOT NULL;

    GRANT SELECT (superseded_token_hash) ON auth_session TO barberias_auth;

    CREATE OR REPLACE FUNCTION auth_buscar_sesion(p_token_hash char(64))
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
      WHERE s.refresh_token_hash = p_token_hash
         OR s.previous_token_hash = p_token_hash
         OR s.superseded_token_hash = p_token_hash
      LIMIT 1
    $fn$;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE OR REPLACE FUNCTION auth_buscar_sesion(p_token_hash char(64))
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

    REVOKE SELECT (superseded_token_hash) ON auth_session FROM barberias_auth;
    DROP INDEX IF EXISTS auth_session_token_reemplazado;
    ALTER TABLE auth_session
      DROP COLUMN IF EXISTS superseded_token_hash,
      DROP COLUMN IF EXISTS grace_used_at,
      DROP COLUMN IF EXISTS rotated_at;
  `,
    )
    .execute(db);
}
