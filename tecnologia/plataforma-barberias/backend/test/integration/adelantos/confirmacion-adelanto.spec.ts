import {
  activarAdelanto,
  bandejaDeAdelantos,
  cambiarEstadoCita,
  confirmarAdelanto,
  conReloj,
  eventosDe,
  filaAdelanto,
  numeroDeOperacion,
  pagosDeAdelanto,
  RelojDePrueba,
  rechazarPago,
  registrarPago,
  reservar,
  verAdelanto,
} from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { png } from '../../helpers/comprobantes';
import {
  filasDe,
  sembrarBarbero,
  sembrarCita,
  sembrarCliente,
  sembrarDisponibilidad,
  sembrarUsuario,
} from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  SEMANA_COMPLETA,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T036 de 008 · El propietario confirma o rechaza el pago del adelanto (US3-1 a US3-4 y US3-6; FR-012 a FR-014,
// FR-025; research R06, R08, R15): confirmar deja la cita CONFIRMADA (Cita.aprobar) y el adelanto CONFIRMADO,
// publica AdelantoConfirmado (en lugar de CitaCreada) y programa el recordatorio; repetir no hace nada; rechazar
// exige un motivo y deja el adelanto POR_PAGAR con su hora límite original; la aprobación de 002 no confirma una
// cita con adelanto (409 ADELANTO_PENDIENTE); y la bandeja ordena los pagos por revisar por hora límite.

const MOTIVO = 'No aparece en Yape';

describe('Confirmar y rechazar el adelanto (T036, US3)', () => {
  const reloj = new RelojDePrueba();
  let prueba: AppDePrueba;
  const dia = fechaEnDias(3);

  beforeAll(async () => {
    prueba = await crearApp({ ajustar: conReloj(reloj) });
  });

  afterEach(() => reloj.real());

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  async function barberia() {
    const e = await barberiaParaReservar();
    await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    return { e, propietario };
  }

  /** Cita pendiente de un cliente nuevo; con `pago`, con su número registrado (y captura). */
  async function citaPendiente(e: BarberiaParaReservar, hora: string, pago = true, fecha = dia) {
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body } = await reservar(prueba, cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(fecha, hora),
    }).expect(201);
    const numero = numeroDeOperacion();
    if (pago) await registrarPago(prueba, cliente.token, body.id, { numero, captura: png() }).expect(201);
    return { cliente, citaId: body.id as string, numero, adelanto: body.adelanto };
  }

  const estadoDeCita = async (citaId: string) =>
    (await poolDe('seed').query('SELECT status FROM appointment WHERE id = $1', [citaId])).rows[0].status;

  describe('confirmar', () => {
    it('la cita pasa a CONFIRMADA y el adelanto a CONFIRMADO, con el pago revisado (US3-1, FR-013)', async () => {
      const { e, propietario } = await barberia();
      const { citaId, numero } = await citaPendiente(e, '10:00');
      const r = await confirmarAdelanto(prueba, propietario, citaId).expect(200);

      expect(r.body).toMatchObject({
        id: citaId,
        estado: 'CONFIRMADA',
        adelanto: {
          estado: 'CONFIRMADO',
          montoCentimos: 400,
          saldoCentimos: 1600,
          pago: { numeroOperacion: numero, resultado: 'CONFIRMADO', motivoRechazo: null },
        },
      });
      expect(await estadoDeCita(citaId)).toBe('CONFIRMADA');
      expect(await filaAdelanto(citaId)).toMatchObject({
        status: 'CONFIRMADO',
        resolved_at: expect.any(Date),
      });
      const [pago] = await pagosDeAdelanto(citaId);
      expect(pago).toMatchObject({ review_result: 'CONFIRMADO', reviewed_by: e.barberia.propietarioId });
      const historial = await poolDe('seed').query(
        `SELECT from_status, to_status, changed_by FROM appointment_status_history
          WHERE appointment_id = $1 ORDER BY changed_at`,
        [citaId],
      );
      expect(historial.rows.at(-1)).toEqual({
        from_status: 'PENDIENTE',
        to_status: 'CONFIRMADA',
        changed_by: e.barberia.propietarioId,
      });
    });

    it('publica AdelantoConfirmado con el saldo (no CitaCreada) y programa el recordatorio 2 h antes (R08)', async () => {
      const { e, propietario } = await barberia();
      const { cliente, citaId } = await citaPendiente(e, '11:00');
      const r = await confirmarAdelanto(prueba, propietario, citaId).expect(200);

      expect(await eventosDe(e.barberia.tenantId, 'CitaCreada')).toEqual([]);
      const [confirmado, ...otros] = await eventosDe(e.barberia.tenantId, 'AdelantoConfirmado');
      expect(otros).toEqual([]);
      expect(confirmado.payload).toEqual({
        citaId,
        version: 1,
        clienteId: cliente.cliente.clienteId,
        servicio: 'Corte',
        barbero: 'Luis',
        inicio: r.body.inicio,
        fin: r.body.fin,
        zonaHoraria: 'America/Lima',
        montoCentimos: 400,
        saldoCentimos: 1600,
      });
      const [recordatorio, ...mas] = await eventosDe(e.barberia.tenantId, 'RecordatorioDeCita');
      expect(mas).toEqual([]);
      expect((recordatorio.available_at as Date).toISOString()).toBe(
        new Date(Date.parse(horaLima(dia, '11:00')) - 2 * 60 * 60 * 1000).toISOString(),
      );
      expect(recordatorio.status).toBe('PENDIENTE');
    });

    it('con menos de 2 h para el inicio no programa el recordatorio (FR-025)', async () => {
      const { e, propietario } = await barberia();
      reloj.fijar(new Date(horaLima(dia, '08:00')));
      const { citaId } = await citaPendiente(e, '09:00');
      await confirmarAdelanto(prueba, propietario, citaId).expect(200);
      expect(await eventosDe(e.barberia.tenantId, 'RecordatorioDeCita')).toEqual([]);
      expect(await eventosDe(e.barberia.tenantId, 'AdelantoConfirmado')).toHaveLength(1);
    });

    it('confirmar otra vez responde 200 sin cambios, sin otro evento ni otra auditoría (US3-4)', async () => {
      const { e, propietario } = await barberia();
      const { citaId } = await citaPendiente(e, '12:00');
      const primera = await confirmarAdelanto(prueba, propietario, citaId).expect(200);
      const segunda = await confirmarAdelanto(prueba, propietario, citaId).expect(200);
      expect(segunda.body).toEqual(primera.body);
      expect(await eventosDe(e.barberia.tenantId, 'AdelantoConfirmado')).toHaveLength(1);
      const auditoria = (await filasDe('audit_log', e.barberia.tenantId)).filter(
        (f) => f.action === 'ADELANTO_CONFIRMADO',
      );
      expect(auditoria).toHaveLength(1);
    });

    it('sin pago registrado → 409 SIN_PAGO_REGISTRADO, la cita sigue PENDIENTE', async () => {
      const { e, propietario } = await barberia();
      const { citaId } = await citaPendiente(e, '13:00', false);
      const r = await confirmarAdelanto(prueba, propietario, citaId).expect(409);
      expect(r.body.codigo).toBe('SIN_PAGO_REGISTRADO');
      expect(await estadoDeCita(citaId)).toBe('PENDIENTE');
      expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_PAGAR' });
    });

    it('una cita sin adelanto → 404; la de otra barbería → 404', async () => {
      const { e, propietario } = await barberia();
      const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId });
      const sinAdelanto = await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        servicioId: e.servicioId,
        clienteId: cliente.clienteId,
        estado: 'PENDIENTE',
        inicio: new Date(horaLima(dia, '14:00')),
      });
      await confirmarAdelanto(prueba, propietario, sinAdelanto).expect(404);
      const otra = await barberia();
      const { citaId } = await citaPendiente(e, '15:00');
      await confirmarAdelanto(prueba, otra.propietario, citaId).expect(404);
      expect(await estadoDeCita(citaId)).toBe('PENDIENTE');
    });
  });

  describe('rechazar', () => {
    it('con motivo: el adelanto vuelve a POR_PAGAR con su hora límite y el registro rechazado se conserva (US3-2)', async () => {
      const { e, propietario } = await barberia();
      const { citaId, numero, adelanto } = await citaPendiente(e, '10:00');
      const antes = await filaAdelanto(citaId);
      const r = await rechazarPago(prueba, propietario, citaId, MOTIVO).expect(200);

      expect(r.body).toMatchObject({
        citaId,
        estado: 'POR_PAGAR',
        horaLimite: adelanto.horaLimite,
        pago: { numeroOperacion: numero, resultado: 'RECHAZADO', motivoRechazo: MOTIVO },
      });
      expect(await filaAdelanto(citaId)).toMatchObject({
        status: 'POR_PAGAR',
        due_at: antes?.due_at,
        resolved_at: null,
      });
      const [pago] = await pagosDeAdelanto(citaId);
      expect(pago).toMatchObject({
        review_result: 'RECHAZADO',
        rejection_reason: MOTIVO,
        reviewed_by: e.barberia.propietarioId,
      });
      expect(await estadoDeCita(citaId)).toBe('PENDIENTE');
      expect(await eventosDe(e.barberia.tenantId, 'PagoDeAdelantoRechazado')).toHaveLength(1);
    });

    it('después del rechazo el cliente registra otro número (FR-014)', async () => {
      const { e, propietario } = await barberia();
      const { cliente, citaId } = await citaPendiente(e, '11:00');
      await rechazarPago(prueba, propietario, citaId, MOTIVO).expect(200);
      const otro = await registrarPago(prueba, cliente.token, citaId).expect(201);
      expect(otro.body).toMatchObject({ estado: 'POR_REVISAR', pago: { resultado: null } });
      expect(await pagosDeAdelanto(citaId)).toHaveLength(2);
      // Y ese otro pago se puede confirmar.
      await confirmarAdelanto(prueba, propietario, citaId).expect(200);
    });

    it.each([
      ['sin motivo', undefined],
      ['con un motivo de 4 caracteres', 'mal '],
      ['con solo espacios', '          '],
      ['con más de 300 caracteres', 'x'.repeat(301)],
    ])('%s → 422 VALIDACION, sin cambios', async (_caso, motivo) => {
      const { e, propietario } = await barberia();
      const { citaId } = await citaPendiente(e, '12:00');
      const r = await rechazarPago(prueba, propietario, citaId, motivo).expect(422);
      expect(r.body).toMatchObject({ codigo: 'VALIDACION', detalles: [{ campo: 'motivo' }] });
      expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_REVISAR' });
    });

    it('sin pago registrado → 409 SIN_PAGO_REGISTRADO; ya confirmado → 409 ADELANTO_RESUELTO', async () => {
      const { e, propietario } = await barberia();
      const sinPago = await citaPendiente(e, '13:00', false);
      expect((await rechazarPago(prueba, propietario, sinPago.citaId, MOTIVO).expect(409)).body.codigo).toBe(
        'SIN_PAGO_REGISTRADO',
      );
      const { citaId } = await citaPendiente(e, '14:00');
      await confirmarAdelanto(prueba, propietario, citaId).expect(200);
      expect((await rechazarPago(prueba, propietario, citaId, MOTIVO).expect(409)).body.codigo).toBe(
        'ADELANTO_RESUELTO',
      );
    });
  });

  it('el barbero no confirma ni rechaza (403), y el cliente tampoco (US3-6)', async () => {
    const { e } = await barberia();
    const { cliente, citaId } = await citaPendiente(e, '16:00');
    const barbero = await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const token = await tokenPara(e.barberia.tenantId, barbero.usuarioId, 'BARBERO');
    await confirmarAdelanto(prueba, token, citaId).expect(403);
    await rechazarPago(prueba, token, citaId, MOTIVO).expect(403);
    await confirmarAdelanto(prueba, cliente.token, citaId).expect(403);
    await rechazarPago(prueba, cliente.token, citaId, MOTIVO).expect(403);
    expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_REVISAR' });
  });

  describe('la aprobación de 002 no confirma una cita con adelanto (research R15)', () => {
    it('POST /citas/{id}/estado CONFIRMADA → 409 ADELANTO_PENDIENTE para el propietario y el barbero, sin cambios', async () => {
      const { e, propietario } = await barberia();
      // Un barbero con usuario, vinculado al barbero de la cita.
      const usuario = await sembrarUsuario({
        tenantId: e.barberia.tenantId,
        rol: 'BARBERO',
        estado: 'ACTIVA',
      });
      const { barberoId } = await sembrarBarbero({
        tenantId: e.barberia.tenantId,
        nombre: 'Rosa',
        usuarioId: usuario.usuarioId,
        servicios: [e.servicioId],
      });
      await sembrarDisponibilidad(e.barberia.tenantId, barberoId, SEMANA_COMPLETA);
      const tokenBarbero = await tokenPara(e.barberia.tenantId, usuario.usuarioId, 'BARBERO');
      const cliente = await sesionCliente(e.barberia.tenantId);
      const { body } = await reservar(prueba, cliente.token, {
        servicioId: e.servicioId,
        barberoId,
        inicio: horaLima(dia, '10:00'),
      }).expect(201);
      await registrarPago(prueba, cliente.token, body.id).expect(201);

      for (const token of [propietario, tokenBarbero]) {
        const r = await cambiarEstadoCita(prueba, token, body.id, 'CONFIRMADA').expect(409);
        expect(r.body.codigo).toBe('ADELANTO_PENDIENTE');
      }
      expect(await estadoDeCita(body.id)).toBe('PENDIENTE');
      expect(await filaAdelanto(body.id)).toMatchObject({ status: 'POR_REVISAR' });
      expect(await eventosDe(e.barberia.tenantId, 'AdelantoConfirmado')).toEqual([]);
    });

    it('una cita PENDIENTE sin adelanto se sigue aprobando como en 002', async () => {
      const { e, propietario } = await barberia();
      const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId });
      const citaId = await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        servicioId: e.servicioId,
        clienteId: cliente.clienteId,
        estado: 'PENDIENTE',
        inicio: new Date(horaLima(dia, '17:00')),
      });
      const r = await cambiarEstadoCita(prueba, propietario, citaId, 'CONFIRMADA').expect(200);
      expect(r.body.estado).toBe('CONFIRMADA');
    });
  });

  describe('bandeja GET /adelantos/por-revisar', () => {
    it('los pagos por revisar, de la hora límite más próxima a la más lejana, sin la captura ni su dirección', async () => {
      const { e, propietario } = await barberia();
      const primero = await citaPendiente(e, '10:00');
      reloj.avanzar(5 * 60_000);
      const segundo = await citaPendiente(e, '11:00');
      await citaPendiente(e, '12:00', false);
      const r = await bandejaDeAdelantos(prueba, propietario).expect(200);

      expect(r.body.map((x: { citaId: string }) => x.citaId)).toEqual([primero.citaId, segundo.citaId]);
      expect(r.body[0]).toEqual({
        citaId: primero.citaId,
        cliente: 'Cliente de Prueba',
        servicio: 'Corte',
        barbero: 'Luis',
        inicio: horaLima(dia, '10:00'),
        adelanto: expect.objectContaining({
          estado: 'POR_REVISAR',
          codigo: primero.adelanto.codigo,
          horaLimite: primero.adelanto.horaLimite,
          limiteRevision: primero.adelanto.limiteRevision,
          pago: expect.objectContaining({ numeroOperacion: primero.numero, tieneCaptura: true }),
        }),
      });
      expect(JSON.stringify(r.body)).not.toMatch(/captura\b.*https?:|\/captura/);
      // Un estado que no es de la bandeja → 400.
      await bandejaDeAdelantos(prueba, propietario, 'CONFIRMADO').expect(400);
      expect((await bandejaDeAdelantos(prueba, propietario, 'POR_DEVOLVER').expect(200)).body).toEqual([]);
    });

    it('solo la barbería del token; el barbero no la ve (403)', async () => {
      const a = await barberia();
      const b = await barberia();
      await citaPendiente(a.e, '13:00');
      expect((await bandejaDeAdelantos(prueba, b.propietario).expect(200)).body).toEqual([]);
      const barbero = await sembrarUsuario({
        tenantId: a.e.barberia.tenantId,
        rol: 'BARBERO',
        estado: 'ACTIVA',
      });
      const token = await tokenPara(a.e.barberia.tenantId, barbero.usuarioId, 'BARBERO');
      await bandejaDeAdelantos(prueba, token).expect(403);
    });

    it('una cita confirmada sale de la bandeja y su adelanto se ve CONFIRMADO', async () => {
      const { e, propietario } = await barberia();
      const { citaId, cliente } = await citaPendiente(e, '14:00');
      await confirmarAdelanto(prueba, propietario, citaId).expect(200);
      expect((await bandejaDeAdelantos(prueba, propietario).expect(200)).body).toEqual([]);
      expect((await verAdelanto(prueba, cliente.token, citaId).expect(200)).body.estado).toBe('CONFIRMADO');
    });
  });
});
