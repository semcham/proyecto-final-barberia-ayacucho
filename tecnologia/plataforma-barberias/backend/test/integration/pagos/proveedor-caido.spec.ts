import { barberiaParaReservar, fechaEnDias, horaLima, nuevaClave } from '../../helpers/reservas';
import { sesionCliente } from '../../helpers/sesiones';
import {
  barberiaEnPrueba,
  type EntornoDePagos,
  filaDePago,
  iniciarEntornoDePagos,
  pagarConYape,
} from '../../helpers/pagos';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T037 · PR06: la pasarela caída o colgada (FR-044, EQ-06, SC-005; research R13). El propietario recibe
// "el pago en línea no está disponible" con la alternativa de transferencia en 3 s o menos, el pago intentado
// queda ANULADO, tras 5 fallos en 60 s el interruptor responde al instante, y el resto de la plataforma
// (reservas y vía pública) sigue funcionando.

describe('PR06 · Proveedor de pagos caído', () => {
  let entorno: EntornoDePagos;

  async function intentarPagar(): Promise<{
    estado: number;
    cuerpo: Record<string, unknown>;
    ms: number;
    pagoId?: string;
  }> {
    const b = await barberiaEnPrueba();
    const inicio = Date.now();
    const respuesta = await pagarConYape(entorno.prueba, b.token);
    const ms = Date.now() - inicio;
    const { rows } = await poolDe('seed').query('SELECT id FROM payment WHERE subscription_id = $1', [
      b.suscripcionId,
    ]);
    return { estado: respuesta.status, cuerpo: respuesta.body, ms, pagoId: rows[0]?.id };
  }

  beforeAll(async () => {
    // El tiempo límite real (2 s): es lo que se mide.
    entorno = await iniciarEntornoDePagos({ entorno: { PAGOS_TIEMPO_LIMITE_MS: '2000' } });
  });

  afterAll(async () => {
    await entorno.cerrar();
    await cerrarPools();
  });

  it('caído: 503 PAGO_EN_LINEA_NO_DISPONIBLE en 3 s o menos, con la alternativa de transferencia, y el pago ANULADO', async () => {
    await entorno.simulador.cambiarModo({ modo: 'caido' });
    const intento = await intentarPagar();
    expect(intento.estado).toBe(503);
    expect(intento.cuerpo).toEqual({
      codigo: 'PAGO_EN_LINEA_NO_DISPONIBLE',
      mensaje: expect.stringContaining('transferencia'),
      detalles: [{ alternativa: 'TRANSFERENCIA' }],
    });
    expect(intento.ms).toBeLessThanOrEqual(3000);
    expect((await filaDePago(intento.pagoId as string)).status).toBe('ANULADO');
  });

  it('colgado: corta en el tiempo límite de 2 s, con el mismo resultado', async () => {
    await entorno.simulador.cambiarModo({ modo: 'colgado' });
    const intento = await intentarPagar();
    expect(intento.estado).toBe(503);
    expect(intento.ms).toBeGreaterThanOrEqual(1900);
    expect(intento.ms).toBeLessThanOrEqual(3000);
    expect((await filaDePago(intento.pagoId as string)).status).toBe('ANULADO');
  });

  it('tras 5 fallos en 60 s el interruptor se abre: la respuesta llega en menos de 100 ms', async () => {
    await entorno.simulador.cambiarModo({ modo: 'caido' });
    // Ya fallaron 2 (caído y colgado); 3 más completan 5 dentro de la ventana.
    for (let i = 0; i < 3; i += 1) expect((await intentarPagar()).estado).toBe(503);
    await entorno.simulador.cambiarModo({ modo: 'normal' });
    const solicitudesAntes = entorno.simulador.solicitudes().length;
    const intento = await intentarPagar();
    expect(intento.estado).toBe(503);
    expect(intento.ms).toBeLessThan(100);
    // Mientras el circuito está abierto, la solicitud ni siquiera llega al proveedor.
    expect(entorno.simulador.solicitudes()).toHaveLength(solicitudesAntes);
  });

  it('durante la caída, una reserva y la vía pública siguen respondiendo', async () => {
    await entorno.simulador.cambiarModo({ modo: 'caido' });
    const e = await barberiaParaReservar();
    await entorno.prueba.agente.get(`/api/v1/publico/${e.barberia.slug}`).expect(200);
    const { token } = await sesionCliente(e.barberia.tenantId);
    await entorno.prueba.agente
      .post('/api/v1/citas')
      .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(fechaEnDias(3), '10:00') })
      .expect(201);
    await entorno.simulador.cambiarModo({ modo: 'normal' });
  });
});
