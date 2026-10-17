import { type Kysely, sql } from 'kysely';

// T009 · Lecturas públicas por enlace (ADR-021, decisión 2, con la precisión del 2026-10-17).
//
// barberias_publico (LOGIN NOBYPASSRLS, creado en db/init/01-roles.sql) recibe SELECT solo sobre las
// columnas públicas de esta lista cerrada. Las filas las sigue filtrando RLS con el tenant que fija
// LecturaPublica (transacción READ ONLY). Sin permisos sobre tenant: el slug lo resuelve M01.
// Cualquier columna nueva pública exige su GRANT aquí o en una migración posterior, y la prueba de PR09
// (lectura-publica.spec.ts) compara estos permisos con la lista exacta.

export const COLUMNAS_PUBLICAS: Record<string, readonly string[]> = {
  business_hours: ['tenant_id', 'weekday', 'start_time', 'end_time'],
  service: ['tenant_id', 'id', 'name', 'description', 'price', 'duration_min', 'active'],
  barber: ['tenant_id', 'id', 'display_name', 'active'],
  barber_service: ['tenant_id', 'barber_id', 'service_id'],
  working_hours: ['tenant_id', 'barber_id', 'weekday', 'start_time', 'end_time'],
  time_off: ['tenant_id', 'barber_id', 'starts_at', 'ends_at'],
  appointment: ['tenant_id', 'barber_id', 'starts_at', 'ends_at', 'status'],
};

function sentencias(verbo: 'GRANT' | 'REVOKE'): string {
  const hacia = verbo === 'GRANT' ? 'TO' : 'FROM';
  return Object.entries(COLUMNAS_PUBLICAS)
    .map(
      ([tabla, columnas]) =>
        `${verbo} SELECT (${columnas.join(', ')}) ON ${tabla} ${hacia} barberias_publico;`,
    )
    .join('\n');
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(sentencias('GRANT')).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(sentencias('REVOKE')).execute(db);
}
