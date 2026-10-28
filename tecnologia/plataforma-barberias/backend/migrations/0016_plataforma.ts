import { type Kysely, sql } from 'kysely';

// T019 · Funcionalidad 003: operaciones de la plataforma (ADR-031; constitución 1.3.1; data-model.md §1.3
// y §4).
//
// barberias_plataforma (LOGIN NOBYPASSRLS NOINHERIT, creado en db/init/01-roles.sql):
// - SOLO SELECT, por columna y sobre la lista cerrada de COLUMNAS_PLATAFORMA. Ningún INSERT, UPDATE ni
//   DELETE en ninguna tabla. La prueba de PR09 (lectura-plataforma.spec.ts) compara estos permisos con la
//   lista exacta.
// - Lee entre barberías solo por las políticas FOR SELECT TO barberias_plataforma USING (true): la política
//   tenant_isolation sigue intacta para los demás roles.
// - Nunca ve el número de operación completo (solo sus últimos 4 caracteres y su hash, H2), ni el contenido
//   de los comprobantes, ni citas, clientes, catálogo, usuarios o sesiones de barbería.
//
// Tablas de la plataforma (sin barbería ni datos de negocio, constitución 1.3.1): platform_admin,
// platform_session, platform_challenge y platform_audit_log. El rol de la aplicación escribe sesiones,
// desafíos y la auditoría del acceso, y NO tiene ningún permiso sobre platform_admin (C3): los secretos del
// administrador solo los lee barberias_plataforma.
//
// Además, barberias_app puede actualizar tenant.status (suspender y reactivar, FR-034, H5); la política
// tenant_edicion lo limita a la barbería de la transacción.

/** SELECT por columna de barberias_plataforma, tabla por tabla (lista cerrada; 0017 agrega la suya). */
export const COLUMNAS_PLATAFORMA: Record<string, readonly string[]> = {
  tenant: ['id', 'name', 'slug', 'status'],
  plan: [
    'id',
    'code',
    'name',
    'trial_days',
    'max_users',
    'max_barbers',
    'ai_enabled',
    'price_cents',
    'currency',
    'active',
    'public',
  ],
  subscription: [
    'id',
    'tenant_id',
    'plan_id',
    'status',
    'started_at',
    'trial_ends_at',
    'current_period_end',
    'grace_ends_at',
    'suspended_at',
    'suspension_reason',
    'updated_at',
  ],
  subscription_period: [
    'id',
    'tenant_id',
    'subscription_id',
    'payment_id',
    'plan_id',
    'starts_at',
    'ends_at',
    'created_at',
  ],
  // Todas las columnas salvo bank_operation_number (H2).
  payment: [
    'id',
    'tenant_id',
    'subscription_id',
    'plan_id',
    'amount_cents',
    'currency',
    'method',
    'status',
    'covers_after',
    'review',
    'review_resolved_at',
    'review_note',
    'provider_reference',
    'checkout_url_expires_at',
    'transfer_reference',
    'bank_operation_last4',
    'bank_operation_hash',
    'transfer_date',
    'rejection_reason',
    'manual_reason',
    'manual_external_ref',
    'created_by',
    'created_at',
    'approved_at',
    'closed_at',
  ],
  // Metadatos del comprobante; nunca payment_receipt_file (contenido).
  payment_receipt: [
    'id',
    'tenant_id',
    'payment_id',
    'content_type',
    'size_bytes',
    'sha256',
    'uploaded_by',
    'uploaded_at',
    'reviewed_by',
    'reviewed_at',
    'review_result',
    'review_reason',
  ],
  provider_event: [
    'event_id',
    'received_at',
    'provider_reference',
    'reported_status',
    'amount_cents',
    'currency',
    'tenant_id',
    'payment_id',
    'effect',
  ],
  platform_admin: [
    'id',
    'email',
    'full_name',
    'password_hash',
    'totp_secret_enc',
    'recovery_codes_hash',
    'status',
    'created_at',
  ],
  platform_session: [
    'id',
    'admin_id',
    'refresh_token_hash',
    'previous_token_hash',
    'status',
    'totp_step',
    'created_at',
    'expires_at',
    'last_used_at',
    'ended_at',
  ],
  platform_challenge: ['id', 'admin_id', 'created_at', 'expires_at', 'used_at', 'used_recovery_index'],
  platform_audit_log: ['id', 'admin_id', 'action', 'result', 'ip', 'at'],
};

/** Tablas de barbería (con RLS) que barberias_plataforma lee entre barberías. */
const TABLAS_CON_RLS_LEIDAS = ['subscription', 'subscription_period', 'payment', 'payment_receipt'];

/**
 * Permisos de barberias_app sobre las tablas de la plataforma (constitución 1.3.1). `tabla`: privilegios de
 * tabla completa; `columnas`: UPDATE por columna. Lo que no aparece aquí no se concede (platform_admin,
 * ninguno). provider_event: solo INSERT, en 0015.
 */
export const PERMISOS_APP_PLATAFORMA: Record<
  string,
  { tabla: readonly string[]; update: readonly string[] }
> = {
  platform_session: {
    tabla: ['SELECT', 'INSERT'],
    update: ['refresh_token_hash', 'previous_token_hash', 'status', 'last_used_at', 'ended_at'],
  },
  platform_challenge: { tabla: ['SELECT', 'INSERT'], update: ['used_at', 'used_recovery_index'] },
  platform_audit_log: { tabla: ['INSERT'], update: [] },
};

export const ACCIONES_ACCESO_ADMIN = [
  'ADMIN_INGRESO',
  'ADMIN_INGRESO_FALLIDO',
  'ADMIN_SEGUNDO_FACTOR_FALLIDO',
  'ADMIN_CODIGO_RECUPERACION_USADO',
  'ADMIN_SALIDA',
] as const;

function permisosPlataforma(verbo: 'GRANT' | 'REVOKE'): string {
  const hacia = verbo === 'GRANT' ? 'TO' : 'FROM';
  return Object.entries(COLUMNAS_PLATAFORMA)
    .map(
      ([tabla, columnas]) =>
        `${verbo} SELECT (${columnas.join(', ')}) ON ${tabla} ${hacia} barberias_plataforma;`,
    )
    .join('\n');
}

function permisosApp(verbo: 'GRANT' | 'REVOKE'): string {
  const hacia = verbo === 'GRANT' ? 'TO' : 'FROM';
  return Object.entries(PERMISOS_APP_PLATAFORMA)
    .flatMap(([tabla, { tabla: privilegios, update }]) => [
      `${verbo} ${privilegios.join(', ')} ON ${tabla} ${hacia} barberias_app;`,
      ...(update.length > 0
        ? [`${verbo} UPDATE (${update.join(', ')}) ON ${tabla} ${hacia} barberias_app;`]
        : []),
    ])
    .join('\n');
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE platform_admin (
      id                   uuid PRIMARY KEY,
      email                varchar(254) NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
      full_name            varchar(120) NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
      password_hash        varchar(255) NOT NULL,
      totp_secret_enc      bytea        NOT NULL,
      recovery_codes_hash  text[]       NOT NULL CHECK (cardinality(recovery_codes_hash) = 10),
      status               varchar(12)  NOT NULL DEFAULT 'ACTIVA' CHECK (status IN ('ACTIVA', 'DESACTIVADA')),
      created_at           timestamptz  NOT NULL DEFAULT now()
    );

    CREATE TABLE platform_session (
      id                   uuid PRIMARY KEY,
      admin_id             uuid        NOT NULL REFERENCES platform_admin (id),
      refresh_token_hash   char(64)    NOT NULL UNIQUE,
      previous_token_hash  char(64)    UNIQUE,
      status               varchar(12) NOT NULL CHECK (status IN ('ACTIVA', 'CERRADA', 'REVOCADA')),
      -- Paso TOTP con el que se abrió (NULL si se entró con un código de recuperación). El índice único
      -- impide que dos ingresos simultáneos con el mismo código abran dos sesiones (R07).
      totp_step            bigint      CHECK (totp_step > 0),
      created_at           timestamptz NOT NULL DEFAULT now(),
      expires_at           timestamptz NOT NULL,
      last_used_at         timestamptz NOT NULL DEFAULT now(),
      ended_at             timestamptz,
      CONSTRAINT platform_session_un_ingreso_por_codigo UNIQUE (admin_id, totp_step),
      CONSTRAINT platform_session_vida_maxima CHECK (expires_at <= created_at + interval '8 hours'),
      CONSTRAINT platform_session_fin CHECK ((status = 'ACTIVA') = (ended_at IS NULL))
    );
    CREATE INDEX platform_session_ultimo_paso ON platform_session (admin_id, totp_step DESC);

    CREATE TABLE platform_challenge (
      id                   uuid PRIMARY KEY,
      admin_id             uuid        NOT NULL REFERENCES platform_admin (id),
      created_at           timestamptz NOT NULL DEFAULT now(),
      expires_at           timestamptz NOT NULL,
      used_at              timestamptz,
      used_recovery_index  smallint    CHECK (used_recovery_index BETWEEN 0 AND 9),
      -- Cada código de recuperación sirve una sola vez, garantizado en la base (R07).
      CONSTRAINT platform_challenge_codigo_un_uso UNIQUE (admin_id, used_recovery_index),
      CONSTRAINT platform_challenge_vida CHECK (expires_at <= created_at + interval '5 minutes'),
      CONSTRAINT platform_challenge_codigo_usado CHECK (used_recovery_index IS NULL OR used_at IS NOT NULL)
    );

    CREATE TABLE platform_audit_log (
      id        uuid PRIMARY KEY,
      admin_id  uuid        REFERENCES platform_admin (id),
      action    varchar(40) NOT NULL CHECK (action IN (${ACCIONES_ACCESO_ADMIN.map((a) => `'${a}'`).join(', ')})),
      result    varchar(12) NOT NULL CHECK (result IN ('PERMITIDO', 'DENEGADO')),
      ip        inet,
      at        timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX platform_audit_log_at ON platform_audit_log (at);

    ${TABLAS_CON_RLS_LEIDAS.map(
      (tabla) =>
        `CREATE POLICY plataforma_lectura ON ${tabla} FOR SELECT TO barberias_plataforma USING (true);`,
    ).join('\n')}

    ${permisosPlataforma('GRANT')}
    ${permisosApp('GRANT')}

    -- Suspender y reactivar una barbería (FR-034, H5): solo la de la transacción (política tenant_edicion).
    GRANT UPDATE (status) ON tenant TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    REVOKE UPDATE (status) ON tenant FROM barberias_app;
    ${permisosApp('REVOKE')}
    ${permisosPlataforma('REVOKE')}
    ${TABLAS_CON_RLS_LEIDAS.map((tabla) => `DROP POLICY IF EXISTS plataforma_lectura ON ${tabla};`).join('\n')}
    DROP TABLE IF EXISTS platform_audit_log;
    DROP TABLE IF EXISTS platform_challenge;
    DROP TABLE IF EXISTS platform_session;
    DROP TABLE IF EXISTS platform_admin;
  `,
    )
    .execute(db);
}
