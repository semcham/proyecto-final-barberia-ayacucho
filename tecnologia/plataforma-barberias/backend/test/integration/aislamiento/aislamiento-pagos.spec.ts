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
import { pagoEnRevision, png, subirComprobante } from '../../helpers/comprobantes';
import { tokenPlataformaPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T036 y T074 · PR09 de los pagos (FR-040; ADR-031): pagos, períodos, suscripciones y comprobantes de una
// barbería son invisibles para otra, por la API y por SQL directo con el rol de la aplicación; una
// notificación de un pago de B nunca modifica a A; el rol de la plataforma no lee el contenido de los
// comprobantes, y el administrador no cruza barberías por la ruta.

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

  // T074 · US3: los comprobantes son de su barbería y de nadie más.
  describe('comprobantes', () => {
    let c: BarberiaEnPrueba;
    let d: BarberiaEnPrueba;
    let pagoC: string;
    let tokenAdmin: string;

    beforeAll(async () => {
      c = await barberiaEnPrueba();
      d = await barberiaEnPrueba();
      pagoC = (await pagoEnRevision(entorno.prueba, c.token)).pagoId;
      await pagoEnRevision(entorno.prueba, d.token);
      tokenAdmin = (await tokenPlataformaPara()).token;
    });

    it('el comprobante de C da 404 al propietario de D, igual que uno inexistente', async () => {
      const ajeno = await entorno.prueba.agente
        .get(`/api/v1/suscripcion/pagos/${pagoC}/comprobante`)
        .set('Authorization', `Bearer ${d.token}`)
        .expect(404);
      const inexistente = await entorno.prueba.agente
        .get('/api/v1/suscripcion/pagos/01923a00-0000-7000-8000-00000000abcd/comprobante')
        .set('Authorization', `Bearer ${d.token}`)
        .expect(404);
      expect(ajeno.body).toEqual(inexistente.body);
      // Subir un comprobante a un pago ajeno tampoco existe.
      await subirComprobante(entorno.prueba, d.token, pagoC, { archivo: png() }).expect(404);
    });

    it.each(['payment_receipt', 'payment_receipt_file', 'receipt_upload_counter'])(
      '%s: por SQL con barberias_app y el tenant de D no aparece ninguna fila de C',
      async (tabla) => {
        const filas = await comoApp(
          d.tenantId,
          async (cl) => (await cl.query(`SELECT tenant_id FROM ${tabla}`)).rows,
        );
        expect(filas.length).toBeGreaterThan(0);
        expect(filas.every((f) => f.tenant_id === d.tenantId)).toBe(true);
      },
    );

    it('barberias_plataforma no puede leer payment_receipt_file (el contenido)', async () => {
      await expect(
        poolDe('plataforma').query('SELECT content FROM payment_receipt_file LIMIT 1'),
      ).rejects.toThrow(/permission denied/);
      await expect(
        poolDe('plataforma').query('SELECT tenant_id FROM payment_receipt_file LIMIT 1'),
      ).rejects.toThrow(/permission denied/);
      // Y del pago no ve el número de operación completo, solo sus últimos 4 y su hash (H2).
      await expect(
        poolDe('plataforma').query('SELECT bank_operation_number FROM payment LIMIT 1'),
      ).rejects.toThrow(/permission denied/);
    });

    it('el administrador con la barbería D en la ruta no ve el pago ni el comprobante de C (404)', async () => {
      const como = { Authorization: `Bearer ${tokenAdmin}` };
      await entorno.prueba.agente
        .get(`/api/v1/plataforma/barberias/${d.tenantId}/pagos/${pagoC}/comprobante`)
        .set(como)
        .expect(404);
      await entorno.prueba.agente
        .get(`/api/v1/plataforma/barberias/${d.tenantId}/pagos/${pagoC}`)
        .set(como)
        .expect(404);
      await entorno.prueba.agente
        .post(`/api/v1/plataforma/barberias/${d.tenantId}/pagos/${pagoC}/revision`)
        .set(como)
        .send({ resultado: 'APROBADO', importeTransferidoCentimos: 4900 })
        .expect(404);
      expect((await filaDePago(pagoC)).status).toBe('EN_REVISION');
      // Con la barbería correcta, sí.
      await entorno.prueba.agente
        .get(`/api/v1/plataforma/barberias/${c.tenantId}/pagos/${pagoC}/comprobante`)
        .set(como)
        .expect(200);
    });
  });
});
