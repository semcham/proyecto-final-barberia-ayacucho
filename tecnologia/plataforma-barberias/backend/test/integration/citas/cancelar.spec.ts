import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarCita, sembrarUsuario } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T113 · Cancelación (RF14; FR-036 a FR-039): libera el horario al instante; la del cliente con menos
// antelación que la mínima de la barbería (120 min por defecto) queda tardía; la del propietario, nunca.

const MINUTO = 60_000;

describe('Cancelar una cita', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let tokenPropietario: string;
  let cliente: Awaited<ReturnType<typeof sesionCliente>>;

  const como = (t: string) => ({ Authorization: `Bearer ${t}` });
  const cancelar = (id: string, t: string, cuerpo?: object) => {
    const solicitud = prueba.agente.post(`/api/v1/citas/${id}/cancelar`).set(como(t));
    return cuerpo ? solicitud.send(cuerpo) : solicitud;
  };
  const reservar = (inicio: string, t: string) =>
    prueba.agente
      .post('/api/v1/citas')
      .set({ ...como(t), 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio });
  /** Cita del cliente que empieza dentro de `minutos` (sembrada: puede caer fuera del paso o del horario). */
  const citaEnMinutos = (minutos: number, clienteId = cliente.cliente.clienteId) =>
    sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.otroBarberoId,
      servicioId: e.servicioId,
      clienteId,
      inicio: new Date(Date.now() + minutos * MINUTO),
    });
  const filaDe = async (id: string) =>
    (
      await poolDe('seed').query(
        'SELECT status, late_cancellation, cancelled_by, cancelled_at, cancel_reason FROM appointment WHERE id = $1',
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    tokenPropietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    cliente = await sesionCliente(e.barberia.tenantId);
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('con antelación suficiente: cancelada sin marca tardía, la hora vuelve a estar libre y se puede reservar de nuevo', async () => {
    const fecha = fechaEnDias(3);
    const inicio = horaLima(fecha, '10:00');
    const { body: reserva } = await reservar(inicio, cliente.token).expect(201);
    const horarios = () =>
      prueba.agente
        .get(
          `/api/v1/publico/${e.barberia.slug}/horarios?servicio=${e.servicioId}&fecha=${fecha}&barbero=${e.barberoId}`,
        )
        .expect(200);
    expect((await horarios()).body.horas.map((h: { inicio: string }) => h.inicio)).not.toContain(inicio);

    const { body } = await cancelar(reserva.id, cliente.token, { motivo: 'Me surgió un viaje' }).expect(200);
    expect(body).toMatchObject({ id: reserva.id, estado: 'CANCELADA', cancelacionTardia: false });
    expect((await horarios()).body.horas.map((h: { inicio: string }) => h.inicio)).toContain(inicio);

    const otro = await sesionCliente(e.barberia.tenantId);
    await reservar(inicio, otro.token).expect(201);
  });

  it('con menos antelación que la mínima: se acepta, queda tardía, registra quién, cuándo y el motivo, y la agenda la marca', async () => {
    const id = await citaEnMinutos(60);
    const antes = Date.now();
    const { body } = await cancelar(id, cliente.token, { motivo: 'Se me hizo tarde' }).expect(200);
    expect(body).toMatchObject({ estado: 'CANCELADA', cancelacionTardia: true });

    const fila = await filaDe(id);
    expect(fila).toMatchObject({
      status: 'CANCELADA',
      late_cancellation: true,
      cancelled_by: cliente.cliente.usuarioId,
      cancel_reason: 'Se me hizo tarde',
    });
    expect(new Date(fila.cancelled_at).getTime()).toBeGreaterThanOrEqual(antes - 1000);

    // La agenda del propietario muestra la marca (antes salía siempre falsa).
    const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(
      new Date(Date.now() + 60 * MINUTO),
    );
    const agenda = await prueba.agente
      .get(`/api/v1/agenda?fecha=${fecha}`)
      .set(como(tokenPropietario))
      .expect(200);
    expect(agenda.body.citas.find((c: { id: string }) => c.id === id)).toMatchObject({
      estado: 'CANCELADA',
      cancelacionTardia: true,
    });
  });

  it('el límite: con exactamente la antelación mínima (o más) no es tardía', async () => {
    const id = await citaEnMinutos(125);
    expect((await cancelar(id, cliente.token).expect(200)).body.cancelacionTardia).toBe(false);
  });

  it('el propietario cancela sobre la hora sin marca tardía y queda registrado como quien canceló', async () => {
    const id = await citaEnMinutos(30);
    const { body } = await cancelar(id, tokenPropietario).expect(200);
    expect(body.cancelacionTardia).toBe(false);
    expect(await filaDe(id)).toMatchObject({
      late_cancellation: false,
      cancelled_by: e.barberia.propietarioId,
    });
  });

  it('la cita de otro cliente de la misma barbería → 404 y no cambia', async () => {
    const otro = await sesionCliente(e.barberia.tenantId);
    const ajena = await citaEnMinutos(300, otro.cliente.clienteId);
    expect((await cancelar(ajena, cliente.token).expect(404)).body.codigo).toBe('NO_ENCONTRADO');
    expect((await filaDe(ajena)).status).toBe('CONFIRMADA');
  });

  it('el barbero no cancela citas → 403', async () => {
    const barbero = await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const t = await tokenPara(e.barberia.tenantId, barbero.usuarioId, 'BARBERO');
    const id = await citaEnMinutos(400);
    await cancelar(id, t).expect(403);
    expect((await filaDe(id)).status).toBe('CONFIRMADA');
  });

  it('una cita ya empezada (cliente) o ya cancelada → 422 TRANSICION_INVALIDA', async () => {
    const empezada = await citaEnMinutos(-10);
    expect((await cancelar(empezada, cliente.token).expect(422)).body.codigo).toBe('TRANSICION_INVALIDA');
    const id = await citaEnMinutos(500);
    await cancelar(id, cliente.token).expect(200);
    await cancelar(id, cliente.token).expect(422);
    await cancelar(id, tokenPropietario).expect(422);
  });

  it('registra CITA_CANCELADA y una fila de historial con el autor', async () => {
    const id = await citaEnMinutos(600);
    await cancelar(id, cliente.token).expect(200);
    const historial = await poolDe('seed').query(
      'SELECT from_status, to_status, changed_by FROM appointment_status_history WHERE appointment_id = $1',
      [id],
    );
    expect(historial.rows).toEqual([
      { from_status: 'CONFIRMADA', to_status: 'CANCELADA', changed_by: cliente.cliente.usuarioId },
    ]);
    const auditoria = (await filasDe('audit_log', e.barberia.tenantId)).filter(
      (f) => f.action === 'CITA_CANCELADA' && f.resource === `cita:${id}`,
    );
    expect(auditoria).toHaveLength(1);
  });

  it('un motivo de más de 200 caracteres o campos desconocidos → 400', async () => {
    const id = await citaEnMinutos(700);
    await cancelar(id, cliente.token, { motivo: 'x'.repeat(201) }).expect(400);
    await cancelar(id, cliente.token, { estado: 'CANCELADA' }).expect(400);
    expect((await filaDe(id)).status).toBe('CONFIRMADA');
  });
});
