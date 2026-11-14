import { VencerAdelantos } from '../../../src/modules/catalogo-citas';
import { EjecutorTareas } from '../../../src/shared';
import { activarAdelanto, confirmarAdelanto, sembrarAdelanto } from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarCita, sembrarCliente } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T049 de 008 · El vencimiento con dos réplicas (PR32; US4-5; FR-015, FR-019; SC-003, SC-006):
// - dos instancias corren vencer-adelantos a la vez (con el candado del ejecutor y sin él) sobre 50 adelantos
//   vencidos: cada cita se cancela UNA vez, con un evento, una auditoría y un aviso por destinatario;
// - confirmaciones y vencimientos simultáneos de las mismas citas (con el pago sin revisar y el límite máximo
//   alcanzado): por cita, exactamente uno de los dos tiene efecto; ninguna queda confirmada Y cancelada, y ninguna
//   respuesta es 5xx.
// Los plazos se mueven en la base (hora límite y límite máximo ya pasados): la prueba no depende del reloj.

jest.setTimeout(300_000);

const TOTAL = 50;
const PARES = 20;

describe('PR32 · Vencimiento con dos réplicas (T049)', () => {
  let instancias: [AppDePrueba, AppDePrueba];

  beforeAll(async () => {
    instancias = [await crearApp(), await crearApp()];
  });

  afterAll(async () => {
    await Promise.all(instancias.map((i) => i.cerrar()));
    await cerrarPools();
  });

  /**
   * `n` citas PENDIENTES con su adelanto (alternando sin pago y con el pago sin revisar), con la hora límite y el
   * límite máximo adicional ya pasados. Una cada 30 min por barbero, desde las 09:00, en días sucesivos.
   */
  async function citasVencidas(
    e: BarberiaParaReservar,
    n: number,
    estado: (i: number) => 'POR_PAGAR' | 'POR_REVISAR',
  ): Promise<string[]> {
    const tenantId = e.barberia.tenantId;
    await activarAdelanto(tenantId, e.barberia.propietarioId);
    const citas: string[] = [];
    for (let i = 0; i < n; i += 1) {
      // Un cliente por cita: el mismo cliente no puede tener dos citas que se solapen (002).
      const cliente = await sembrarCliente({ tenantId });
      const turno = Math.floor(i / 2);
      const minutos = 9 * 60 + (turno % 18) * 30;
      const hora = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
      const citaId = await sembrarCita({
        tenantId,
        barberoId: i % 2 === 0 ? e.barberoId : e.otroBarberoId,
        servicioId: e.servicioId,
        clienteId: cliente.clienteId,
        estado: 'PENDIENTE',
        inicio: new Date(horaLima(fechaEnDias(3 + Math.floor(turno / 18)), hora)),
      });
      await sembrarAdelanto({
        tenantId,
        citaId,
        clienteId: cliente.clienteId,
        usuarioClienteId: cliente.usuarioId as string,
        propietarioId: e.barberia.propietarioId,
        estado: estado(i),
      });
      citas.push(citaId);
    }
    await poolDe('seed').query(
      `UPDATE booking_deposit SET due_at = now() - interval '2 minutes', review_limit_at = now() - interval '1 minute'
        WHERE tenant_id = $1`,
      [tenantId],
    );
    return citas;
  }

  async function porCita(sqlTexto: string, citas: string[]): Promise<Map<string, number>> {
    const { rows } = await poolDe('seed').query<{ cita: string; n: number }>(sqlTexto, [citas]);
    return new Map(rows.map((f) => [f.cita, f.n]));
  }

  const despacharTodo = async (tenantId: string) => {
    const ejecutor = instancias[0].app.get(EjecutorTareas);
    for (let i = 0; i < 20; i += 1) {
      const { rows } = await poolDe('seed').query<{ n: number }>(
        `SELECT count(*)::int AS n FROM outbox_event WHERE tenant_id = $1 AND status = 'PENDIENTE'
           AND type IN ('AdelantoVencido', 'AdelantoConfirmado')`,
        [tenantId],
      );
      if (rows[0].n === 0) return;
      await ejecutor.ejecutarAhora('despachar-eventos');
    }
  };

  it(`${TOTAL} adelantos vencidos y dos réplicas a la vez → cada cita se cancela una vez, con un aviso por destinatario`, async () => {
    const e = await barberiaParaReservar();
    const tenantId = e.barberia.tenantId;
    const citas = await citasVencidas(e, TOTAL, (i) => (i % 2 === 0 ? 'POR_PAGAR' : 'POR_REVISAR'));

    // Las dos réplicas, con el candado (una sola corre) y sin él (las dos a la vez).
    await Promise.all([
      ...instancias.map((i) => i.app.get(VencerAdelantos).ejecutar()),
      ...instancias.map((i) => i.app.get(EjecutorTareas).ejecutarAhora('vencer-adelantos')),
    ]);
    // Una corrida más, por si alguna cita bloqueada se saltó: no debe cambiar nada.
    await instancias[1].app.get(VencerAdelantos).ejecutar();

    const { rows: estados } = await poolDe('seed').query<{ status: string; late: boolean; deposito: string }>(
      `SELECT a.status, a.late_cancellation AS late, d.status AS deposito
         FROM appointment a JOIN booking_deposit d ON d.appointment_id = a.id WHERE a.id = ANY($1)`,
      [citas],
    );
    expect(estados).toHaveLength(TOTAL);
    expect(estados.every((f) => f.status === 'CANCELADA' && !f.late)).toBe(true);
    expect(estados.filter((f) => f.deposito === 'VENCIDO')).toHaveLength(TOTAL / 2);
    expect(estados.filter((f) => f.deposito === 'POR_DEVOLVER')).toHaveLength(TOTAL / 2);

    const cancelaciones = await porCita(
      `SELECT appointment_id AS cita, count(*)::int AS n FROM appointment_status_history
        WHERE appointment_id = ANY($1) AND to_status = 'CANCELADA' GROUP BY 1`,
      citas,
    );
    expect(citas.map((c) => cancelaciones.get(c))).toEqual(citas.map(() => 1));
    const eventos = await porCita(
      `SELECT payload->>'citaId' AS cita, count(*)::int AS n FROM outbox_event
        WHERE type = 'AdelantoVencido' AND payload->>'citaId' = ANY($1) GROUP BY 1`,
      citas,
    );
    expect(citas.map((c) => eventos.get(c))).toEqual(citas.map(() => 1));
    const auditoria = (await filasDe('audit_log', tenantId)).filter((f) => f.action === 'ADELANTO_VENCIDO');
    expect(auditoria).toHaveLength(TOTAL);
    expect(new Set(auditoria.map((f) => f.resource)).size).toBe(TOTAL);

    await despacharTodo(tenantId);
    const { rows: avisos } = await poolDe('seed').query<{ cita: string; para: string; n: number }>(
      `SELECT appointment_id AS cita, recipient_kind AS para, count(*)::int AS n FROM notification
        WHERE tenant_id = $1 AND kind = 'ADELANTO_VENCIDO' GROUP BY 1, 2`,
      [tenantId],
    );
    expect(avisos).toHaveLength(TOTAL * 2);
    expect(avisos.every((f) => f.n === 1)).toBe(true);
  });

  it(`${PARES} confirmaciones a la vez que el vencimiento → exactamente uno de los dos por cita`, async () => {
    const e = await barberiaParaReservar();
    const tenantId = e.barberia.tenantId;
    const propietario = await tokenPara(tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const citas = await citasVencidas(e, PARES, () => 'POR_REVISAR');

    const [respuestas] = await Promise.all([
      Promise.all(citas.map((citaId, i) => confirmarAdelanto(instancias[i % 2], propietario, citaId))),
      instancias[0].app.get(VencerAdelantos).ejecutar(),
      instancias[1].app.get(VencerAdelantos).ejecutar(),
    ]);
    // Lo que una corrida saltó por estar la cita bloqueada lo toma la siguiente.
    await instancias[0].app.get(VencerAdelantos).ejecutar();

    const estados = respuestas.map((r) => r.status);
    console.info(
      'PR32 vencer/confirmar',
      JSON.stringify({
        e200: estados.filter((s) => s === 200).length,
        e409: estados.filter((s) => s === 409).length,
        otros: estados.filter((s) => s !== 200 && s !== 409),
      }),
    );
    expect(estados.every((s) => s === 200 || s === 409)).toBe(true);
    for (const r of respuestas) {
      if (r.status === 409) expect(r.body.codigo).toBe('ADELANTO_RESUELTO');
    }

    const { rows } = await poolDe('seed').query<{ id: string; status: string; deposito: string }>(
      `SELECT a.id, a.status, d.status AS deposito
         FROM appointment a JOIN booking_deposit d ON d.appointment_id = a.id WHERE a.id = ANY($1)`,
      [citas],
    );
    expect(rows).toHaveLength(PARES);
    for (const fila of rows) {
      const respuesta = respuestas[citas.indexOf(fila.id)];
      // Nunca confirmada y cancelada: la cita y el adelanto cuentan lo mismo, y la respuesta también.
      if (fila.status === 'CONFIRMADA') {
        expect(fila.deposito).toBe('CONFIRMADO');
        expect(respuesta.status).toBe(200);
      } else {
        expect(fila).toMatchObject({ status: 'CANCELADA', deposito: 'POR_DEVOLVER' });
        expect(respuesta.status).toBe(409);
      }
    }

    const transiciones = await porCita(
      `SELECT appointment_id AS cita, count(*)::int AS n FROM appointment_status_history
        WHERE appointment_id = ANY($1) AND from_status = 'PENDIENTE' GROUP BY 1`,
      citas,
    );
    expect(citas.map((c) => transiciones.get(c))).toEqual(citas.map(() => 1));
    const eventos = await porCita(
      `SELECT payload->>'citaId' AS cita, count(*)::int AS n FROM outbox_event
        WHERE type IN ('AdelantoVencido', 'AdelantoConfirmado') AND payload->>'citaId' = ANY($1) GROUP BY 1`,
      citas,
    );
    expect(citas.map((c) => eventos.get(c))).toEqual(citas.map(() => 1));
    const auditoria = (await filasDe('audit_log', tenantId)).filter((f) =>
      ['ADELANTO_VENCIDO', 'ADELANTO_CONFIRMADO'].includes(f.action as string),
    );
    expect(auditoria).toHaveLength(PARES);
    expect(new Set(auditoria.map((f) => (f.resource as string).split(';')[0])).size).toBe(PARES);

    // Un aviso por destinatario: confirmada → el cliente; vencida → el cliente y el propietario.
    await despacharTodo(tenantId);
    const { rows: avisos } = await poolDe('seed').query<{ cita: string; para: string; n: number }>(
      `SELECT appointment_id AS cita, recipient_kind AS para, count(*)::int AS n FROM notification
        WHERE tenant_id = $1 AND kind IN ('ADELANTO_VENCIDO', 'ADELANTO_CONFIRMADO') GROUP BY 1, 2`,
      [tenantId],
    );
    expect(avisos.every((f) => f.n === 1)).toBe(true);
    const confirmadas = rows.filter((f) => f.status === 'CONFIRMADA').length;
    expect(avisos).toHaveLength(confirmadas + (PARES - confirmadas) * 2);
  });
});
