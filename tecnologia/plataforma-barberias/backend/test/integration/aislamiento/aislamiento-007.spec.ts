import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { type BarberiaSembrada, sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import { sembrarSolicitudDatos, TABLAS_007_CON_BARBERIA } from '../../helpers/solicitudes-datos';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T004 de 007 · PR09, FR-010, SC-002: con el tenant de A, barberias_app no lee, cambia ni inserta (WITH CHECK) una
// fila de B en data_subject_request; no hay DELETE, y una solicitud de A no puede apuntar a un cliente de B (FK
// compuesta). Las columnas que la aplicación puede cambiar son solo las de la transición (data-model §1).

interface Sembrado {
  barberia: BarberiaSembrada;
  clienteId: string;
  solicitudId: string;
}

async function comoApp<T>(tenantId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await poolDe('app').connect();
  try {
    await cliente.query('BEGIN');
    if (tenantId) await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(cliente);
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
}

async function sembrar(): Promise<Sembrado> {
  const barberia = await sembrarBarberia();
  const { clienteId, usuarioId } = await sembrarCliente({ tenantId: barberia.tenantId });
  const solicitudId = await sembrarSolicitudDatos({
    tenantId: barberia.tenantId,
    registradaPor: usuarioId as string,
    clienteId,
  });
  return { barberia, clienteId, solicitudId };
}

const INSERTAR = `INSERT INTO data_subject_request
  (id, tenant_id, kind, subject_kind, customer_id, status, registered_by, on_behalf, received_at, due_on)
  VALUES ($1, $2, 'ELIMINACION', 'CLIENTE', $3, 'RECIBIDA', $4, false, now(), '2026-12-01')`;

describe('PR09 · Aislamiento de data_subject_request (007, FR-010)', () => {
  let a: Sembrado;
  let b: Sembrado;

  beforeAll(async () => {
    a = await sembrar();
    b = await sembrar();
  });

  afterAll(cerrarPools);

  it('la tabla nueva de 007 con barbería es exactamente data_subject_request', () => {
    expect([...TABLAS_007_CON_BARBERIA]).toEqual(['data_subject_request']);
  });

  it('con el tenant de A no se lee la solicitud de B; con el de B, sí; sin tenant, ninguna', async () => {
    const leer = (c: PoolClient) =>
      c.query('SELECT id FROM data_subject_request WHERE id = $1', [b.solicitudId]);
    expect((await comoApp(a.barberia.tenantId, leer)).rowCount).toBe(0);
    expect((await comoApp(b.barberia.tenantId, leer)).rowCount).toBe(1);
    expect((await comoApp(null, (c) => c.query('SELECT id FROM data_subject_request'))).rowCount).toBe(0);
  });

  it('con el tenant de A no se modifica la solicitud de B; con el de B, sí', async () => {
    const sentencia = `UPDATE data_subject_request SET status = 'EN_ATENCION', started_at = now() WHERE id = $1`;
    expect((await comoApp(a.barberia.tenantId, (c) => c.query(sentencia, [b.solicitudId]))).rowCount).toBe(0);
    expect((await comoApp(b.barberia.tenantId, (c) => c.query(sentencia, [b.solicitudId]))).rowCount).toBe(1);
  });

  it('un INSERT con el tenant de B desde el contexto de A falla por WITH CHECK', async () => {
    await expect(
      comoApp(a.barberia.tenantId, (c) =>
        c.query(INSERTAR, [uuidv7(), b.barberia.tenantId, b.clienteId, b.barberia.propietarioId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('una solicitud de A no puede apuntar a un cliente de B (clave foránea compuesta)', async () => {
    await expect(
      comoApp(a.barberia.tenantId, (c) =>
        c.query(INSERTAR, [uuidv7(), a.barberia.tenantId, b.clienteId, a.barberia.propietarioId]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('ningún DELETE, ni siquiera de las filas propias', async () => {
    await expect(
      comoApp(a.barberia.tenantId, (c) => c.query('DELETE FROM data_subject_request')),
    ).rejects.toThrow(/permission denied/);
  });

  it('la aplicación no puede cambiar el tipo, el titular, el detalle, quién la registró ni la barbería', async () => {
    for (const columna of [
      "kind = 'ACCESO'",
      "subject_kind = 'BARBERO'",
      'customer_id = customer_id',
      "detail = 'otro'",
      'registered_by = registered_by',
      'on_behalf = true',
      'received_at = now()',
      "due_on = '2030-01-01'",
      'tenant_id = tenant_id',
    ]) {
      await expect(
        comoApp(a.barberia.tenantId, (c) =>
          c.query(`UPDATE data_subject_request SET ${columna} WHERE id = $1`, [a.solicitudId]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('permisos exactos de barberias_app: SELECT e INSERT de tabla, UPDATE solo de las columnas de la transición', async () => {
    const seed = poolDe('seed');
    const tabla = await seed.query<{ privilegio: string }>(
      `SELECT privilege_type AS privilegio FROM information_schema.table_privileges
        WHERE grantee = 'barberias_app' AND table_name = 'data_subject_request' ORDER BY 1`,
    );
    expect(tabla.rows.map((f) => f.privilegio)).toEqual(['INSERT', 'SELECT']);
    const update = await seed.query<{ columna: string }>(
      `SELECT column_name AS columna FROM information_schema.column_privileges
        WHERE grantee = 'barberias_app' AND table_name = 'data_subject_request' AND privilege_type = 'UPDATE'
        ORDER BY 1`,
    );
    expect(update.rows.map((f) => f.columna)).toEqual(
      ['closed_at', 'closed_by', 'rejection_reason', 'response', 'started_at', 'status'].sort(),
    );
  });

  it('una sola abierta por titular y tipo también en la base (índice único parcial)', async () => {
    await expect(
      comoApp(a.barberia.tenantId, (c) =>
        c.query(
          `INSERT INTO data_subject_request
             (id, tenant_id, kind, subject_kind, customer_id, status, registered_by, on_behalf, received_at, due_on)
           VALUES ($1, $2, 'ACCESO', 'CLIENTE', $3, 'RECIBIDA', $4, false, now(), '2026-12-01')`,
          [uuidv7(), a.barberia.tenantId, a.clienteId, a.barberia.propietarioId],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});
