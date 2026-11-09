import { v7 as uuidv7 } from 'uuid';
import { crearInstanciaDeEventos, type InstanciaDeEventos } from '../../helpers/eventos';
import { sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T015 de 004 · ADR-025, SC-005: dos instancias despachan a la vez los mismos 100 eventos pendientes, de dos
// barberías; cada evento llega al manejador y queda PROCESADO exactamente una vez (FOR UPDATE SKIP LOCKED y
// el cambio de estado en la misma transacción que el manejador).

const TIPO = 'PruebaDosInstancias';
const TOTAL = 100;

describe('Despacho con dos instancias (ADR-025, SC-005)', () => {
  let r1: InstanciaDeEventos;
  let r2: InstanciaDeEventos;
  const ids: string[] = [];

  beforeAll(async () => {
    r1 = crearInstanciaDeEventos();
    r2 = crearInstanciaDeEventos();
    const tenants = [(await sembrarBarberia()).tenantId, (await sembrarBarberia()).tenantId];
    for (let i = 0; i < TOTAL; i += 1) {
      const id = uuidv7();
      ids.push(id);
      await poolDe('seed').query(
        `INSERT INTO outbox_event (id, tenant_id, type, payload, available_at, status, attempts)
         VALUES ($1, $2, $3, $4, now() - interval '1 second', 'PENDIENTE', 0)`,
        [id, tenants[i % 2], TIPO, JSON.stringify({ n: i })],
      );
    }
  });

  afterAll(async () => {
    await r1.cerrar();
    await r2.cerrar();
    await cerrarPools();
  });

  it('cada evento llega al manejador una sola vez y queda PROCESADO una sola vez', async () => {
    const vistos: string[] = [];
    const manejador = async (evento: { id: string }) => {
      vistos.push(evento.id);
      // Un poco de trabajo, para que las dos instancias se crucen sobre los mismos eventos.
      await new Promise((r) => setTimeout(r, 2));
    };
    r1.despachador.suscribir(TIPO, manejador);
    r2.despachador.suscribir(TIPO, manejador);

    for (let ronda = 0; ronda < 3; ronda += 1) {
      await Promise.all([r1.despachador.ejecutar(), r2.despachador.ejecutar()]);
    }

    expect(vistos).toHaveLength(TOTAL);
    expect(new Set(vistos).size).toBe(TOTAL);
    expect([...vistos].sort()).toEqual([...ids].sort());
    const { rows } = await poolDe('seed').query<{ status: string; total: number }>(
      `SELECT status, count(*)::int AS total FROM outbox_event WHERE id = ANY($1) GROUP BY status`,
      [ids],
    );
    expect(rows).toEqual([{ status: 'PROCESADO', total: TOTAL }]);
  });
});
