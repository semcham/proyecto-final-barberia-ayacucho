import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBloqueo, sembrarCita } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T038 · Reprogramar una cita con sesión (RF13; US1-1, US1-2, US1-4, US1-6 y US1-7; FR-001 a FR-007). La misma
// cita cambia de hora con las reglas de una reserva nueva; si no puede, conserva su hora, su barbero, su estado y
// su versión. Cada reprogramación con cambio deja su fila en appointment_reschedule.

interface FilaCita {
  barber_id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  version: number;
  client_confirmed_at: Date | null;
  service_name: string;
  customer_id: string;
}

async function filaDeCita(id: string): Promise<FilaCita> {
  const { rows } = await poolDe('seed').query<FilaCita>(
    `SELECT barber_id, starts_at, ends_at, status, version, client_confirmed_at, service_name, customer_id
       FROM appointment WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function reprogramacionesDe(id: string) {
  const { rows } = await poolDe('seed').query(
    `SELECT from_barber_id, from_starts_at, to_barber_id, to_starts_at, changed_by, via
       FROM appointment_reschedule WHERE appointment_id = $1 ORDER BY changed_at`,
    [id],
  );
  return rows;
}

describe('Reprogramar una cita con sesión (T038, US1)', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let propietario: string;
  const como = (token: string) => ({ Authorization: `Bearer ${token}` });
  const fecha = fechaEnDias(3);

  const reprogramar = (token: string, citaId: string, cuerpo: object) =>
    prueba.agente.post(`/api/v1/citas/${citaId}/reprogramar`).set(como(token)).send(cuerpo);

  /** Un cliente con sesión y una cita suya del barbero principal, a la hora indicada. */
  async function clienteConCita(hora: string, dia = fecha, barberoId = e.barberoId) {
    const sesion = await sesionCliente(e.barberia.tenantId);
    const citaId = await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId,
      servicioId: e.servicioId,
      clienteId: sesion.cliente.clienteId,
      inicio: new Date(horaLima(dia, hora)),
      creadoPor: sesion.cliente.usuarioId as string,
    });
    return { ...sesion, citaId };
  }

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('US1-1: el cliente mueve su cita a una hora libre; la anterior vuelve a estar libre y queda en el historial', async () => {
    const c = await clienteConCita('10:00');
    await poolDe('seed').query('UPDATE appointment SET client_confirmed_at = now() WHERE id = $1', [
      c.citaId,
    ]);

    const { body } = await reprogramar(c.token, c.citaId, { inicio: horaLima(fecha, '12:00') }).expect(200);
    expect(body).toMatchObject({
      cambio: true,
      inicioAnterior: horaLima(fecha, '10:00'),
      cita: {
        id: c.citaId,
        servicio: 'Servicio sembrado',
        barbero: 'Luis',
        inicio: horaLima(fecha, '12:00'),
        fin: horaLima(fecha, '12:30'),
        estado: 'CONFIRMADA',
        confirmadaPorClienteEn: null,
      },
    });

    const fila = await filaDeCita(c.citaId);
    expect(fila).toMatchObject({
      barber_id: e.barberoId,
      status: 'CONFIRMADA',
      version: 2,
      client_confirmed_at: null,
      service_name: 'Servicio sembrado',
      customer_id: c.cliente.clienteId,
    });
    expect(fila.starts_at).toEqual(new Date(horaLima(fecha, '12:00')));
    expect(fila.ends_at).toEqual(new Date(horaLima(fecha, '12:30')));

    expect(await reprogramacionesDe(c.citaId)).toEqual([
      {
        from_barber_id: e.barberoId,
        from_starts_at: new Date(horaLima(fecha, '10:00')),
        to_barber_id: e.barberoId,
        to_starts_at: new Date(horaLima(fecha, '12:00')),
        changed_by: c.cliente.usuarioId,
        via: 'SESION',
      },
    ]);

    // La hora anterior aparece libre en la consulta siguiente, y otro cliente puede reservarla.
    const otro = await sesionCliente(e.barberia.tenantId);
    const horarios = await prueba.agente
      .get(`/api/v1/horarios?servicio=${e.servicioId}&fecha=${fecha}&barbero=${e.barberoId}`)
      .set(como(otro.token))
      .expect(200);
    const inicios = horarios.body.horas.map((h: { inicio: string }) => h.inicio);
    expect(inicios).toContain(horaLima(fecha, '10:00'));
    expect(inicios).not.toContain(horaLima(fecha, '12:00'));
    await prueba.agente
      .post('/api/v1/citas')
      .set({ ...como(otro.token), 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(fecha, '10:00') })
      .expect(201);
  });

  it('US1-2: a la hora de otra cita activa del mismo barbero → 409 HORARIO_NO_DISPONIBLE y la cita no cambia', async () => {
    const c = await clienteConCita('14:00');
    await clienteConCita('15:00');
    const { body } = await reprogramar(c.token, c.citaId, { inicio: horaLima(fecha, '15:00') }).expect(409);
    expect(body.codigo).toBe('HORARIO_NO_DISPONIBLE');
    const fila = await filaDeCita(c.citaId);
    expect(fila).toMatchObject({ barber_id: e.barberoId, status: 'CONFIRMADA', version: 1 });
    expect(fila.starts_at).toEqual(new Date(horaLima(fecha, '14:00')));
    expect(await reprogramacionesDe(c.citaId)).toEqual([]);
  });

  it('a una hora que se solapa con otra cita del mismo cliente → 409 CITA_SOLAPADA_DEL_CLIENTE', async () => {
    const c = await clienteConCita('09:00', fechaEnDias(4));
    await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.otroBarberoId,
      servicioId: e.servicioId,
      clienteId: c.cliente.clienteId,
      inicio: new Date(horaLima(fechaEnDias(4), '11:00')),
    });
    const { body } = await reprogramar(c.token, c.citaId, {
      inicio: horaLima(fechaEnDias(4), '11:00'),
    }).expect(409);
    expect(body.codigo).toBe('CITA_SOLAPADA_DEL_CLIENTE');
    expect((await filaDeCita(c.citaId)).version).toBe(1);
  });

  describe('US1-4: la nueva hora se valida como una reserva nueva (422 con el motivo de 002)', () => {
    // Cada caso con su cita a una hora distinta del día 10 (las citas sembradas no pueden solaparse).
    it.each([
      ['FUERA_DE_DISPONIBILIDAD', '09:00', () => horaLima(fecha, '20:00')],
      ['FUERA_DE_DISPONIBILIDAD', '09:30', () => horaLima(fecha, '10:10')],
      ['HORA_PASADA', '10:00', () => horaLima(fechaEnDias(-1), '10:00')],
      ['FUERA_DEL_HORIZONTE', '10:30', () => horaLima(fechaEnDias(45), '10:00')],
    ])('%s (cita de las %s)', async (motivo, hora, inicio) => {
      const c = await clienteConCita(hora, fechaEnDias(10));
      const { body } = await reprogramar(c.token, c.citaId, { inicio: inicio() }).expect(422);
      expect(body).toMatchObject({ codigo: 'RESERVA_INVALIDA', detalles: [{ motivo }] });
      const fila = await filaDeCita(c.citaId);
      expect(fila.starts_at).toEqual(new Date(horaLima(fechaEnDias(10), hora)));
      expect(fila.version).toBe(1);
    });

    it('EN_BLOQUEO', async () => {
      const dia = fechaEnDias(5);
      const c = await clienteConCita('09:00', dia);
      await sembrarBloqueo({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        inicio: new Date(horaLima(dia, '13:00')),
        fin: new Date(horaLima(dia, '14:00')),
      });
      const { body } = await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '13:30') }).expect(422);
      expect(body).toMatchObject({ codigo: 'RESERVA_INVALIDA', detalles: [{ motivo: 'EN_BLOQUEO' }] });
      expect((await filaDeCita(c.citaId)).version).toBe(1);
    });

    it('BARBERO_NO_OFRECE_SERVICIO (barbero de otra barbería o inexistente)', async () => {
      const c = await clienteConCita('17:00');
      const otra = await barberiaParaReservar();
      const { body } = await reprogramar(c.token, c.citaId, {
        inicio: horaLima(fecha, '17:30'),
        barberoId: otra.barberoId,
      }).expect(422);
      expect(body).toMatchObject({
        codigo: 'RESERVA_INVALIDA',
        detalles: [{ motivo: 'BARBERO_NO_OFRECE_SERVICIO' }],
      });
      expect((await filaDeCita(c.citaId)).barber_id).toBe(e.barberoId);
    });
  });

  it('US1-6: el propietario reprograma la cita de un cliente a otro barbero que ofrece el servicio', async () => {
    const c = await clienteConCita('11:00', fechaEnDias(6));
    const { body } = await reprogramar(propietario, c.citaId, {
      inicio: horaLima(fechaEnDias(6), '15:30'),
      barberoId: e.otroBarberoId,
    }).expect(200);
    expect(body).toMatchObject({
      cambio: true,
      inicioAnterior: horaLima(fechaEnDias(6), '11:00'),
      cita: { id: c.citaId, barbero: 'Ana', inicio: horaLima(fechaEnDias(6), '15:30'), estado: 'CONFIRMADA' },
    });
    expect(await reprogramacionesDe(c.citaId)).toEqual([
      expect.objectContaining({
        from_barber_id: e.barberoId,
        to_barber_id: e.otroBarberoId,
        changed_by: e.barberia.propietarioId,
        via: 'SESION',
      }),
    ]);
  });

  it('el propietario también mueve una cita PENDIENTE, que queda CONFIRMADA (FR-007)', async () => {
    const sesion = await sesionCliente(e.barberia.tenantId);
    const citaId = await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId: sesion.cliente.clienteId,
      inicio: new Date(horaLima(fechaEnDias(7), '10:00')),
      estado: 'PENDIENTE',
    });
    await reprogramar(propietario, citaId, { inicio: horaLima(fechaEnDias(7), '10:30') }).expect(200);
    expect(await filaDeCita(citaId)).toMatchObject({ status: 'CONFIRMADA', version: 2 });
    const { rows } = await poolDe('seed').query(
      `SELECT from_status, to_status FROM appointment_status_history WHERE appointment_id = $1`,
      [citaId],
    );
    expect(rows).toEqual([{ from_status: 'PENDIENTE', to_status: 'CONFIRMADA' }]);
  });

  it('a la misma hora y con el mismo barbero → 200 con cambio: false, sin historial ni versión nueva', async () => {
    const c = await clienteConCita('18:00');
    const { body } = await reprogramar(c.token, c.citaId, {
      inicio: horaLima(fecha, '18:00'),
      barberoId: e.barberoId,
    }).expect(200);
    expect(body.cambio).toBe(false);
    expect(body.inicioAnterior).toBeUndefined();
    expect(body.cita).toMatchObject({ id: c.citaId, inicio: horaLima(fecha, '18:00') });
    expect((await filaDeCita(c.citaId)).version).toBe(1);
    expect(await reprogramacionesDe(c.citaId)).toEqual([]);
  });

  it('una cita cancelada no se reprograma (422 TRANSICION_INVALIDA)', async () => {
    const sesion = await sesionCliente(e.barberia.tenantId);
    const citaId = await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId: sesion.cliente.clienteId,
      inicio: new Date(horaLima(fechaEnDias(8), '10:00')),
      estado: 'CANCELADA',
    });
    const { body } = await reprogramar(sesion.token, citaId, {
      inicio: horaLima(fechaEnDias(8), '11:00'),
    }).expect(422);
    expect(body.codigo).toBe('TRANSICION_INVALIDA');
  });

  it('la cita de otro cliente no existe para el cliente (404) y no cambia', async () => {
    const c = await clienteConCita('09:30', fechaEnDias(9));
    const intruso = await sesionCliente(e.barberia.tenantId);
    await reprogramar(intruso.token, c.citaId, { inicio: horaLima(fechaEnDias(9), '10:30') }).expect(404);
    expect((await filaDeCita(c.citaId)).version).toBe(1);
  });

  it('el cuerpo no admite campos ajenos ni una hora sin formato (400)', async () => {
    const c = await clienteConCita('12:30', fechaEnDias(9));
    await reprogramar(c.token, c.citaId, {
      inicio: horaLima(fechaEnDias(9), '13:00'),
      tenantId: e.barberia.tenantId,
    }).expect(400);
    await reprogramar(c.token, c.citaId, { inicio: 'mañana' }).expect(400);
    await reprogramar(c.token, c.citaId, {}).expect(400);
  });

  it('US1-7: con una suscripción que no acepta reservas → 403 SUSCRIPCION_NO_PERMITE; cancelar sigue permitido', async () => {
    const g = await barberiaParaReservar();
    const sesion = await sesionCliente(g.barberia.tenantId);
    const dia = fechaEnDias(4);
    const citaId = await sembrarCita({
      tenantId: g.barberia.tenantId,
      barberoId: g.barberoId,
      servicioId: g.servicioId,
      clienteId: sesion.cliente.clienteId,
      inicio: new Date(horaLima(dia, '10:00')),
    });
    await poolDe('seed').query(`UPDATE subscription SET status = 'EXPIRED' WHERE tenant_id = $1`, [
      g.barberia.tenantId,
    ]);
    const duenio = await tokenPara(g.barberia.tenantId, g.barberia.propietarioId, 'PROPIETARIO');

    for (const token of [sesion.token, duenio]) {
      const { body } = await reprogramar(token, citaId, { inicio: horaLima(dia, '11:00') }).expect(403);
      expect(body).toMatchObject({
        codigo: 'SUSCRIPCION_NO_PERMITE',
        mensaje: 'Esta barbería no acepta reservas por ahora',
      });
    }
    expect((await filaDeCita(citaId)).version).toBe(1);

    await prueba.agente.post(`/api/v1/citas/${citaId}/cancelar`).set(como(sesion.token)).expect(200);
  });
});
