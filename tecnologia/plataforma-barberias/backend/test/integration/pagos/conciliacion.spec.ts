import { EjecutorTareas } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  barberiaEnPrueba,
  type EntornoDePagos,
  filaDePago,
  iniciarEntornoDePagos,
  notificar,
  pagarConYape,
  periodosDe,
} from '../../helpers/pagos';
import { decidirEnSimulador } from '../../helpers/simulador';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T040 · Conciliación (principio V; FR-026 a FR-028; ADR-024), en P1: un pago aprobado en el proveedor cuya
// notificación nunca llegó queda aprobado; los rechazados o vencidos en el proveedor se cierran; los que
// llevan 24 h sin respuesta expiran; con el proveedor caído no cambia nada; y con dos réplicas a la vez cada
// pago se consulta una sola vez.

const seed = () => poolDe('seed');

describe('Conciliación de pagos en línea (T040)', () => {
  let entorno: EntornoDePagos;

  const conciliar = (prueba: AppDePrueba = entorno.prueba) =>
    prueba.app.get(EjecutorTareas).ejecutarAhora('conciliar-pagos');

  /** Pago Yape iniciado por la API, con su sesión en el simulador, creado hace `minutos`. */
  async function pagoPendiente(minutos = 11) {
    const b = await barberiaEnPrueba();
    const { body } = await pagarConYape(entorno.prueba, b.token).expect(201);
    await seed().query(`UPDATE payment SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [
      body.pago.id,
      minutos,
    ]);
    return {
      b,
      pagoId: body.pago.id as string,
      referencia: (await filaDePago(body.pago.id)).provider_reference as string,
    };
  }

  const consultasA = (referencia: string) =>
    entorno.simulador
      .solicitudes()
      .filter((s) => s.metodo === 'GET' && s.ruta === `/v1/sesiones/${referencia}`).length;

  beforeAll(async () => {
    entorno = await iniciarEntornoDePagos();
  });

  afterEach(async () => {
    await entorno.simulador.cambiarModo({ modo: 'normal' });
  });

  afterAll(async () => {
    await entorno.cerrar();
    await cerrarPools();
  });

  it('un pago aprobado en el proveedor sin notificación queda aprobado, con un solo período', async () => {
    const { b, pagoId, referencia } = await pagoPendiente();
    await decidirEnSimulador(entorno.simulador, referencia, 'aprobar', { notificar: false });
    await expect(conciliar()).resolves.toMatchObject({ ejecutada: true });
    expect((await filaDePago(pagoId)).status).toBe('APROBADO');
    expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
    // Una segunda corrida no lo vuelve a tocar: ya no está pendiente.
    await conciliar();
    expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
  });

  it('uno rechazado en el proveedor queda RECHAZADO; uno cancelado o vencido allí, EXPIRADO', async () => {
    const rechazado = await pagoPendiente();
    await decidirEnSimulador(entorno.simulador, rechazado.referencia, 'rechazar', { notificar: false });
    const vencido = await pagoPendiente();
    await fetch(`${entorno.simulador.url}/v1/sesiones/${vencido.referencia}/cancelar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.PAGOS_LLAVE_SECRETA}` },
    });
    await conciliar();
    expect((await filaDePago(rechazado.pagoId)).status).toBe('RECHAZADO');
    expect((await filaDePago(vencido.pagoId)).status).toBe('EXPIRADO');
  });

  it('uno pendiente de menos de 10 minutos no se toca', async () => {
    const { pagoId, referencia } = await pagoPendiente(5);
    await decidirEnSimulador(entorno.simulador, referencia, 'aprobar', { notificar: false });
    await conciliar();
    expect((await filaDePago(pagoId)).status).toBe('PENDIENTE');
    expect(consultasA(referencia)).toBe(0);
  });

  it('uno pendiente de 24 h expira; una aprobación posterior se aplica, o queda DUPLICADO si su período ya está tomado', async () => {
    const primero = await pagoPendiente(24 * 60 + 1);
    await conciliar();
    expect((await filaDePago(primero.pagoId)).status).toBe('EXPIRADO');

    // El proveedor aprueba después: el dinero recibido nunca se ignora (FR-012a).
    await notificar(entorno.prueba, { referencia: primero.referencia }).expect(200);
    expect((await filaDePago(primero.pagoId)).status).toBe('APROBADO');
    expect(await periodosDe(primero.b.suscripcionId)).toHaveLength(1);

    // Con ese período ya pagado por adelantado, no se puede iniciar otro pago.
    const { body } = await pagarConYape(entorno.prueba, primero.b.token).expect(409);
    expect(body.codigo).toBe('PAGO_ADELANTADO_NO_PERMITIDO');
  });

  it('un pago expirado por la conciliación y aprobado tarde, con su período ya tomado por otro, queda DUPLICADO', async () => {
    const a = await pagoPendiente(24 * 60 + 1);
    await conciliar();
    expect((await filaDePago(a.pagoId)).status).toBe('EXPIRADO');
    // La barbería paga de nuevo (el anterior expiró) y ese pago se aprueba primero.
    const { body } = await pagarConYape(entorno.prueba, a.b.token).expect(201);
    await notificar(entorno.prueba, {
      referencia: (await filaDePago(body.pago.id)).provider_reference as string,
    }).expect(200);
    // Llega tarde la aprobación del expirado: mismo período objetivo, ya tomado.
    await notificar(entorno.prueba, { referencia: a.referencia }).expect(200);
    const fila = await filaDePago(a.pagoId);
    expect([fila.status, fila.review]).toEqual(['APROBADO', 'DUPLICADO']);
    expect(await periodosDe(a.b.suscripcionId)).toHaveLength(1);
  });

  it('la conciliación y la notificación a la vez producen un solo efecto', async () => {
    const { b, pagoId, referencia } = await pagoPendiente();
    await decidirEnSimulador(entorno.simulador, referencia, 'aprobar', { notificar: false });
    await Promise.all([conciliar(), notificar(entorno.prueba, { referencia })]);
    expect((await filaDePago(pagoId)).status).toBe('APROBADO');
    expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
    const { rows } = await seed().query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action = 'PAGO_APROBADO'`,
      [b.tenantId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('con el proveedor caído no cambia nada y se reintenta en la siguiente corrida', async () => {
    const { b, pagoId, referencia } = await pagoPendiente();
    await decidirEnSimulador(entorno.simulador, referencia, 'aprobar', { notificar: false });
    await entorno.simulador.cambiarModo({ modo: 'caido' });
    const corrida = await conciliar();
    expect(corrida).toMatchObject({ ejecutada: true });
    expect((corrida as { fallidos: number }).fallidos).toBeGreaterThanOrEqual(1);
    expect((await filaDePago(pagoId)).status).toBe('PENDIENTE');
    expect(await periodosDe(b.suscripcionId)).toEqual([]);

    await entorno.simulador.cambiarModo({ modo: 'normal' });
    // El interruptor pudo quedar abierto por las fallas: otra aplicación (otra réplica) lo reintenta.
    const otra = await crearApp();
    try {
      await conciliar(otra);
    } finally {
      await otra.cerrar();
    }
    expect((await filaDePago(pagoId)).status).toBe('APROBADO');
    expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
  });

  it('dos réplicas a la vez consultan cada pago una sola vez', async () => {
    const { pagoId, referencia } = await pagoPendiente();
    await decidirEnSimulador(entorno.simulador, referencia, 'aprobar', { notificar: false });
    const otra = await crearApp();
    try {
      // Si coinciden, una encuentra el candado tomado; si no, la segunda ya no encuentra el pago pendiente.
      await Promise.all([conciliar(), conciliar(otra)]);
    } finally {
      await otra.cerrar();
    }
    expect((await filaDePago(pagoId)).status).toBe('APROBADO');
    expect(consultasA(referencia)).toBe(1);
  });
});
