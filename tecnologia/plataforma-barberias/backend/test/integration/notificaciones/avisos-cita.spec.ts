import type { AppDePrueba } from '../../helpers/app';
import {
  appConCorreo,
  avisosDe,
  correrTareasDeAvisos,
  destinoDe,
  esperarCorreos,
  descartarAvisosDeOtrasPruebas,
} from '../../helpers/avisos';
import {
  sembrarBarbero,
  sembrarCliente,
  sembrarDisponibilidad,
  sembrarUsuario,
} from '../../helpers/fixtures';
import { iniciarMailpit, type Mailpit } from '../../helpers/mailpit';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
  SEMANA_COMPLETA,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T061 · Avisos de cita por correo, con Mailpit (PR27, RF30; US2-1 a US2-4 y US2-7; contracts/eventos.md §4).
// Un correo por operación y destinatario; el cliente presencial sin correo no recibe nada (y la cita se crea
// igual); el personal recibe aviso solo cuando el cliente cancela o reprograma; una operación fallida no deja
// ningún aviso. Nunca el teléfono ni el correo del cliente en el texto.

jest.setTimeout(120_000);

describe('Avisos de cita por correo (T061, US2)', () => {
  let mailpit: Mailpit;
  let prueba: AppDePrueba;
  const como = (token: string) => ({ Authorization: `Bearer ${token}` });
  const dia = fechaEnDias(3);

  interface Escenario {
    e: BarberiaParaReservar;
    nombreBarberia: string;
    propietario: string;
    /** Barbero con usuario vinculado (recibe avisos) y su correo. */
    rosa: { barberoId: string; correo: string };
  }

  async function escenario(): Promise<Escenario> {
    const e = await barberiaParaReservar();
    const tenantId = e.barberia.tenantId;
    const usuario = await sembrarUsuario({ tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const { barberoId } = await sembrarBarbero({
      tenantId,
      nombre: 'Rosa',
      usuarioId: usuario.usuarioId,
      servicios: [e.servicioId],
    });
    await sembrarDisponibilidad(tenantId, barberoId, SEMANA_COMPLETA);
    const { rows } = await poolDe('seed').query<{ name: string }>('SELECT name FROM tenant WHERE id = $1', [
      tenantId,
    ]);
    return {
      e,
      nombreBarberia: rows[0].name,
      propietario: await tokenPara(tenantId, e.barberia.propietarioId, 'PROPIETARIO'),
      rosa: { barberoId, correo: usuario.correo },
    };
  }

  const reservar = (token: string, s: Escenario, hora: string, barberoId = s.rosa.barberoId, extra = {}) =>
    prueba.agente
      .post('/api/v1/citas')
      .set({ ...como(token), 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: s.e.servicioId, barberoId, inicio: horaLima(dia, hora), ...extra });

  // Avisos pendientes que dejaron otros archivos: la tarea no debe intentarlos aquí (helpers/avisos.ts).
  beforeEach(() => descartarAvisosDeOtrasPruebas());

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    prueba = await appConCorreo(destinoDe(mailpit));
  });

  afterAll(async () => {
    await prueba.cerrar();
    await mailpit.detener();
    await cerrarPools();
  });

  it('US2-1: el cliente que reserva recibe UN correo de confirmación en texto simple con los datos de la cita', async () => {
    const s = await escenario();
    const cliente = await sesionCliente(s.e.barberia.tenantId);
    const { body: cita } = await reservar(cliente.token, s, '10:00').expect(201);
    await correrTareasDeAvisos(prueba);
    // Otra corrida no reenvía nada.
    await correrTareasDeAvisos(prueba);

    const correos = await esperarCorreos(mailpit, cliente.cliente.correo as string, 1);
    expect(correos).toHaveLength(1);
    const [correo] = correos;
    expect(correo.contentType).toMatch(/^text\/plain/);
    expect(correo.asunto).toMatch(/cita confirmada/i);
    for (const parte of [s.nombreBarberia, 'Corte', 'Rosa', '10:00']) expect(correo.texto).toContain(parte);
    expect(correo.texto).not.toContain(cliente.cliente.telefono);
    expect(correo.texto).not.toContain(cliente.cliente.correo as string);

    const avisos = await avisosDe(s.e.barberia.tenantId);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      kind: 'CITA_CREADA',
      recipient_kind: 'CLIENTE',
      recipient_ref: cliente.cliente.clienteId,
      appointment_id: cita.id,
      channel_planned: 'CORREO',
      channel_used: 'CORREO',
      status: 'ENVIADO',
      attempts: 0,
    });
    // El Message-ID sale del id del aviso (clave de idempotencia ante el canal).
    expect(correo.messageId).toContain(avisos[0].id);
    // Nadie del personal recibe la confirmación.
    expect(await mailpit.mensajesPara(s.e.barberia.correo)).toEqual([]);
    expect(await mailpit.mensajesPara(s.rosa.correo)).toEqual([]);
  });

  it('US2-2: la cita presencial avisa al cliente con correo; sin correo no se envía nada y la cita se crea igual', async () => {
    const s = await escenario();
    const tenantId = s.e.barberia.tenantId;
    const conCorreo = await sembrarCliente({
      tenantId,
      conCuenta: false,
      correo: `presencial-${nuevaClave().slice(0, 8)}@prueba.pe`,
      creadoPor: s.e.barberia.propietarioId,
    });
    const sinCorreo = await sembrarCliente({
      tenantId,
      conCuenta: false,
      creadoPor: s.e.barberia.propietarioId,
    });
    await reservar(s.propietario, s, '11:00', s.rosa.barberoId, { clienteId: conCorreo.clienteId }).expect(
      201,
    );
    await reservar(s.propietario, s, '12:00', s.rosa.barberoId, { clienteId: sinCorreo.clienteId }).expect(
      201,
    );
    await correrTareasDeAvisos(prueba);

    expect(await esperarCorreos(mailpit, conCorreo.correo as string, 1)).toHaveLength(1);
    const avisos = await avisosDe(tenantId);
    expect(avisos.find((a) => a.recipient_ref === conCorreo.clienteId)).toMatchObject({ status: 'ENVIADO' });
    expect(avisos.find((a) => a.recipient_ref === sinCorreo.clienteId)).toMatchObject({
      status: 'DESCARTADO',
      last_error: 'SIN_CANAL',
      channel_used: null,
    });
  });

  it('US2-3: si cancela el cliente, avisan al cliente, al propietario y al barbero con usuario', async () => {
    const s = await escenario();
    const cliente = await sesionCliente(s.e.barberia.tenantId);
    const { body: cita } = await reservar(cliente.token, s, '13:00').expect(201);
    await prueba.agente.post(`/api/v1/citas/${cita.id}/cancelar`).set(como(cliente.token)).expect(200);
    await correrTareasDeAvisos(prueba);

    const delCliente = await esperarCorreos(mailpit, cliente.cliente.correo as string, 2);
    expect(delCliente.map((m) => m.asunto)).toEqual([
      expect.stringMatching(/confirmada/i),
      expect.stringMatching(/cancelada/i),
    ]);
    const alPropietario = await esperarCorreos(mailpit, s.e.barberia.correo, 1);
    const alBarbero = await esperarCorreos(mailpit, s.rosa.correo, 1);
    expect(alPropietario).toHaveLength(1);
    expect(alBarbero).toHaveLength(1);
    for (const correo of [...alPropietario, ...alBarbero]) {
      expect(correo.texto).toMatch(/el cliente canceló/i);
      expect(correo.texto).toContain('13:00');
      expect(correo.texto).not.toContain(cliente.cliente.telefono);
      expect(correo.texto).not.toContain(cliente.cliente.correo as string);
    }
    const tipos = (await avisosDe(s.e.barberia.tenantId))
      .filter((a) => a.kind === 'CITA_CANCELADA')
      .map((a) => a.recipient_kind)
      .sort();
    expect(tipos).toEqual(['BARBERO', 'CLIENTE', 'PROPIETARIO']);
  });

  it('US2-3: si cancela el propietario, solo avisa al cliente', async () => {
    const s = await escenario();
    const cliente = await sesionCliente(s.e.barberia.tenantId);
    const { body: cita } = await reservar(cliente.token, s, '14:00').expect(201);
    await prueba.agente.post(`/api/v1/citas/${cita.id}/cancelar`).set(como(s.propietario)).expect(200);
    await correrTareasDeAvisos(prueba);

    expect(await esperarCorreos(mailpit, cliente.cliente.correo as string, 2)).toHaveLength(2);
    expect(await mailpit.mensajesPara(s.e.barberia.correo)).toEqual([]);
    expect(await mailpit.mensajesPara(s.rosa.correo)).toEqual([]);
  });

  it('US2-4: si reprograma el cliente, todos reciben UN aviso con la hora anterior y la nueva', async () => {
    const s = await escenario();
    const cliente = await sesionCliente(s.e.barberia.tenantId);
    const { body: cita } = await reservar(cliente.token, s, '15:00').expect(201);
    await prueba.agente
      .post(`/api/v1/citas/${cita.id}/reprogramar`)
      .set(como(cliente.token))
      .send({ inicio: horaLima(dia, '16:30') })
      .expect(200);
    await correrTareasDeAvisos(prueba);

    const delCliente = await esperarCorreos(mailpit, cliente.cliente.correo as string, 2);
    expect(delCliente).toHaveLength(2);
    const reprogramacion = delCliente[1];
    expect(reprogramacion.asunto).toMatch(/reprogramada/i);
    expect(reprogramacion.texto).toContain('15:00');
    expect(reprogramacion.texto).toContain('16:30');
    expect(await esperarCorreos(mailpit, s.e.barberia.correo, 1)).toHaveLength(1);
    const alBarbero = await esperarCorreos(mailpit, s.rosa.correo, 1);
    expect(alBarbero).toHaveLength(1);
    expect(alBarbero[0].texto).toMatch(/el cliente reprogramó/i);
  });

  it('US2-4: si reprograma el propietario, solo avisa al cliente', async () => {
    const s = await escenario();
    const cliente = await sesionCliente(s.e.barberia.tenantId);
    const { body: cita } = await reservar(cliente.token, s, '17:00').expect(201);
    await prueba.agente
      .post(`/api/v1/citas/${cita.id}/reprogramar`)
      .set(como(s.propietario))
      .send({ inicio: horaLima(dia, '17:30') })
      .expect(200);
    await correrTareasDeAvisos(prueba);

    expect(await esperarCorreos(mailpit, cliente.cliente.correo as string, 2)).toHaveLength(2);
    expect(await mailpit.mensajesPara(s.e.barberia.correo)).toEqual([]);
    expect(await mailpit.mensajesPara(s.rosa.correo)).toEqual([]);
  });

  it('US2-7: una operación que falla (409, 422) no deja ningún aviso', async () => {
    const s = await escenario();
    const primero = await sesionCliente(s.e.barberia.tenantId);
    const segundo = await sesionCliente(s.e.barberia.tenantId);
    const { body: cita } = await reservar(primero.token, s, '18:00').expect(201);
    await reservar(segundo.token, s, '18:00').expect(409);
    await prueba.agente
      .post(`/api/v1/citas/${cita.id}/reprogramar`)
      .set(como(primero.token))
      .send({ inicio: horaLima(fechaEnDias(-1), '10:00') })
      .expect(422);
    await correrTareasDeAvisos(prueba);

    const avisos = await avisosDe(s.e.barberia.tenantId);
    expect(avisos.map((a) => [a.kind, a.recipient_ref])).toEqual([
      ['CITA_CREADA', primero.cliente.clienteId],
    ]);
    expect(await mailpit.mensajesPara(segundo.cliente.correo as string)).toEqual([]);
  });
});
