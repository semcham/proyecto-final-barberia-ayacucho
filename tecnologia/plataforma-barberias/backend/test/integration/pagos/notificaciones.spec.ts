import { Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { sumarUnMes } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import { crearApp } from '../../helpers/app';
import { filasDe, sembrarPago } from '../../helpers/fixtures';
import {
  type BarberiaEnPrueba,
  barberiaEnPrueba,
  type EntornoDePagos,
  esperarHasta,
  filaDePago,
  iniciarEntornoDePagos,
  notificacionFirmada,
  notificar,
  pagarConYape,
  periodosDe,
  PLAN_PRO,
  RUTA_NOTIFICACIONES,
} from '../../helpers/pagos';
import { decidirEnSimulador } from '../../helpers/simulador';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T035 · PR17: notificaciones del proveedor (FR-013 a FR-018; research R03; data-model.md §3). Firma HMAC
// en tiempo constante con ±5 min, idempotencia por evento_id, aplicación atómica con el tenant del pago,
// regla de aprobación (período objetivo y tope por adelantado, H1) y "el dinero recibido nunca se ignora".

const seed = () => poolDe('seed');

async function eventosDe(pagoId: string) {
  const { rows } = await seed().query('SELECT event_id, effect FROM provider_event WHERE payment_id = $1', [
    pagoId,
  ]);
  return rows as { event_id: string; effect: string }[];
}

async function aprobacionesAuditadas(tenantId: string, pagoId: string): Promise<number> {
  return (await filasDe('audit_log', tenantId)).filter(
    (f) => f.action === 'PAGO_APROBADO' && f.resource === `pago:${pagoId}`,
  ).length;
}

describe('PR17 · Notificaciones del proveedor', () => {
  let entorno: EntornoDePagos;
  let registro = '';
  const restaurar: (() => void)[] = [];

  /** Barbería en prueba con un pago Yape iniciado por la API (con su sesión en el simulador). */
  async function pagoIniciado(
    planId?: string,
  ): Promise<{ b: BarberiaEnPrueba; pagoId: string; referencia: string }> {
    const b = await barberiaEnPrueba();
    const { body } = await pagarConYape(entorno.prueba, b.token, planId).expect(201);
    const fila = await filaDePago(body.pago.id);
    return { b, pagoId: body.pago.id, referencia: fila.provider_reference as string };
  }

  beforeAll(async () => {
    entorno = await iniciarEntornoDePagos();
    for (const metodo of ['log', 'warn', 'error']) {
      const original = console[metodo as 'log'];
      console[metodo as 'log'] = (...args: unknown[]) => {
        registro += `${args.map(String).join(' ')}\n`;
      };
      restaurar.push(() => (console[metodo as 'log'] = original));
    }
    // Todo lo que se registra con el Logger de Nest, sin depender de sus niveles ni de su salida.
    for (const metodo of ['log', 'warn', 'error'] as const) {
      const espia = jest.spyOn(Logger.prototype, metodo).mockImplementation((...args: unknown[]) => {
        registro += `${args.map(String).join(' ')}\n`;
      });
      restaurar.push(() => espia.mockRestore());
    }
  });

  afterAll(async () => {
    restaurar.forEach((deshacer) => deshacer());
    await entorno.cerrar();
    await cerrarPools();
  });

  it('una notificación válida aprueba el pago y crea el período al terminar la prueba (escenario 6)', async () => {
    const { b, pagoId, referencia } = await pagoIniciado();
    await decidirEnSimulador(entorno.simulador, referencia, 'aprobar');
    await esperarHasta(async () => (await filaDePago(pagoId)).status === 'APROBADO');
    await entorno.simulador.esperarNotificaciones();
    const periodos = await periodosDe(b.suscripcionId);
    expect(periodos).toEqual([
      { starts_at: b.finPrueba, ends_at: sumarUnMes(b.finPrueba), payment_id: pagoId },
    ]);
    expect(await eventosDe(pagoId)).toEqual([{ event_id: expect.any(String), effect: 'APLICADO' }]);
    // La suscripción sigue en prueba hasta que termine (pago durante la prueba).
    const { rows } = await seed().query('SELECT status FROM subscription WHERE id = $1', [b.suscripcionId]);
    expect(rows[0].status).toBe('TRIAL');
    expect(await aprobacionesAuditadas(b.tenantId, pagoId)).toBe(1);
  });

  it('la misma notificación 10 veces: 1 período, 1 transición y 10 respuestas 200', async () => {
    const { b, pagoId, referencia } = await pagoIniciado();
    const { cuerpo, firma } = notificacionFirmada({ referencia });
    const respuestas = [];
    for (let i = 0; i < 10; i += 1) {
      respuestas.push(
        await entorno.prueba.agente
          .post(RUTA_NOTIFICACIONES)
          .set('Content-Type', 'application/json')
          .set('X-Firma', firma)
          .send(cuerpo),
      );
    }
    expect(respuestas.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
    expect(await eventosDe(pagoId)).toHaveLength(1);
    expect(await aprobacionesAuditadas(b.tenantId, pagoId)).toBe(1);
  });

  it('el reenvío días después, con t nuevo y el mismo evento_id, responde 200 sin efecto', async () => {
    const { b, pagoId, referencia } = await pagoIniciado();
    const eventoId = `evt_${uuidv7().replace(/-/g, '')}`;
    await notificar(entorno.prueba, { referencia, eventoId, t: Math.floor(Date.now() / 1000) - 200 }).expect(
      200,
    );
    await notificar(entorno.prueba, { referencia, eventoId }).expect(200);
    expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
    expect(await eventosDe(pagoId)).toHaveLength(1);
  });

  describe('firma inválida, ausente o vencida: 401, sin ningún efecto y con un registro resumido', () => {
    it.each([
      ['otra firma', { secreto: 'otro-secreto-cualquiera-0123456789' }],
      ['marca de tiempo vencida', { t: Math.floor(Date.now() / 1000) - 360 }],
    ])('%s', async (_caso, cambio) => {
      const { pagoId, referencia } = await pagoIniciado();
      const { cuerpo, firma, eventoId } = notificacionFirmada({ referencia, ...cambio });
      registro = '';
      await entorno.prueba.agente
        .post(RUTA_NOTIFICACIONES)
        .set('Content-Type', 'application/json')
        .set('X-Firma', firma)
        .send(cuerpo)
        .expect(401);
      expect((await filaDePago(pagoId)).status).toBe('PENDIENTE');
      const { rows } = await seed().query('SELECT 1 FROM provider_event WHERE event_id = $1', [eventoId]);
      expect(rows).toEqual([]);
      expect(registro).toContain('PAGO_NOTIFICACION_RECHAZADA');
      expect(registro).not.toContain(referencia);
      expect(registro).not.toContain(eventoId);
    });

    it('sin el encabezado X-Firma', async () => {
      const { pagoId, referencia } = await pagoIniciado();
      const { cuerpo } = notificacionFirmada({ referencia });
      await entorno.prueba.agente
        .post(RUTA_NOTIFICACIONES)
        .set('Content-Type', 'application/json')
        .send(cuerpo)
        .expect(401);
      expect((await filaDePago(pagoId)).status).toBe('PENDIENTE');
    });

    it('un cuerpo alterado tras firmar', async () => {
      const { pagoId, referencia } = await pagoIniciado();
      const { cuerpo, firma } = notificacionFirmada({ referencia });
      await entorno.prueba.agente
        .post(RUTA_NOTIFICACIONES)
        .set('Content-Type', 'application/json')
        .set('X-Firma', firma)
        .send(cuerpo.replace('4900', '100'))
        .expect(401);
      expect((await filaDePago(pagoId)).status).toBe('PENDIENTE');
    });
  });

  it('un PENDIENTE atrasado después del APROBADO no tiene efecto', async () => {
    const { pagoId, referencia } = await pagoIniciado();
    await notificar(entorno.prueba, { referencia }).expect(200);
    await notificar(entorno.prueba, { referencia, estado: 'PENDIENTE' }).expect(200);
    expect((await filaDePago(pagoId)).status).toBe('APROBADO');
    expect((await eventosDe(pagoId)).map((e) => e.effect).sort()).toEqual(['APLICADO', 'SIN_EFECTO']);
  });

  it('un importe distinto no crea período y deja la marca IMPORTE_DISTINTO', async () => {
    const { b, pagoId, referencia } = await pagoIniciado();
    await notificar(entorno.prueba, { referencia, importeCentimos: 4800 }).expect(200);
    const fila = await filaDePago(pagoId);
    expect([fila.status, fila.review]).toEqual(['APROBADO', 'IMPORTE_DISTINTO']);
    expect(await periodosDe(b.suscripcionId)).toEqual([]);
    expect((await eventosDe(pagoId))[0].effect).toBe('REVISION');
  });

  it('una referencia desconocida queda registrada como SIN_PAGO para el administrador', async () => {
    const { eventoId } = notificacionFirmada({ referencia: 'ses_que_nadie_conoce' });
    await notificar(entorno.prueba, { referencia: 'ses_que_nadie_conoce', eventoId }).expect(200);
    const { rows } = await seed().query(
      'SELECT effect, tenant_id, payment_id FROM provider_event WHERE event_id = $1',
      [eventoId],
    );
    expect(rows).toEqual([{ effect: 'SIN_PAGO', tenant_id: null, payment_id: null }]);
  });

  describe('el dinero recibido nunca se ignora (FR-012a) y el período objetivo no se cobra dos veces (H1)', () => {
    it('un Yape anulado que se terminó de pagar se aprueba; otro pago del mismo período queda DUPLICADO', async () => {
      // El propietario cambia de plan: el primer pago (BÁSICO) queda ANULADO y nace otro (PRO).
      const primero = await pagoIniciado();
      const { body } = await pagarConYape(entorno.prueba, primero.b.token, PLAN_PRO).expect(201);
      const segundo = {
        pagoId: body.pago.id,
        referencia: (await filaDePago(body.pago.id)).provider_reference as string,
      };
      expect((await filaDePago(primero.pagoId)).status).toBe('ANULADO');

      await notificar(entorno.prueba, { referencia: primero.referencia }).expect(200);
      expect((await filaDePago(primero.pagoId)).status).toBe('APROBADO');
      expect(await periodosDe(primero.b.suscripcionId)).toHaveLength(1);

      await notificar(entorno.prueba, { referencia: segundo.referencia, importeCentimos: 8900 }).expect(200);
      const fila = await filaDePago(segundo.pagoId);
      expect([fila.status, fila.review]).toEqual(['APROBADO', 'DUPLICADO']);
      // No se crea otro período, aunque el siguiente no se solaparía.
      expect(await periodosDe(primero.b.suscripcionId)).toHaveLength(1);
      expect((await eventosDe(segundo.pagoId))[0].effect).toBe('REVISION');
    });

    it('un pago EXPIRADO aprobado después se aplica', async () => {
      const { b, pagoId, referencia } = await pagoIniciado();
      await seed().query(`UPDATE payment SET status = 'EXPIRADO', closed_at = now() WHERE id = $1`, [pagoId]);
      await notificar(entorno.prueba, { referencia }).expect(200);
      expect((await filaDePago(pagoId)).status).toBe('APROBADO');
      expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
    });

    it('un pago que al aprobarse excedería el tope de un período por adelantado queda DUPLICADO', async () => {
      const b = await barberiaEnPrueba();
      // Ya hay un período pagado que empieza al terminar la prueba...
      const pagado = await sembrarPago({
        tenantId: b.tenantId,
        suscripcionId: b.suscripcionId,
        metodo: 'TRANSFERENCIA',
        estado: 'APROBADO',
        cubreDesde: b.finPrueba,
      });
      await seed().query(
        `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
         SELECT $1, $2, $3, $4, plan_id, $5, $6 FROM payment WHERE id = $4`,
        [uuidv7(), b.tenantId, b.suscripcionId, pagado.pagoId, b.finPrueba, sumarUnMes(b.finPrueba)],
      );
      // ...y un pago en línea cuyo período objetivo sería el siguiente (dos por adelantado).
      const otro = await sembrarPago({
        tenantId: b.tenantId,
        suscripcionId: b.suscripcionId,
        estado: 'EXPIRADO',
        cubreDesde: sumarUnMes(b.finPrueba),
      });
      await notificar(entorno.prueba, { referencia: otro.referencia }).expect(200);
      const fila = await filaDePago(otro.pagoId);
      expect([fila.status, fila.review]).toEqual(['APROBADO', 'DUPLICADO']);
      expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
    });
  });

  it('un APROBADO después de un RECHAZADO queda con la marca y sin período (FR-017)', async () => {
    const { b, pagoId, referencia } = await pagoIniciado();
    await notificar(entorno.prueba, { referencia, estado: 'RECHAZADO' }).expect(200);
    await notificar(entorno.prueba, { referencia }).expect(200);
    const fila = await filaDePago(pagoId);
    expect([fila.status, fila.review]).toEqual(['RECHAZADO', 'APROBADO_TRAS_RECHAZO']);
    expect(await periodosDe(b.suscripcionId)).toEqual([]);
  });

  it('una devolución deja la marca DEVOLUCION y no cambia la suscripción (FR-017a)', async () => {
    const { b, pagoId, referencia } = await pagoIniciado();
    await notificar(entorno.prueba, { referencia }).expect(200);
    const antes = await seed().query('SELECT status, current_period_end FROM subscription WHERE id = $1', [
      b.suscripcionId,
    ]);
    await notificar(entorno.prueba, { referencia, estado: 'DEVUELTO' }).expect(200);
    const fila = await filaDePago(pagoId);
    expect([fila.status, fila.review]).toEqual(['APROBADO', 'DEVOLUCION']);
    expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
    const despues = await seed().query('SELECT status, current_period_end FROM subscription WHERE id = $1', [
      b.suscripcionId,
    ]);
    expect(despues.rows).toEqual(antes.rows);
  });

  it('dos aprobaciones distintas del mismo pago a la vez crean un solo período', async () => {
    const { b, pagoId, referencia } = await pagoIniciado();
    const respuestas = await Promise.all([
      notificar(entorno.prueba, { referencia }),
      notificar(entorno.prueba, { referencia }),
    ]);
    expect(respuestas.map((r) => r.status)).toEqual([200, 200]);
    expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
    expect((await eventosDe(pagoId)).map((e) => e.effect).sort()).toEqual(['APLICADO', 'SIN_EFECTO']);
    expect(await aprobacionesAuditadas(b.tenantId, pagoId)).toBe(1);
  });

  it('más notificaciones por minuto que el límite desde una IP responden 429 (FR-013a)', async () => {
    const anterior = process.env.PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO;
    process.env.PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO = '5';
    // Aplicación propia: sus contadores del límite empiezan en cero.
    const otra = await crearApp();
    try {
      const estados: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        estados.push((await notificar(otra, { referencia: 'ses_limite_de_prueba' })).status);
      }
      expect(estados).toEqual([200, 200, 200, 200, 200, 429]);
    } finally {
      if (anterior === undefined) delete process.env.PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO;
      else process.env.PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO = anterior;
      await otra.cerrar();
    }
  });

  it('responde rápido: el p95 de 50 notificaciones válidas queda bajo 300 ms y ninguna supera 1 s (FR-018)', async () => {
    const b = await barberiaEnPrueba();
    const pagos = [];
    for (let i = 0; i < 50; i += 1) {
      pagos.push(
        await sembrarPago({
          tenantId: b.tenantId,
          suscripcionId: b.suscripcionId,
          estado: 'EXPIRADO',
          cubreDesde: b.finPrueba,
        }),
      );
    }
    const tiempos: number[] = [];
    for (const pago of pagos) {
      const inicio = performance.now();
      await notificar(entorno.prueba, { referencia: pago.referencia }).expect(200);
      tiempos.push(performance.now() - inicio);
    }
    tiempos.sort((x, y) => x - y);
    const p95 = tiempos[Math.ceil(0.95 * tiempos.length) - 1];
    expect({ p95: p95 < 300, maximo: (tiempos.at(-1) as number) < 1000 }).toEqual({
      p95: true,
      maximo: true,
    });
    // Una sola aprobación aplicó período; las demás del mismo período objetivo quedaron DUPLICADO.
    expect(await periodosDe(b.suscripcionId)).toHaveLength(1);
  });
});
