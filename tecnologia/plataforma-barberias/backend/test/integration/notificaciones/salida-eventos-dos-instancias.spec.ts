import type { AppDePrueba } from '../../helpers/app';
import {
  appConCorreo,
  avisosDe,
  descartarAvisosDeOtrasPruebas,
  destinoDe,
  enviarSinCandado,
} from '../../helpers/avisos';
import { iniciarMailpit, type Mailpit } from '../../helpers/mailpit';
import { barberiaParaReservar, fechaEnDias, horaLima, nuevaClave } from '../../helpers/reservas';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T063 · Salida de eventos con dos instancias (US2-6; SC-005, SC-004; ADR-025). 100 reservas repartidas entre
// DOS instancias de la aplicación (cada una con sus pools) → 100 avisos: 0 perdidos y 0 duplicados, aunque las
// dos corran enviar-avisos a la vez y SIN el candado de las tareas (la garantía es el reclamo con SKIP LOCKED y
// la anotación condicional, no el candado). Además, la latencia: con el canal disponible, el ≥ 95 % de las
// confirmaciones queda aceptado por el canal en ≤ 5 min desde la reserva (medición local, no de producción).

jest.setTimeout(300_000);

const CITAS = 100;
const POR_DIA = 20;

/** HH:MM de la franja `i` (09:00 a 18:30, cada 30 min). */
const franja = (i: number) => {
  const minutos = 9 * 60 + (i % POR_DIA) * 30;
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
};

describe('Avisos con dos instancias (T063, SC-005)', () => {
  let mailpit: Mailpit;
  let instancias: [AppDePrueba, AppDePrueba];

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

  it('100 reservas → 100 confirmaciones, cada cliente exactamente una; ≥ 95 % aceptadas en ≤ 5 min', async () => {
    const e = await barberiaParaReservar();
    const clientes: Awaited<ReturnType<typeof sesionCliente>>[] = [];
    for (let i = 0; i < CITAS; i += 20) {
      clientes.push(
        ...(await Promise.all(Array.from({ length: 20 }, () => sesionCliente(e.barberia.tenantId)))),
      );
    }

    const respuestas = await Promise.all(
      clientes.map((c, i) =>
        instancias[i % 2].agente
          .post('/api/v1/citas')
          .set({ Authorization: `Bearer ${c.token}`, 'Idempotency-Key': nuevaClave() })
          .send({
            servicioId: e.servicioId,
            barberoId: i % 2 === 0 ? e.barberoId : e.otroBarberoId,
            inicio: horaLima(fechaEnDias(2 + Math.floor(i / (2 * POR_DIA))), franja(Math.floor(i / 2))),
          }),
      ),
    );
    expect(respuestas.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);

    // Las dos instancias envían a la vez, dos veces cada una, sin el candado.
    await Promise.all([enviarSinCandado(instancias[0]), enviarSinCandado(instancias[1])]);
    await Promise.all([enviarSinCandado(instancias[0]), enviarSinCandado(instancias[1])]);
    // Un fallo pasajero del buzón (con el equipo cargado) deja algún aviso PENDIENTE con su reintento a 30 s: se
    // adelanta ese reintento, como si hubiera pasado el tiempo, y las dos instancias vuelven a enviar. La prueba
    // sigue exigiendo 0 perdidos y 0 duplicados.
    for (let vuelta = 0; vuelta < 3; vuelta += 1) {
      const { rowCount } = await poolDe('seed').query(
        `UPDATE notification SET next_attempt_at = now() - interval '1 second'
          WHERE tenant_id = $1 AND status = 'PENDIENTE'`,
        [e.barberia.tenantId],
      );
      if (!rowCount) break;
      await Promise.all([enviarSinCandado(instancias[0]), enviarSinCandado(instancias[1])]);
    }

    const avisos = await avisosDe(e.barberia.tenantId);
    expect(avisos).toHaveLength(CITAS);
    expect(avisos.filter((a) => a.status !== 'ENVIADO')).toEqual([]);
    expect(new Set(avisos.map((a) => a.recipient_ref)).size).toBe(CITAS);

    // En el buzón: exactamente un correo por cliente (0 perdidos, 0 duplicados).
    const conteos = await Promise.all(
      clientes.map(async (c) => (await mailpit.mensajesPara(c.cliente.correo as string)).length),
    );
    expect(conteos.filter((n) => n !== 1)).toEqual([]);

    // Latencia (SC-004): de la reserva (created_at de la cita) a la aceptación del canal (sent_at del aviso).
    const { rows } = await poolDe('seed').query<{ segundos: number }>(
      `SELECT EXTRACT(EPOCH FROM (n.sent_at - a.created_at))::float AS segundos
         FROM notification n JOIN appointment a ON a.tenant_id = n.tenant_id AND a.id = n.appointment_id
        WHERE n.tenant_id = $1 ORDER BY segundos`,
      [e.barberia.tenantId],
    );
    expect(rows).toHaveLength(CITAS);
    const p95 = rows[Math.ceil(CITAS * 0.95) - 1].segundos;
    expect(p95).toBeLessThanOrEqual(300);
  });
});
