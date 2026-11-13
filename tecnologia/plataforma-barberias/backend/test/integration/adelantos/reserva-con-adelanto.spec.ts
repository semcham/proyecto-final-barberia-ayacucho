import {
  activarAdelanto,
  conReloj,
  eventosDe,
  filaAdelanto,
  RelojDePrueba,
  reservar,
} from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  citasActivasEn,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { sembrarCliente } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T021 de 008 · La reserva del cliente con el adelanto activo (US2-1; FR-004 a FR-008, FR-025; research R03, R08):
// nace PENDIENTE con su adelanto y el horario retenido; la del propietario nace CONFIRMADA sin adelanto; sin tiempo
// para pagar se rechaza; el adelanto conserva lo calculado al reservar; la reserva pendiente no publica CitaCreada
// ni programa el recordatorio (eso sale al confirmar, fase 4); y sin adelanto activo todo sigue como en 002.

const MIN = 60_000;
const CODIGO = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
/** Instante ISO con el desplazamiento de Lima (como el resto de las horas de la API). */
const ISO_LIMA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?-05:00$/;

describe('Reserva con adelanto (T021, US2)', () => {
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

  async function escenario(regla?: Parameters<typeof activarAdelanto>[2]) {
    const e = await barberiaParaReservar();
    const adelanto = await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId, regla);
    const cliente = await sesionCliente(e.barberia.tenantId);
    return { e, adelanto, cliente };
  }

  const cuerpo = (e: BarberiaParaReservar, hora: string, fecha = dia) => ({
    servicioId: e.servicioId,
    barberoId: e.barberoId,
    inicio: horaLima(fecha, hora),
  });

  it('la reserva del cliente nace PENDIENTE con su adelanto: monto, código, hora límite y límite de revisión', async () => {
    const { e, adelanto, cliente } = await escenario({
      tipo: 'PORCENTAJE',
      porcentaje: 20,
      plazoMinutos: 30,
    });
    const antes = Date.now();
    const r = await reservar(prueba, cliente.token, cuerpo(e, '10:00')).expect(201);

    expect(r.body).toMatchObject({ estado: 'PENDIENTE', servicio: 'Corte', precio: '20.00' });
    const vista = r.body.adelanto;
    expect(vista).toMatchObject({
      citaId: r.body.id,
      estado: 'POR_PAGAR',
      montoCentimos: 400,
      precioCentimos: 2000,
      saldoCentimos: 1600,
      pago: null,
      devueltoEn: null,
    });
    expect(vista.codigo).toMatch(CODIGO);
    expect(vista.horaLimite).toMatch(ISO_LIMA);
    expect(vista.limiteRevision).toMatch(ISO_LIMA);
    const horaLimite = Date.parse(vista.horaLimite);
    expect(horaLimite).toBeGreaterThanOrEqual(antes + 30 * MIN - 1000);
    expect(horaLimite).toBeLessThanOrEqual(Date.now() + 30 * MIN + 1000);
    // Lejos del inicio: límite de revisión = hora límite + 24 h.
    expect(Date.parse(vista.limiteRevision) - horaLimite).toBe(24 * 60 * MIN);

    const fila = await filaAdelanto(r.body.id);
    expect(fila).toMatchObject({
      tenant_id: e.barberia.tenantId,
      customer_id: cliente.cliente.clienteId,
      customer_user_id: cliente.cliente.usuarioId,
      code: vista.codigo,
      amount_cents: 400,
      service_price_cents: 2000,
      service_name: 'Corte',
      time_zone: 'America/Lima',
      qr_file_id: adelanto.qrId,
      status: 'POR_PAGAR',
      resolved_at: null,
    });
    expect((fila?.starts_at as Date).toISOString()).toBe(new Date(horaLima(dia, '10:00')).toISOString());
    expect((fila?.due_at as Date).getTime()).toBe(horaLimite);
    const { rows } = await poolDe('seed').query('SELECT status FROM appointment WHERE id = $1', [r.body.id]);
    expect(rows[0].status).toBe('PENDIENTE');
  });

  it('el horario queda retenido: otro cliente recibe 409 HORARIO_NO_DISPONIBLE', async () => {
    const { e, cliente } = await escenario();
    await reservar(prueba, cliente.token, cuerpo(e, '11:00')).expect(201);
    const otro = await sesionCliente(e.barberia.tenantId);
    const r = await reservar(prueba, otro.token, cuerpo(e, '11:00')).expect(409);
    expect(r.body.codigo).toBe('HORARIO_NO_DISPONIBLE');
    expect(await citasActivasEn(e.barberoId, horaLima(dia, '11:00'), horaLima(dia, '11:30'))).toBe(1);
  });

  it('con monto fijo mayor que el precio, el adelanto es el precio completo (FR-006)', async () => {
    const { e, cliente } = await escenario({ tipo: 'FIJO', montoCentimos: 5000 });
    const r = await reservar(prueba, cliente.token, cuerpo(e, '12:00')).expect(201);
    expect(r.body.adelanto).toMatchObject({ montoCentimos: 2000, saldoCentimos: 0 });
  });

  it('la cita presencial del propietario nace CONFIRMADA y sin adelanto (FR-005)', async () => {
    const { e } = await escenario();
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const presencial = await sembrarCliente({
      tenantId: e.barberia.tenantId,
      conCuenta: false,
      creadoPor: e.barberia.propietarioId,
    });
    const r = await reservar(prueba, propietario, {
      ...cuerpo(e, '13:00'),
      clienteId: presencial.clienteId,
    }).expect(201);
    expect(r.body.estado).toBe('CONFIRMADA');
    expect(r.body).not.toHaveProperty('adelanto');
    expect(await filaAdelanto(r.body.id)).toBeUndefined();
    expect(await eventosDe(e.barberia.tenantId, 'CitaCreada')).toHaveLength(1);
  });

  it('sin tiempo para pagar antes del inicio menos 30 min → 422 SIN_TIEMPO_PARA_ADELANTO, sin crear nada', async () => {
    const { e, cliente } = await escenario();
    // La reserva se hace a las 09:40 del día de la cita, para las 10:00: la hora límite quedaría antes de ahora.
    reloj.fijar(new Date(horaLima(dia, '09:40')));
    const r = await reservar(prueba, cliente.token, cuerpo(e, '10:00')).expect(422);
    expect(r.body.codigo).toBe('SIN_TIEMPO_PARA_ADELANTO');
    const { rows } = await poolDe('seed').query(
      'SELECT count(*)::int AS n FROM appointment WHERE tenant_id = $1',
      [e.barberia.tenantId],
    );
    expect(rows[0].n).toBe(0);
    expect(await eventosDe(e.barberia.tenantId, 'AdelantoSolicitado')).toEqual([]);
  });

  it('cerca del inicio la hora límite es el inicio − 30 min y el límite de revisión, el inicio (FR-007, FR-018)', async () => {
    const { e, cliente } = await escenario({ tipo: 'PORCENTAJE', porcentaje: 20, plazoMinutos: 60 });
    reloj.fijar(new Date(horaLima(dia, '09:00')));
    const r = await reservar(prueba, cliente.token, cuerpo(e, '10:00')).expect(201);
    expect(Date.parse(r.body.adelanto.horaLimite)).toBe(Date.parse(horaLima(dia, '09:30')));
    expect(Date.parse(r.body.adelanto.limiteRevision)).toBe(Date.parse(horaLima(dia, '10:00')));
  });

  it('un cambio posterior de la configuración no cambia el adelanto ya creado (FR-004)', async () => {
    const { e, cliente } = await escenario({ tipo: 'PORCENTAJE', porcentaje: 20 });
    const r = await reservar(prueba, cliente.token, cuerpo(e, '14:00')).expect(201);
    const antes = await filaAdelanto(r.body.id);
    await poolDe('seed').query(
      `UPDATE booking_deposit_settings SET kind = 'FIJO', percent = NULL, amount_cents = 1500,
         payment_window_minutes = 120 WHERE tenant_id = $1`,
      [e.barberia.tenantId],
    );
    const otro = await sesionCliente(e.barberia.tenantId);
    const nueva = await reservar(prueba, otro.token, cuerpo(e, '15:00')).expect(201);
    expect(nueva.body.adelanto.montoCentimos).toBe(1500);
    expect(await filaAdelanto(r.body.id)).toEqual(antes);
  });

  it('la reserva pendiente publica AdelantoSolicitado y NO CitaCreada ni RecordatorioDeCita (R08, FR-025)', async () => {
    const { e, cliente } = await escenario();
    const r = await reservar(prueba, cliente.token, cuerpo(e, '16:00')).expect(201);
    expect(await eventosDe(e.barberia.tenantId, 'CitaCreada')).toEqual([]);
    expect(await eventosDe(e.barberia.tenantId, 'RecordatorioDeCita')).toEqual([]);
    const [solicitado, ...otros] = await eventosDe(e.barberia.tenantId, 'AdelantoSolicitado');
    expect(otros).toEqual([]);
    expect(solicitado.payload).toEqual({
      citaId: r.body.id,
      clienteId: cliente.cliente.clienteId,
      servicio: 'Corte',
      inicio: r.body.inicio,
      zonaHoraria: 'America/Lima',
      montoCentimos: 400,
      codigo: r.body.adelanto.codigo,
      horaLimite: r.body.adelanto.horaLimite,
    });
    // Nunca el número de operación, el QR, teléfonos ni correos (FR-024).
    const texto = JSON.stringify(solicitado.payload);
    expect(texto).not.toContain(cliente.cliente.correo as string);
    expect(texto).not.toContain(cliente.cliente.telefono);
  });

  it('el reintento idempotente devuelve la misma cita con su adelanto, sin otro adelanto ni otro evento', async () => {
    const { e, cliente } = await escenario();
    const clave = nuevaClave();
    const primera = await reservar(prueba, cliente.token, cuerpo(e, '17:00'), clave).expect(201);
    const repetida = await reservar(prueba, cliente.token, cuerpo(e, '17:00'), clave).expect(200);
    expect(repetida.body).toEqual(primera.body);
    const { rows } = await poolDe('seed').query(
      'SELECT count(*)::int AS n FROM booking_deposit WHERE tenant_id = $1',
      [e.barberia.tenantId],
    );
    expect(rows[0].n).toBe(1);
    expect(await eventosDe(e.barberia.tenantId, 'AdelantoSolicitado')).toHaveLength(1);
  });

  it('sin adelanto activo la reserva es la de 002: CONFIRMADA, sin el campo adelanto, con CitaCreada y recordatorio', async () => {
    const e = await barberiaParaReservar();
    // Configurado pero desactivado: como si no existiera.
    await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
    await poolDe('seed').query('UPDATE booking_deposit_settings SET enabled = false WHERE tenant_id = $1', [
      e.barberia.tenantId,
    ]);
    const cliente = await sesionCliente(e.barberia.tenantId);
    const r = await reservar(prueba, cliente.token, cuerpo(e, '10:00')).expect(201);
    expect(r.body.estado).toBe('CONFIRMADA');
    expect(r.body).not.toHaveProperty('adelanto');
    expect(await filaAdelanto(r.body.id)).toBeUndefined();
    expect(await eventosDe(e.barberia.tenantId, 'CitaCreada')).toHaveLength(1);
    expect(await eventosDe(e.barberia.tenantId, 'RecordatorioDeCita')).toHaveLength(1);
    expect(await eventosDe(e.barberia.tenantId, 'AdelantoSolicitado')).toEqual([]);
  });

  it('un servicio de precio cero no pide adelanto aunque esté activo (FR-006)', async () => {
    const { e, cliente } = await escenario();
    await poolDe('seed').query(`UPDATE service SET price = '0.00' WHERE id = $1`, [e.servicioId]);
    const r = await reservar(prueba, cliente.token, cuerpo(e, '18:00')).expect(201);
    expect(r.body.estado).toBe('CONFIRMADA');
    expect(r.body).not.toHaveProperty('adelanto');
  });
});
