import { DespachadorDeEventos } from '../../../src/shared';
import type { AppDePrueba } from '../../helpers/app';
import {
  appConCorreo,
  avisosDe,
  correrTareasDeAvisos,
  descartarAvisosDeOtrasPruebas,
  destinoDe,
  esperarCorreos,
} from '../../helpers/avisos';
import { iniciarMailpit, type Mailpit } from '../../helpers/mailpit';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';
import { iniciarWhatsappDePrueba, type SimuladorDePrueba } from '../../helpers/whatsapp';

// T106 · CERO mensajes por WhatsApp a quien no tiene consentimiento vigente (SC-007; EQ-18; PR18; FR-019). El
// canal y el consentimiento se leen de M01 AL ENVIAR (research R12), así que también cuenta un retiro hecho entre
// la reserva y el recordatorio. Casos:
//  - canal WhatsApp con número guardado pero sin consentimiento (nunca lo dio);
//  - consentimiento retirado entre la confirmación y el recordatorio;
//  - número cambiado a otro sin aceptar (el consentimiento era del número anterior).
// En todos, el aviso sale por correo y el simulador no recibe nada desde que no hay consentimiento.

jest.setTimeout(180_000);

const RUTA_AVISO = '/api/v1/clientes/yo/aviso';

describe('WhatsApp sin consentimiento vigente: 0 mensajes (T106, SC-007)', () => {
  let mailpit: Mailpit;
  let whatsapp: SimuladorDePrueba;
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let hora = 0;
  const como = (token: string) => ({ Authorization: `Bearer ${token}` });

  const reservar = async (token: string) => {
    const minutos = 9 * 60 + 30 * hora++;
    const hh = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
    const { body } = await prueba.agente
      .post('/api/v1/citas')
      .set({ ...como(token), 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(fechaEnDias(3), hh) })
      .expect(201);
    return body.id as string;
  };

  const aceptar = (token: string, numero: string) =>
    prueba.agente
      .put(RUTA_AVISO)
      .set(como(token))
      .send({ canal: 'WHATSAPP', numeroWhatsapp: numero, aceptaWhatsapp: true, versionTexto: '2026-11' })
      .expect(200);

  /** El recordatorio de la cita llegó a su momento: se despacha y se envía. */
  async function enviarRecordatorio(citaId: string) {
    await poolDe('seed').query(
      `UPDATE outbox_event SET available_at = now() - interval '1 minute'
        WHERE type = 'RecordatorioDeCita' AND replace_key = $1 AND status = 'PENDIENTE'`,
      [`recordatorio:${citaId}`],
    );
    await prueba.app.get(DespachadorDeEventos).ejecutar();
    await correrTareasDeAvisos(prueba);
  }

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    whatsapp = await iniciarWhatsappDePrueba();
    prueba = await appConCorreo(destinoDe(mailpit), { whatsappUrl: whatsapp.url });
    e = await barberiaParaReservar();
  });

  beforeEach(() => descartarAvisosDeOtrasPruebas());

  afterAll(async () => {
    await prueba.cerrar();
    await whatsapp.cerrar();
    await mailpit.detener();
    await cerrarPools();
  });

  it('canal WhatsApp con número guardado pero sin consentimiento: 0 mensajes; la confirmación sale por correo', async () => {
    const c = await sesionCliente(e.barberia.tenantId);
    const numero = '+51 922 000 001';
    // Como si la preferencia hubiera quedado en WhatsApp sin consentimiento (la API no lo permite: se siembra).
    await poolDe('seed').query(
      `INSERT INTO customer_notification_preference (tenant_id, customer_id, channel, whatsapp_number)
       VALUES ($1, $2, 'WHATSAPP', $3)`,
      [e.barberia.tenantId, c.cliente.clienteId, numero],
    );
    const citaId = await reservar(c.token);
    await correrTareasDeAvisos(prueba);
    expect(await whatsapp.mensajesPara(numero)).toEqual([]);
    expect(await esperarCorreos(mailpit, c.cliente.correo as string, 1)).toHaveLength(1);
    const aviso = (await avisosDe(e.barberia.tenantId)).find((a) => a.appointment_id === citaId);
    expect(aviso).toMatchObject({ status: 'ENVIADO', channel_used: 'CORREO', channel_planned: 'CORREO' });
  });

  it('consentimiento retirado entre la confirmación y el recordatorio: el recordatorio sale por correo, 0 mensajes nuevos', async () => {
    const c = await sesionCliente(e.barberia.tenantId);
    const numero = '+51 922 000 002';
    await aceptar(c.token, numero);
    const citaId = await reservar(c.token);
    await correrTareasDeAvisos(prueba);
    // Con consentimiento, la confirmación sí sale por WhatsApp.
    expect(await whatsapp.mensajesPara(numero)).toHaveLength(1);

    await prueba.agente.delete(`${RUTA_AVISO}/consentimiento-whatsapp`).set(como(c.token)).expect(204);
    await enviarRecordatorio(citaId);
    expect(await whatsapp.mensajesPara(numero)).toHaveLength(1);
    const correos = await esperarCorreos(mailpit, c.cliente.correo as string, 1);
    expect(correos.filter((m) => /recordatorio/i.test(m.asunto))).toHaveLength(1);
  });

  it('número cambiado a otro sin consentimiento (sembrado): 0 mensajes a cualquiera de los dos números', async () => {
    const c = await sesionCliente(e.barberia.tenantId);
    const anterior = '+51 922 000 003';
    const nuevo = '+51 922 000 004';
    await aceptar(c.token, anterior);
    // El número de la preferencia cambia sin un consentimiento nuevo (vigente solo para el anterior).
    await poolDe('seed').query(
      `UPDATE customer_notification_preference SET whatsapp_number = $3 WHERE tenant_id = $1 AND customer_id = $2`,
      [e.barberia.tenantId, c.cliente.clienteId, nuevo],
    );
    await reservar(c.token);
    await correrTareasDeAvisos(prueba);
    expect(await whatsapp.mensajesPara(anterior)).toEqual([]);
    expect(await whatsapp.mensajesPara(nuevo)).toEqual([]);
    expect(await esperarCorreos(mailpit, c.cliente.correo as string, 1)).toHaveLength(1);
  });

  it('en total, el simulador solo recibió mensajes de números con consentimiento vigente en ese momento', async () => {
    const { rows } = await poolDe('seed').query<{ number: string }>(
      `SELECT DISTINCT number FROM whatsapp_consent WHERE tenant_id = $1`,
      [e.barberia.tenantId],
    );
    const conConsentimiento = new Set(rows.map((r) => r.number));
    const recibidos = whatsapp.simulador.todos();
    expect(recibidos.length).toBeGreaterThan(0);
    for (const mensaje of recibidos) expect(conConsentimiento.has(mensaje.para)).toBe(true);
  });
});
