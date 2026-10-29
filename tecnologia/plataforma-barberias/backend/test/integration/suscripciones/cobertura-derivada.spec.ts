import { v7 as uuidv7 } from 'uuid';
import { AvanzarSuscripcion } from '../../../src/modules/suscripciones-pagos/suscripciones/application/avanzar-suscripcion';
import { sumarUnMes } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import { EjecutorTareas } from '../../../src/shared';
import { sembrarPago } from '../../helpers/fixtures';
import {
  barberiaEnPrueba,
  type EntornoDePagos,
  filaDePago,
  iniciarEntornoDePagos,
  notificar,
  pagarConYape,
  PLAN_BASICO,
  PLAN_PRO,
} from '../../helpers/pagos';
import { pagoEnRevision, revisar } from '../../helpers/comprobantes';
import { tokenPlataformaPara } from '../../helpers/sesiones';
import { decidirEnSimulador } from '../../helpers/simulador';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T041 · Cobertura derivada (M2): subscription_period es la fuente de verdad y subscription.current_period_end
// su copia, actualizada en la MISMA transacción. Después de cada operación que crea períodos la copia es el
// mayor fin de los períodos (o el fin de la prueba, sin períodos), y una transacción que falla a mitad no deja
// los dos valores distintos. US2, US3 y US5 agregan sus casos (vencimiento, revisión y activación manual).

async function coberturaDe(suscripcionId: string) {
  const { rows } = await poolDe('seed').query(
    `SELECT s.current_period_end AS copia,
            greatest(s.trial_ends_at, (SELECT max(ends_at) FROM subscription_period p WHERE p.subscription_id = s.id))
              AS derivada,
            (SELECT count(*)::int FROM subscription_period p WHERE p.subscription_id = s.id) AS periodos
       FROM subscription s WHERE s.id = $1`,
    [suscripcionId],
  );
  return rows[0] as { copia: Date; derivada: Date; periodos: number };
}

describe('Cobertura derivada: current_period_end coincide con los períodos (M2)', () => {
  let entorno: EntornoDePagos;

  beforeAll(async () => {
    entorno = await iniciarEntornoDePagos();
  });

  afterAll(async () => {
    await entorno.cerrar();
    await cerrarPools();
  });

  it('sin períodos, la copia es el fin de la prueba', async () => {
    const b = await barberiaEnPrueba();
    const cobertura = await coberturaDe(b.suscripcionId);
    expect(cobertura).toEqual({ copia: b.finPrueba, derivada: b.finPrueba, periodos: 0 });
  });

  it('tras la aprobación por notificación', async () => {
    const b = await barberiaEnPrueba();
    const { body } = await pagarConYape(entorno.prueba, b.token).expect(201);
    await notificar(entorno.prueba, {
      referencia: (await filaDePago(body.pago.id)).provider_reference as string,
    }).expect(200);
    const cobertura = await coberturaDe(b.suscripcionId);
    expect(cobertura.periodos).toBe(1);
    expect(cobertura.copia).toEqual(cobertura.derivada);
    expect(cobertura.copia.getTime()).toBeGreaterThan(b.finPrueba.getTime());
  });

  it('tras la aprobación por conciliación', async () => {
    const b = await barberiaEnPrueba();
    const { body } = await pagarConYape(entorno.prueba, b.token).expect(201);
    const referencia = (await filaDePago(body.pago.id)).provider_reference as string;
    await poolDe('seed').query(
      `UPDATE payment SET created_at = now() - interval '11 minutes' WHERE id = $1`,
      [body.pago.id],
    );
    await decidirEnSimulador(entorno.simulador, referencia, 'aprobar', { notificar: false });
    await entorno.prueba.app.get(EjecutorTareas).ejecutarAhora('conciliar-pagos');
    const cobertura = await coberturaDe(b.suscripcionId);
    expect(cobertura.periodos).toBe(1);
    expect(cobertura.copia).toEqual(cobertura.derivada);
  });

  it('tras cada transición del vencimiento (US2), la copia sigue coincidiendo con los períodos', async () => {
    const DIA = 24 * 60 * 60 * 1000;
    const seed = poolDe('seed');
    const vencer = () => entorno.prueba.app.get(EjecutorTareas).ejecutarAhora('vencer-suscripciones');
    /** Suscripción en TRIAL con la prueba terminada en `inicio` y un período por cada plan, uno tras otro. */
    const preparar = async (inicio: Date, planes: string[]) => {
      const b = await barberiaEnPrueba();
      let desde = inicio;
      for (const plan of planes) {
        const { pagoId } = await sembrarPago({
          tenantId: b.tenantId,
          suscripcionId: b.suscripcionId,
          metodo: 'TRANSFERENCIA',
          estado: 'APROBADO',
          plan: plan === PLAN_PRO ? 'PRO' : 'BASICO',
          cubreDesde: desde,
        });
        const hasta = sumarUnMes(desde);
        await seed.query(
          `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [uuidv7(), b.tenantId, b.suscripcionId, pagoId, plan, desde, hasta],
        );
        desde = hasta;
      }
      await seed.query('UPDATE subscription SET trial_ends_at = $2, current_period_end = $3 WHERE id = $1', [
        b.suscripcionId,
        inicio,
        desde,
      ]);
      return b;
    };

    const casos = [
      { inicio: new Date(Date.now() - DIA), planes: [], estado: 'EXPIRED' },
      { inicio: new Date(Date.now() - DIA), planes: [PLAN_BASICO], estado: 'ACTIVE' },
      { inicio: new Date(Date.now() - 32 * DIA), planes: [PLAN_BASICO, PLAN_PRO], estado: 'ACTIVE' },
      { inicio: new Date(Date.now() - 33 * DIA), planes: [PLAN_BASICO], estado: 'PAST_DUE' },
      { inicio: new Date(Date.now() - 45 * DIA), planes: [PLAN_BASICO], estado: 'EXPIRED' },
    ];
    const suscripciones = [];
    for (const caso of casos) suscripciones.push(await preparar(caso.inicio, caso.planes));
    await vencer();
    for (const [i, b] of suscripciones.entries()) {
      const { rows } = await seed.query('SELECT status FROM subscription WHERE id = $1', [b.suscripcionId]);
      expect(rows[0].status).toBe(casos[i].estado);
      const cobertura = await coberturaDe(b.suscripcionId);
      expect(cobertura.periodos).toBe(casos[i].planes.length);
      expect(cobertura.copia).toEqual(cobertura.derivada);
    }
  });

  it('tras aprobar un comprobante de transferencia (US3)', async () => {
    const b = await barberiaEnPrueba();
    const { pagoId } = await pagoEnRevision(entorno.prueba, b.token);
    const { token } = await tokenPlataformaPara();
    await revisar(entorno.prueba, token, b.tenantId, pagoId, {
      resultado: 'APROBADO',
      importeTransferidoCentimos: 4900,
    }).expect(200);
    const cobertura = await coberturaDe(b.suscripcionId);
    expect(cobertura.periodos).toBe(1);
    expect(cobertura.copia).toEqual(cobertura.derivada);
    expect(cobertura.copia.getTime()).toBeGreaterThan(b.finPrueba.getTime());
  });

  it('tras una activación manual del administrador (US5)', async () => {
    const b = await barberiaEnPrueba();
    const { token } = await tokenPlataformaPara();
    const { body } = await entorno.prueba.agente
      .post(`/api/v1/plataforma/barberias/${b.tenantId}/activacion-manual`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planId: PLAN_PRO, motivo: 'Pago en efectivo en la oficina', referenciaExterna: 'REC-0042' })
      .expect(201);
    const cobertura = await coberturaDe(b.suscripcionId);
    expect(cobertura.periodos).toBe(1);
    expect(cobertura.copia).toEqual(cobertura.derivada);
    // El período empieza al terminar la prueba y la copia es su fin: un mes calendario después.
    expect(new Date(body.periodo.iniciaEn)).toEqual(b.finPrueba);
    expect(cobertura.copia).toEqual(sumarUnMes(b.finPrueba));
  });

  it('una activación manual que falla a mitad no deja ni el pago, ni el período, ni la copia cambiada', async () => {
    const conFalla = await iniciarEntornoDePagos({
      ajustar: (constructor) =>
        constructor.overrideProvider(AvanzarSuscripcion).useValue({
          ejecutar: async () => {
            throw new Error('falla simulada después de insertar el período');
          },
        }),
    });
    try {
      const b = await barberiaEnPrueba();
      const { token } = await tokenPlataformaPara();
      await conFalla.prueba.agente
        .post(`/api/v1/plataforma/barberias/${b.tenantId}/activacion-manual`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          planId: PLAN_BASICO,
          motivo: 'Pago en efectivo en la oficina',
          referenciaExterna: 'REC-0043',
        })
        .expect(500);
      expect(await coberturaDe(b.suscripcionId)).toEqual({
        copia: b.finPrueba,
        derivada: b.finPrueba,
        periodos: 0,
      });
      const { rows } = await poolDe('seed').query(
        'SELECT count(*)::int AS total FROM payment WHERE tenant_id = $1',
        [b.tenantId],
      );
      expect(rows[0].total).toBe(0);
    } finally {
      await conFalla.cerrar();
    }
  });

  it('un número de operación repetido deshace la aprobación entera: ni período ni copia cambiada', async () => {
    const { token } = await tokenPlataformaPara();
    const primera = await barberiaEnPrueba();
    const { numero, pagoId: aprobado } = await pagoEnRevision(entorno.prueba, primera.token);
    await revisar(entorno.prueba, token, primera.tenantId, aprobado, {
      resultado: 'APROBADO',
      importeTransferidoCentimos: 4900,
    }).expect(200);
    const b = await barberiaEnPrueba();
    const { pagoId } = await pagoEnRevision(entorno.prueba, b.token, { numero });
    await revisar(entorno.prueba, token, b.tenantId, pagoId, {
      resultado: 'APROBADO',
      importeTransferidoCentimos: 4900,
    }).expect(409);
    expect(await coberturaDe(b.suscripcionId)).toEqual({
      copia: b.finPrueba,
      derivada: b.finPrueba,
      periodos: 0,
    });
  });

  it('una aprobación que falla a mitad no deja ni el período ni la copia cambiada', async () => {
    const conFalla = await iniciarEntornoDePagos({
      ajustar: (constructor) =>
        constructor.overrideProvider(AvanzarSuscripcion).useValue({
          ejecutar: async () => {
            throw new Error('falla simulada después de insertar el período');
          },
        }),
    });
    try {
      const b = await barberiaEnPrueba();
      const { body } = await pagarConYape(conFalla.prueba, b.token).expect(201);
      await notificar(conFalla.prueba, {
        referencia: (await filaDePago(body.pago.id)).provider_reference as string,
      }).expect(500);
      expect(await coberturaDe(b.suscripcionId)).toEqual({
        copia: b.finPrueba,
        derivada: b.finPrueba,
        periodos: 0,
      });
      expect((await filaDePago(body.pago.id)).status).toBe('PENDIENTE');
    } finally {
      await conFalla.cerrar();
    }
  });
});
