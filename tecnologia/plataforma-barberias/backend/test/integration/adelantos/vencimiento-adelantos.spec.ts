import { EjecutorTareas } from '../../../src/shared';
import {
  activarAdelanto,
  confirmarAdelanto,
  conReloj,
  eventosDe,
  filaAdelanto,
  RelojDePrueba,
  rechazarPago,
  registrarPago,
  reservar,
} from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { avisosDe } from '../../helpers/avisos';
import { filasDe } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T048 de 008 · Vencimiento automático del adelanto (US4-1 a US4-4; FR-016 a FR-018, FR-029; research R09), con el
// reloj de la prueba y la tarea vencer-adelantos:
// - sin pago a la hora límite → la cita se cancela sin marca de tardía, el horario queda libre y el adelanto VENCIDO;
// - con el pago sin revisar, pasar la hora límite no cambia nada; al alcanzar el límite máximo adicional, la cita se
//   cancela y el adelanto queda POR_DEVOLVER;
// - un pago rechazado sin registro nuevo vence como sin pago;
// - publica AdelantoVencido (no CitaCancelada), con su aviso al cliente y al propietario, y audita ADELANTO_VENCIDO;
// - una segunda corrida no repite nada, y cada barbería se procesa con su tenant.

jest.setTimeout(120_000);

const MINUTO = 60_000;

describe('Vencimiento automático del adelanto (T048, US4)', () => {
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

  const vencer = () => prueba.app.get(EjecutorTareas).ejecutarAhora('vencer-adelantos');

  async function barberia() {
    const e = await barberiaParaReservar();
    await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    return { e, propietario };
  }

  /** Cita pendiente de un cliente nuevo (reservada con el reloj de la prueba); con `pago`, con su número registrado. */
  async function citaPendiente(e: BarberiaParaReservar, inicio: string, pago = false) {
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body } = await reservar(prueba, cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio,
    }).expect(201);
    if (pago) await registrarPago(prueba, cliente.token, body.id).expect(201);
    return {
      cliente,
      citaId: body.id as string,
      inicio: body.inicio as string,
      adelanto: body.adelanto as { codigo: string; horaLimite: string; limiteRevision: string },
    };
  }

  const filaCita = async (citaId: string) =>
    (
      await poolDe('seed').query(
        'SELECT status, late_cancellation, cancelled_by, cancelled_at, version FROM appointment WHERE id = $1',
        [citaId],
      )
    ).rows[0];

  const transiciones = async (citaId: string) =>
    (
      await poolDe('seed').query(
        `SELECT from_status, to_status, changed_by FROM appointment_status_history
          WHERE appointment_id = $1 ORDER BY changed_at`,
        [citaId],
      )
    ).rows;

  const vencidasDe = async (tenantId: string) =>
    (await filasDe('audit_log', tenantId)).filter((f) => f.action === 'ADELANTO_VENCIDO');

  it('sin pago a la hora límite: cita CANCELADA sin tardía, adelanto VENCIDO y horario libre (US4-1, FR-016)', async () => {
    const { e } = await barberia();
    reloj.fijar(new Date(horaLima(dia, '07:00')));
    const { cliente, citaId, inicio, adelanto } = await citaPendiente(e, horaLima(dia, '10:00'));

    // Un minuto antes de la hora límite, nada.
    reloj.fijar(new Date(Date.parse(adelanto.horaLimite) - MINUTO));
    await vencer();
    expect(await filaCita(citaId)).toMatchObject({ status: 'PENDIENTE' });
    expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_PAGAR', resolved_at: null });

    reloj.fijar(new Date(Date.parse(adelanto.horaLimite) + MINUTO));
    await vencer();
    expect(await filaCita(citaId)).toMatchObject({
      status: 'CANCELADA',
      late_cancellation: false,
      cancelled_by: null,
      cancelled_at: expect.any(Date),
      version: 2,
    });
    expect(await filaAdelanto(citaId)).toMatchObject({ status: 'VENCIDO', resolved_at: expect.any(Date) });
    expect((await transiciones(citaId)).at(-1)).toEqual({
      from_status: 'PENDIENTE',
      to_status: 'CANCELADA',
      changed_by: null,
    });

    // AdelantoVencido en lugar de CitaCancelada (contracts/eventos.md §2 de 008).
    expect(await eventosDe(e.barberia.tenantId, 'CitaCancelada')).toEqual([]);
    const [evento, ...otros] = await eventosDe(e.barberia.tenantId, 'AdelantoVencido');
    expect(otros).toEqual([]);
    expect(evento.payload).toEqual({
      citaId,
      clienteId: cliente.cliente.clienteId,
      servicio: 'Corte',
      inicio,
      zonaHoraria: 'America/Lima',
      montoCentimos: 400,
      codigo: adelanto.codigo,
      causa: 'SIN_PAGO',
      porDevolver: false,
    });

    // Auditoría del vencimiento, sin actor (la tarea) y sin el número ni datos del cliente.
    const [auditoria, ...mas] = await vencidasDe(e.barberia.tenantId);
    expect(mas).toEqual([]);
    expect(auditoria).toMatchObject({
      actor_id: null,
      resource: `cita:${citaId};VENCIDO`,
      result: 'PERMITIDO',
    });

    // El horario quedó libre: otro cliente lo reserva.
    const otro = await sesionCliente(e.barberia.tenantId);
    await reservar(prueba, otro.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, '10:00'),
    }).expect(201);
  });

  it('con el pago sin revisar, pasar la hora límite no cambia nada (US4-2, FR-017; SC-004)', async () => {
    const { e } = await barberia();
    reloj.fijar(new Date(horaLima(dia, '07:00')));
    const { citaId, adelanto } = await citaPendiente(e, horaLima(dia, '11:00'), true);
    reloj.fijar(new Date(Date.parse(adelanto.horaLimite) + 5 * MINUTO));
    await vencer();
    expect(await filaCita(citaId)).toMatchObject({ status: 'PENDIENTE' });
    expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_REVISAR' });
    expect(await eventosDe(e.barberia.tenantId, 'AdelantoVencido')).toEqual([]);
    expect(await vencidasDe(e.barberia.tenantId)).toEqual([]);
  });

  it('al alcanzar el límite máximo adicional (2 h antes del inicio): CANCELADA y POR_DEVOLVER (US4-3, FR-018)', async () => {
    const { e, propietario } = await barberia();
    reloj.fijar(new Date(horaLima(dia, '07:00')));
    const { cliente, citaId, inicio, adelanto } = await citaPendiente(e, horaLima(dia, '12:00'), true);
    // 2 h antes del inicio llega antes que 24 h después de la hora límite.
    expect(Date.parse(adelanto.limiteRevision)).toBe(Date.parse(horaLima(dia, '10:00')));

    reloj.fijar(new Date(Date.parse(adelanto.limiteRevision) - MINUTO));
    await vencer();
    expect(await filaCita(citaId)).toMatchObject({ status: 'PENDIENTE' });

    reloj.fijar(new Date(Date.parse(adelanto.limiteRevision) + MINUTO));
    await vencer();
    expect(await filaCita(citaId)).toMatchObject({ status: 'CANCELADA', late_cancellation: false });
    expect(await filaAdelanto(citaId)).toMatchObject({
      status: 'POR_DEVOLVER',
      resolved_at: expect.any(Date),
    });
    const [evento] = await eventosDe(e.barberia.tenantId, 'AdelantoVencido');
    expect(evento.payload).toEqual({
      citaId,
      clienteId: cliente.cliente.clienteId,
      servicio: 'Corte',
      inicio,
      zonaHoraria: 'America/Lima',
      montoCentimos: 400,
      codigo: adelanto.codigo,
      causa: 'SIN_REVISION',
      porDevolver: true,
    });
    const [auditoria] = await vencidasDe(e.barberia.tenantId);
    expect(auditoria).toMatchObject({ actor_id: null, resource: `cita:${citaId};POR_DEVOLVER` });

    // Ya resuelto: confirmar después responde 409 y no cambia nada.
    const r = await confirmarAdelanto(prueba, propietario, citaId).expect(409);
    expect(r.body.codigo).toBe('ADELANTO_RESUELTO');
    expect(await filaCita(citaId)).toMatchObject({ status: 'CANCELADA' });
  });

  it('al alcanzar el límite máximo adicional (24 h después de la hora límite): CANCELADA y POR_DEVOLVER', async () => {
    const { e } = await barberia();
    reloj.fijar(new Date(horaLima(dia, '07:00')));
    const { citaId, adelanto } = await citaPendiente(e, horaLima(fechaEnDias(5), '12:00'), true);
    expect(Date.parse(adelanto.limiteRevision)).toBe(Date.parse(adelanto.horaLimite) + 24 * 60 * MINUTO);

    reloj.fijar(new Date(Date.parse(adelanto.horaLimite) + 23 * 60 * MINUTO));
    await vencer();
    expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_REVISAR' });

    reloj.fijar(new Date(Date.parse(adelanto.limiteRevision) + MINUTO));
    await vencer();
    expect(await filaCita(citaId)).toMatchObject({ status: 'CANCELADA', late_cancellation: false });
    expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_DEVOLVER' });
  });

  it('un pago rechazado y sin registro nuevo vence como sin pago (US4-4)', async () => {
    const { e, propietario } = await barberia();
    reloj.fijar(new Date(horaLima(dia, '07:00')));
    const { citaId, adelanto } = await citaPendiente(e, horaLima(dia, '13:00'), true);
    await rechazarPago(prueba, propietario, citaId, 'No aparece en Yape').expect(200);
    reloj.fijar(new Date(Date.parse(adelanto.horaLimite) + MINUTO));
    await vencer();
    expect(await filaCita(citaId)).toMatchObject({ status: 'CANCELADA', late_cancellation: false });
    expect(await filaAdelanto(citaId)).toMatchObject({ status: 'VENCIDO' });
    const [evento] = await eventosDe(e.barberia.tenantId, 'AdelantoVencido');
    expect(evento.payload).toMatchObject({ causa: 'SIN_PAGO', porDevolver: false });
  });

  it('el despacho crea UN aviso ADELANTO_VENCIDO al cliente y otro al propietario (FR-016, FR-018)', async () => {
    const { e } = await barberia();
    reloj.fijar(new Date(horaLima(dia, '07:00')));
    const sinPago = await citaPendiente(e, horaLima(dia, '14:00'));
    const conPago = await citaPendiente(e, horaLima(dia, '15:00'), true);
    reloj.fijar(new Date(Date.parse(conPago.adelanto.limiteRevision) + MINUTO));
    await vencer();
    const ejecutor = prueba.app.get(EjecutorTareas);
    await ejecutor.ejecutarAhora('despachar-eventos');
    await ejecutor.ejecutarAhora('despachar-eventos');

    const vencidos = (await avisosDe(e.barberia.tenantId)).filter((a) => a.kind === 'ADELANTO_VENCIDO');
    const porCita = (citaId: string) =>
      vencidos
        .filter((a) => a.appointment_id === citaId)
        .map((a) => [a.recipient_kind, a.recipient_ref])
        .sort();
    expect(porCita(sinPago.citaId)).toEqual([
      ['CLIENTE', sinPago.cliente.cliente.clienteId],
      ['PROPIETARIO', e.barberia.tenantId],
    ]);
    expect(porCita(conPago.citaId)).toEqual([
      ['CLIENTE', conPago.cliente.cliente.clienteId],
      ['PROPIETARIO', e.barberia.tenantId],
    ]);
  });

  it('una segunda corrida no repite nada (FR-019)', async () => {
    const { e } = await barberia();
    reloj.fijar(new Date(horaLima(dia, '07:00')));
    const { citaId, adelanto } = await citaPendiente(e, horaLima(dia, '16:00'));
    reloj.fijar(new Date(Date.parse(adelanto.horaLimite) + MINUTO));
    await vencer();
    await vencer();
    await prueba.app.get(EjecutorTareas).ejecutarAhora('vencer-adelantos');
    expect((await transiciones(citaId)).filter((t) => t.to_status === 'CANCELADA')).toHaveLength(1);
    expect(await eventosDe(e.barberia.tenantId, 'AdelantoVencido')).toHaveLength(1);
    expect(await vencidasDe(e.barberia.tenantId)).toHaveLength(1);
  });

  it('cada barbería se procesa con su tenant y no toca lo que no venció de otra (FR-028)', async () => {
    const a = await barberia();
    const b = await barberia();
    reloj.fijar(new Date(horaLima(dia, '07:00')));
    const deA = await citaPendiente(a.e, horaLima(dia, '17:00'));
    const deB = await citaPendiente(b.e, horaLima(dia, '17:00'));
    // La de B, reservada más tarde: su hora límite todavía no llega.
    reloj.fijar(new Date(Date.parse(deA.adelanto.horaLimite) + MINUTO));
    const deBTarde = await citaPendiente(b.e, horaLima(dia, '18:00'));
    await vencer();

    expect(await filaCita(deA.citaId)).toMatchObject({ status: 'CANCELADA' });
    expect(await filaCita(deB.citaId)).toMatchObject({ status: 'CANCELADA' });
    expect(await filaCita(deBTarde.citaId)).toMatchObject({ status: 'PENDIENTE' });
    expect(await filaAdelanto(deBTarde.citaId)).toMatchObject({ status: 'POR_PAGAR' });

    const deEventos = async (tenantId: string) =>
      (await eventosDe(tenantId, 'AdelantoVencido')).map((f) => (f.payload as { citaId: string }).citaId);
    expect(await deEventos(a.e.barberia.tenantId)).toEqual([deA.citaId]);
    expect(await deEventos(b.e.barberia.tenantId)).toEqual([deB.citaId]);
    expect((await vencidasDe(a.e.barberia.tenantId)).map((f) => f.resource)).toEqual([
      `cita:${deA.citaId};VENCIDO`,
    ]);
    expect((await vencidasDe(b.e.barberia.tenantId)).map((f) => f.resource)).toEqual([
      `cita:${deB.citaId};VENCIDO`,
    ]);
  });
});
