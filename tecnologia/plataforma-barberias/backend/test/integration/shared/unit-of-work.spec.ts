import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { crearBaseDeDatos, type BaseDeDatos } from '../../../src/shared/persistence/database';
import { KyselyUnitOfWork } from '../../../src/shared/persistence/kysely-unit-of-work';
import { TenantContext } from '../../../src/shared/tenant/tenant-context';
import { TenantId } from '../../../src/shared/tenant/tenant-id';
import { type BarberiaSembrada, filasDe, sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools } from '../../helpers/test-db';

// T024 · KyselyUnitOfWork con una sola conexión en el pool, para comprobar que el tenant no pasa de una
// transacción a la siguiente que reutiliza la misma conexión.

describe('KyselyUnitOfWork (integración, RLS real)', () => {
  let db: BaseDeDatos;
  let uow: KyselyUnitOfWork;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;

  beforeAll(async () => {
    db = crearBaseDeDatos(process.env.TEST_DB_APP_URL as string, 1);
    uow = new KyselyUnitOfWork(db, new TenantContext());
    a = await sembrarBarberia();
    b = await sembrarBarberia();
  });

  afterAll(async () => {
    await db.destroy();
    await cerrarPools();
  });

  it('dentro de la transacción solo ve filas del tenant fijado', async () => {
    const tenants = await uow.ejecutar(TenantId.de(a.tenantId), () =>
      uow.transaccionActual().selectFrom('membership').select('tenant_id').execute(),
    );
    expect(tenants.map((fila) => fila.tenant_id)).toEqual([a.tenantId]);
  });

  it('el tenant no sobrevive a la transacción en la conexión reutilizada', async () => {
    await uow.ejecutar(TenantId.de(a.tenantId), async () => undefined);
    const ajuste = await sql<{
      valor: string | null;
    }>`select current_setting('app.tenant_id', true) as valor`.execute(db);
    expect(ajuste.rows[0]?.valor ?? '').toBe('');
    // Sin tenant, RLS no deja ver filas (y no falla gracias a NULLIF en la política).
    const filas = await db.selectFrom('membership').select('id').execute();
    expect(filas).toHaveLength(0);
  });

  it('una transacción posterior con otro tenant ve solo el suyo', async () => {
    await uow.ejecutar(TenantId.de(a.tenantId), async () => undefined);
    const tenants = await uow.ejecutar(TenantId.de(b.tenantId), () =>
      uow.transaccionActual().selectFrom('membership').select('tenant_id').execute(),
    );
    expect(tenants.map((fila) => fila.tenant_id)).toEqual([b.tenantId]);
  });

  it('un error revierte todo lo escrito en la transacción', async () => {
    const antes = await filasDe('audit_log', a.tenantId);
    await expect(
      uow.ejecutar(TenantId.de(a.tenantId), async () => {
        await uow
          .transaccionActual()
          .insertInto('audit_log')
          .values({
            id: uuidv7(),
            tenant_id: a.tenantId,
            actor_id: null,
            action: 'PRUEBA',
            result: 'PERMITIDO',
          })
          .execute();
        throw new Error('falla a mitad');
      }),
    ).rejects.toThrow('falla a mitad');
    expect(await filasDe('audit_log', a.tenantId)).toEqual(antes);
  });

  it('fijarTenant activa RLS dentro de una transacción abierta sin tenant', async () => {
    const tenants = await uow.ejecutarSinTenant(async () => {
      const sinTenant = await uow.transaccionActual().selectFrom('membership').select('id').execute();
      expect(sinTenant).toHaveLength(0);
      await uow.fijarTenant(TenantId.de(b.tenantId));
      return uow.transaccionActual().selectFrom('membership').select('tenant_id').execute();
    });
    expect(tenants.map((fila) => fila.tenant_id)).toEqual([b.tenantId]);
  });

  it('ejecutarAparte confirma aunque la transacción exterior se revierta', async () => {
    // Necesita dos conexiones: la exterior sigue abierta mientras la aparte confirma.
    const dbDos = crearBaseDeDatos(process.env.TEST_DB_APP_URL as string, 2);
    const uowDos = new KyselyUnitOfWork(dbDos, new TenantContext());
    const idRegistro = uuidv7();
    try {
      await expect(
        uowDos.ejecutar(TenantId.de(a.tenantId), async () => {
          await uowDos.ejecutarAparte(TenantId.de(a.tenantId), () =>
            uowDos
              .transaccionActual()
              .insertInto('audit_log')
              .values({
                id: idRegistro,
                tenant_id: a.tenantId,
                actor_id: null,
                action: 'PRUEBA',
                result: 'DENEGADO',
              })
              .execute(),
          );
          throw new Error('la exterior falla');
        }),
      ).rejects.toThrow('la exterior falla');
    } finally {
      await dbDos.destroy();
    }
    const filas = await filasDe('audit_log', a.tenantId);
    expect(filas.some((fila) => fila.id === idRegistro)).toBe(true);
  });

  it('no permite abrir una transacción anidada con otro tenant', async () => {
    await expect(
      uow.ejecutar(TenantId.de(a.tenantId), () =>
        uow.ejecutar(TenantId.de(b.tenantId), async () => undefined),
      ),
    ).rejects.toThrow();
  });
});
