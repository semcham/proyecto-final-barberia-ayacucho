import {
  activarAdelanto,
  cambiarEstadoCita,
  cancelarCita,
  confirmarAdelanto,
  conReloj,
  eventosDe,
  filaAdelanto,
  marcarDevuelto,
  RelojDePrueba,
  registrarPago,
  reservar,
  verAdelanto,
} from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { emitirEnlace, ipUnica, solicitudDeEnlace } from '../../helpers/enlaces';
import { filasDe } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T054 de 008 · Qué pasa con el adelanto al cancelar, al no asistir y al devolverlo (US5-1 a US5-6; FR-020 a FR-022,
// FR-029; research R10), con el reloj de la prueba:
// - confirmado: el cliente cancela con tiempo → POR_DEVOLVER; tarde → RETENIDO (y cancelación tardía); el propietario
//   → POR_DEVOLVER; no asistió → RETENIDO; por el enlace de 004, la misma regla que el cliente;
// - pendiente: sin pago → ANULADO; con el pago por revisar → POR_DEVOLVER;
// - CitaCancelada lleva `adelanto` (POR_DEVOLVER o RETENIDO); auditoría ADELANTO_RESUELTO;
// - marcar devuelto solo desde POR_DEVOLVER → DEVUELTO con su fecha, auditado (ADELANTO_DEVUELTO), sin datos del pago;
//   desde RETENIDO, CONFIRMADO, pendiente o ya devuelto → 409 ADELANTO_NO_POR_DEVOLVER;
// - el saldo (precio − adelanto) en la cita confirmada y en la completada.

jest.setTimeout(180_000);

const MINUTO = 60_000;

describe('El adelanto al cancelar, al no asistir y la devolución (T054, US5)', () => {
  const reloj = new RelojDePrueba();
  let prueba: AppDePrueba;
  const dia = fechaEnDias(3);

  beforeAll(async () => {
    prueba = await crearApp({ ajustar: conReloj(reloj) });
  });

  afterEach(() => reloj.real());

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  async function barberia() {
    const e = await barberiaParaReservar();
    await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    return { e, propietario };
  }

  /**
   * Cita de un cliente nuevo reservada a las 07:00 del día (reloj de la prueba) para `hora`: 'POR_PAGAR' sin pago,
   * 'POR_REVISAR' con el pago registrado, 'CONFIRMADO' con el pago confirmado por el propietario.
   */
  async function cita(
    e: BarberiaParaReservar,
    propietario: string,
    hora: string,
    estado: 'POR_PAGAR' | 'POR_REVISAR' | 'CONFIRMADO' = 'CONFIRMADO',
  ) {
    reloj.fijar(new Date(horaLima(dia, '07:00')));
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body } = await reservar(prueba, cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, hora),
    }).expect(201);
    if (estado !== 'POR_PAGAR') await registrarPago(prueba, cliente.token, body.id).expect(201);
    if (estado === 'CONFIRMADO') await confirmarAdelanto(prueba, propietario, body.id).expect(200);
    return { cliente, citaId: body.id as string };
  }

  const filaCita = async (citaId: string) =>
    (await poolDe('seed').query('SELECT status, late_cancellation FROM appointment WHERE id = $1', [citaId]))
      .rows[0];

  const resueltos = async (tenantId: string) =>
    (await filasDe('audit_log', tenantId)).filter((f) => f.action === 'ADELANTO_RESUELTO');

  const canceladaDe = async (tenantId: string, citaId: string) =>
    (await eventosDe(tenantId, 'CitaCancelada')).find(
      (f) => (f.payload as { citaId: string }).citaId === citaId,
    )?.payload as Record<string, unknown> | undefined;

  describe('con el adelanto confirmado', () => {
    it('el cliente cancela con tiempo → POR_DEVOLVER; CitaCancelada lo lleva y queda auditado (US5-2)', async () => {
      const { e, propietario } = await barberia();
      const { cliente, citaId } = await cita(e, propietario, '10:00');
      reloj.fijar(new Date(horaLima(dia, '07:30')));
      await cancelarCita(prueba, cliente.token, citaId).expect(200);

      expect(await filaCita(citaId)).toEqual({ status: 'CANCELADA', late_cancellation: false });
      expect(await filaAdelanto(citaId)).toMatchObject({
        status: 'POR_DEVOLVER',
        resolved_at: expect.any(Date),
      });
      expect(await canceladaDe(e.barberia.tenantId, citaId)).toMatchObject({
        canceladaPor: 'CLIENTE',
        tardia: false,
        adelanto: 'POR_DEVOLVER',
      });
      const [auditoria, ...mas] = await resueltos(e.barberia.tenantId);
      expect(mas).toEqual([]);
      expect(auditoria).toMatchObject({
        actor_id: cliente.cliente.usuarioId,
        resource: `cita:${citaId};POR_DEVOLVER`,
        result: 'PERMITIDO',
      });
    });

    it('el cliente cancela tarde → cancelación tardía y RETENIDO (US5-3)', async () => {
      const { e, propietario } = await barberia();
      const { cliente, citaId } = await cita(e, propietario, '10:00');
      // Menos de los 120 minutos de antelación de la barbería.
      reloj.fijar(new Date(horaLima(dia, '09:00')));
      await cancelarCita(prueba, cliente.token, citaId).expect(200);

      expect(await filaCita(citaId)).toEqual({ status: 'CANCELADA', late_cancellation: true });
      expect(await filaAdelanto(citaId)).toMatchObject({ status: 'RETENIDO' });
      expect(await canceladaDe(e.barberia.tenantId, citaId)).toMatchObject({
        tardia: true,
        adelanto: 'RETENIDO',
      });
      expect((await resueltos(e.barberia.tenantId)).map((f) => f.resource)).toEqual([
        `cita:${citaId};RETENIDO`,
      ]);
    });

    it('el propietario cancela (aunque falte poco) → POR_DEVOLVER, nunca tardía', async () => {
      const { e, propietario } = await barberia();
      const { citaId } = await cita(e, propietario, '11:00');
      reloj.fijar(new Date(horaLima(dia, '10:30')));
      await cancelarCita(prueba, propietario, citaId, 'Se enfermó el barbero').expect(200);
      expect(await filaCita(citaId)).toEqual({ status: 'CANCELADA', late_cancellation: false });
      expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_DEVOLVER' });
      expect(await canceladaDe(e.barberia.tenantId, citaId)).toMatchObject({
        canceladaPor: 'PROPIETARIO',
        adelanto: 'POR_DEVOLVER',
      });
    });

    it('no asistió → RETENIDO, auditado; completada → sigue CONFIRMADO (descontado del precio) (US5-4, US5-1)', async () => {
      const { e, propietario } = await barberia();
      const ausente = await cita(e, propietario, '12:00');
      const atendida = await cita(e, propietario, '13:00');
      reloj.fijar(new Date(horaLima(dia, '13:30')));
      await cambiarEstadoCita(prueba, propietario, ausente.citaId, 'NO_ASISTIO').expect(200);
      await cambiarEstadoCita(prueba, propietario, atendida.citaId, 'COMPLETADA').expect(200);

      expect(await filaAdelanto(ausente.citaId)).toMatchObject({ status: 'RETENIDO' });
      expect((await resueltos(e.barberia.tenantId)).map((f) => [f.resource, f.actor_id])).toEqual([
        [`cita:${ausente.citaId};RETENIDO`, e.barberia.propietarioId],
      ]);
      // El día de la cita el cliente paga el saldo: precio − adelanto (FR-020).
      const { body } = await verAdelanto(prueba, propietario, atendida.citaId).expect(200);
      expect(body).toMatchObject({
        estado: 'CONFIRMADO',
        precioCentimos: 2000,
        montoCentimos: 400,
        saldoCentimos: 1600,
      });
    });

    it('cancelar por el enlace del recordatorio (004) aplica la regla del cliente', async () => {
      const { e, propietario } = await barberia();
      const { citaId } = await cita(e, propietario, '14:00');
      reloj.fijar(new Date(horaLima(dia, '08:00')));
      const token = emitirEnlace(prueba, {
        tenantId: e.barberia.tenantId,
        citaId,
        accion: 'CANCELAR',
        venceEn: new Date(horaLima(dia, '14:00')),
      });
      await solicitudDeEnlace(prueba, 'cancelar', token, ipUnica()).expect(200);
      expect(await filaCita(citaId)).toEqual({ status: 'CANCELADA', late_cancellation: false });
      expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_DEVOLVER' });
      expect(await canceladaDe(e.barberia.tenantId, citaId)).toMatchObject({ adelanto: 'POR_DEVOLVER' });
      expect((await resueltos(e.barberia.tenantId)).map((f) => [f.resource, f.actor_id])).toEqual([
        [`cita:${citaId};POR_DEVOLVER`, null],
      ]);
    });
  });

  describe('con la cita pendiente', () => {
    it('sin pago → ANULADO (CitaCancelada sin `adelanto`); con el pago por revisar → POR_DEVOLVER (US5-5)', async () => {
      const { e, propietario } = await barberia();
      const sinPago = await cita(e, propietario, '15:00', 'POR_PAGAR');
      const conPago = await cita(e, propietario, '16:00', 'POR_REVISAR');
      reloj.fijar(new Date(horaLima(dia, '07:10')));
      await cancelarCita(prueba, sinPago.cliente.token, sinPago.citaId).expect(200);
      await cancelarCita(prueba, conPago.cliente.token, conPago.citaId).expect(200);

      expect(await filaAdelanto(sinPago.citaId)).toMatchObject({
        status: 'ANULADO',
        resolved_at: expect.any(Date),
      });
      expect(await filaAdelanto(conPago.citaId)).toMatchObject({ status: 'POR_DEVOLVER' });
      const anulada = await canceladaDe(e.barberia.tenantId, sinPago.citaId);
      expect(anulada).toBeDefined();
      expect(anulada).not.toHaveProperty('adelanto');
      expect(await canceladaDe(e.barberia.tenantId, conPago.citaId)).toMatchObject({
        adelanto: 'POR_DEVOLVER',
      });
      expect((await resueltos(e.barberia.tenantId)).map((f) => f.resource).sort()).toEqual(
        [`cita:${sinPago.citaId};ANULADO`, `cita:${conPago.citaId};POR_DEVOLVER`].sort(),
      );
      // Ya resuelto: el vencimiento y la confirmación no lo cambian.
      await confirmarAdelanto(prueba, propietario, conPago.citaId).expect(409);
      expect(await filaAdelanto(conPago.citaId)).toMatchObject({ status: 'POR_DEVOLVER' });
    });
  });

  describe('marcar devuelto (FR-022)', () => {
    it('desde POR_DEVOLVER → DEVUELTO con su fecha y quién, auditado y sin datos del pago; repetir → 409', async () => {
      const { e, propietario } = await barberia();
      const { cliente, citaId } = await cita(e, propietario, '17:00');
      reloj.fijar(new Date(horaLima(dia, '08:00')));
      await cancelarCita(prueba, cliente.token, citaId).expect(200);

      reloj.fijar(new Date(horaLima(dia, '08:30')));
      const r = await marcarDevuelto(prueba, propietario, citaId).expect(200);
      expect(r.body).toMatchObject({ citaId, estado: 'DEVUELTO', devueltoEn: expect.any(String) });
      expect(Math.abs(Date.parse(r.body.devueltoEn) - Date.parse(horaLima(dia, '08:30')))).toBeLessThan(
        MINUTO,
      );
      expect(await filaAdelanto(citaId)).toMatchObject({
        status: 'DEVUELTO',
        refunded_at: expect.any(Date),
        refunded_by: e.barberia.propietarioId,
      });
      const devueltos = (await filasDe('audit_log', e.barberia.tenantId)).filter(
        (f) => f.action === 'ADELANTO_DEVUELTO',
      );
      expect(devueltos).toHaveLength(1);
      expect(devueltos[0]).toMatchObject({
        actor_id: e.barberia.propietarioId,
        resource: `cita:${citaId};DEVUELTO`,
        result: 'PERMITIDO',
        reason: null,
      });

      const otra = await marcarDevuelto(prueba, propietario, citaId).expect(409);
      expect(otra.body.codigo).toBe('ADELANTO_NO_POR_DEVOLVER');
    });

    it('desde RETENIDO, CONFIRMADO o pendiente → 409 ADELANTO_NO_POR_DEVOLVER, sin cambios', async () => {
      const { e, propietario } = await barberia();
      const retenida = await cita(e, propietario, '10:00');
      const confirmada = await cita(e, propietario, '11:00');
      const pendiente = await cita(e, propietario, '12:00', 'POR_REVISAR');
      reloj.fijar(new Date(horaLima(dia, '09:30')));
      await cancelarCita(prueba, retenida.cliente.token, retenida.citaId).expect(200);
      expect(await filaAdelanto(retenida.citaId)).toMatchObject({ status: 'RETENIDO' });

      for (const [citaId, estado] of [
        [retenida.citaId, 'RETENIDO'],
        [confirmada.citaId, 'CONFIRMADO'],
        [pendiente.citaId, 'POR_REVISAR'],
      ]) {
        const r = await marcarDevuelto(prueba, propietario, citaId).expect(409);
        expect(r.body.codigo).toBe('ADELANTO_NO_POR_DEVOLVER');
        expect(await filaAdelanto(citaId)).toMatchObject({ status: estado, refunded_at: null });
      }
      expect(
        (await filasDe('audit_log', e.barberia.tenantId)).filter((f) => f.action === 'ADELANTO_DEVUELTO'),
      ).toEqual([]);
    });

    it('el propietario de otra barbería no lo ve (404) y la cita sin adelanto da 404 (FR-028)', async () => {
      const a = await barberia();
      const b = await barberia();
      const { cliente, citaId } = await cita(a.e, a.propietario, '13:00');
      reloj.fijar(new Date(horaLima(dia, '08:00')));
      await cancelarCita(prueba, cliente.token, citaId).expect(200);
      await marcarDevuelto(prueba, b.propietario, citaId).expect(404);
      expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_DEVOLVER' });
    });
  });
});
