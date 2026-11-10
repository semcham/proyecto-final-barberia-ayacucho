import { DespachadorDeEventos } from '../../../src/shared';
import type { AppDePrueba } from '../../helpers/app';
import {
  appConCorreo,
  avisosDe,
  correrTareasDeAvisos,
  destinoDe,
  enviarSinCandado,
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

// T064 · Caídas de una réplica (ADR-025; FR-012, SC-005). Con dos instancias, sin pérdidas ni duplicados:
//  1. caída después del COMMIT y antes del despacho: el evento quedó PENDIENTE y sin avisos; la otra réplica lo
//     despacha con su tarea;
//  2. caída durante el despacho: la transacción del despacho se revierte entera (evento PENDIENTE, sin avisos);
//     dos réplicas que lo despachan a la vez crean los avisos una sola vez, y volver a despachar un evento ya
//     procesado no duplica avisos (UNIQUE por evento y destinatario);
//  3. caída con el aviso reclamado y sin enviar: al vencer el reclamo (claimed_until), la otra lo envía una vez;
//     antes de vencer, no lo toca.
// No cubre la caída entre la aceptación del canal y la anotación del envío (FR-012 y SC-005 la excluyen).
//
// El estado que deja una réplica caída se reproduce con el pool de siembra sobre filas reales.

jest.setTimeout(180_000);

describe('Caídas de una réplica en la salida de eventos y el envío (T064)', () => {
  let mailpit: Mailpit;
  let a: AppDePrueba;
  let b: AppDePrueba;
  let e: BarberiaParaReservar;
  const seed = () => poolDe('seed');

  /** Un cliente reserva con la instancia A; devuelve su correo y el id del evento CitaCreada. */
  async function reservaEnA(hora: string) {
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body } = await a.agente
      .post('/api/v1/citas')
      .set({ Authorization: `Bearer ${cliente.token}`, 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(fechaEnDias(3), hora) })
      .expect(201);
    const { rows } = await seed().query<{ id: string }>(
      `SELECT id FROM outbox_event WHERE tenant_id = $1 AND type = 'CitaCreada' AND payload->>'citaId' = $2`,
      [e.barberia.tenantId, body.id],
    );
    return { correo: cliente.cliente.correo as string, eventoId: rows[0].id, citaId: body.id as string };
  }

  /** Lo que deja una réplica que cae tras el COMMIT y antes de despachar: evento PENDIENTE y ningún aviso. */
  async function comoSiNoSeHubieraDespachado(eventoId: string) {
    await seed().query('DELETE FROM notification WHERE event_id = $1', [eventoId]);
    await seed().query(
      `UPDATE outbox_event SET status = 'PENDIENTE', processed_at = NULL, next_attempt_at = NULL WHERE id = $1`,
      [eventoId],
    );
  }

  const avisosDelEvento = async (eventoId: string) =>
    (await avisosDe(e.barberia.tenantId)).filter((aviso) => aviso.event_id === eventoId);

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    a = await appConCorreo(destinoDe(mailpit));
    b = await appConCorreo(destinoDe(mailpit));
    e = await barberiaParaReservar();
  });

  afterAll(async () => {
    await Promise.all([a.cerrar(), b.cerrar()]);
    await mailpit.detener();
    await cerrarPools();
  });

  it('1. caída después del COMMIT y antes del despacho: la otra réplica despacha y envía una vez', async () => {
    const reserva = await reservaEnA('09:00');
    await comoSiNoSeHubieraDespachado(reserva.eventoId);
    expect(await avisosDelEvento(reserva.eventoId)).toEqual([]);

    await correrTareasDeAvisos(b);
    await correrTareasDeAvisos(b);
    expect(await avisosDelEvento(reserva.eventoId)).toEqual([expect.objectContaining({ status: 'ENVIADO' })]);
    expect(await esperarCorreos(mailpit, reserva.correo, 1)).toHaveLength(1);
  });

  it('2. caída durante el despacho: dos réplicas a la vez crean los avisos una sola vez; redespachar no duplica', async () => {
    const reserva = await reservaEnA('10:00');
    await comoSiNoSeHubieraDespachado(reserva.eventoId);

    // Las dos despachan a la vez, sin el candado.
    await Promise.all([
      a.app.get(DespachadorDeEventos).ejecutar(),
      b.app.get(DespachadorDeEventos).ejecutar(),
    ]);
    expect(await avisosDelEvento(reserva.eventoId)).toHaveLength(1);

    // Un evento ya procesado que vuelve a quedar PENDIENTE (peor caso): el manejador no crea otro aviso.
    await seed().query(`UPDATE outbox_event SET status = 'PENDIENTE', processed_at = NULL WHERE id = $1`, [
      reserva.eventoId,
    ]);
    await b.app.get(DespachadorDeEventos).ejecutar();
    expect(await avisosDelEvento(reserva.eventoId)).toHaveLength(1);
    const { rows } = await seed().query('SELECT status FROM outbox_event WHERE id = $1', [reserva.eventoId]);
    expect(rows[0].status).toBe('PROCESADO');

    await Promise.all([enviarSinCandado(a), enviarSinCandado(b)]);
    expect(await esperarCorreos(mailpit, reserva.correo, 1)).toHaveLength(1);
  });

  it('3. caída con el aviso reclamado y sin enviar: la otra réplica lo envía al vencer el reclamo, una vez', async () => {
    const reserva = await reservaEnA('11:00');
    const [aviso] = await avisosDelEvento(reserva.eventoId);

    // A reclamó el aviso (ENVIANDO, con plazo) y cayó antes de enviarlo. Mientras el plazo no vence, B no lo toca.
    await seed().query(
      `UPDATE notification SET status = 'ENVIANDO', claimed_until = now() + interval '2 minutes' WHERE id = $1`,
      [aviso.id],
    );
    await enviarSinCandado(b);
    expect((await avisosDelEvento(reserva.eventoId))[0].status).toBe('ENVIANDO');
    expect(await mailpit.mensajesPara(reserva.correo)).toEqual([]);

    // Vence el plazo: B lo retoma y lo envía, una sola vez.
    await seed().query(`UPDATE notification SET claimed_until = now() - interval '1 second' WHERE id = $1`, [
      aviso.id,
    ]);
    await enviarSinCandado(b);
    await enviarSinCandado(b);
    expect((await avisosDelEvento(reserva.eventoId))[0]).toMatchObject({ status: 'ENVIADO' });
    const correos = await esperarCorreos(mailpit, reserva.correo, 1);
    expect(correos).toHaveLength(1);
    expect(correos[0].messageId).toContain(aviso.id);
  });
});
