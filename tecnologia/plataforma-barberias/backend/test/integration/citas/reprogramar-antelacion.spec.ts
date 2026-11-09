import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarCita } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T039 · Antelación para reprogramar (US1-5; FR-006; SC-012). El cliente necesita la misma antelación mínima de
// cancelación de su barbería (120 min por defecto): con menos, 422 SIN_ANTELACION_PARA_REPROGRAMAR con
// puedeCancelar=true y la cita no cambia. El propietario no tiene esa regla.

const MINUTO = 60_000;

describe('Antelación para reprogramar (T039, US1-5)', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  const como = (token: string) => ({ Authorization: `Bearer ${token}` });
  const destino = horaLima(fechaEnDias(3), '10:00');

  /** Cita del cliente que empieza dentro de `minutos` minutos (redondeados al minuto). */
  async function citaDentroDe(minutos: number, barberoId: string) {
    const sesion = await sesionCliente(e.barberia.tenantId);
    const inicio = new Date(Math.ceil((Date.now() + minutos * MINUTO) / MINUTO) * MINUTO);
    const citaId = await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId,
      servicioId: e.servicioId,
      clienteId: sesion.cliente.clienteId,
      inicio,
    });
    return { ...sesion, citaId, inicio };
  }

  const inicioDe = async (citaId: string) =>
    (await poolDe('seed').query('SELECT starts_at, version FROM appointment WHERE id = $1', [citaId]))
      .rows[0];

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('el cliente sin antelación recibe 422 SIN_ANTELACION_PARA_REPROGRAMAR con puedeCancelar y la cita no cambia', async () => {
    const c = await citaDentroDe(60, e.barberoId);
    const { body } = await prueba.agente
      .post(`/api/v1/citas/${c.citaId}/reprogramar`)
      .set(como(c.token))
      .send({ inicio: destino })
      .expect(422);
    expect(body.codigo).toBe('SIN_ANTELACION_PARA_REPROGRAMAR');
    expect(body.mensaje).toMatch(/ya no se puede reprogramar/i);
    expect(body.detalles).toEqual([{ puedeCancelar: true }]);
    expect(await inicioDe(c.citaId)).toEqual({ starts_at: c.inicio, version: 1 });

    // La interfaz le ofrece cancelar: sigue pudiendo hacerlo (será una cancelación tardía).
    const cancelada = await prueba.agente
      .post(`/api/v1/citas/${c.citaId}/cancelar`)
      .set(como(c.token))
      .expect(200);
    expect(cancelada.body).toMatchObject({ estado: 'CANCELADA', cancelacionTardia: true });
  });

  it('con antelación suficiente el cliente reprograma', async () => {
    const c = await citaDentroDe(180, e.otroBarberoId);
    await prueba.agente
      .post(`/api/v1/citas/${c.citaId}/reprogramar`)
      .set(como(c.token))
      .send({ inicio: horaLima(fechaEnDias(3), '11:00'), barberoId: e.otroBarberoId })
      .expect(200);
    expect((await inicioDe(c.citaId)).version).toBe(2);
  });

  it('el propietario reprograma aunque falte menos que la antelación', async () => {
    const c = await citaDentroDe(30, e.barberoId);
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const { body } = await prueba.agente
      .post(`/api/v1/citas/${c.citaId}/reprogramar`)
      .set(como(propietario))
      .send({ inicio: horaLima(fechaEnDias(3), '12:00') })
      .expect(200);
    expect(body).toMatchObject({ cambio: true, cita: { inicio: horaLima(fechaEnDias(3), '12:00') } });
  });
});
