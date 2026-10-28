import { v7 as uuidv7 } from 'uuid';
import { sumarUnMes } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import { sembrarPago } from '../../helpers/fixtures';
import {
  barberiaEnPrueba,
  type EntornoDePagos,
  filaDePago,
  iniciarEntornoDePagos,
  pagarConYape,
  PLAN_BASICO,
  PLAN_PRO,
} from '../../helpers/pagos';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T034 · Iniciar el pago de un período con Yape (FR-005b, FR-008 a FR-012; R04; H1, H3, H4): un solo pago
// abierto por suscripción, importe del plan fijado al iniciar, período objetivo registrado, reutilización
// solo con la sesión vigente y nunca se anula un comprobante en revisión.

const seed = () => poolDe('seed');

describe('Iniciar un pago con Yape (T034)', () => {
  let entorno: EntornoDePagos;
  const planCaro = uuidv7();

  /** Estado de la sesión en el simulador (CANCELADO se informa como EXPIRADO). */
  async function estadoEnSimulador(referencia: string): Promise<string> {
    const respuesta = await fetch(`${entorno.simulador.url}/v1/sesiones/${referencia}`, {
      headers: { Authorization: `Bearer ${process.env.PAGOS_LLAVE_SECRETA}` },
    });
    return ((await respuesta.json()) as { estado: string }).estado;
  }

  async function pagosDe(suscripcionId: string) {
    const { rows } = await seed().query(
      'SELECT id, status, plan_id FROM payment WHERE subscription_id = $1 ORDER BY created_at',
      [suscripcionId],
    );
    return rows as { id: string; status: string; plan_id: string }[];
  }

  beforeAll(async () => {
    entorno = await iniciarEntornoDePagos();
    // Un plan contratable cuyo precio supera el máximo de Yape (S/ 500).
    await seed().query(
      `INSERT INTO plan (id, code, name, max_users, max_barbers, price_cents, public)
       VALUES ($1, $2, 'Plan caro de prueba', 20, 20, 60000, true)`,
      [planCaro, `CARO_${planCaro.slice(-8).toUpperCase()}`],
    );
  });

  afterAll(async () => {
    await seed().query('DELETE FROM plan WHERE id = $1', [planCaro]);
    await entorno.cerrar();
    await cerrarPools();
  });

  it('crea el pago PENDIENTE con el importe del plan, su período objetivo y la URL del proveedor', async () => {
    const b = await barberiaEnPrueba();
    const { body } = await pagarConYape(entorno.prueba, b.token).expect(201);
    expect(body).toEqual({
      pago: expect.objectContaining({
        plan: { id: PLAN_BASICO, nombre: 'Básico' },
        importeCentimos: 4900,
        moneda: 'PEN',
        medio: 'YAPE',
        estado: 'PENDIENTE',
        marca: null,
        periodo: null,
      }),
      urlPago: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/checkout\/ses_/),
      transferencia: null,
    });
    const fila = await filaDePago(body.pago.id);
    // El período objetivo es la cobertura vigente al iniciar: el fin de la prueba (H1).
    expect(fila.covers_after).toEqual(b.finPrueba);
    expect(fila.amount_cents).toBe(4900);
    expect(fila.created_by).toBe(b.propietarioId);
    expect(await estadoEnSimulador(fila.provider_reference as string)).toBe('PENDIENTE');
  });

  it('dos intentos iguales a la vez dejan UN pago y la misma respuesta (201 y 200)', async () => {
    const b = await barberiaEnPrueba();
    const [r1, r2] = await Promise.all([
      pagarConYape(entorno.prueba, b.token),
      pagarConYape(entorno.prueba, b.token),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r1.body.pago.id).toBe(r2.body.pago.id);
    expect(r1.body.urlPago).toBe(r2.body.urlPago);
    expect(await pagosDe(b.suscripcionId)).toHaveLength(1);
  });

  it('otro plan anula el pago anterior y cancela su sesión en el proveedor', async () => {
    const b = await barberiaEnPrueba();
    const primero = (await pagarConYape(entorno.prueba, b.token).expect(201)).body;
    const segundo = (await pagarConYape(entorno.prueba, b.token, PLAN_PRO).expect(201)).body;
    expect(segundo.pago.id).not.toBe(primero.pago.id);
    expect(segundo.pago.importeCentimos).toBe(8900);
    expect((await pagosDe(b.suscripcionId)).map((p) => p.status)).toEqual(['ANULADO', 'PENDIENTE']);
    const referencia = (await filaDePago(primero.pago.id)).provider_reference as string;
    expect(await estadoEnSimulador(referencia)).toBe('EXPIRADO');
  });

  it('el mismo intento con la sesión de pago vencida anula el anterior y crea otro con otra URL (H3)', async () => {
    const b = await barberiaEnPrueba();
    const primero = (await pagarConYape(entorno.prueba, b.token).expect(201)).body;
    await seed().query(
      `UPDATE payment SET checkout_url_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [primero.pago.id],
    );
    const segundo = (await pagarConYape(entorno.prueba, b.token).expect(201)).body;
    expect(segundo.pago.id).not.toBe(primero.pago.id);
    expect(segundo.urlPago).not.toBe(primero.urlPago);
    expect((await filaDePago(primero.pago.id)).status).toBe('ANULADO');
    expect(await estadoEnSimulador((await filaDePago(primero.pago.id)).provider_reference as string)).toBe(
      'EXPIRADO',
    );
  });

  it('con un comprobante en revisión responde 409 COMPROBANTE_YA_EN_REVISION y no anula nada (H4)', async () => {
    const b = await barberiaEnPrueba();
    const enRevision = await sembrarPago({
      tenantId: b.tenantId,
      suscripcionId: b.suscripcionId,
      metodo: 'TRANSFERENCIA',
      estado: 'EN_REVISION',
    });
    for (const plan of [PLAN_BASICO, PLAN_PRO]) {
      const { body } = await pagarConYape(entorno.prueba, b.token, plan).expect(409);
      expect(body.codigo).toBe('COMPROBANTE_YA_EN_REVISION');
    }
    expect(await pagosDe(b.suscripcionId)).toEqual([
      { id: enRevision.pagoId, status: 'EN_REVISION', plan_id: PLAN_BASICO },
    ]);
  });

  it('con el período siguiente ya pagado responde 409 PAGO_ADELANTADO_NO_PERMITIDO', async () => {
    const b = await barberiaEnPrueba();
    const pagado = await sembrarPago({
      tenantId: b.tenantId,
      suscripcionId: b.suscripcionId,
      metodo: 'TRANSFERENCIA',
      estado: 'APROBADO',
      cubreDesde: b.finPrueba,
    });
    await seed().query(
      `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        uuidv7(),
        b.tenantId,
        b.suscripcionId,
        pagado.pagoId,
        PLAN_BASICO,
        b.finPrueba,
        sumarUnMes(b.finPrueba),
      ],
    );
    const { body } = await pagarConYape(entorno.prueba, b.token).expect(409);
    expect(body.codigo).toBe('PAGO_ADELANTADO_NO_PERMITIDO');
    expect(await pagosDe(b.suscripcionId)).toHaveLength(1);
  });

  it('un plan con un importe fuera del rango de Yape responde 422 MEDIO_NO_DISPONIBLE_PARA_EL_PLAN', async () => {
    const b = await barberiaEnPrueba();
    const { body } = await pagarConYape(entorno.prueba, b.token, planCaro).expect(422);
    expect(body.codigo).toBe('MEDIO_NO_DISPONIBLE_PARA_EL_PLAN');
    expect(await pagosDe(b.suscripcionId)).toEqual([]);
  });

  it.each([
    ['el plan de prueba', '01923a00-0000-7000-8000-000000000001'],
    ['un plan que no existe', '01923a00-0000-7000-8000-0000000000ff'],
  ])('%s no se puede contratar: 422 PLAN_NO_CONTRATABLE', async (_caso, planId) => {
    const b = await barberiaEnPrueba();
    const { body } = await pagarConYape(entorno.prueba, b.token, planId).expect(422);
    expect(body.codigo).toBe('PLAN_NO_CONTRATABLE');
  });

  it.each([
    [{ numeroTarjeta: '4111111111111111', cvv: '123' }],
    [{ telefonoYape: '987654321' }],
    [{ importeCentimos: 100 }],
  ])('el cuerpo no acepta campos de tarjeta, del pagador ni importes: %o → 400', async (extra) => {
    const b = await barberiaEnPrueba();
    const { body } = await entorno.prueba.agente
      .post('/api/v1/suscripcion/pagos')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ planId: PLAN_BASICO, medio: 'YAPE', ...extra })
      .expect(400);
    expect(body.codigo).toBe('VALIDACION');
    expect(await pagosDe(b.suscripcionId)).toEqual([]);
  });

  it('un cambio de precio posterior no cambia el importe del pago (FR-005b)', async () => {
    const b = await barberiaEnPrueba();
    const { body } = await pagarConYape(entorno.prueba, b.token, PLAN_PRO).expect(201);
    await seed().query(`UPDATE plan SET price_cents = 9900 WHERE id = $1`, [PLAN_PRO]);
    try {
      const pago = await entorno.prueba.agente
        .get(`/api/v1/suscripcion/pagos/${body.pago.id}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);
      expect(pago.body.importeCentimos).toBe(8900);
      expect((await filaDePago(body.pago.id)).amount_cents).toBe(8900);
    } finally {
      await seed().query(`UPDATE plan SET price_cents = 8900 WHERE id = $1`, [PLAN_PRO]);
    }
  });
});
