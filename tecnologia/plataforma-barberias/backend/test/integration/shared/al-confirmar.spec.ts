import { Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { crearBaseDeDatos, type BaseDeDatos } from '../../../src/shared/persistence/database';
import { KyselyUnitOfWork } from '../../../src/shared/persistence/kysely-unit-of-work';
import { TenantContext } from '../../../src/shared/tenant/tenant-context';
import { TenantId } from '../../../src/shared/tenant/tenant-id';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T006 · UnitOfWork.alConfirmar (R08, FR-010): las acciones corren solo tras el COMMIT de la transacción
// más externa, nunca con ROLLBACK, y su error no cambia el resultado del caso de uso.

const A = TenantId.de('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

describe('UnitOfWork.alConfirmar', () => {
  let db: BaseDeDatos;
  let uow: KyselyUnitOfWork;

  beforeAll(() => {
    db = crearBaseDeDatos(process.env.TEST_DB_APP_URL as string, 4);
    uow = new KyselyUnitOfWork(db, new TenantContext());
  });

  afterAll(async () => {
    await db.destroy();
    await cerrarPools();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Id de la transacción en curso (la fuerza a tener uno). */
  async function idDeTransaccion(): Promise<string> {
    const { rows } = await sql<{ id: string }>`select txid_current()::text as id`.execute(
      uow.transaccionActual(),
    );
    return rows[0].id;
  }

  /** Estado de una transacción visto desde otra conexión. */
  async function estado(id: string): Promise<string> {
    const { rows } = await poolDe('seed').query<{ estado: string }>(
      'select txid_status($1::bigint) as estado',
      [id],
    );
    return rows[0].estado;
  }

  it('ejecuta la acción después del COMMIT, no antes', async () => {
    let id = '';
    let estadoEnLaAccion = '';
    let ejecutadaDentro = false;
    const resultado = await uow.ejecutar(A, async () => {
      id = await idDeTransaccion();
      uow.alConfirmar(async () => {
        estadoEnLaAccion = await estado(id);
      });
      ejecutadaDentro = estadoEnLaAccion !== '';
      return 'hecho';
    });
    expect(resultado).toBe('hecho');
    expect(ejecutadaDentro).toBe(false);
    expect(estadoEnLaAccion).toBe('committed');
  });

  it('con un error dentro de la transacción (ROLLBACK) no ejecuta la acción', async () => {
    const accion = jest.fn();
    await expect(
      uow.ejecutar(A, async () => {
        uow.alConfirmar(accion);
        throw new Error('falla a mitad del caso de uso');
      }),
    ).rejects.toThrow('falla a mitad');
    expect(accion).not.toHaveBeenCalled();
  });

  it('en una transacción anidada del mismo tenant espera a la externa', async () => {
    const orden: string[] = [];
    await uow.ejecutar(A, async () => {
      await uow.ejecutar(A, async () => {
        uow.alConfirmar(() => {
          orden.push('accion');
        });
      });
      orden.push('fin-de-la-anidada');
    });
    expect(orden).toEqual(['fin-de-la-anidada', 'accion']);
  });

  it('si la externa se revierte tras una anidada, tampoco se ejecuta', async () => {
    const accion = jest.fn();
    await expect(
      uow.ejecutar(A, async () => {
        await uow.ejecutar(A, async () => uow.alConfirmar(accion));
        throw new Error('revertir');
      }),
    ).rejects.toThrow('revertir');
    expect(accion).not.toHaveBeenCalled();
  });

  it('ejecuta varias acciones en orden', async () => {
    const orden: number[] = [];
    await uow.ejecutar(A, async () => {
      uow.alConfirmar(() => {
        orden.push(1);
      });
      uow.alConfirmar(async () => {
        orden.push(2);
      });
    });
    expect(orden).toEqual([1, 2]);
  });

  it('el error de una acción se registra y no cambia el resultado ni detiene las demás', async () => {
    const registro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const segunda = jest.fn();
    const resultado = await uow.ejecutar(A, async () => {
      uow.alConfirmar(() => {
        throw new Error('redis no responde');
      });
      uow.alConfirmar(segunda);
      return 42;
    });
    expect(resultado).toBe(42);
    expect(segunda).toHaveBeenCalledTimes(1);
    expect(registro).toHaveBeenCalledTimes(1);
  });

  it('también funciona con ejecutarSinTenant', async () => {
    const accion = jest.fn();
    await uow.ejecutarSinTenant(async () => uow.alConfirmar(accion));
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it('ejecutarAparte tiene sus propias acciones, que corren al confirmar la aparte', async () => {
    const orden: string[] = [];
    await uow.ejecutar(A, async () => {
      await uow.ejecutarAparte(A, async () => {
        uow.alConfirmar(() => {
          orden.push('aparte');
        });
      });
      orden.push('externa-sigue');
      uow.alConfirmar(() => {
        orden.push('externa');
      });
    });
    expect(orden).toEqual(['aparte', 'externa-sigue', 'externa']);
  });

  it('fuera de una transacción lanza un error', () => {
    expect(() => uow.alConfirmar(() => undefined)).toThrow(/transacción/);
  });
});
