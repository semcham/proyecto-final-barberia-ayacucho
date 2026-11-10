import { DespachadorDeEventos } from '../../../src/shared';
import { ZonaHoraria } from '../../../src/shared/tiempo/zona-horaria';
import type { AppDePrueba } from '../../helpers/app';
import {
  appConCorreo,
  avisosDe,
  correrTareasDeAvisos,
  destinoDe,
  enviarSinCandado,
  descartarAvisosDeOtrasPruebas,
} from '../../helpers/avisos';
import {
  sembrarBarberia,
  sembrarBarbero,
  sembrarCita,
  sembrarDisponibilidad,
  sembrarHorarioAtencion,
  sembrarServicio,
} from '../../helpers/fixtures';
import { iniciarMailpit, type Mailpit } from '../../helpers/mailpit';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T078 · Recordatorio del día (US3-1, US3-5, US3-6; FR-022, FR-023, FR-033; SC-006, SC-010; PR28; research R09).
// - Al reservar o reprogramar con 2 h o más de antelación, M02 programa UN RecordatorioDeCita para inicio − 2 h
//   (clave de reemplazo recordatorio:<citaId>); con menos de 2 h, ninguno.
// - Reprogramar reemplaza el recordatorio; cancelar, completar o no asistió lo anulan; cancelar o reprogramar
//   descartan además el aviso de recordatorio ya creado y no enviado.
// - Con dos instancias y 50 citas: exactamente un recordatorio por cita, con los tres enlaces.
// - Un recordatorio que no se envió antes del inicio se descarta. Sin respuesta, la cita no cambia.
// - Latencia: cada recordatorio queda aceptado por el canal ≤ 10 min después de su momento programado.
//
// El paso del tiempo se simula moviendo available_at del evento a "ahora" (el momento programado de la prueba).

jest.setTimeout(300_000);

const MINUTO = 60_000;
const CLAVE = (citaId: string) => `recordatorio:${citaId}`;
const ENLACE = /\/e#[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

interface FilaEvento {
  id: string;
  status: string;
  available_at: Date;
  payload: Record<string, unknown>;
}

async function recordatoriosDe(citaId: string): Promise<FilaEvento[]> {
  const { rows } = await poolDe('seed').query<FilaEvento>(
    `SELECT id, status, available_at, payload FROM outbox_event
      WHERE type = 'RecordatorioDeCita' AND replace_key = $1 ORDER BY created_at`,
    [CLAVE(citaId)],
  );
  return rows;
}

/**
 * El momento del recordatorio llegó: available_at = hace un minuto (el reloj del contenedor de PostgreSQL puede ir
 * algo adelantado respecto del de la aplicación). Devuelve ese instante: el momento programado de la prueba.
 */
async function llegaElMomento(tenantId: string): Promise<Date> {
  const { rows } = await poolDe('seed').query<{ momento: Date }>(
    `UPDATE outbox_event SET available_at = now() - interval '1 minute'
      WHERE tenant_id = $1 AND type = 'RecordatorioDeCita' AND status = 'PENDIENTE'
      RETURNING available_at AS momento`,
    [tenantId],
  );
  return rows[0]?.momento ?? new Date();
}

/** Barbería que atiende todo el día (00:00 a 23:59): para reservar a menos de 2 h a cualquier hora. */
async function barberiaDeTodoElDia() {
  const barberia = await sembrarBarberia();
  const tramos = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, inicio: '00:00', fin: '23:59' }));
  await sembrarHorarioAtencion(barberia.tenantId, tramos);
  const { servicioId } = await sembrarServicio({
    tenantId: barberia.tenantId,
    nombre: 'Corte',
    precio: '20.00',
    duracionMin: 30,
  });
  const { barberoId } = await sembrarBarbero({
    tenantId: barberia.tenantId,
    nombre: 'Luis',
    servicios: [servicioId],
  });
  await sembrarDisponibilidad(barberia.tenantId, barberoId, tramos);
  return { barberia, servicioId, barberoId, otroBarberoId: barberoId } as BarberiaParaReservar;
}

/** La próxima hora de la agenda (múltiplo de 30 min en Lima) que empieza entre 35 min y 2 h desde ahora. */
function horaAMenosDeDosHoras(): string {
  const zona = ZonaHoraria.LIMA;
  let instante = Math.ceil((Date.now() + 35 * MINUTO) / (30 * MINUTO)) * 30 * MINUTO;
  // Un turno de 23:30 terminaría a las 24:00, fuera del horario: se toma el de las 00:00.
  if (zona.aLocal(new Date(instante)).minutos === 23 * 60 + 30) instante += 30 * MINUTO;
  return zona.formatoIso(new Date(instante));
}

describe('Recordatorio del día (T078, US3)', () => {
  let mailpit: Mailpit;
  let instancias: [AppDePrueba, AppDePrueba];
  const como = (token: string) => ({ Authorization: `Bearer ${token}` });

  const reservar = (
    i: number,
    token: string,
    e: BarberiaParaReservar,
    inicio: string,
    barberoId = e.barberoId,
  ) =>
    instancias[i % 2].agente
      .post('/api/v1/citas')
      .set({ ...como(token), 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: e.servicioId, barberoId, inicio });

  // Avisos pendientes que dejaron otros archivos: la tarea no debe intentarlos aquí (helpers/avisos.ts).
  beforeEach(() => descartarAvisosDeOtrasPruebas());

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    instancias = [await appConCorreo(destinoDe(mailpit)), await appConCorreo(destinoDe(mailpit))];
  });

  afterAll(async () => {
    await Promise.all(instancias.map((instancia) => instancia.cerrar()));
    await mailpit.detener();
    await cerrarPools();
  });

  it('reservar con 2 h o más programa UN recordatorio a inicio − 2 h, con el payload del contrato', async () => {
    const e = await barberiaParaReservar();
    const cliente = await sesionCliente(e.barberia.tenantId);
    const inicio = horaLima(fechaEnDias(3), '10:00');
    const { body: cita } = await reservar(0, cliente.token, e, inicio).expect(201);
    const eventos = await recordatoriosDe(cita.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0].status).toBe('PENDIENTE');
    expect(eventos[0].available_at).toEqual(new Date(new Date(inicio).getTime() - 120 * MINUTO));
    expect(eventos[0].payload).toEqual({
      citaId: cita.id,
      version: 1,
      clienteId: cliente.cliente.clienteId,
      servicio: 'Corte',
      barbero: 'Luis',
      inicio,
      fin: horaLima(fechaEnDias(3), '10:30'),
      zonaHoraria: 'America/Lima',
    });
  });

  it('una cita reservada o reprogramada a menos de 2 h no recibe recordatorio (FR-022)', async () => {
    const e = await barberiaDeTodoElDia();
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body: cercana } = await reservar(0, cliente.token, e, horaAMenosDeDosHoras()).expect(201);
    expect(await recordatoriosDe(cercana.id)).toEqual([]);

    // Una cita con recordatorio, reprogramada por el propietario a menos de 2 h: el recordatorio se anula.
    const otro = await sesionCliente(e.barberia.tenantId);
    const { body: lejana } = await reservar(1, otro.token, e, horaLima(fechaEnDias(3), '10:00')).expect(201);
    expect((await recordatoriosDe(lejana.id))[0].status).toBe('PENDIENTE');
    // La hora cercana la ocupa la primera cita: se libera (cancelada) para poder mover la segunda allí.
    await poolDe('seed').query(
      `UPDATE appointment SET status = 'CANCELADA', cancelled_at = now(), version = version + 1 WHERE id = $1`,
      [cercana.id],
    );
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    await instancias[0].agente
      .post(`/api/v1/citas/${lejana.id}/reprogramar`)
      .set(como(propietario))
      .send({ inicio: horaAMenosDeDosHoras() })
      .expect(200);
    expect((await recordatoriosDe(lejana.id)).map((ev) => ev.status)).toEqual(['ANULADO']);
  });

  it('reprogramar reemplaza el recordatorio; cancelar lo anula', async () => {
    const e = await barberiaParaReservar();
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body: cita } = await reservar(0, cliente.token, e, horaLima(fechaEnDias(3), '11:00')).expect(201);
    const nueva = horaLima(fechaEnDias(4), '12:00');
    await instancias[1].agente
      .post(`/api/v1/citas/${cita.id}/reprogramar`)
      .set(como(cliente.token))
      .send({ inicio: nueva })
      .expect(200);
    const tras = await recordatoriosDe(cita.id);
    expect(tras.map((ev) => ev.status)).toEqual(['ANULADO', 'PENDIENTE']);
    expect(tras[1].available_at).toEqual(new Date(new Date(nueva).getTime() - 120 * MINUTO));
    expect(tras[1].payload).toMatchObject({ version: 2, inicio: nueva });

    await instancias[0].agente.post(`/api/v1/citas/${cita.id}/cancelar`).set(como(cliente.token)).expect(200);
    expect((await recordatoriosDe(cita.id)).map((ev) => ev.status)).toEqual(['ANULADO', 'ANULADO']);
  });

  it('completar o marcar no asistió anula el recordatorio pendiente', async () => {
    const e = await barberiaParaReservar();
    const cliente = await sesionCliente(e.barberia.tenantId);
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    for (const estado of ['COMPLETADA', 'NO_ASISTIO'] as const) {
      // Una cita que ya empezó, con su recordatorio todavía pendiente (p. ej., la tarea no corrió a tiempo).
      const citaId = await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId: estado === 'COMPLETADA' ? e.barberoId : e.otroBarberoId,
        servicioId: e.servicioId,
        clienteId: cliente.cliente.clienteId,
        inicio: new Date(Date.now() - 10 * MINUTO),
      });
      await poolDe('seed').query(
        `INSERT INTO outbox_event (id, tenant_id, type, payload, replace_key, available_at)
         VALUES (gen_random_uuid(), $1, 'RecordatorioDeCita', '{}'::jsonb, $2, now() + interval '1 hour')`,
        [e.barberia.tenantId, CLAVE(citaId)],
      );
      await instancias[0].agente
        .post(`/api/v1/citas/${citaId}/estado`)
        .set(como(propietario))
        .send({ estado })
        .expect(200);
      expect((await recordatoriosDe(citaId)).map((ev) => ev.status)).toEqual(['ANULADO']);
    }
  });

  it('cancelar o reprogramar descartan el aviso de recordatorio ya creado y aún no enviado (R09)', async () => {
    const e = await barberiaParaReservar();
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body: cita } = await reservar(0, cliente.token, e, horaLima(fechaEnDias(3), '13:00')).expect(201);
    await llegaElMomento(e.barberia.tenantId);
    await instancias[0].app.get(DespachadorDeEventos).ejecutar();
    const creado = (await avisosDe(e.barberia.tenantId)).filter((a) => a.kind === 'RECORDATORIO');
    expect(creado).toEqual([expect.objectContaining({ status: 'PENDIENTE', appointment_id: cita.id })]);

    await instancias[1].agente.post(`/api/v1/citas/${cita.id}/cancelar`).set(como(cliente.token)).expect(200);
    const tras = (await avisosDe(e.barberia.tenantId)).filter((a) => a.kind === 'RECORDATORIO');
    expect(tras).toEqual([expect.objectContaining({ status: 'DESCARTADO' })]);
  });

  it('un recordatorio que no se envió antes del inicio se descarta, sin enviarse (FR-033)', async () => {
    const e = await barberiaParaReservar();
    const cliente = await sesionCliente(e.barberia.tenantId);
    await reservar(0, cliente.token, e, horaLima(fechaEnDias(3), '14:00')).expect(201);
    await llegaElMomento(e.barberia.tenantId);
    await instancias[0].app.get(DespachadorDeEventos).ejecutar();
    // La cita "empezó" antes de que el aviso saliera (discard_after = inicio).
    await poolDe('seed').query(
      `UPDATE notification SET discard_after = now() - interval '1 second' WHERE tenant_id = $1 AND kind = 'RECORDATORIO'`,
      [e.barberia.tenantId],
    );
    await enviarSinCandado(instancias[1]);
    const recordatorio = (await avisosDe(e.barberia.tenantId)).find((a) => a.kind === 'RECORDATORIO');
    expect(recordatorio).toMatchObject({ status: 'DESCARTADO', sent_at: null });
    const correos = await mailpit.mensajesPara(cliente.cliente.correo as string);
    expect(correos.filter((m) => /recordatorio/i.test(m.asunto))).toEqual([]);
  });

  it('dos instancias y 50 citas: exactamente un recordatorio por cita, con tres enlaces, en ≤ 10 min; la cita no cambia', async () => {
    const e = await barberiaParaReservar();
    const clientes: Awaited<ReturnType<typeof sesionCliente>>[] = [];
    for (let i = 0; i < 50; i += 25) {
      clientes.push(
        ...(await Promise.all(Array.from({ length: 25 }, () => sesionCliente(e.barberia.tenantId)))),
      );
    }
    const franja = (k: number) => {
      const minutos = 9 * 60 + (k % 20) * 30;
      return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
    };
    const respuestas = await Promise.all(
      clientes.map((c, i) =>
        reservar(
          i,
          c.token,
          e,
          horaLima(fechaEnDias(2 + Math.floor(i / 40)), franja(Math.floor(i / 2))),
          i % 2 === 0 ? e.barberoId : e.otroBarberoId,
        ),
      ),
    );
    expect(respuestas.filter((r) => r.status !== 201).map((r) => r.status)).toEqual([]);
    const citaIds = respuestas.map((r) => r.body.id as string);

    const programado = await llegaElMomento(e.barberia.tenantId);
    // Las dos instancias despachan y envían a la vez, dos veces, sin el candado de las tareas.
    for (let vuelta = 0; vuelta < 2; vuelta += 1) {
      await Promise.all(instancias.map((i) => i.app.get(DespachadorDeEventos).ejecutar()));
      await Promise.all(instancias.map((i) => enviarSinCandado(i)));
    }
    await correrTareasDeAvisos(instancias[0]);

    const recordatorios = (await avisosDe(e.barberia.tenantId)).filter((a) => a.kind === 'RECORDATORIO');
    expect(recordatorios).toHaveLength(50);
    expect(new Set(recordatorios.map((a) => a.appointment_id))).toEqual(new Set(citaIds));
    expect(recordatorios.filter((a) => a.status !== 'ENVIADO')).toEqual([]);

    // En el buzón: un recordatorio por cliente, con los tres enlaces a URL_PUBLICA/e#<token>.
    for (const c of clientes) {
      const correos = (await mailpit.mensajesPara(c.cliente.correo as string)).filter((m) =>
        /recordatorio/i.test(m.asunto),
      );
      expect(correos).toHaveLength(1);
      const enlaces = correos[0].texto.match(ENLACE) ?? [];
      expect(enlaces).toHaveLength(3);
      expect(new Set(enlaces).size).toBe(3);
      expect(correos[0].texto).not.toContain(c.cliente.telefono);
    }

    // Latencia (SC-006): del momento programado a la aceptación del canal, ≤ 10 min en todas las citas.
    const demoras = recordatorios.map((a) => (a.sent_at as Date).getTime() - programado.getTime());
    expect(Math.max(...demoras)).toBeLessThanOrEqual(10 * MINUTO);

    // US3-5: sin respuesta, la cita no cambia.
    const { rows } = await poolDe('seed').query(
      `SELECT DISTINCT status, client_confirmed_at FROM appointment WHERE id = ANY($1::uuid[])`,
      [citaIds],
    );
    expect(rows).toEqual([{ status: 'CONFIRMADA', client_confirmed_at: null }]);
  });
});
