import {
  activarAdelanto,
  confirmarAdelanto,
  numeroDeOperacion,
  rechazarPago,
  registrarPago,
  reservar,
} from '../../helpers/adelantos';
import type { AppDePrueba } from '../../helpers/app';
import {
  appConCorreo,
  avisosDe,
  correrTareasDeAvisos,
  descartarAvisosDeOtrasPruebas,
  destinoDe,
  enviarSinCandado,
  esperarCorreos,
  iniciarProxySmtp,
  type ProxySmtp,
} from '../../helpers/avisos';
import { png } from '../../helpers/comprobantes';
import { iniciarMailpit, type Mailpit } from '../../helpers/mailpit';
import { barberiaParaReservar, fechaEnDias, horaLima } from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';
import { EjecutorTareas } from '../../../src/shared';

// T025 de 008 · Avisos del adelanto con Mailpit (US2-2; FR-023, FR-024; SC-008; contracts/eventos.md §3 y §4), por
// el mecanismo de 004 (salida de eventos, despacho y enviar-avisos): AdelantoSolicitado deja UN correo al cliente
// con el monto, el código y la hora límite; PagoDeAdelantoRegistrado deja UN correo al propietario; ninguno trae el
// número de operación ni la captura. Con dos instancias, cada aviso sale una vez; con el correo caído, la reserva y
// el registro del pago responden igual y cada aviso llega una vez al volver. Las fases 4 y 5 suman sus avisos.

jest.setTimeout(180_000);

const soles = (centimos: number) =>
  new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(centimos / 100);
const horaEnLima = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

describe('Avisos del adelanto (T025, US2)', () => {
  let mailpit: Mailpit;
  let instancias: [AppDePrueba, AppDePrueba];
  const dia = fechaEnDias(3);

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    instancias = [await appConCorreo(destinoDe(mailpit)), await appConCorreo(destinoDe(mailpit))];
  });

  beforeEach(() => descartarAvisosDeOtrasPruebas());

  afterAll(async () => {
    await Promise.all(instancias.map((i) => i.cerrar()));
    await mailpit.detener();
    await cerrarPools();
  });

  async function escenario() {
    const e = await barberiaParaReservar();
    await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { rows } = await poolDe('seed').query<{ name: string }>('SELECT name FROM tenant WHERE id = $1', [
      e.barberia.tenantId,
    ]);
    return { e, cliente, nombre: rows[0].name };
  }

  it('al reservar, el cliente recibe UN correo con el monto, el código, la hora límite y el enlace a su cita', async () => {
    const { e, cliente, nombre } = await escenario();
    const { body: cita } = await reservar(instancias[0], cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, '10:00'),
    }).expect(201);
    // Las dos instancias corren las tareas a la vez, y otra vez sin el candado: el aviso sale una sola vez.
    await Promise.all(instancias.map((i) => correrTareasDeAvisos(i)));
    await Promise.all(instancias.map((i) => enviarSinCandado(i)));

    const correos = await esperarCorreos(mailpit, cliente.cliente.correo as string, 1);
    expect(correos).toHaveLength(1);
    const [correo] = correos;
    expect(correo.contentType).toMatch(/^text\/plain/);
    expect(correo.asunto).toMatch(/adelanto/i);
    for (const parte of [
      nombre,
      'Corte',
      '10:00',
      soles(400),
      cita.adelanto.codigo,
      horaEnLima(cita.adelanto.horaLimite),
      `/mis-citas/${cita.id}/adelanto`,
    ]) {
      expect(correo.texto).toContain(parte);
    }
    expect(correo.texto).not.toContain(cliente.cliente.telefono);
    expect(correo.texto).not.toContain(cliente.cliente.correo as string);
    // Nunca dice que la cita quedó confirmada: está pendiente del adelanto.
    expect(correo.texto).not.toMatch(/quedó confirmada/i);

    const avisos = await avisosDe(e.barberia.tenantId);
    expect(avisos.map((a) => [a.kind, a.recipient_kind, a.status])).toEqual([
      ['ADELANTO_SOLICITADO', 'CLIENTE', 'ENVIADO'],
    ]);
    expect(avisos[0]).toMatchObject({ recipient_ref: cliente.cliente.clienteId, appointment_id: cita.id });
    expect(await mailpit.mensajesPara(e.barberia.correo)).toEqual([]);
  });

  it('al registrar el pago, el propietario recibe UN correo de comprobante por revisar, sin el número', async () => {
    const { e, cliente, nombre } = await escenario();
    const { body: cita } = await reservar(instancias[0], cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, '11:00'),
    }).expect(201);
    const numero = numeroDeOperacion();
    await registrarPago(instancias[1], cliente.token, cita.id, { numero, captura: png() }).expect(201);
    await Promise.all(instancias.map((i) => correrTareasDeAvisos(i)));
    await Promise.all(instancias.map((i) => enviarSinCandado(i)));

    const alPropietario = await esperarCorreos(mailpit, e.barberia.correo, 1);
    expect(alPropietario).toHaveLength(1);
    const [correo] = alPropietario;
    expect(correo.contentType).toMatch(/^text\/plain/);
    expect(correo.asunto).toMatch(/pago/i);
    for (const parte of [nombre, 'Corte', '11:00', soles(400), cita.adelanto.codigo]) {
      expect(correo.texto).toContain(parte);
    }
    expect(correo.texto).not.toContain(numero);
    expect(correo.texto).not.toContain(cliente.cliente.correo as string);
    expect(correo.texto).not.toContain(cliente.cliente.telefono);

    const tipos = (await avisosDe(e.barberia.tenantId)).map((a) => [a.kind, a.recipient_kind]).sort();
    expect(tipos).toEqual([
      ['ADELANTO_SOLICITADO', 'CLIENTE'],
      ['PAGO_ADELANTO_REGISTRADO', 'PROPIETARIO'],
    ]);
    // El cliente solo recibió las instrucciones de pago.
    expect(await esperarCorreos(mailpit, cliente.cliente.correo as string, 1)).toHaveLength(1);
  });

  // T038 · Fase 4 (US3): confirmar y rechazar.
  it('al confirmar, el cliente recibe UN correo de adelanto confirmado con el saldo, y no el de "cita creada"', async () => {
    const { e, cliente, nombre } = await escenario();
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const { body: cita } = await reservar(instancias[0], cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, '13:00'),
    }).expect(201);
    const numero = numeroDeOperacion();
    await registrarPago(instancias[0], cliente.token, cita.id, { numero }).expect(201);
    await confirmarAdelanto(instancias[1], propietario, cita.id).expect(200);
    await confirmarAdelanto(instancias[0], propietario, cita.id).expect(200);
    await Promise.all(instancias.map((i) => correrTareasDeAvisos(i)));
    await Promise.all(instancias.map((i) => enviarSinCandado(i)));

    // Instrucciones de pago y adelanto confirmado: dos correos, nunca "cita creada" aparte.
    const correos = await esperarCorreos(mailpit, cliente.cliente.correo as string, 2);
    expect(correos).toHaveLength(2);
    const confirmado = correos.find((c) => /confirmad/i.test(c.asunto));
    if (!confirmado) throw new Error('Falta el correo de adelanto confirmado');
    for (const parte of [nombre, 'Corte', 'Luis', '13:00', soles(400), soles(1600)]) {
      expect(confirmado.texto).toContain(parte);
    }
    expect(confirmado.texto).toMatch(/saldo/i);
    expect(confirmado.texto).not.toContain(numero);
    const tipos = (await avisosDe(e.barberia.tenantId)).map((a) => a.kind).sort();
    expect(tipos).toEqual(['ADELANTO_CONFIRMADO', 'ADELANTO_SOLICITADO', 'PAGO_ADELANTO_REGISTRADO']);
  });

  it('al rechazar, el cliente recibe UN correo con el motivo y la hora límite, sin el número', async () => {
    const { e, cliente, nombre } = await escenario();
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const { body: cita } = await reservar(instancias[0], cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, '14:00'),
    }).expect(201);
    const numero = numeroDeOperacion();
    await registrarPago(instancias[0], cliente.token, cita.id, { numero }).expect(201);
    await rechazarPago(instancias[1], propietario, cita.id, 'No aparece en Yape').expect(200);
    await Promise.all(instancias.map((i) => correrTareasDeAvisos(i)));
    await Promise.all(instancias.map((i) => enviarSinCandado(i)));

    const correos = await esperarCorreos(mailpit, cliente.cliente.correo as string, 2);
    expect(correos).toHaveLength(2);
    const rechazo = correos.find((c) => /rechaz/i.test(c.asunto));
    if (!rechazo) throw new Error('Falta el correo de pago rechazado');
    for (const parte of [
      nombre,
      'No aparece en Yape',
      cita.adelanto.codigo,
      horaEnLima(cita.adelanto.horaLimite),
      `/mis-citas/${cita.id}/adelanto`,
    ]) {
      expect(rechazo.texto).toContain(parte);
    }
    expect(rechazo.texto).not.toContain(numero);
    const tipos = (await avisosDe(e.barberia.tenantId)).map((a) => [a.kind, a.recipient_kind]).sort();
    expect(tipos).toEqual([
      ['ADELANTO_SOLICITADO', 'CLIENTE'],
      ['PAGO_ADELANTO_RECHAZADO', 'CLIENTE'],
      ['PAGO_ADELANTO_REGISTRADO', 'PROPIETARIO'],
    ]);
  });

  // T048 · Fase 5 (US4): el vencimiento avisa al cliente y al propietario; con el pago sin revisar, que se devuelva.
  it('al vencer, el cliente y el propietario reciben UN correo cada uno; con el pago sin revisar, "por devolver"', async () => {
    const { e, cliente, nombre } = await escenario();
    const { body: sinPago } = await reservar(instancias[0], cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, '15:00'),
    }).expect(201);
    const otro = await sesionCliente(e.barberia.tenantId);
    const { body: conPago } = await reservar(instancias[0], otro.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, '16:00'),
    }).expect(201);
    const numero = numeroDeOperacion();
    await registrarPago(instancias[0], otro.token, conPago.id, { numero }).expect(201);
    // La hora límite y el límite máximo ya pasaron (movidos en la base: la aplicación usa el reloj real).
    await poolDe('seed').query(
      `UPDATE booking_deposit SET due_at = now() - interval '2 minutes', review_limit_at = now() - interval '1 minute'
        WHERE tenant_id = $1`,
      [e.barberia.tenantId],
    );
    await Promise.all(instancias.map((i) => i.app.get(EjecutorTareas).ejecutarAhora('vencer-adelantos')));
    await Promise.all(instancias.map((i) => correrTareasDeAvisos(i)));
    await Promise.all(instancias.map((i) => enviarSinCandado(i)));

    const vencido = async (correo: string, n: number) => {
      const correos = await esperarCorreos(mailpit, correo, n);
      expect(correos).toHaveLength(n);
      const encontrado = correos.find((c) => /venci/i.test(c.asunto));
      if (!encontrado) throw new Error(`Falta el correo de adelanto vencido para ${correo}`);
      expect(encontrado.contentType).toMatch(/^text\/plain/);
      return encontrado;
    };
    // Cliente sin pago: instrucciones y vencido. Sin "devolver".
    const alClienteSinPago = await vencido(cliente.cliente.correo as string, 2);
    for (const parte of [nombre, 'Corte', '15:00', sinPago.adelanto.codigo]) {
      expect(alClienteSinPago.texto).toContain(parte);
    }
    expect(alClienteSinPago.texto).toMatch(/cancel/i);
    expect(alClienteSinPago.texto).not.toMatch(/devol/i);
    // Cliente con pago sin revisar: instrucciones y vencido, que la barbería le devolverá el adelanto.
    const alClienteConPago = await vencido(otro.cliente.correo as string, 2);
    expect(alClienteConPago.texto).toContain('16:00');
    expect(alClienteConPago.texto).toMatch(/devol/i);
    expect(alClienteConPago.texto).not.toContain(numero);
    // Propietario: un comprobante por revisar y dos vencidos; el de la cita con pago le pide devolverlo.
    const alPropietario = await esperarCorreos(mailpit, e.barberia.correo, 3);
    expect(alPropietario).toHaveLength(3);
    const vencidosPropietario = alPropietario.filter((c) => /venci/i.test(c.asunto));
    expect(vencidosPropietario).toHaveLength(2);
    const conDevolucion = vencidosPropietario.find((c) => c.texto.includes('16:00'));
    expect(conDevolucion?.texto).toMatch(/devol/i);
    expect(conDevolucion?.texto).toContain(conPago.adelanto.codigo);
    expect(conDevolucion?.texto).not.toContain(numero);
    for (const c of vencidosPropietario) {
      expect(c.texto).toMatch(/horario quedó libre/i);
      expect(c.texto).not.toContain(cliente.cliente.correo as string);
      expect(c.texto).not.toContain(otro.cliente.correo as string);
    }

    const tipos = (await avisosDe(e.barberia.tenantId))
      .filter((a) => a.kind === 'ADELANTO_VENCIDO')
      .map((a) => a.recipient_kind)
      .sort();
    expect(tipos).toEqual(['CLIENTE', 'CLIENTE', 'PROPIETARIO', 'PROPIETARIO']);
  });

  describe('con el correo caído', () => {
    let proxy: ProxySmtp;
    let prueba: AppDePrueba;

    beforeAll(async () => {
      proxy = await iniciarProxySmtp(mailpit);
      prueba = await appConCorreo(proxy);
    });

    afterAll(async () => {
      await prueba.cerrar();
      await proxy.cerrar();
    });

    it('la reserva y el registro responden igual, sin tocar el SMTP; al volver, cada aviso llega una vez', async () => {
      const { e, cliente } = await escenario();
      proxy.caido = true;
      const reserva = await reservar(prueba, cliente.token, {
        servicioId: e.servicioId,
        barberoId: e.barberoId,
        inicio: horaLima(dia, '12:00'),
      });
      expect(reserva.status).toBe(201);
      const pago = await registrarPago(prueba, cliente.token, reserva.body.id);
      expect(pago.status).toBe(201);
      expect(proxy.rechazadas()).toBe(0);

      await correrTareasDeAvisos(prueba);
      expect(proxy.rechazadas()).toBeGreaterThan(0);
      expect((await avisosDe(e.barberia.tenantId)).every((a) => a.status === 'PENDIENTE')).toBe(true);

      proxy.caido = false;
      // Pasada la pausa del circuito del correo (30 s), la tarea envía todo, una vez.
      await new Promise((resolver) => setTimeout(resolver, 31_000));
      await poolDe('seed').query('UPDATE notification SET next_attempt_at = now() WHERE tenant_id = $1', [
        e.barberia.tenantId,
      ]);
      await correrTareasDeAvisos(prueba);
      await correrTareasDeAvisos(prueba);

      expect((await avisosDe(e.barberia.tenantId)).every((a) => a.status === 'ENVIADO')).toBe(true);
      const delCliente = await esperarCorreos(mailpit, cliente.cliente.correo as string, 1);
      const delPropietario = await esperarCorreos(mailpit, e.barberia.correo, 1);
      expect(delCliente).toHaveLength(1);
      expect(delPropietario).toHaveLength(1);
    });
  });
});
