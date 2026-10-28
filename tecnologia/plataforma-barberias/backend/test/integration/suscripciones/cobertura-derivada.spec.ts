import { AvanzarSuscripcion } from '../../../src/modules/suscripciones-pagos/suscripciones/application/avanzar-suscripcion';
import { EjecutorTareas } from '../../../src/shared';
import {
  barberiaEnPrueba,
  type EntornoDePagos,
  filaDePago,
  iniciarEntornoDePagos,
  notificar,
  pagarConYape,
} from '../../helpers/pagos';
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
