import type { PoolClient } from 'pg';
import {
  type BarberiaEnPrueba,
  barberiaEnPrueba,
  type EntornoDePagos,
  filaDePago,
  iniciarEntornoDePagos,
  notificar,
  pagarConYape,
} from '../../helpers/pagos';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T036 · PR09 de los pagos (FR-040; ADR-031): pagos, períodos y suscripciones de una barbería son invisibles
// para otra, por la API y por SQL directo con el rol de la aplicación, y una notificación de un pago de B
// nunca modifica a A. US3 amplía esta prueba con los comprobantes.

const TABLAS = ['payment', 'subscription_period', 'subscription'];

async function comoApp<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await poolDe('app').connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(cliente);
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
}

async function fotoDe(tenantId: string): Promise<Record<string, unknown[]>> {
  const foto: Record<string, unknown[]> = {};
  for (const tabla of TABLAS) {
    foto[tabla] = (
      await poolDe('seed').query(`SELECT * FROM ${tabla} WHERE tenant_id = $1 ORDER BY id`, [tenantId])
    ).rows;
  }
  return foto;
}

describe('PR09 · Aislamiento de pagos entre barberías', () => {
  let entorno: EntornoDePagos;
  let a: BarberiaEnPrueba;
  let b: BarberiaEnPrueba;
  let pagoA: string;
  let pagoB: string;

  beforeAll(async () => {
    entorno = await iniciarEntornoDePagos();
    a = await barberiaEnPrueba();
    b = await barberiaEnPrueba();
    // Cada una con un pago aprobado, con su período y su evento.
    for (const barberia of [a, b]) {
      const aprobado = (await pagarConYape(entorno.prueba, barberia.token).expect(201)).body.pago.id;
      await notificar(entorno.prueba, {
        referencia: (await filaDePago(aprobado)).provider_reference as string,
      }).expect(200);
    }
    // El pago de cada barbería es el aprobado (con el período siguiente pagado no se inicia otro).
    const { rows } = await poolDe('seed').query(
      'SELECT tenant_id, id FROM payment WHERE tenant_id = ANY($1)',
      [[a.tenantId, b.tenantId]],
    );
    pagoA = rows.find((r) => r.tenant_id === a.tenantId).id;
    pagoB = rows.find((r) => r.tenant_id === b.tenantId).id;
  });

  afterAll(async () => {
    await entorno.cerrar();
    await cerrarPools();
  });

  it('el propietario de A recibe 404 en el pago de B, igual que en uno inexistente', async () => {
    const ajeno = await entorno.prueba.agente
      .get(`/api/v1/suscripcion/pagos/${pagoB}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(404);
    const inexistente = await entorno.prueba.agente
      .get('/api/v1/suscripcion/pagos/01923a00-0000-7000-8000-00000000abcd')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(404);
    expect(ajeno.body).toEqual(inexistente.body);
    await entorno.prueba.agente
      .get(`/api/v1/suscripcion/pagos/${pagoA}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
  });

  it('GET /suscripcion solo muestra la suscripción de la barbería del token', async () => {
    const { body } = await entorno.prueba.agente
      .get('/api/v1/suscripcion')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    expect(JSON.stringify(body)).not.toContain(b.suscripcionId);
    expect(JSON.stringify(body)).not.toContain(pagoB);
    expect(body.proximoPeriodo).not.toBeNull();
  });

  it.each(TABLAS)(
    '%s: por SQL con barberias_app y el tenant de A no aparece ninguna fila de B',
    async (tabla) => {
      const filas = await comoApp(
        a.tenantId,
        async (c) => (await c.query(`SELECT tenant_id FROM ${tabla}`)).rows,
      );
      expect(filas.length).toBeGreaterThan(0);
      expect(filas.every((f) => f.tenant_id === a.tenantId)).toBe(true);
    },
  );

  it('con el tenant de A no se puede cambiar un pago de B', async () => {
    await expect(
      comoApp(a.tenantId, (c) =>
        c.query(`UPDATE payment SET status = 'ANULADO', closed_at = now() WHERE id = $1`, [pagoB]),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  it('una notificación de un pago de B nunca modifica a A', async () => {
    const antesA = await fotoDe(a.tenantId);
    await notificar(entorno.prueba, {
      referencia: (await filaDePago(pagoB)).provider_reference as string,
      estado: 'DEVUELTO',
    }).expect(200);
    expect(await fotoDe(a.tenantId)).toEqual(antesA);
    expect((await filaDePago(pagoB)).review).toBe('DEVOLUCION');
  });
});
