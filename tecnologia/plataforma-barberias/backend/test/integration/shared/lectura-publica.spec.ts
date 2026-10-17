import { type Kysely, sql } from 'kysely';
import { LecturaPublica } from '../../../src/shared/lectura-publica';
import type { Database } from '../../../src/shared/persistence/db-types';
import { TenantId } from '../../../src/shared/tenant/tenant-id';
import { type BarberiaSembrada, sembrarBarberia, sembrarServicio } from '../../helpers/fixtures';
import { cerrarPools } from '../../helpers/test-db';

// T018 · LecturaPublica (ADR-021): transacción de solo lectura con el tenant fijado y RLS activa.

describe('LecturaPublica', () => {
  // Una sola conexión: así la prueba de "no sobrevive a la transacción" usa la misma conexión.
  const lectura = LecturaPublica.conectar(process.env.TEST_DB_PUBLICO_URL as string, 1);
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;

  beforeAll(async () => {
    a = await sembrarBarberia();
    b = await sembrarBarberia();
    await sembrarServicio({ tenantId: a.tenantId, nombre: 'Corte de A' });
    await sembrarServicio({ tenantId: b.tenantId, nombre: 'Corte de B' });
  });

  afterAll(async () => {
    await lectura.cerrar();
    await cerrarPools();
  });

  it('con el tenant de A solo se ven filas de A', async () => {
    const nombres = await lectura.ejecutar(TenantId.de(a.tenantId), (tx) =>
      tx.selectFrom('service').select(['name', 'tenant_id']).execute(),
    );
    expect(nombres).toEqual([{ name: 'Corte de A', tenant_id: a.tenantId }]);
  });

  it('la transacción es de solo lectura: cualquier escritura o DDL falla', async () => {
    const modo = await lectura.ejecutar(TenantId.de(a.tenantId), async (tx) => {
      const { rows } = await sql<{ transaction_read_only: string }>`show transaction_read_only`.execute(tx);
      return rows[0].transaction_read_only;
    });
    expect(modo).toBe('on');
    await expect(
      lectura.ejecutar(TenantId.de(a.tenantId), (tx) => sql`create temp table intento (x int)`.execute(tx)),
    ).rejects.toThrow(/read-only transaction/);
  });

  it('app.tenant_id no sobrevive a la transacción ni pasa a la siguiente que usa la conexión', async () => {
    await lectura.ejecutar(TenantId.de(a.tenantId), async () => undefined);
    // Siguiente transacción en la misma conexión, sin fijar tenant: RLS no deja ver nada.
    const resultado = await lectura.ejecutar(TenantId.de(b.tenantId), async (tx) => {
      const { rows } = await sql<{
        actual: string | null;
      }>`select current_setting('app.tenant_id', true) as actual`.execute(tx);
      return rows[0].actual;
    });
    expect(resultado).toBe(b.tenantId);
    // Consulta fuera de LecturaPublica por la misma (única) conexión del pool: sin tenant y sin filas.
    const db = (lectura as unknown as { db: Kysely<Database> }).db;
    const { rows } = await sql<{ actual: string | null; total: number }>`
      select nullif(current_setting('app.tenant_id', true), '') as actual,
             (select count(*)::int from service) as total`.execute(db);
    expect(rows[0]).toEqual({ actual: null, total: 0 });
  });
});
