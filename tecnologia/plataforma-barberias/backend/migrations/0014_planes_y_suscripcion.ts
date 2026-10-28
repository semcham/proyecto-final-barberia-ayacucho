import { type Kysely, sql } from 'kysely';

// T017 · Funcionalidad 003: planes contratables y columnas nuevas de la suscripción (data-model.md §1.1,
// research R11 y R12).
//
// - plan: nombre, precio mensual en céntimos enteros (sin decimales), moneda PEN, activo y público. BASICO
//   (S/ 49,00; 3 usuarios y 3 barberos) y PRO (S/ 89,00; 8 y 8), con precios referenciales (HU18). TRIAL
//   sigue siendo el plan de la prueba: sin precio y no contratable.
// - subscription: fin de la gracia, suspensión con su motivo y fecha de actualización. current_period_end
//   pasa a ser una copia derivada de los períodos (M2): el fin del último período o, sin períodos, el fin de
//   la prueba. Las suscripciones existentes se completan aquí con el fin de su prueba.
// - barberias_app puede actualizar solo las columnas de estado y fechas (UPDATE (status) ya existe, 0007).

export const ID_PLAN_BASICO = '01923a00-0000-7000-8000-000000000002';
export const ID_PLAN_PRO = '01923a00-0000-7000-8000-000000000003';

const COLUMNAS_ACTUALIZABLES =
  'plan_id, current_period_end, grace_ends_at, suspended_at, suspension_reason, updated_at';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE plan
      ADD COLUMN name        varchar(40),
      ADD COLUMN price_cents int     CHECK (price_cents > 0),
      ADD COLUMN currency    char(3) NOT NULL DEFAULT 'PEN' CHECK (currency = 'PEN'),
      ADD COLUMN active      boolean NOT NULL DEFAULT true,
      ADD COLUMN public      boolean NOT NULL DEFAULT false;
    UPDATE plan SET name = 'Prueba gratuita' WHERE code = 'TRIAL';
    ALTER TABLE plan
      ALTER COLUMN name SET NOT NULL,
      ADD CONSTRAINT plan_nombre CHECK (char_length(btrim(name)) BETWEEN 2 AND 40),
      -- Solo se contrata un plan con precio; el de prueba no tiene precio ni se ofrece.
      ADD CONSTRAINT plan_contratable_con_precio CHECK (NOT public OR price_cents IS NOT NULL),
      ADD CONSTRAINT plan_prueba_no_contratable CHECK (trial_days IS NULL OR NOT public);

    INSERT INTO plan (id, code, name, trial_days, max_users, max_barbers, ai_enabled, price_cents, public)
    VALUES
      ('${ID_PLAN_BASICO}', 'BASICO', 'Básico', NULL, 3, 3, false, 4900, true),
      ('${ID_PLAN_PRO}',    'PRO',    'Pro',    NULL, 8, 8, false, 8900, true);

    ALTER TABLE subscription
      ADD COLUMN grace_ends_at     timestamptz,
      ADD COLUMN suspended_at      timestamptz,
      ADD COLUMN suspension_reason varchar(300),
      ADD COLUMN updated_at        timestamptz NOT NULL DEFAULT now(),
      ADD CONSTRAINT subscription_gracia_con_fecha
        CHECK (status <> 'PAST_DUE' OR grace_ends_at IS NOT NULL),
      ADD CONSTRAINT subscription_suspension_con_motivo
        CHECK ((status = 'SUSPENDED') = (suspended_at IS NOT NULL AND suspension_reason IS NOT NULL)),
      ADD CONSTRAINT subscription_motivo_suspension
        CHECK (suspension_reason IS NULL OR char_length(btrim(suspension_reason)) BETWEEN 5 AND 300);

    -- Copia derivada para las suscripciones existentes (todas en prueba: 001 y 002 no cobran). La tabla
    -- tiene RLS forzada también para su dueño, así que el relleno se hace con RLS sin forzar, dentro de
    -- la misma transacción de la migración.
    ALTER TABLE subscription NO FORCE ROW LEVEL SECURITY;
    UPDATE subscription SET current_period_end = trial_ends_at WHERE current_period_end IS NULL;
    ALTER TABLE subscription FORCE ROW LEVEL SECURITY;

    GRANT UPDATE (${COLUMNAS_ACTUALIZABLES}) ON subscription TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    REVOKE UPDATE (${COLUMNAS_ACTUALIZABLES}) ON subscription FROM barberias_app;
    ALTER TABLE subscription
      DROP CONSTRAINT IF EXISTS subscription_motivo_suspension,
      DROP CONSTRAINT IF EXISTS subscription_suspension_con_motivo,
      DROP CONSTRAINT IF EXISTS subscription_gracia_con_fecha,
      DROP COLUMN IF EXISTS updated_at,
      DROP COLUMN IF EXISTS suspension_reason,
      DROP COLUMN IF EXISTS suspended_at,
      DROP COLUMN IF EXISTS grace_ends_at;
    DELETE FROM plan WHERE id IN ('${ID_PLAN_BASICO}', '${ID_PLAN_PRO}');
    ALTER TABLE plan
      DROP CONSTRAINT IF EXISTS plan_prueba_no_contratable,
      DROP CONSTRAINT IF EXISTS plan_contratable_con_precio,
      DROP CONSTRAINT IF EXISTS plan_nombre,
      DROP COLUMN IF EXISTS public,
      DROP COLUMN IF EXISTS active,
      DROP COLUMN IF EXISTS currency,
      DROP COLUMN IF EXISTS price_cents,
      DROP COLUMN IF EXISTS name;
  `,
    )
    .execute(db);
}
