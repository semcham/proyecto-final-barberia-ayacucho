import { EjecutorTareas } from '../../../src/shared';
import { activarAdelanto, confirmarAdelanto, registrarPago, reservar } from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe } from '../../helpers/fixtures';
import { barberiaParaReservar, fechaEnDias, horaLima } from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T037 de 008 · PR32 (US3-5; FR-015; SC-006; research R06): 20 pares de confirmaciones simultáneas de la misma cita,
// cada par repartido entre DOS instancias, dejan por cita exactamente 1 transición PENDIENTE → CONFIRMADA, 1 entrada
// de auditoría ADELANTO_CONFIRMADO y 1 aviso al cliente; las dos respuestas son 200 (la segunda, sin efecto), y
// ninguna 5xx. La cita se bloquea primero y el adelanto después, con transiciones condicionales.

jest.setTimeout(240_000);

const PARES = 20;

describe('PR32 · Confirmaciones simultáneas del adelanto (T037, 2 instancias)', () => {
  let instancias: [AppDePrueba, AppDePrueba];

  beforeAll(async () => {
    instancias = [await crearApp(), await crearApp()];
  });

  afterAll(async () => {
    await Promise.all(instancias.map((i) => i.cerrar()));
    await cerrarPools();
  });

  it(`${PARES} pares de confirmaciones a la vez → 1 transición, 1 auditoría y 1 aviso por cita`, async () => {
    const e = await barberiaParaReservar();
    const tenantId = e.barberia.tenantId;
    await activarAdelanto(tenantId, e.barberia.propietarioId);
    const propietario = await tokenPara(tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const fecha = fechaEnDias(3);

    // 20 citas pendientes con su pago registrado (una cada 30 min, alternando los dos barberos).
    const citas: string[] = [];
    for (let i = 0; i < PARES; i += 1) {
      const cliente = await sesionCliente(tenantId);
      const minutos = 9 * 60 + Math.floor(i / 2) * 30;
      const hora = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
      const { body } = await reservar(instancias[0], cliente.token, {
        servicioId: e.servicioId,
        barberoId: i % 2 === 0 ? e.barberoId : e.otroBarberoId,
        inicio: horaLima(fecha, hora),
      }).expect(201);
      await registrarPago(instancias[1], cliente.token, body.id).expect(201);
      citas.push(body.id);
    }

    const respuestas = await Promise.all(
      citas.flatMap((citaId) =>
        instancias.map((instancia) => confirmarAdelanto(instancia, propietario, citaId)),
      ),
    );
    const estados = respuestas.map((r) => r.status);
    console.info(
      'PR32',
      JSON.stringify({
        e200: estados.filter((s) => s === 200).length,
        otros: estados.filter((s) => s !== 200),
      }),
    );
    expect(estados.every((s) => s === 200)).toBe(true);
    for (const r of respuestas)
      expect(r.body).toMatchObject({ estado: 'CONFIRMADA', adelanto: { estado: 'CONFIRMADO' } });

    const seed = poolDe('seed');
    const transiciones = await seed.query<{ appointment_id: string; n: number }>(
      `SELECT appointment_id, count(*)::int AS n FROM appointment_status_history
        WHERE appointment_id = ANY($1) AND to_status = 'CONFIRMADA' GROUP BY appointment_id`,
      [citas],
    );
    expect(transiciones.rows.map((f) => f.n)).toEqual(citas.map(() => 1));
    const auditoria = (await filasDe('audit_log', tenantId)).filter(
      (f) => f.action === 'ADELANTO_CONFIRMADO',
    );
    expect(auditoria).toHaveLength(PARES);
    expect(new Set(auditoria.map((f) => f.resource)).size).toBe(PARES);
    const eventos = await seed.query<{ cita: string; n: number }>(
      `SELECT payload->>'citaId' AS cita, count(*)::int AS n FROM outbox_event
        WHERE tenant_id = $1 AND type = 'AdelantoConfirmado' GROUP BY 1`,
      [tenantId],
    );
    expect(eventos.rows).toHaveLength(PARES);
    expect(eventos.rows.every((f) => f.n === 1)).toBe(true);

    // El despacho crea UN aviso ADELANTO_CONFIRMADO por cita (el envío no hace falta aquí).
    const ejecutor = instancias[0].app.get(EjecutorTareas);
    for (let i = 0; i < 10; i += 1) {
      const pendientes = await seed.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM outbox_event WHERE tenant_id = $1 AND status = 'PENDIENTE'
           AND type = 'AdelantoConfirmado'`,
        [tenantId],
      );
      if (pendientes.rows[0].n === 0) break;
      await ejecutor.ejecutarAhora('despachar-eventos');
    }
    const avisos = await seed.query<{ cita: string; n: number }>(
      `SELECT appointment_id AS cita, count(*)::int AS n FROM notification
        WHERE tenant_id = $1 AND kind = 'ADELANTO_CONFIRMADO' GROUP BY 1`,
      [tenantId],
    );
    expect(avisos.rows).toHaveLength(PARES);
    expect(avisos.rows.every((f) => f.n === 1)).toBe(true);
  });
});
