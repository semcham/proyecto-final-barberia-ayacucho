import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBloqueo, sembrarServicio } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T077 · Reserva de un cliente (RF12, FR-029 a FR-034) contra PostgreSQL real.

const CITAS = '/api/v1/citas';

describe('POST /citas (cliente)', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let token: string;
  let clienteId: string;
  let usuarioId: string;
  const fecha = fechaEnDias(2);

  const reservar = (cuerpo: object, clave: string | null = nuevaClave(), conToken = token) => {
    const encabezados: Record<string, string> = { Authorization: `Bearer ${conToken}` };
    if (clave !== null) encabezados['Idempotency-Key'] = clave;
    return prueba.agente.post(CITAS).set(encabezados).send(cuerpo);
  };
  const cuerpo = (hora: string, extra: object = {}) => ({
    servicioId: e.servicioId,
    barberoId: e.barberoId,
    inicio: horaLima(fecha, hora),
    ...extra,
  });

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    const sesion = await sesionCliente(e.barberia.tenantId);
    token = sesion.token;
    clienteId = sesion.cliente.clienteId;
    usuarioId = sesion.cliente.usuarioId as string;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('201 con barbería, servicio, barbero, fecha, hora, precio y estado (FR-034)', async () => {
    const { body } = await reservar(cuerpo('09:00')).expect(201);
    expect(body).toEqual({
      id: expect.any(String),
      barberia: expect.any(String),
      servicio: 'Corte',
      barbero: 'Luis',
      inicio: horaLima(fecha, '09:00'),
      fin: horaLima(fecha, '09:30'),
      precio: '20.00',
      estado: 'CONFIRMADA',
      cancelacionTardia: false,
      origen: 'EN_LINEA',
    });
    const { rows } = await poolDe('seed').query(
      'SELECT customer_id, created_by, service_name, duration_min FROM appointment WHERE id = $1',
      [body.id],
    );
    expect(rows[0]).toEqual({
      customer_id: clienteId,
      created_by: usuarioId,
      service_name: 'Corte',
      duration_min: 30,
    });
  });

  it('escribe el historial (NULL → CONFIRMADA) y la auditoría', async () => {
    const { body } = await reservar(cuerpo('09:30')).expect(201);
    const historial = await poolDe('seed').query(
      'SELECT from_status, to_status, changed_by FROM appointment_status_history WHERE appointment_id = $1',
      [body.id],
    );
    expect(historial.rows).toEqual([{ from_status: null, to_status: 'CONFIRMADA', changed_by: usuarioId }]);
    const auditoria = await poolDe('seed').query(
      'SELECT action, actor_id, resource, result FROM audit_log WHERE resource = $1',
      [`cita:${body.id}`],
    );
    expect(auditoria.rows).toEqual([
      { action: 'CITA_RESERVADA', actor_id: usuarioId, resource: `cita:${body.id}`, result: 'PERMITIDO' },
    ]);
  });

  describe('422 RESERVA_INVALIDA con el motivo', () => {
    it('hora pasada', async () => {
      const { body } = await reservar({
        ...cuerpo('10:00'),
        inicio: horaLima(fechaEnDias(-1), '10:00'),
      }).expect(422);
      expect(body).toMatchObject({ codigo: 'RESERVA_INVALIDA', detalles: [{ motivo: 'HORA_PASADA' }] });
    });

    it('fuera del horizonte de 30 días', async () => {
      const { body } = await reservar({
        ...cuerpo('10:00'),
        inicio: horaLima(fechaEnDias(45), '10:00'),
      }).expect(422);
      expect(body.detalles).toEqual([{ motivo: 'FUERA_DEL_HORIZONTE' }]);
    });

    it.each([
      ['antes de la apertura', '08:30'],
      ['termina después del cierre', '18:45'],
      ['fuera del paso de 15 minutos', '10:07'],
    ])('fuera de disponibilidad: %s', async (_caso, hora) => {
      const { body } = await reservar(cuerpo(hora)).expect(422);
      expect(body.detalles).toEqual([{ motivo: 'FUERA_DE_DISPONIBILIDAD' }]);
    });

    it('dentro de un bloqueo', async () => {
      await sembrarBloqueo({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        inicio: new Date(horaLima(fecha, '13:00')),
        fin: new Date(horaLima(fecha, '14:00')),
      });
      const { body } = await reservar(cuerpo('13:30')).expect(422);
      expect(body.detalles).toEqual([{ motivo: 'EN_BLOQUEO' }]);
    });

    it('servicio inactivo', async () => {
      const { servicioId } = await sembrarServicio({ tenantId: e.barberia.tenantId, activo: false });
      const { body } = await reservar(cuerpo('11:00', { servicioId })).expect(422);
      expect(body.detalles).toEqual([{ motivo: 'SERVICIO_INACTIVO' }]);
    });

    it('barbero que no ofrece el servicio', async () => {
      const { servicioId } = await sembrarServicio({ tenantId: e.barberia.tenantId, nombre: 'Tinte' });
      const { body } = await reservar(cuerpo('11:00', { servicioId })).expect(422);
      expect(body.detalles).toEqual([{ motivo: 'BARBERO_NO_OFRECE_SERVICIO' }]);
    });
  });

  describe('idempotencia (R09, FR-032)', () => {
    it('misma clave y mismo cuerpo → 200 con la misma cita', async () => {
      const clave = nuevaClave();
      const primera = await reservar(cuerpo('15:00'), clave).expect(201);
      const segunda = await reservar(cuerpo('15:00'), clave).expect(200);
      expect(segunda.body).toEqual(primera.body);
    });

    it('misma clave con otro cuerpo → 422 IDEMPOTENCIA_CONFLICTO', async () => {
      const clave = nuevaClave();
      await reservar(cuerpo('16:00'), clave).expect(201);
      const { body } = await reservar(cuerpo('16:30'), clave).expect(422);
      expect(body.codigo).toBe('IDEMPOTENCIA_CONFLICTO');
    });

    it.each([
      ['sin Idempotency-Key', null],
      ['con una clave que no es UUID', 'no-es-un-uuid'],
    ])('%s → 400', async (_caso, clave) => {
      const { body } = await reservar(cuerpo('17:00'), clave).expect(400);
      expect(body.codigo).toBe('VALIDACION');
    });
  });

  it('un clienteId enviado por un cliente → 400 (el cliente sale de la sesión)', async () => {
    const { body } = await reservar(cuerpo('17:30', { clienteId })).expect(400);
    expect(body.codigo).toBe('VALIDACION');
  });

  it('una hora ya tomada por otro cliente → 409 HORARIO_NO_DISPONIBLE', async () => {
    await reservar(cuerpo('18:00')).expect(201);
    const otro = await sesionCliente(e.barberia.tenantId);
    const { body } = await reservar(cuerpo('18:00'), nuevaClave(), otro.token).expect(409);
    expect(body.codigo).toBe('HORARIO_NO_DISPONIBLE');
  });

  it('campos de tenant o desconocidos en el cuerpo → 400', async () => {
    await reservar(cuerpo('12:00', { tenantId: e.barberia.tenantId })).expect(400);
  });
});
