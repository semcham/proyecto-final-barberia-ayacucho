import { v7 as uuidv7 } from 'uuid';
import { type BarberiaSembrada, sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T005 de 011 · Tabla catalog_batch (migración 0037; data-model §1): permisos exactos, índice de idempotencia y RLS.

const ROLES_SIN_PERMISO = ['barberias_publico', 'barberias_plataforma', 'barberias_conteos'];
const PRIVILEGIOS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

async function privilegiosDe(rol: string): Promise<string[]> {
  const { rows } = await poolDe('seed').query<{ privilegio: string }>(
    `SELECT p AS privilegio FROM unnest($2::text[]) AS p
      WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
        AND has_table_privilege($1, 'catalog_batch', p)
      ORDER BY p`,
    [rol, PRIVILEGIOS],
  );
  return rows.map((f) => f.privilegio);
}

/** Inserta una carga como la aplicación, con el tenant de la transacción fijado. */
async function insertarComoApp(
  tenantId: string,
  fila: { autor: string; clave: string; tenantFila?: string },
) {
  const cliente = await poolDe('app').connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await cliente.query(
      `INSERT INTO catalog_batch
         (id, tenant_id, author_user_id, idempotency_key, kind, rows_digest, created_count, created_ids)
       VALUES ($1, $2, $3, $4, 'SERVICIOS', $5, 1, ARRAY[$6]::uuid[])`,
      [uuidv7(), fila.tenantFila ?? tenantId, fila.autor, fila.clave, 'b'.repeat(64), uuidv7()],
    );
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

async function contarComoApp(tenantId: string): Promise<number> {
  const cliente = await poolDe('app').connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const { rows } = await cliente.query<{ n: number }>('SELECT count(*)::int AS n FROM catalog_batch');
    await cliente.query('COMMIT');
    return rows[0].n;
  } finally {
    cliente.release();
  }
}

describe('catalog_batch (cargas en lote)', () => {
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;

  beforeAll(async () => {
    a = await sembrarBarberia();
    b = await sembrarBarberia();
  });

  afterAll(async () => {
    await cerrarPools();
  });

  it('barberias_app solo puede leer e insertar (una carga guardada no cambia)', async () => {
    expect(await privilegiosDe('barberias_app')).toEqual(['INSERT', 'SELECT']);
  });

  it.each(ROLES_SIN_PERMISO)('%s no tiene ningún permiso', async (rol) => {
    expect(await privilegiosDe(rol)).toEqual([]);
  });

  it('el índice único rechaza la misma clave del mismo autor en la misma barbería', async () => {
    const clave = uuidv7();
    await insertarComoApp(a.tenantId, { autor: a.propietarioId, clave });
    await expect(insertarComoApp(a.tenantId, { autor: a.propietarioId, clave })).rejects.toMatchObject({
      constraint: 'catalog_batch_idempotencia',
    });
    // Otra barbería puede usar la misma clave (la clave es por barbería y autor).
    await insertarComoApp(b.tenantId, { autor: b.propietarioId, clave });
  });

  it('con RLS, una barbería no ve ni escribe las cargas de otra', async () => {
    const antesB = await contarComoApp(b.tenantId);
    await insertarComoApp(a.tenantId, { autor: a.propietarioId, clave: uuidv7() });
    expect(await contarComoApp(b.tenantId)).toBe(antesB);
    await expect(
      insertarComoApp(a.tenantId, { autor: b.propietarioId, clave: uuidv7(), tenantFila: b.tenantId }),
    ).rejects.toThrow(/row-level security/);
  });
});
