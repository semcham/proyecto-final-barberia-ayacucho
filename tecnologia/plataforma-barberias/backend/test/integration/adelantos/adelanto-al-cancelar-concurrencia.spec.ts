import { VencerAdelantos } from '../../../src/modules/catalogo-citas';
import { activarAdelanto, cancelarCita, confirmarAdelanto, sembrarAdelanto } from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarCita } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T054 de 008 (concurrencia; PR32; FR-015, FR-019, FR-021) · Cancelar a la vez que vencer o confirmar, con dos
// instancias. Todas las operaciones bloquean la cita primero y el adelanto después:
// - cancelar (el cliente) y vencer a la vez una cita con el pago sin revisar y el límite máximo cumplido: exactamente
//   UNA de las dos tiene efecto (una cancelación, un evento, una auditoría); la otra no cambia nada;
// - cancelar (el propietario) y confirmar a la vez: la cancelación se aplica una sola vez y siempre deja el adelanto
//   POR_DEVOLVER; la confirmación, o no tiene efecto (409), o se aplicó antes (y entonces la cita se canceló
//   confirmada). Nunca una cita cancelada con el adelanto confirmado, ni respuestas 5xx.

jest.setTimeout(300_000);

const N = 20;

describe('PR32 · Cancelar a la vez que vencer o confirmar (T054, 2 instancias)', () => {
  let instancias: [AppDePrueba, AppDePrueba];

  beforeAll(async () => {
    instancias = [await crearApp(), await crearApp()];
  });

  afterAll(async () => {
    await Promise.all(instancias.map((i) => i.cerrar()));
    await cerrarPools();
  });

  /** `N` citas PENDIENTES, cada una de un cliente con sesión, con el pago registrado sin revisar. */
  async function pendientes(e: BarberiaParaReservar) {
    const tenantId = e.barberia.tenantId;
    await activarAdelanto(tenantId, e.barberia.propietarioId);
    const citas: { citaId: string; token: string }[] = [];
    for (let i = 0; i < N; i += 1) {
      const { cliente, token } = await sesionCliente(tenantId);
      const minutos = 9 * 60 + Math.floor(i / 2) * 30;
      const hora = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
      const citaId = await sembrarCita({
        tenantId,
        barberoId: i % 2 === 0 ? e.barberoId : e.otroBarberoId,
        servicioId: e.servicioId,
        clienteId: cliente.clienteId,
        estado: 'PENDIENTE',
        inicio: new Date(horaLima(fechaEnDias(4), hora)),
      });
      await sembrarAdelanto({
        tenantId,
        citaId,
        clienteId: cliente.clienteId,
        usuarioClienteId: cliente.usuarioId as string,
        propietarioId: e.barberia.propietarioId,
        estado: 'POR_REVISAR',
      });
      citas.push({ citaId, token });
    }
    return citas;
  }

  const estados = async (ids: string[]) =>
    (
      await poolDe('seed').query<{ id: string; status: string; deposito: string }>(
        `SELECT a.id, a.status, d.status AS deposito
           FROM appointment a JOIN booking_deposit d ON d.appointment_id = a.id WHERE a.id = ANY($1)`,
        [ids],
      )
    ).rows;

  async function porCita(sqlTexto: string, ids: string[]): Promise<Map<string, number>> {
    const { rows } = await poolDe('seed').query<{ cita: string; n: number }>(sqlTexto, [ids]);
    return new Map(rows.map((f) => [f.cita, f.n]));
  }

  const transicionesA = (estado: string, ids: string[]) =>
    porCita(
      `SELECT appointment_id AS cita, count(*)::int AS n FROM appointment_status_history
        WHERE appointment_id = ANY($1) AND to_status = '${estado}' GROUP BY 1`,
      ids,
    );

  const eventosPorCita = (tipo: string, ids: string[]) =>
    porCita(
      `SELECT payload->>'citaId' AS cita, count(*)::int AS n FROM outbox_event
        WHERE type = '${tipo}' AND payload->>'citaId' = ANY($1) GROUP BY 1`,
      ids,
    );

  it(`${N} cancelaciones del cliente a la vez que el vencimiento → exactamente una de las dos por cita`, async () => {
    const e = await barberiaParaReservar();
    const citas = await pendientes(e);
    const ids = citas.map((c) => c.citaId);
    // El límite máximo adicional ya pasó (movido en la base).
    await poolDe('seed').query(
      `UPDATE booking_deposit SET due_at = now() - interval '2 minutes', review_limit_at = now() - interval '1 minute'
        WHERE tenant_id = $1`,
      [e.barberia.tenantId],
    );

    const [respuestas] = await Promise.all([
      Promise.all(citas.map((c, i) => cancelarCita(instancias[i % 2], c.token, c.citaId))),
      instancias[0].app.get(VencerAdelantos).ejecutar(),
      instancias[1].app.get(VencerAdelantos).ejecutar(),
    ]);
    await instancias[0].app.get(VencerAdelantos).ejecutar();
    const codigos = respuestas.map((r) => r.status);
    console.info(
      'PR32 cancelar/vencer',
      JSON.stringify({
        e200: codigos.filter((s) => s === 200).length,
        otros: codigos.filter((s) => s !== 200),
      }),
    );
    // Si la tarea ganó, la cita ya está cancelada: cancelarla otra vez es una transición inválida de 002 (422).
    for (const r of respuestas) {
      expect([200, 422]).toContain(r.status);
      if (r.status === 422) expect(r.body.codigo).toBe('TRANSICION_INVALIDA');
    }

    expect((await estados(ids)).every((f) => f.status === 'CANCELADA' && f.deposito === 'POR_DEVOLVER')).toBe(
      true,
    );
    const cancelaciones = await transicionesA('CANCELADA', ids);
    expect(ids.map((c) => cancelaciones.get(c))).toEqual(ids.map(() => 1));
    const vencidas = await eventosPorCita('AdelantoVencido', ids);
    const canceladas = await eventosPorCita('CitaCancelada', ids);
    const auditoria = (await filasDe('audit_log', e.barberia.tenantId)).filter((f) =>
      ['ADELANTO_VENCIDO', 'ADELANTO_RESUELTO'].includes(f.action as string),
    );
    for (const [i, citaId] of ids.entries()) {
      // La cancelación del cliente tuvo efecto (200) o la tarea venció la cita antes (422): nunca las dos.
      const ganoElCliente = respuestas[i].status === 200;
      expect({ citaId, vencida: vencidas.get(citaId) ?? 0, cancelada: canceladas.get(citaId) ?? 0 }).toEqual({
        citaId,
        vencida: ganoElCliente ? 0 : 1,
        cancelada: ganoElCliente ? 1 : 0,
      });
      expect(auditoria.filter((f) => (f.resource as string).startsWith(`cita:${citaId};`))).toHaveLength(1);
    }
  });

  it(`${N} cancelaciones del propietario a la vez que la confirmación → una cancelación, nunca cancelada y confirmada`, async () => {
    const e = await barberiaParaReservar();
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const citas = await pendientes(e);
    const ids = citas.map((c) => c.citaId);

    const [cancelaciones, confirmaciones] = await Promise.all([
      Promise.all(citas.map((c, i) => cancelarCita(instancias[i % 2], propietario, c.citaId))),
      Promise.all(citas.map((c, i) => confirmarAdelanto(instancias[(i + 1) % 2], propietario, c.citaId))),
    ]);
    const confirmadas = confirmaciones.filter((r) => r.status === 200).length;
    console.info(
      'PR32 cancelar/confirmar',
      JSON.stringify({
        cancelar: cancelaciones.map((r) => r.status).filter((s) => s !== 200),
        confirmar200: confirmadas,
        confirmarOtros: confirmaciones.map((r) => r.status).filter((s) => s !== 200),
      }),
    );
    expect(cancelaciones.every((r) => r.status === 200)).toBe(true);
    for (const r of confirmaciones) {
      expect([200, 409]).toContain(r.status);
      if (r.status === 409) expect(r.body.codigo).toBe('ADELANTO_RESUELTO');
    }

    expect((await estados(ids)).every((f) => f.status === 'CANCELADA' && f.deposito === 'POR_DEVOLVER')).toBe(
      true,
    );
    const aCancelada = await transicionesA('CANCELADA', ids);
    const aConfirmada = await transicionesA('CONFIRMADA', ids);
    const eventosConfirmado = await eventosPorCita('AdelantoConfirmado', ids);
    const eventosCancelada = await eventosPorCita('CitaCancelada', ids);
    for (const [i, citaId] of ids.entries()) {
      const confirmo = confirmaciones[i].status === 200;
      expect({
        citaId,
        canceladas: aCancelada.get(citaId) ?? 0,
        confirmadas: aConfirmada.get(citaId) ?? 0,
        eventoConfirmado: eventosConfirmado.get(citaId) ?? 0,
        eventoCancelada: eventosCancelada.get(citaId) ?? 0,
      }).toEqual({
        citaId,
        canceladas: 1,
        confirmadas: confirmo ? 1 : 0,
        eventoConfirmado: confirmo ? 1 : 0,
        eventoCancelada: 1,
      });
    }
    const resueltos = (await filasDe('audit_log', e.barberia.tenantId)).filter(
      (f) => f.action === 'ADELANTO_RESUELTO',
    );
    expect(resueltos).toHaveLength(N);
    expect(new Set(resueltos.map((f) => f.resource)).size).toBe(N);
  });
});
