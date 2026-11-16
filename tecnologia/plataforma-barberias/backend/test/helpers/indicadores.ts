import { v7 as uuidv7 } from 'uuid';
import type { AppDePrueba } from './app';
import { poolDe } from './test-db';

// 007 (fase 2b, US2): ayudas de las pruebas de los indicadores de la plataforma (GET /plataforma/indicadores).

export type EstadoSuscripcionSembrado =
  'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';

/** GET /api/v1/plataforma/indicadores con el token dado (o sin sesión). */
export function pedirIndicadores(prueba: AppDePrueba, token: string | null) {
  const solicitud = prueba.agente.get('/api/v1/plataforma/indicadores');
  return token ? solicitud.set('Authorization', `Bearer ${token}`) : solicitud;
}

/** Fija el estado de la suscripción y de la barbería sin pasar por los casos de uso (sembrado sin RLS). */
export async function fijarEstados(
  tenantId: string,
  suscripcion: EstadoSuscripcionSembrado,
  barberia: 'ACTIVA' | 'SUSPENDIDA' = 'ACTIVA',
): Promise<void> {
  const seed = poolDe('seed');
  await seed.query(
    `UPDATE subscription
        SET status = $2::text,
            grace_ends_at = CASE WHEN $2::text = 'PAST_DUE' THEN now() + interval '3 days' END,
            suspended_at = CASE WHEN $2::text = 'SUSPENDED' THEN now() END,
            suspension_reason = CASE WHEN $2::text = 'SUSPENDED' THEN 'Revisión de la cuenta' END
      WHERE tenant_id = $1`,
    [tenantId, suscripcion],
  );
  await seed.query('UPDATE tenant SET status = $2 WHERE id = $1', [tenantId, barberia]);
}

/**
 * Barberías de volumen sembradas en bloque (sin propietario ni datos de negocio): cada una con su suscripción de
 * prueba. Devuelve sus ids para borrarlas al terminar y no cambiar los conteos de otras pruebas.
 */
export async function sembrarBarberiasEnBloque(cantidad: number): Promise<string[]> {
  const ids = Array.from({ length: cantidad }, () => uuidv7());
  const seed = poolDe('seed');
  await seed.query(
    `INSERT INTO tenant (id, name, slug, status)
     SELECT id, 'Volumen ' || n, 'volumen-' || replace(id::text, '-', ''), 'ACTIVA'
       FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, n)`,
    [ids],
  );
  await seed.query(
    `INSERT INTO subscription (id, tenant_id, plan_id, status, started_at, trial_ends_at, current_period_end)
     SELECT gen_random_uuid(), t.id, p.id, 'TRIAL', now(), now() + interval '14 days', now() + interval '14 days'
       FROM unnest($1::uuid[]) AS t(id) CROSS JOIN plan p WHERE p.code = 'TRIAL'`,
    [ids],
  );
  return ids;
}

/** Borra las barberías sembradas en bloque (sin RLS). */
export async function borrarBarberiasEnBloque(ids: string[]): Promise<void> {
  const seed = poolDe('seed');
  await seed.query('DELETE FROM subscription WHERE tenant_id = ANY($1::uuid[])', [ids]);
  await seed.query('DELETE FROM tenant WHERE id = ANY($1::uuid[])', [ids]);
}

/** Filas `ADMIN_INDICADORES_CONSULTADOS` de un administrador en platform_audit_log (sin RLS). */
export async function consultasAuditadas(adminId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await poolDe('seed').query(
    `SELECT * FROM platform_audit_log WHERE admin_id = $1 AND action = 'ADMIN_INDICADORES_CONSULTADOS' ORDER BY at`,
    [adminId],
  );
  return rows;
}
