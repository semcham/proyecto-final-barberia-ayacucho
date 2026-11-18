import { type Kysely, sql } from 'kysely';

// T048 de 007 · Vistas de solo conteo para los indicadores de la plataforma (fase 2c, US2; RF31; FR-012; data-model §2;
// enmienda 1.7.0 del principio III y revisión de ADR-031).
//
// - platform_appointment_counts (month, status, appointments): citas registradas por mes de Lima y estado, de los
//   últimos 12 meses. platform_membership_counts (kind, users): membresías activas por tipo (PERSONAL o CLIENTE).
//   Ya agregadas y SIN ninguna columna de barbería ni de persona: no se puede obtener una fila ni filtrar por barbería.
// - Su dueño es barberias_conteos (NOLOGIN NOBYPASSRLS NOINHERIT, creado en db/init/01-roles.sql), con SELECT solo
//   sobre las columnas que cuentan y una política FOR SELECT propia. Una vista corre con los permisos y las políticas
//   de su dueño: así lee todas las barberías sin omitir RLS y sin que el rol de la plataforma toque las tablas.
// - barberias_owner lo tiene concedido WITH INHERIT FALSE, SET TRUE: puede asignarle la propiedad, pero no hereda sus
//   políticas (sigue viendo solo la barbería de su transacción).
// - barberias_plataforma recibe SELECT SOLO sobre las dos vistas: ningún permiso sobre appointment, membership,
//   customer_profile ni user_account. barberias_app y barberias_publico no las leen.

export const VISTAS_DE_CONTEO = ['platform_appointment_counts', 'platform_membership_counts'] as const;

/** Columnas de cada vista (la prueba de permisos exactos las compara, T044). */
export const COLUMNAS_VISTAS_DE_CONTEO: Record<(typeof VISTAS_DE_CONTEO)[number], readonly string[]> = {
  platform_appointment_counts: ['month', 'status', 'appointments'],
  platform_membership_counts: ['kind', 'users'],
};

/** Las únicas columnas de tablas que puede leer barberias_conteos: las que cuentan. */
export const COLUMNAS_DE_CONTEO: Record<string, readonly string[]> = {
  appointment: ['created_at', 'status'],
  membership: ['role_code', 'status'],
};

export const ZONA_DE_LOS_INDICADORES = 'America/Lima';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. El rol se crea fuera de las migraciones (es global al clúster). Sin él, la migración falla con un mensaje claro y
  //    las réplicas no arrancan, como con cualquier migración fallida.
  await sql
    .raw(
      `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barberias_conteos') THEN
        RAISE EXCEPTION 'falta el rol barberias_conteos: ver README (paso manual de la funcionalidad 007)';
      END IF;
      IF NOT pg_has_role(current_user, 'barberias_conteos', 'SET') THEN
        RAISE EXCEPTION 'barberias_owner no puede asignar la propiedad a barberias_conteos: ver README (GRANT barberias_conteos TO barberias_owner WITH INHERIT FALSE, SET TRUE)';
      END IF;
    END
    $$;
  `,
    )
    .execute(db);

  await sql
    .raw(
      `
    -- 2. SELECT por columna y una política de lectura propia, solo para barberias_conteos.
    GRANT SELECT (${COLUMNAS_DE_CONTEO.appointment.join(', ')}) ON appointment TO barberias_conteos;
    GRANT SELECT (${COLUMNAS_DE_CONTEO.membership.join(', ')}) ON membership TO barberias_conteos;
    CREATE POLICY plataforma_conteo ON appointment FOR SELECT TO barberias_conteos USING (true);
    CREATE POLICY plataforma_conteo ON membership FOR SELECT TO barberias_conteos USING (true);

    -- 3. Las dos vistas, ya agregadas y sin tenant_id.
    CREATE VIEW platform_appointment_counts (month, status, appointments) AS
      SELECT (date_trunc('month', created_at AT TIME ZONE '${ZONA_DE_LOS_INDICADORES}'))::date,
             status,
             count(*)::int
        FROM appointment
       WHERE created_at >= (date_trunc('month', now() AT TIME ZONE '${ZONA_DE_LOS_INDICADORES}') - interval '11 months')
                           AT TIME ZONE '${ZONA_DE_LOS_INDICADORES}'
       GROUP BY 1, 2;

    CREATE VIEW platform_membership_counts (kind, users) AS
      SELECT CASE WHEN role_code = 'CLIENTE' THEN 'CLIENTE' ELSE 'PERSONAL' END,
             count(*)::int
        FROM membership
       WHERE status = 'ACTIVA'
       GROUP BY 1;

    -- 4. Solo el rol de la plataforma las lee. Se concede ANTES de cambiar el dueño: barberias_owner tiene el rol sin
    --    herencia, así que después del cambio ya no podría conceder nada sobre las vistas. Al cambiar de dueño,
    --    PostgreSQL conserva estos permisos.
    REVOKE ALL ON platform_appointment_counts, platform_membership_counts FROM PUBLIC;
    GRANT SELECT ON platform_appointment_counts, platform_membership_counts TO barberias_plataforma;

    -- 5. Su dueño es barberias_conteos. Para asignarlo, el nuevo dueño necesita CREATE sobre el esquema solo durante
    --    el cambio: se le concede y se le quita en la misma migración.
    GRANT CREATE ON SCHEMA public TO barberias_conteos;
    ALTER VIEW platform_appointment_counts OWNER TO barberias_conteos;
    ALTER VIEW platform_membership_counts OWNER TO barberias_conteos;
    REVOKE CREATE ON SCHEMA public FROM barberias_conteos;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DROP VIEW IF EXISTS platform_membership_counts;
    DROP VIEW IF EXISTS platform_appointment_counts;
    DROP POLICY IF EXISTS plataforma_conteo ON membership;
    DROP POLICY IF EXISTS plataforma_conteo ON appointment;
    REVOKE SELECT (${COLUMNAS_DE_CONTEO.membership.join(', ')}) ON membership FROM barberias_conteos;
    REVOKE SELECT (${COLUMNAS_DE_CONTEO.appointment.join(', ')}) ON appointment FROM barberias_conteos;
  `,
    )
    .execute(db);
}
