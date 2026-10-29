/**
 * T100 (003, ADR-024) · Demostración del vencimiento con las dos réplicas de Docker Compose (quickstart.md §4).
 * Fuera de CI y sin dependencias nuevas:
 *
 * - `npm run demo:vencimiento -- --barberias 50`: siembra 50 barberías de demostración, cada una con su
 *   suscripción de prueba vencida hace una hora (en TRIAL: la tarea `vencer-suscripciones` debe pasarlas a
 *   EXPIRED una sola vez, aunque corra en las dos réplicas).
 * - `npm run demo:vencimiento -- --verificar`: cuenta cuántas quedaron EXPIRED y cuántas tienen exactamente
 *   UN registro SUSCRIPCION_VENCIDA en la auditoría, y muestra las últimas corridas de la tarea.
 * - `npm run demo:vencimiento -- --limpiar`: borra lo sembrado (barberías, suscripciones y su auditoría).
 *
 * Usa el superusuario de desarrollo (`MEDIR_DB_SUPERUSUARIO`, como `medir-horarios.ts`): las barberías de
 * demostración no tienen propietario ni datos personales, y se reconocen por el prefijo de su enlace.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';

const PREFIJO = 'demo-vencimiento-';
const MAXIMO = 500;

const { values: opciones } = parseArgs({
  options: {
    barberias: { type: 'string', default: '50' },
    limpiar: { type: 'boolean', default: false },
    verificar: { type: 'boolean', default: false },
  },
});

const DB = process.env.MEDIR_DB_SUPERUSUARIO ?? 'postgres://postgres:postgres_dev@localhost:5433/barberias';

async function sembrar(pool: Pool, cantidad: number): Promise<void> {
  const lote = randomBytes(3).toString('hex');
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    for (let i = 1; i <= cantidad; i += 1) {
      const tenantId = uuidv7();
      await cliente.query(`INSERT INTO tenant (id, name, slug, status) VALUES ($1, $2, $3, 'ACTIVA')`, [
        tenantId,
        `Demo vencimiento ${lote} ${String(i).padStart(3, '0')}`,
        `${PREFIJO}${lote}-${i}`,
      ]);
      // Como tras un registro real: prueba gratuita, que terminó hace una hora sin que la tarea pasara.
      await cliente.query(
        `INSERT INTO subscription (id, tenant_id, plan_id, status, started_at, trial_ends_at, current_period_end)
         SELECT $1, $2, p.id, 'TRIAL', now() - interval '14 days 1 hour', now() - interval '1 hour',
                now() - interval '1 hour'
           FROM plan p WHERE p.code = 'TRIAL'`,
        [uuidv7(), tenantId],
      );
    }
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
  console.log(`Sembradas ${cantidad} barberías (lote ${lote}) con la prueba vencida hace una hora.`);
  console.log(
    'Espera dos ciclos de la tarea (TAREAS_INTERVALO_MS) y ejecuta: npm run demo:vencimiento -- --verificar',
  );
}

async function verificar(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ estado: string; barberias: number; con_un_registro: number }>(
    `SELECT s.status AS estado, count(*)::int AS barberias,
            count(*) FILTER (WHERE (SELECT count(*) FROM audit_log a
                                     WHERE a.tenant_id = s.tenant_id AND a.action = 'SUSCRIPCION_VENCIDA') = 1)::int
              AS con_un_registro
       FROM subscription s JOIN tenant t ON t.id = s.tenant_id
      WHERE t.slug LIKE $1
      GROUP BY s.status ORDER BY s.status`,
    [`${PREFIJO}%`],
  );
  console.table(rows);
  const corridas = await pool.query(
    `SELECT job, replica, processed, failed, started_at FROM scheduled_job_run
      WHERE job = 'vencer-suscripciones' ORDER BY started_at DESC LIMIT 6`,
  );
  console.table(corridas.rows);
}

async function limpiar(pool: Pool): Promise<void> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const ids = `SELECT id FROM tenant WHERE slug LIKE $1`;
    await cliente.query(`DELETE FROM audit_log WHERE tenant_id IN (${ids})`, [`${PREFIJO}%`]);
    await cliente.query(`DELETE FROM subscription WHERE tenant_id IN (${ids})`, [`${PREFIJO}%`]);
    const { rowCount } = await cliente.query(`DELETE FROM tenant WHERE slug LIKE $1`, [`${PREFIJO}%`]);
    await cliente.query('COMMIT');
    console.log(`Borradas ${rowCount ?? 0} barberías de demostración.`);
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DB, max: 2 });
  try {
    if (opciones.limpiar) return await limpiar(pool);
    if (opciones.verificar) return await verificar(pool);
    const cantidad = Number(opciones.barberias);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAXIMO) {
      throw new Error(`--barberias debe ser un entero entre 1 y ${MAXIMO}`);
    }
    await sembrar(pool, cantidad);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Error desconocido');
  process.exitCode = 1;
});
