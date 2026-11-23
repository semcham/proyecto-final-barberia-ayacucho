import { type Kysely, sql } from 'kysely';
import { TIPOS_DE_AVISO } from './0024_avisos';
import { TIPOS_DE_AVISO_ADELANTO } from './0030_avisos_adelanto';
import { rlsPorTenant } from './sql-comun';

// T037 de 010 · Acceso verificado: enlaces de cuenta por correo (verificar el correo y recuperar la contraseña).
// data-model §1 a §5; research R01 a R04 y R08; constitución 1.8.0 (principio III, quinta excepción) y ADR-036.
//
// 1. user_account: estado de verificación. Las cuentas existentes quedan verificadas ('MIGRACION', FR-016); las nuevas
//    nacen sin verificar. barberias_app solo LEE las dos columnas: el INSERT de la tabla pasa a ser por columna (las
//    seis de siempre), para que la aplicación no pueda crear una cuenta ya verificada.
// 2. account_link: el enlace, por barbería, con RLS forzada. Nace sin token; se guarda solo el SHA-256 del token.
// 3. account_link_attempt: tabla técnica de intentos SIN barbería (como login_attempt y action_link_attempt): el origen
//    solo como HMAC con INTENTOS_SAL_IP, nunca la IP.
// 4. Cuatro funciones SECURITY DEFINER de barberias_auth (el rol de ADR-015; NO se crea ningún rol): solo las ejecuta
//    barberias_app.
// 5. notification: tres tipos de aviso y el destinatario CUENTA.
//
// Ninguna política RLS existente cambia (FR-033): solo se agregan las de la tabla nueva.

export const TIPOS_DE_AVISO_CUENTA = [
  'VERIFICAR_CORREO',
  'RECUPERAR_CONTRASENA',
  'CONTRASENA_CAMBIADA',
] as const;
const DESTINATARIOS_ANTERIORES = ['CLIENTE', 'PROPIETARIO', 'BARBERO'] as const;

/** Columnas de user_account que barberias_app puede insertar: las de 0001 (sin las de verificación). */
export const INSERT_APP_USER_ACCOUNT = [
  'id',
  'email',
  'full_name',
  'password_hash',
  'is_platform_admin',
  'created_at',
] as const;

/** Columnas de account_link que barberias_app puede insertar: el enlace nace sin token, sin uso y sin anular. */
export const INSERT_APP_ACCOUNT_LINK = [
  'id',
  'tenant_id',
  'user_id',
  'purpose',
  'requested_at',
  'expires_at',
] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    -- 1. Estado de verificación del correo.
    ALTER TABLE user_account
      ADD COLUMN email_verified_at  timestamptz,
      ADD COLUMN email_verified_via varchar(10)
        CHECK (email_verified_via IS NULL OR email_verified_via IN ('ENLACE', 'ACTIVACION', 'MIGRACION')),
      ADD CONSTRAINT user_account_verificacion_coherente
        CHECK ((email_verified_at IS NULL) = (email_verified_via IS NULL));

    -- Con FORCE ROW LEVEL SECURITY ni el dueño ve las cuentas sin tenant: se quita FORCE solo para esta actualización
    -- (mismo patrón que 0009). La política no cambia.
    ALTER TABLE user_account NO FORCE ROW LEVEL SECURITY;
    UPDATE user_account SET email_verified_at = now(), email_verified_via = 'MIGRACION';
    ALTER TABLE user_account FORCE ROW LEVEL SECURITY;

    GRANT SELECT (email_verified_at, email_verified_via) ON user_account TO barberias_app;
    REVOKE INSERT ON user_account FROM barberias_app;
    GRANT INSERT (${INSERT_APP_USER_ACCOUNT.join(', ')}) ON user_account TO barberias_app;

    -- 2. Enlaces de cuenta (por barbería).
    CREATE TABLE account_link (
      id            uuid PRIMARY KEY,
      tenant_id     uuid         NOT NULL REFERENCES tenant (id),
      user_id       uuid         NOT NULL,
      purpose       varchar(20)  NOT NULL CHECK (purpose IN ('VERIFICAR_CORREO', 'RECUPERAR_CONTRASENA')),
      token_hash    char(64)     UNIQUE CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
      requested_at  timestamptz  NOT NULL,
      expires_at    timestamptz  NOT NULL,
      used_at       timestamptz,
      revoked_at    timestamptz,
      FOREIGN KEY (tenant_id, user_id) REFERENCES membership (tenant_id, user_id),
      UNIQUE (tenant_id, id),
      CHECK (expires_at > requested_at),
      CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL))
    );
    -- Un solo enlace sin usar ni anular por cuenta, propósito y barbería. Con RLS, la aplicación solo ve (y anula) los
    -- de su barbería; al USAR uno, las funciones de sistema anulan los demás del mismo propósito en todas.
    CREATE UNIQUE INDEX account_link_uno_vigente ON account_link (tenant_id, user_id, purpose)
      WHERE used_at IS NULL AND revoked_at IS NULL;
    CREATE INDEX account_link_de_la_cuenta ON account_link (user_id, purpose);
    -- Retención: los terminados hace más de 30 días.
    CREATE INDEX account_link_terminados ON account_link (tenant_id, expires_at);

    ${rlsPorTenant('account_link')}

    -- DELETE para la retención de 30 días (tarea purgar-enlaces-de-cuenta, con RLS, barbería por barbería). used_at
    -- nunca: solo lo marcan las funciones de sistema.
    GRANT SELECT, DELETE ON account_link TO barberias_app;
    GRANT INSERT (${INSERT_APP_ACCOUNT_LINK.join(', ')}) ON account_link TO barberias_app;
    GRANT UPDATE (token_hash, revoked_at) ON account_link TO barberias_app;

    -- 3. Intentos (tabla técnica sin barbería).
    CREATE TABLE account_link_attempt (
      id            bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      kind          varchar(12)  NOT NULL CHECK (kind IN ('REENVIO', 'RECUPERACION', 'USO_FALLIDO')),
      subject_hash  char(64)     CHECK (subject_hash IS NULL OR subject_hash ~ '^[0-9a-f]{64}$'),
      origin_hash   char(64)     NOT NULL CHECK (origin_hash ~ '^[0-9a-f]{64}$'),
      at            timestamptz  NOT NULL,
      CHECK ((kind = 'USO_FALLIDO') = (subject_hash IS NULL))
    );
    CREATE INDEX account_link_attempt_sujeto ON account_link_attempt (kind, subject_hash, at);
    CREATE INDEX account_link_attempt_origen ON account_link_attempt (kind, origin_hash, at);
    CREATE INDEX account_link_attempt_fecha ON account_link_attempt (at);

    GRANT SELECT, INSERT, DELETE ON account_link_attempt TO barberias_app;

    -- 4. Funciones de sistema (dueño barberias_auth, ADR-015 revisado por ADR-036). Solo los permisos por columna que
    --    necesitan.
    GRANT SELECT (email_verified_at) ON user_account TO barberias_auth;
    GRANT UPDATE (password_hash, email_verified_at, email_verified_via) ON user_account TO barberias_auth;
    GRANT SELECT (created_at) ON membership TO barberias_auth;
    GRANT SELECT (id, tenant_id, user_id, purpose, token_hash, expires_at, used_at, revoked_at)
      ON account_link TO barberias_auth;
    GRANT UPDATE (used_at, revoked_at) ON account_link TO barberias_auth;
    GRANT UPDATE (status, ended_at) ON auth_session TO barberias_auth;

    -- Barbería del aviso de una cuenta (R03): la preferida si la cuenta tiene una membresía activa allí; si no, la del
    -- personal; si no, la membresía de cliente más reciente. Solo membresías ACTIVAS: un usuario del personal pendiente o
    -- desactivado no recibe enlaces.
    CREATE FUNCTION auth_barberia_para_enlace(p_user_id uuid, p_tenant_preferido uuid)
    RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
      SELECT m.tenant_id
      FROM membership m
      WHERE m.user_id = p_user_id AND m.status = 'ACTIVA'
      ORDER BY (m.tenant_id = p_tenant_preferido) DESC NULLS LAST,
               (m.role_code IN ('PROPIETARIO', 'BARBERO')) DESC,
               m.created_at DESC
      LIMIT 1
    $fn$;

    -- Usar un enlace de verificación. Ninguna fila si ningún enlace de VERIFICAR_CORREO tiene ese hash (R15);
    -- RECHAZADO si existe pero ya no sirve (usado, anulado o vencido); APLICADO si se usó ahora.
    CREATE FUNCTION auth_verificar_correo(p_token_hash char(64))
    RETURNS TABLE (resultado varchar, tenant_id uuid, user_id uuid)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
    #variable_conflict use_column
    DECLARE
      v_id uuid; v_tenant uuid; v_user uuid; v_vence timestamptz; v_usado timestamptz; v_anulado timestamptz;
    BEGIN
      SELECT l.id, l.tenant_id, l.user_id, l.expires_at, l.used_at, l.revoked_at
        INTO v_id, v_tenant, v_user, v_vence, v_usado, v_anulado
        FROM account_link l
       WHERE l.token_hash = p_token_hash AND l.purpose = 'VERIFICAR_CORREO'
       FOR UPDATE;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      IF v_usado IS NOT NULL OR v_anulado IS NOT NULL OR v_vence <= now() THEN
        RETURN QUERY SELECT 'RECHAZADO'::varchar, v_tenant, v_user;
        RETURN;
      END IF;
      UPDATE account_link SET used_at = now() WHERE id = v_id;
      UPDATE account_link SET revoked_at = now()
       WHERE user_id = v_user AND purpose = 'VERIFICAR_CORREO' AND id <> v_id
         AND used_at IS NULL AND revoked_at IS NULL;
      UPDATE user_account SET email_verified_at = now(), email_verified_via = 'ENLACE'
       WHERE id = v_user AND email_verified_at IS NULL;
      RETURN QUERY SELECT 'APLICADO'::varchar, v_tenant, v_user;
    END
    $fn$;

    -- Usar un enlace de recuperación: cambia la contraseña (ya hasheada con argon2id por la aplicación), verifica el
    -- correo si no lo estaba, anula los demás enlaces de recuperación de la cuenta y revoca TODAS sus sesiones activas,
    -- en todas sus barberías. Mismos resultados que auth_verificar_correo.
    CREATE FUNCTION auth_restablecer_contrasena(p_token_hash char(64), p_hash_nuevo varchar)
    RETURNS TABLE (resultado varchar, tenant_id uuid, user_id uuid)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
    #variable_conflict use_column
    DECLARE
      v_id uuid; v_tenant uuid; v_user uuid; v_vence timestamptz; v_usado timestamptz; v_anulado timestamptz;
    BEGIN
      IF p_hash_nuevo IS NULL OR p_hash_nuevo NOT LIKE '$argon2id$%' THEN
        RAISE EXCEPTION 'auth_restablecer_contrasena: el hash nuevo no es argon2id';
      END IF;
      SELECT l.id, l.tenant_id, l.user_id, l.expires_at, l.used_at, l.revoked_at
        INTO v_id, v_tenant, v_user, v_vence, v_usado, v_anulado
        FROM account_link l
       WHERE l.token_hash = p_token_hash AND l.purpose = 'RECUPERAR_CONTRASENA'
       FOR UPDATE;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      IF v_usado IS NOT NULL OR v_anulado IS NOT NULL OR v_vence <= now() THEN
        RETURN QUERY SELECT 'RECHAZADO'::varchar, v_tenant, v_user;
        RETURN;
      END IF;
      UPDATE account_link SET used_at = now() WHERE id = v_id;
      UPDATE account_link SET revoked_at = now()
       WHERE user_id = v_user AND purpose = 'RECUPERAR_CONTRASENA' AND id <> v_id
         AND used_at IS NULL AND revoked_at IS NULL;
      UPDATE user_account SET password_hash = p_hash_nuevo WHERE id = v_user;
      UPDATE user_account SET email_verified_at = now(), email_verified_via = 'ENLACE'
       WHERE id = v_user AND email_verified_at IS NULL;
      UPDATE auth_session SET status = 'REVOCADA', ended_at = now()
       WHERE user_id = v_user AND status = 'ACTIVA';
      RETURN QUERY SELECT 'APLICADO'::varchar, v_tenant, v_user;
    END
    $fn$;

    -- La activación del personal (en su transacción) marca la cuenta como verificada. Solo si esa cuenta tiene una
    -- activación YA USADA: la aplicación no puede verificar otras cuentas con esta función.
    CREATE FUNCTION auth_marcar_verificada_por_activacion(p_user_id uuid)
    RETURNS void
    LANGUAGE sql VOLATILE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
      UPDATE user_account SET email_verified_at = now(), email_verified_via = 'ACTIVACION'
       WHERE id = p_user_id AND email_verified_at IS NULL
         AND EXISTS (SELECT 1 FROM account_activation a WHERE a.user_id = p_user_id AND a.used_at IS NOT NULL)
    $fn$;

    ALTER FUNCTION auth_barberia_para_enlace(uuid, uuid) OWNER TO barberias_auth;
    ALTER FUNCTION auth_verificar_correo(char) OWNER TO barberias_auth;
    ALTER FUNCTION auth_restablecer_contrasena(char, varchar) OWNER TO barberias_auth;
    ALTER FUNCTION auth_marcar_verificada_por_activacion(uuid) OWNER TO barberias_auth;

    REVOKE ALL ON FUNCTION auth_barberia_para_enlace(uuid, uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION auth_verificar_correo(char) FROM PUBLIC;
    REVOKE ALL ON FUNCTION auth_restablecer_contrasena(char, varchar) FROM PUBLIC;
    REVOKE ALL ON FUNCTION auth_marcar_verificada_por_activacion(uuid) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION auth_barberia_para_enlace(uuid, uuid) TO barberias_app;
    GRANT EXECUTE ON FUNCTION auth_verificar_correo(char) TO barberias_app;
    GRANT EXECUTE ON FUNCTION auth_restablecer_contrasena(char, varchar) TO barberias_app;
    GRANT EXECUTE ON FUNCTION auth_marcar_verificada_por_activacion(uuid) TO barberias_app;

    -- 5. Avisos de la cuenta.
    ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
    ALTER TABLE notification ADD CONSTRAINT notification_kind_check
      CHECK (kind IN (${lista([...TIPOS_DE_AVISO, ...TIPOS_DE_AVISO_ADELANTO, ...TIPOS_DE_AVISO_CUENTA])}));
    ALTER TABLE notification DROP CONSTRAINT notification_recipient_kind_check;
    ALTER TABLE notification ADD CONSTRAINT notification_recipient_kind_check
      CHECK (recipient_kind IN (${lista([...DESTINATARIOS_ANTERIORES, 'CUENTA'])}));
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    -- Los avisos de la cuenta no tienen lugar en el esquema anterior.
    ALTER TABLE notification NO FORCE ROW LEVEL SECURITY;
    DELETE FROM notification WHERE recipient_kind = 'CUENTA' OR kind IN (${lista(TIPOS_DE_AVISO_CUENTA)});
    ALTER TABLE notification FORCE ROW LEVEL SECURITY;
    ALTER TABLE notification DROP CONSTRAINT notification_recipient_kind_check;
    ALTER TABLE notification ADD CONSTRAINT notification_recipient_kind_check
      CHECK (recipient_kind IN (${lista(DESTINATARIOS_ANTERIORES)}));
    ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
    ALTER TABLE notification ADD CONSTRAINT notification_kind_check
      CHECK (kind IN (${lista([...TIPOS_DE_AVISO, ...TIPOS_DE_AVISO_ADELANTO])}));

    DROP FUNCTION IF EXISTS auth_marcar_verificada_por_activacion(uuid);
    DROP FUNCTION IF EXISTS auth_restablecer_contrasena(char, varchar);
    DROP FUNCTION IF EXISTS auth_verificar_correo(char);
    DROP FUNCTION IF EXISTS auth_barberia_para_enlace(uuid, uuid);

    REVOKE UPDATE (status, ended_at) ON auth_session FROM barberias_auth;
    REVOKE SELECT (created_at) ON membership FROM barberias_auth;
    REVOKE UPDATE (password_hash, email_verified_at, email_verified_via) ON user_account FROM barberias_auth;

    DROP TABLE IF EXISTS account_link_attempt;
    DROP TABLE IF EXISTS account_link;

    REVOKE INSERT (${INSERT_APP_USER_ACCOUNT.join(', ')}) ON user_account FROM barberias_app;
    GRANT INSERT ON user_account TO barberias_app;
    ALTER TABLE user_account DROP CONSTRAINT user_account_verificacion_coherente;
    ALTER TABLE user_account DROP COLUMN email_verified_via, DROP COLUMN email_verified_at;
  `,
    )
    .execute(db);
}
