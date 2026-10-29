import { randomUUID } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarPago } from '../../helpers/fixtures';
import { type BarberiaEnPrueba, barberiaEnPrueba, filaDePago, notificar } from '../../helpers/pagos';
import { tokenPlataformaPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T086 · Pagos por revisar del administrador (FR-025a): se listan los pagos marcados DUPLICADO,
// IMPORTE_DISTINTO, APROBADO_TRAS_RECHAZO y DEVOLUCION sin resolver, y las notificaciones sin pago (SIN_PAGO).
// La resolución con nota los saca de la lista, una sola vez, y queda en el audit_log de la barbería (PR13).

const seed = () => poolDe('seed');

interface Caso {
  marca: string;
  barberia: { id: string; nombre: string } | null;
  pagoId: string | null;
  eventoId: string | null;
  importeCentimos: number | null;
  detectadoEn: string;
}

describe('Pagos por revisar (T086)', () => {
  let prueba: AppDePrueba;
  let admin: string;
  let adminId: string;

  beforeAll(async () => {
    prueba = await crearApp();
    adminId = randomUUID();
    admin = (await tokenPlataformaPara(adminId)).token;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const lista = async () =>
    (
      await prueba.agente
        .get('/api/v1/plataforma/pagos/por-revisar')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200)
    ).body as Caso[];
  const resolver = (barberiaId: string, pagoId: string, motivo?: string) =>
    prueba.agente
      .post(`/api/v1/plataforma/barberias/${barberiaId}/pagos/${pagoId}/revision/resolucion`)
      .set({ Authorization: `Bearer ${admin}`, 'X-Correlation-Id': 'correlacion-resolucion' })
      .send(motivo === undefined ? {} : { motivo });

  /** Pago con la marca dada, sembrado directamente (como lo dejan la notificación o la conciliación). */
  async function marcado(b: BarberiaEnPrueba, marca: string, estado: 'APROBADO' | 'RECHAZADO' = 'APROBADO') {
    const { pagoId } = await sembrarPago({ tenantId: b.tenantId, suscripcionId: b.suscripcionId, estado });
    await seed().query('UPDATE payment SET review = $2 WHERE id = $1', [pagoId, marca]);
    return pagoId;
  }

  it('lista cada marca de un pago sin resolver con su barbería, y una notificación sin pago', async () => {
    const b = await barberiaEnPrueba();
    const ids = {
      DUPLICADO: await marcado(b, 'DUPLICADO'),
      IMPORTE_DISTINTO: await marcado(b, 'IMPORTE_DISTINTO'),
      APROBADO_TRAS_RECHAZO: await marcado(b, 'APROBADO_TRAS_RECHAZO', 'RECHAZADO'),
      DEVOLUCION: await marcado(b, 'DEVOLUCION'),
    };
    // Una notificación firmada de una referencia que no existe: provider_event con SIN_PAGO.
    const eventoId = `evt_${randomUUID().replace(/-/g, '')}`;
    await notificar(prueba, {
      referencia: `ses_desconocida_${randomUUID()}`,
      eventoId,
      importeCentimos: 3100,
    }).expect(200);

    const casos = await lista();
    for (const [marca, pagoId] of Object.entries(ids)) {
      expect(casos.find((c) => c.pagoId === pagoId)).toMatchObject({
        marca,
        barberia: { id: b.tenantId, nombre: expect.any(String) },
        eventoId: null,
        importeCentimos: 4900,
        detectadoEn: expect.any(String),
      });
    }
    expect(casos.find((c) => c.eventoId === eventoId)).toEqual({
      marca: 'SIN_PAGO',
      barberia: null,
      pagoId: null,
      eventoId,
      importeCentimos: 3100,
      detectadoEn: expect.any(String),
    });
    // Del más antiguo al más reciente.
    const fechas = casos.map((c) => Date.parse(c.detectadoEn));
    expect([...fechas].sort((x, y) => x - y)).toEqual(fechas);
  });

  it('no lista pagos sin marca, con la marca ya resuelta, ni la marca informativa de la fecha', async () => {
    const b = await barberiaEnPrueba();
    const { pagoId: sinMarca } = await sembrarPago({
      tenantId: b.tenantId,
      suscripcionId: b.suscripcionId,
      estado: 'APROBADO',
    });
    const resuelto = await marcado(b, 'DUPLICADO');
    await seed().query(
      `UPDATE payment SET review_resolved_at = now(), review_note = 'ya resuelto' WHERE id = $1`,
      [resuelto],
    );
    const conFecha = await marcado(b, 'FECHA_ANTERIOR_AL_PAGO');
    const ids = (await lista()).map((c) => c.pagoId);
    for (const id of [sinMarca, resuelto, conFecha]) expect(ids).not.toContain(id);
  });

  it('una notificación sin pago de hace más de 30 días ya no se lista', async () => {
    const eventoId = `evt_${randomUUID().replace(/-/g, '')}`;
    await notificar(prueba, { referencia: `ses_vieja_${randomUUID()}`, eventoId }).expect(200);
    await seed().query(
      `UPDATE provider_event SET received_at = now() - interval '31 days' WHERE event_id = $1`,
      [eventoId],
    );
    expect((await lista()).some((c) => c.eventoId === eventoId)).toBe(false);
  });

  it('resolver con nota lo saca de la lista, guarda la nota y queda auditado con el administrador', async () => {
    const b = await barberiaEnPrueba();
    const pagoId = await marcado(b, 'DUPLICADO');
    expect((await lista()).some((c) => c.pagoId === pagoId)).toBe(true);

    await resolver(b.tenantId, pagoId, '  Devuelto por Yape el 28/10, operación 1234  ').expect(204);
    expect((await lista()).some((c) => c.pagoId === pagoId)).toBe(false);
    expect(await filaDePago(pagoId)).toMatchObject({
      review: 'DUPLICADO',
      review_resolved_at: expect.any(Date),
      review_note: 'Devuelto por Yape el 28/10, operación 1234',
      status: 'APROBADO',
    });

    const auditoria = (await filasDe('audit_log', b.tenantId)).filter(
      (f) => f.action === 'REVISION_RESUELTA',
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      actor_id: adminId,
      resource: `pago:${pagoId}`,
      result: 'PERMITIDO',
      correlation_id: 'correlacion-resolucion',
    });
    // La nota no va a la auditoría (sin texto libre).
    expect(JSON.stringify(auditoria)).not.toContain('Devuelto por Yape');
    // No mueve dinero: la suscripción y los períodos no cambian.
    const { rows } = await seed().query(
      'SELECT count(*)::int AS n FROM subscription_period WHERE payment_id = $1',
      [pagoId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('una sola vez: resolverlo de nuevo, o un pago sin marca de la lista, responde 409; sin nota, 400', async () => {
    const b = await barberiaEnPrueba();
    const pagoId = await marcado(b, 'DEVOLUCION');
    await resolver(b.tenantId, pagoId).expect(400);
    await resolver(b.tenantId, pagoId, 'abc').expect(400);
    const respuestas = await Promise.all([
      resolver(b.tenantId, pagoId, 'Contracargo aceptado por el banco'),
      resolver(b.tenantId, pagoId, 'Contracargo aceptado por el banco'),
    ]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(respuestas.find((r) => r.status === 409)?.body.codigo).toBe('PAGO_YA_REVISADO');

    const { pagoId: sinMarca } = await sembrarPago({
      tenantId: b.tenantId,
      suscripcionId: b.suscripcionId,
      estado: 'APROBADO',
    });
    await resolver(b.tenantId, sinMarca, 'Nada que resolver aquí').expect(409);
    const conFecha = await marcado(b, 'FECHA_ANTERIOR_AL_PAGO');
    await resolver(b.tenantId, conFecha, 'No es de esta lista').expect(409);
    const auditoria = (await filasDe('audit_log', b.tenantId)).filter(
      (f) => f.action === 'REVISION_RESUELTA',
    );
    expect(auditoria).toHaveLength(1);
  });

  it('con otra barbería en la ruta el pago no existe (404) y no cambia', async () => {
    const a = await barberiaEnPrueba();
    const b = await barberiaEnPrueba();
    const pagoId = await marcado(a, 'IMPORTE_DISTINTO');
    await resolver(b.tenantId, pagoId, 'Intento con la barbería equivocada').expect(404);
    expect((await filaDePago(pagoId)).review_resolved_at).toBeNull();
  });
});
