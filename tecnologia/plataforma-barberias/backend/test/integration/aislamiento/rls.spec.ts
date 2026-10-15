import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  type BarberiaSembrada,
  sembrarBarberia,
  sembrarSesion,
  sembrarSuscripcion,
} from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T090 · PR09 a nivel de base: RLS forzada en toda tabla con tenant_id, sin fugas entre barberías.

const DIA_MS = 24 * 60 * 60 * 1000;

async function comoApp<T>(fn: (cliente: PoolClient) => Promise<T>, tenantId?: string): Promise<T> {
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

describe('PR09 · RLS en la base de datos', () => {
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;
  let tablasConTenant: string[];
  let tablasConRls: string[];

  beforeAll(async () => {
    a = await sembrarBarberia();
    b = await sembrarBarberia();
    // Cada barbería con datos en todas las tablas por tenant.
    for (const barberia of [a, b]) {
      await sembrarSesion({ tenantId: barberia.tenantId, usuarioId: barberia.propietarioId });
      await sembrarSuscripcion({
        tenantId: barberia.tenantId,
        trialEndsAt: new Date(Date.now() + 14 * DIA_MS),
      });
      const seed = poolDe('seed');
      await seed.query(
        `INSERT INTO audit_log (id, tenant_id, actor_id, action, result) VALUES ($1, $2, $3, 'PRUEBA', 'PERMITIDO')`,
        [uuidv7(), barberia.tenantId, barberia.propietarioId],
      );
      await seed.query(
        `INSERT INTO terms_acceptance (id, tenant_id, user_id, document, text_version) VALUES ($1, $2, $3, 'TERMINOS', '2026-10')`,
        [uuidv7(), barberia.tenantId, barberia.propietarioId],
      );
      await seed.query(
        `INSERT INTO account_activation (id, tenant_id, user_id, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, now() + interval '72 hours', $3)`,
        [uuidv7(), barberia.tenantId, barberia.propietarioId, uuidv7().replace(/-/g, '').padEnd(64, '0')],
      );
    }

    const seed = poolDe('seed');
    tablasConTenant = (
      await seed.query<{ tabla: string }>(
        `SELECT table_name AS tabla FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'tenant_id' ORDER BY table_name`,
      )
    ).rows.map((fila) => fila.tabla);
    tablasConRls = (
      await seed.query<{ tabla: string }>(
        `SELECT c.relname AS tabla FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
         ORDER BY c.relname`,
      )
    ).rows.map((fila) => fila.tabla);
  });

  afterAll(cerrarPools);

  it('toda tabla con columna tenant_id tiene RLS activada y forzada', () => {
    expect(tablasConTenant.length).toBeGreaterThanOrEqual(6);
    expect(tablasConTenant.filter((tabla) => !tablasConRls.includes(tabla))).toEqual([]);
    // user_account no tiene tenant_id pero también tiene RLS (ADR-015).
    expect(tablasConRls).toContain('user_account');
  });

  it('(a) sin contexto de tenant, barberias_app no ve ninguna fila en ninguna tabla con RLS', async () => {
    const conteos = await comoApp(async (cliente) => {
      const resultado: Record<string, number> = {};
      for (const tabla of tablasConRls) {
        resultado[tabla] = (await cliente.query(`SELECT count(*)::int AS total FROM ${tabla}`)).rows[0].total;
      }
      return resultado;
    });
    expect(Object.values(conteos).every((total) => total === 0)).toBe(true);
    expect(Object.keys(conteos).sort()).toEqual([...tablasConRls].sort());
  });

  it('(b) con el contexto de A no aparece ninguna fila de B, y sí las de A', async () => {
    const resultado = await comoApp(async (cliente) => {
      const filas: Record<string, { deA: number; deB: number }> = {};
      for (const tabla of tablasConTenant) {
        const { rows } = await cliente.query<{ dea: number; deb: number }>(
          `SELECT count(*) FILTER (WHERE tenant_id = $1)::int AS dea, count(*) FILTER (WHERE tenant_id = $2)::int AS deb FROM ${tabla}`,
          [a.tenantId, b.tenantId],
        );
        filas[tabla] = { deA: rows[0].dea, deB: rows[0].deb };
      }
      return filas;
    }, a.tenantId);
    for (const [tabla, { deA, deB }] of Object.entries(resultado)) {
      expect({ tabla, deB }).toEqual({ tabla, deB: 0 });
      expect({ tabla, conDatosDeA: deA > 0 }).toEqual({ tabla, conDatosDeA: true });
    }
  });

  describe('(c) no se puede escribir en B desde el contexto de A', () => {
    it('INSERT con tenant_id de B falla por WITH CHECK', async () => {
      await expect(
        comoApp(
          (cliente) =>
            cliente.query(
              `INSERT INTO audit_log (id, tenant_id, actor_id, action, result) VALUES ($1, $2, NULL, 'ATAQUE', 'DENEGADO')`,
              [uuidv7(), b.tenantId],
            ),
          a.tenantId,
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('UPDATE que mueve una fila de A a B falla por WITH CHECK', async () => {
      await expect(
        comoApp(
          (cliente) =>
            cliente.query('UPDATE auth_session SET tenant_id = $1 WHERE tenant_id = $2', [
              b.tenantId,
              a.tenantId,
            ]),
          a.tenantId,
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('UPDATE y DELETE sobre filas de B no afectan ninguna fila', async () => {
      const afectadas = await comoApp(async (cliente) => {
        const actualizadas = await cliente.query(
          "UPDATE membership SET status = 'DESACTIVADA' WHERE tenant_id = $1",
          [b.tenantId],
        );
        const borradas = await cliente.query('DELETE FROM auth_session WHERE tenant_id = $1', [b.tenantId]);
        return [actualizadas.rowCount, borradas.rowCount];
      }, a.tenantId);
      expect(afectadas).toEqual([0, 0]);
    });
  });

  it('(d) barberias_app no tiene BYPASSRLS ni es dueño de ninguna tabla', async () => {
    const seed = poolDe('seed');
    const rol = await seed.query(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'barberias_app'",
    );
    expect(rol.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    const propias = await seed.query("SELECT tablename FROM pg_tables WHERE tableowner = 'barberias_app'");
    expect(propias.rows).toEqual([]);
  });

  it('(e) audit_log es inmutable para la aplicación: UPDATE y DELETE denegados', async () => {
    await expect(
      comoApp((cliente) => cliente.query("UPDATE audit_log SET action = 'BORRADO'"), a.tenantId),
    ).rejects.toThrow(/permission denied/);
    await expect(comoApp((cliente) => cliente.query('DELETE FROM audit_log'), a.tenantId)).rejects.toThrow(
      /permission denied/,
    );
  });
});
