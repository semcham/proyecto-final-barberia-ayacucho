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

// T105 · Respaldo por correo cuando WhatsApp falla (US4-5; SC-009; FR-020; PR06; research R12, R13). Un cliente
// con canal WhatsApp y consentimiento vigente: si WhatsApp responde, el aviso sale por WhatsApp (ENVIADO); si falla
// 3 veces (fallar_n) o está caído, el MISMO aviso llega por correo una sola vez, como ENVIADO_RESPALDO. El paso del
// tiempo entre reintentos se simula adelantando next_attempt_at.

jest.setTimeout(180_000);

describe('Respaldo por correo de WhatsApp (T105, US4-5)', () => {
  let mailpit: Mailpit;
  let whatsapp: SimuladorDePrueba;
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let hora = 0;

  /** Un cliente con WhatsApp y consentimiento vigente (por la API) y una reserva suya. */
  async function clienteConWhatsapp(numero: string) {
    const c = await sesionCliente(e.barberia.tenantId);
    await prueba.agente
      .put('/api/v1/clientes/yo/aviso')
      .set({ Authorization: `Bearer ${c.token}` })
      .send({ canal: 'WHATSAPP', numeroWhatsapp: numero, aceptaWhatsapp: true, versionTexto: '2026-11' })
      .expect(200);
    const minutos = 9 * 60 + 30 * hora++;
    const hh = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
    const { body } = await prueba.agente
      .post('/api/v1/citas')
      .set({ Authorization: `Bearer ${c.token}`, 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(fechaEnDias(3), hh) })
      .expect(201);
    return { ...c, citaId: body.id as string };
  }

  /** Corre la tarea hasta que el aviso de la cita quede en un estado final (cada vuelta, "pasan" 30 s). */
  async function hastaFinal(citaId: string) {
    for (let vuelta = 0; vuelta < 8; vuelta += 1) {
      await correrTareasDeAvisos(prueba);
      const aviso = (await avisosDe(e.barberia.tenantId)).find((a) => a.appointment_id === citaId);
      if (aviso && !['PENDIENTE', 'ENVIANDO'].includes(aviso.status)) return aviso;
      await poolDe('seed').query(
        `UPDATE notification SET next_attempt_at = now() - interval '1 second' WHERE appointment_id = $1`,
        [citaId],
      );
    }
    return (await avisosDe(e.barberia.tenantId)).find((a) => a.appointment_id === citaId);
  }

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    whatsapp = await iniciarWhatsappDePrueba();
    prueba = await appConCorreo(destinoDe(mailpit), { whatsappUrl: whatsapp.url });
    e = await barberiaParaReservar();
  });

  beforeEach(async () => {
    await descartarAvisosDeOtrasPruebas();
    await whatsapp.modo({ modo: 'normal' });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await whatsapp.cerrar();
    await mailpit.detener();
    await cerrarPools();
  });

  it('con WhatsApp disponible, la confirmación sale por WhatsApp (ENVIADO) y no por correo', async () => {
    const c = await clienteConWhatsapp('+51 911 000 001');
    const aviso = await hastaFinal(c.citaId);
    expect(aviso).toMatchObject({ status: 'ENVIADO', channel_used: 'WHATSAPP', channel_planned: 'WHATSAPP' });
    const mensajes = await whatsapp.mensajesPara('+51 911 000 001');
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].texto).toContain('Corte');
    expect(mensajes[0].texto).not.toContain(c.cliente.telefono);
    expect(await mailpit.mensajesPara(c.cliente.correo as string)).toEqual([]);
  });

  it('fallar_n: tras 3 fallos de WhatsApp, el mismo aviso llega por correo una sola vez (ENVIADO_RESPALDO)', async () => {
    await whatsapp.modo({ modo: 'fallar_n', veces: 3 });
    const c = await clienteConWhatsapp('+51 911 000 002');
    const aviso = await hastaFinal(c.citaId);
    expect(aviso).toMatchObject({ status: 'ENVIADO_RESPALDO', channel_used: 'CORREO', attempts: 3 });
    expect(await whatsapp.mensajesPara('+51 911 000 002')).toEqual([]);
    const correos = await esperarCorreos(mailpit, c.cliente.correo as string, 1);
    expect(correos).toHaveLength(1);
    // Otra corrida no lo reenvía por ningún canal.
    await correrTareasDeAvisos(prueba);
    expect(await mailpit.mensajesPara(c.cliente.correo as string)).toHaveLength(1);
  });

  it('caido: WhatsApp no responde; el aviso llega por correo una sola vez (ENVIADO_RESPALDO)', async () => {
    await whatsapp.modo({ modo: 'caido' });
    const c = await clienteConWhatsapp('+51 911 000 003');
    const aviso = await hastaFinal(c.citaId);
    expect(aviso).toMatchObject({ status: 'ENVIADO_RESPALDO', channel_used: 'CORREO' });
    expect(await esperarCorreos(mailpit, c.cliente.correo as string, 1)).toHaveLength(1);
    await correrTareasDeAvisos(prueba);
    expect(await mailpit.mensajesPara(c.cliente.correo as string)).toHaveLength(1);
    expect(await whatsapp.mensajesPara('+51 911 000 003')).toEqual([]);
  });
});
