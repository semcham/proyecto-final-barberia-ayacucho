import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { TenantId } from '../../../src/shared/tenant/tenant-id';
import { crearInstanciaDeEventos, type InstanciaDeEventos } from '../../helpers/eventos';
import { sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T013 de 004 · Salida transaccional de eventos (ADR-025, contracts/eventos.md §1 y §2; FR-011, FR-012):
// - publicar en una transacción confirmada deja el evento PENDIENTE con el tenant de la transacción;
// - si la transacción se revierte, no hay evento; sin transacción, publicar falla;
// - reemplazar y anular actúan solo sobre el pendiente de esa clave y ese tenant;
// - el despacho ejecuta el manejador y marca PROCESADO en el mismo COMMIT;
// - un manejador que falla deja el evento PENDIENTE con attempts + 1 y sin sus escrituras.

const EN_UNA_HORA = () => new Date(Date.now() + 60 * 60 * 1000);

interface FilaEvento {
  id: string;
  tenant_id: string;
  type: string;
  payload: Record<string, unknown>;
  replace_key: string | null;
  status: string;
  attempts: number;
  processed_at: Date | null;
  next_attempt_at: Date | null;
}

async function evento(id: string): Promise<FilaEvento | undefined> {
  const { rows } = await poolDe('seed').query<FilaEvento>(
    `SELECT id, tenant_id, type, payload, replace_key, status, attempts, processed_at, next_attempt_at
       FROM outbox_event WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function pendientesConClave(tenantId: string, clave: string): Promise<FilaEvento[]> {
  const { rows } = await poolDe('seed').query<FilaEvento>(
    `SELECT id, tenant_id, type, payload, replace_key, status, attempts, processed_at, next_attempt_at
       FROM outbox_event WHERE tenant_id = $1 AND replace_key = $2 ORDER BY created_at, id`,
    [tenantId, clave],
  );
  return rows;
}

describe('Salida transaccional de eventos (ADR-025)', () => {
  let instancia: InstanciaDeEventos;
  let a: TenantId;
  let b: TenantId;

  beforeAll(async () => {
    instancia = crearInstanciaDeEventos();
    a = TenantId.de((await sembrarBarberia()).tenantId);
    b = TenantId.de((await sembrarBarberia()).tenantId);
  });

  afterAll(async () => {
    await instancia.cerrar();
    await cerrarPools();
  });

  it('publicar en una transacción confirmada deja el evento PENDIENTE con el tenant de la transacción', async () => {
    const { uow, bus } = instancia;
    const id = await uow.ejecutar(a, () =>
      bus.publicar({ tipo: 'PruebaFutura', payload: { citaId: 'c-1' } }, { disponibleDesde: EN_UNA_HORA() }),
    );
    expect(await evento(id)).toMatchObject({
      tenant_id: a.valor,
      type: 'PruebaFutura',
      payload: { citaId: 'c-1' },
      status: 'PENDIENTE',
      attempts: 0,
      processed_at: null,
    });
  });

  it('si la transacción se revierte, el evento no existe', async () => {
    const { uow, bus } = instancia;
    let id = '';
    await expect(
      uow.ejecutar(a, async () => {
        id = await bus.publicar({ tipo: 'PruebaRevertida', payload: {} });
        throw new Error('la operación falla después de publicar');
      }),
    ).rejects.toThrow('la operación falla');
    expect(id).not.toBe('');
    expect(await evento(id)).toBeUndefined();
  });

  it('publicar sin transacción falla y no deja nada', async () => {
    await expect(instancia.bus.publicar({ tipo: 'PruebaSinTransaccion', payload: {} })).rejects.toThrow(
      /transacción/,
    );
    const { rows } = await poolDe('seed').query(
      `SELECT 1 FROM outbox_event WHERE type = 'PruebaSinTransaccion'`,
    );
    expect(rows).toEqual([]);
  });

  it('publicar en una transacción sin tenant falla (todo evento lleva barbería)', async () => {
    await expect(
      instancia.uow.ejecutarSinTenant(() => instancia.bus.publicar({ tipo: 'PruebaSinTenant', payload: {} })),
    ).rejects.toThrow();
  });

  it('reemplazar anula el pendiente de esa clave en ese tenant y publica el nuevo; el de otro tenant sigue', async () => {
    const { uow, bus } = instancia;
    const clave = `recordatorio:${uuidv7()}`;
    const deA = await uow.ejecutar(a, () =>
      bus.reemplazar(
        clave,
        { tipo: 'RecordatorioDeCita', payload: { v: 1 } },
        { disponibleDesde: EN_UNA_HORA() },
      ),
    );
    const deB = await uow.ejecutar(b, () =>
      bus.reemplazar(
        clave,
        { tipo: 'RecordatorioDeCita', payload: { v: 1 } },
        { disponibleDesde: EN_UNA_HORA() },
      ),
    );
    const nuevo = await uow.ejecutar(a, () =>
      bus.reemplazar(
        clave,
        { tipo: 'RecordatorioDeCita', payload: { v: 2 } },
        { disponibleDesde: EN_UNA_HORA() },
      ),
    );
    expect((await pendientesConClave(a.valor, clave)).map((f) => [f.id, f.status, f.payload])).toEqual([
      [deA, 'ANULADO', { v: 1 }],
      [nuevo, 'PENDIENTE', { v: 2 }],
    ]);
    expect((await evento(deA))?.processed_at).not.toBeNull();
    expect((await pendientesConClave(b.valor, clave)).map((f) => [f.id, f.status])).toEqual([
      [deB, 'PENDIENTE'],
    ]);
  });

  it('anular actúa solo sobre el pendiente de esa clave y ese tenant', async () => {
    const { uow, bus } = instancia;
    const clave = `recordatorio:${uuidv7()}`;
    for (const tenant of [a, b]) {
      await uow.ejecutar(tenant, () =>
        bus.reemplazar(
          clave,
          { tipo: 'RecordatorioDeCita', payload: {} },
          { disponibleDesde: EN_UNA_HORA() },
        ),
      );
    }
    expect(await uow.ejecutar(a, () => bus.anular(clave))).toBe(true);
    expect(await uow.ejecutar(a, () => bus.anular(clave))).toBe(false);
    expect((await pendientesConClave(a.valor, clave)).map((f) => f.status)).toEqual(['ANULADO']);
    expect((await pendientesConClave(b.valor, clave)).map((f) => f.status)).toEqual(['PENDIENTE']);
  });

  it('tras el COMMIT despacha: el manejador corre con el tenant del evento y queda PROCESADO en el mismo COMMIT', async () => {
    const { uow, bus, despachador } = instancia;
    const marca = uuidv7();
    const vistos: { id: string; tenant: string; payload: unknown }[] = [];
    despachador.suscribir('PruebaDespachada', async (e) => {
      vistos.push({ id: e.id, tenant: e.tenantId.valor, payload: e.payload });
      // Escritura del manejador en la transacción del despacho, con RLS: debe confirmarse junto con PROCESADO.
      await sql`INSERT INTO audit_log (id, tenant_id, action, result) VALUES (${uuidv7()}, ${e.tenantId.valor},
        ${`PRUEBA_${marca}`}, 'PERMITIDO')`.execute(uow.transaccionActual());
    });
    const id = await uow.ejecutar(a, () => bus.publicar({ tipo: 'PruebaDespachada', payload: { n: 1 } }));
    expect(vistos).toEqual([{ id, tenant: a.valor, payload: { n: 1 } }]);
    expect(await evento(id)).toMatchObject({ status: 'PROCESADO', attempts: 0 });
    const { rows } = await poolDe('seed').query('SELECT tenant_id FROM audit_log WHERE action = $1', [
      `PRUEBA_${marca}`,
    ]);
    expect(rows).toEqual([{ tenant_id: a.valor }]);
  });

  it('un manejador que falla deja el evento PENDIENTE con attempts + 1, sin sus escrituras, y se reintenta más tarde', async () => {
    const { uow, bus, despachador } = instancia;
    const marca = uuidv7();
    let llamadas = 0;
    despachador.suscribir('PruebaQueFalla', async (e) => {
      llamadas += 1;
      await sql`INSERT INTO audit_log (id, tenant_id, action, result) VALUES (${uuidv7()}, ${e.tenantId.valor},
        ${`PRUEBA_${marca}`}, 'PERMITIDO')`.execute(uow.transaccionActual());
      throw new Error('el manejador falla');
    });
    const id = await uow.ejecutar(a, () => bus.publicar({ tipo: 'PruebaQueFalla', payload: {} }));
    expect(llamadas).toBe(1);
    const fila = await evento(id);
    expect(fila).toMatchObject({ status: 'PENDIENTE', attempts: 1, processed_at: null });
    expect(fila?.next_attempt_at?.getTime()).toBeGreaterThan(Date.now());
    const { rows } = await poolDe('seed').query('SELECT 1 FROM audit_log WHERE action = $1', [
      `PRUEBA_${marca}`,
    ]);
    expect(rows).toEqual([]);
    // Antes de su próximo intento, la tarea no lo vuelve a tomar.
    await despachador.ejecutar();
    expect(llamadas).toBe(1);
  });

  it('el mismo tipo no se puede suscribir dos veces', () => {
    instancia.despachador.suscribir('PruebaUnica', async () => undefined);
    expect(() => instancia.despachador.suscribir('PruebaUnica', async () => undefined)).toThrow(
      /PruebaUnica/,
    );
  });
});
