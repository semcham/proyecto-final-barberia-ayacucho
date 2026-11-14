import {
  activarAdelanto,
  confirmarAdelanto,
  conReloj,
  eventosDe,
  filaAdelanto,
  RelojDePrueba,
  registrarPago,
  reprogramarCita,
  reservar,
} from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { emitirEnlace, ipUnica, solicitudDeEnlace } from '../../helpers/enlaces';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T055 de 008 · Reprogramar una cita con adelanto (research R11; FR-025):
// - el CLIENTE no reprograma su cita PENDIENTE (409 ADELANTO_PENDIENTE), ni con sesión ni por un enlace;
// - el PROPIETARIO sí: la cita sigue PENDIENTE (espera su adelanto) y el adelanto conserva monto, hora límite y límite
//   máximo, con la hora nueva en su copia; NO se programa el recordatorio de 004;
// - una cita CONFIRMADA (adelanto confirmado) se reprograma como en 004: el recordatorio se programa para la hora
//   nueva y la copia del adelanto la sigue.

jest.setTimeout(120_000);

const HORA_MS = 60 * 60 * 1000;

describe('Reprogramar con adelanto (T055, US5)', () => {
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

  async function cita(e: BarberiaParaReservar, hora: string, pago = true) {
    reloj.fijar(new Date(horaLima(dia, '07:00')));
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body } = await reservar(prueba, cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, hora),
    }).expect(201);
    if (pago) await registrarPago(prueba, cliente.token, body.id).expect(201);
    return { cliente, citaId: body.id as string };
  }

  const filaCita = async (citaId: string) =>
    (await poolDe('seed').query('SELECT status, version, starts_at FROM appointment WHERE id = $1', [citaId]))
      .rows[0];

  const recordatoriosDe = async (tenantId: string, citaId: string) =>
    (await eventosDe(tenantId, 'RecordatorioDeCita')).filter(
      (f) => (f.payload as { citaId: string }).citaId === citaId && f.status === 'PENDIENTE',
    );

  it('el cliente no reprograma su cita PENDIENTE: 409 ADELANTO_PENDIENTE y nada cambia', async () => {
    const { e } = await barberia();
    const { cliente, citaId } = await cita(e, '10:00');
    const antes = await filaAdelanto(citaId);
    const r = await reprogramarCita(prueba, cliente.token, citaId, { inicio: horaLima(dia, '11:00') }).expect(
      409,
    );
    expect(r.body.codigo).toBe('ADELANTO_PENDIENTE');
    expect(await filaCita(citaId)).toMatchObject({ status: 'PENDIENTE', version: 1 });
    expect((await filaCita(citaId)).starts_at.toISOString()).toBe(
      new Date(horaLima(dia, '10:00')).toISOString(),
    );
    expect(await filaAdelanto(citaId)).toEqual(antes);
  });

  it('tampoco por el enlace de reprogramar (004): 409 ADELANTO_PENDIENTE y el enlace sigue sin usar', async () => {
    const { e } = await barberia();
    const { citaId } = await cita(e, '10:30');
    reloj.fijar(new Date(horaLima(dia, '07:10')));
    const token = emitirEnlace(prueba, {
      tenantId: e.barberia.tenantId,
      citaId,
      accion: 'REPROGRAMAR',
      venceEn: new Date(horaLima(dia, '10:30')),
    });
    const r = await solicitudDeEnlace(prueba, 'reprogramar', token, ipUnica(), {
      inicio: horaLima(dia, '12:00'),
    }).expect(409);
    expect(r.body.codigo).toBe('ADELANTO_PENDIENTE');
    expect(await filaCita(citaId)).toMatchObject({ status: 'PENDIENTE', version: 1 });
    const { rows } = await poolDe('seed').query(
      'SELECT 1 FROM appointment_link_use WHERE appointment_id = $1',
      [citaId],
    );
    expect(rows).toEqual([]);
  });

  it('el propietario reprograma la PENDIENTE: sigue PENDIENTE, el adelanto conserva sus plazos y no hay recordatorio', async () => {
    const { e, propietario } = await barberia();
    const { citaId } = await cita(e, '11:00');
    const antes = (await filaAdelanto(citaId)) as Record<string, unknown>;
    reloj.fijar(new Date(horaLima(dia, '07:20')));
    const r = await reprogramarCita(prueba, propietario, citaId, { inicio: horaLima(dia, '15:00') }).expect(
      200,
    );
    expect(r.body).toMatchObject({ cambio: true, cita: { estado: 'PENDIENTE' } });

    expect(await filaCita(citaId)).toMatchObject({ status: 'PENDIENTE', version: 2 });
    const despues = (await filaAdelanto(citaId)) as Record<string, unknown>;
    expect(despues).toMatchObject({
      status: 'POR_REVISAR',
      amount_cents: antes.amount_cents,
      due_at: antes.due_at,
      review_limit_at: antes.review_limit_at,
      code: antes.code,
    });
    expect((despues.starts_at as Date).toISOString()).toBe(new Date(horaLima(dia, '15:00')).toISOString());
    // FR-025: una cita pendiente no se recuerda.
    expect(await recordatoriosDe(e.barberia.tenantId, citaId)).toEqual([]);
    const { rows } = await poolDe('seed').query(
      `SELECT from_status, to_status FROM appointment_status_history WHERE appointment_id = $1 ORDER BY changed_at`,
      [citaId],
    );
    expect(rows.map((f) => f.to_status)).not.toContain('CONFIRMADA');
    // Sigue confirmándose con su adelanto.
    await confirmarAdelanto(prueba, propietario, citaId).expect(200);
    expect(await filaCita(citaId)).toMatchObject({ status: 'CONFIRMADA' });
  });

  it('una CONFIRMADA se reprograma como en 004: recordatorio para la hora nueva y la copia del adelanto la sigue', async () => {
    const { e, propietario } = await barberia();
    const { cliente, citaId } = await cita(e, '12:00');
    await confirmarAdelanto(prueba, propietario, citaId).expect(200);
    reloj.fijar(new Date(horaLima(dia, '07:30')));
    // El cliente con antelación, como en 004.
    await reprogramarCita(prueba, cliente.token, citaId, { inicio: horaLima(dia, '16:00') }).expect(200);

    expect(await filaCita(citaId)).toMatchObject({ status: 'CONFIRMADA', version: 2 });
    const adelanto = (await filaAdelanto(citaId)) as Record<string, unknown>;
    expect(adelanto.status).toBe('CONFIRMADO');
    expect((adelanto.starts_at as Date).toISOString()).toBe(new Date(horaLima(dia, '16:00')).toISOString());
    const [recordatorio, ...otros] = await recordatoriosDe(e.barberia.tenantId, citaId);
    expect(otros).toEqual([]);
    expect((recordatorio.available_at as Date).toISOString()).toBe(
      new Date(Date.parse(horaLima(dia, '16:00')) - 2 * HORA_MS).toISOString(),
    );
  });
});
