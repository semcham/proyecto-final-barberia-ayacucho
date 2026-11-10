import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  citaConEnlaces,
  emitirEnlace,
  filaDeCita,
  ipUnica,
  solicitudDeEnlace,
  usosDeEnlace,
} from '../../helpers/enlaces';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T080 · Rechazos de los enlaces (US3-7; FR-024, FR-025; SC-008; PR28; spec, casos límite). Firma inválida,
// vencido, ya usado, de otra acción, o de una cita cancelada, reprogramada o completada → 410 ENLACE_NO_VALIDO con
// el MISMO cuerpo y la cita sin cambios. Dos usos simultáneos en dos instancias → uno solo con efecto. Dos acciones
// a la vez sobre la misma cita (el propietario reprograma mientras el cliente cancela por el enlace) → exactamente
// una tiene efecto: si gana el enlace, el propietario recibe 409 CITA_CAMBIO; si gana el propietario, el enlace 410.

jest.setTimeout(120_000);

describe('Rechazos de los enlaces (T080)', () => {
  let a: AppDePrueba;
  let b: AppDePrueba;
  let e: BarberiaParaReservar;
  let propietario: string;
  let rechazoDeReferencia: Record<string, unknown>;

  /** Comprueba el 410 y que el cuerpo es idéntico al de cualquier otro rechazo (no revela el motivo). */
  async function esRechazo(respuesta: { status: number; body: Record<string, unknown> }) {
    expect(respuesta.status).toBe(410);
    expect(respuesta.body.codigo).toBe('ENLACE_NO_VALIDO');
    expect(respuesta.body).toEqual(rechazoDeReferencia);
  }

  beforeAll(async () => {
    a = await crearApp();
    b = await crearApp();
    e = await barberiaParaReservar();
    propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const inventado = await solicitudDeEnlace(a, 'consultar', 'no.es-un-enlace', ipUnica());
    rechazoDeReferencia = inventado.body;
    expect(inventado.status).toBe(410);
    expect(String(rechazoDeReferencia.mensaje)).toMatch(/inicia sesión/i);
  });

  afterAll(async () => {
    await Promise.all([a.cerrar(), b.cerrar()]);
    await cerrarPools();
  });

  it('firma inválida (token alterado) → 410 y la cita no cambia', async () => {
    const c = await citaConEnlaces(a, e, 300);
    const token = c.enlace('CANCELAR');
    // Se cambia el PRIMER carácter de la firma: el último de un base64url de 32 bytes solo lleva bits de relleno,
    // y cambiarlo no alteraría la firma decodificada.
    const punto = token.indexOf('.');
    const alterado = `${token.slice(0, punto + 1)}${token[punto + 1] === 'A' ? 'B' : 'A'}${token.slice(punto + 2)}`;
    await esRechazo(await solicitudDeEnlace(a, 'cancelar', alterado, ipUnica()));
    expect((await filaDeCita(c.citaId)).status).toBe('CONFIRMADA');
  });

  it('vencido (después de la hora de inicio) → 410', async () => {
    const c = await citaConEnlaces(a, e, 330);
    const vencido = emitirEnlace(a, {
      tenantId: e.barberia.tenantId,
      citaId: c.citaId,
      accion: 'CONFIRMAR',
      venceEn: new Date(Date.now() - 1000),
    });
    await esRechazo(await solicitudDeEnlace(a, 'confirmar', vencido, ipUnica()));
    expect((await filaDeCita(c.citaId)).client_confirmed_at).toBeNull();
  });

  it('ya usado: el mismo token por segunda vez → 410 (y su GET también)', async () => {
    const c = await citaConEnlaces(a, e, 390);
    const ip = ipUnica();
    const token = c.enlace('CONFIRMAR');
    await solicitudDeEnlace(a, 'confirmar', token, ip).expect(200);
    await esRechazo(await solicitudDeEnlace(a, 'confirmar', token, ip));
    await esRechazo(await solicitudDeEnlace(a, 'consultar', token, ip));
    expect(await usosDeEnlace(c.citaId)).toHaveLength(1);
  });

  it('de otra acción (un enlace de confirmar en /cancelar) → 410 y la cita no cambia', async () => {
    const c = await citaConEnlaces(a, e, 420);
    await esRechazo(await solicitudDeEnlace(a, 'cancelar', c.enlace('CONFIRMAR'), ipUnica()));
    expect((await filaDeCita(c.citaId)).status).toBe('CONFIRMADA');
  });

  it('de una cita cancelada, reprogramada o completada → 410 (la versión cambió)', async () => {
    const ip = ipUnica();
    const cancelada = await citaConEnlaces(a, e, 450);
    await a.agente
      .post(`/api/v1/citas/${cancelada.citaId}/cancelar`)
      .set({ Authorization: `Bearer ${propietario}` })
      .expect(200);
    await esRechazo(await solicitudDeEnlace(a, 'confirmar', cancelada.enlace('CONFIRMAR'), ip));

    const reprogramada = await citaConEnlaces(a, e, 480);
    await a.agente
      .post(`/api/v1/citas/${reprogramada.citaId}/reprogramar`)
      .set({ Authorization: `Bearer ${propietario}` })
      .send({ inicio: horaLima(fechaEnDias(5), '10:00') })
      .expect(200);
    await esRechazo(await solicitudDeEnlace(a, 'cancelar', reprogramada.enlace('CANCELAR'), ip));
    expect((await filaDeCita(reprogramada.citaId)).status).toBe('CONFIRMADA');

    // Completada (como la deja la agenda al llegar la hora): estado final y versión + 1.
    const completada = await citaConEnlaces(a, e, 510);
    await poolDe('seed').query(`UPDATE appointment SET status = 'COMPLETADA', version = 2 WHERE id = $1`, [
      completada.citaId,
    ]);
    await esRechazo(await solicitudDeEnlace(a, 'consultar', completada.enlace('CANCELAR'), ip));
  });

  it('dos usos simultáneos en dos instancias → exactamente uno con efecto', async () => {
    for (let i = 0; i < 3; i += 1) {
      const c = await citaConEnlaces(a, e, 600 + i * 30);
      const token = c.enlace('CONFIRMAR');
      const respuestas = await Promise.all([
        solicitudDeEnlace(a, 'confirmar', token, ipUnica()),
        solicitudDeEnlace(b, 'confirmar', token, ipUnica()),
      ]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 410]);
      expect(await usosDeEnlace(c.citaId)).toHaveLength(1);
    }
  });

  it('dos cancelaciones simultáneas con el mismo enlace → una sola cancelación', async () => {
    const c = await citaConEnlaces(a, e, 700);
    const token = c.enlace('CANCELAR');
    const respuestas = await Promise.all([
      solicitudDeEnlace(a, 'cancelar', token, ipUnica()),
      solicitudDeEnlace(b, 'cancelar', token, ipUnica()),
    ]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(await filaDeCita(c.citaId)).toMatchObject({ status: 'CANCELADA', version: 2 });
  });

  it('el propietario reprograma mientras el cliente cancela por el enlace → exactamente una tiene efecto', async () => {
    for (let i = 0; i < 4; i += 1) {
      const c = await citaConEnlaces(a, e, 760 + i * 30);
      const [delPropietario, delEnlace] = await Promise.all([
        b.agente
          .post(`/api/v1/citas/${c.citaId}/reprogramar`)
          .set({ Authorization: `Bearer ${propietario}` })
          .send({ inicio: horaLima(fechaEnDias(6), ['09:00', '09:30', '10:00', '10:30'][i]) }),
        solicitudDeEnlace(a, 'cancelar', c.enlace('CANCELAR'), ipUnica()),
      ]);
      const fila = await filaDeCita(c.citaId);
      expect(fila.version).toBe(2);
      if (delEnlace.status === 200) {
        // Si el propietario leyó la cita antes de la cancelación, su UPDATE condicional no encuentra la versión:
        // 409 CITA_CAMBIO. Si la leyó ya cancelada, es la regla de 002/US1: 422 TRANSICION_INVALIDA. En los dos
        // casos su reprogramación no tuvo efecto.
        expect([
          [409, 'CITA_CAMBIO'],
          [422, 'TRANSICION_INVALIDA'],
        ]).toContainEqual([delPropietario.status, delPropietario.body.codigo]);
        expect(fila.status).toBe('CANCELADA');
      } else {
        await esRechazo(delEnlace);
        expect(delPropietario.status).toBe(200);
        expect(fila.status).toBe('CONFIRMADA');
      }
    }
  });
});
