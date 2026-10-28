import { v7 as uuidv7 } from 'uuid';
import {
  finDeGracia,
  sumarUnMes,
} from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import { EjecutorTareas } from '../../../src/shared';
import { sembrarPago } from '../../helpers/fixtures';
import {
  type BarberiaEnPrueba,
  barberiaEnPrueba,
  type EntornoDePagos,
  filaDePago,
  iniciarEntornoDePagos,
  notificar,
  PLAN_BASICO,
  PLAN_PRO,
} from '../../helpers/pagos';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T052 · Tarea vencer-suscripciones (RF22; FR-029 a FR-033; ADR-024; data-model.md §2): cada transición
// automática, con el plan del período que empieza y la auditoría con la fecha que le correspondía (FR-031).
// Escenario 8 de US2: el pago confirmado durante la gracia hace empezar el período al final del vencido.

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;
const seed = () => poolDe('seed');

async function suscripcion(id: string) {
  const { rows } = await seed().query(
    `SELECT s.status, p.code AS plan, s.grace_ends_at, s.current_period_end FROM subscription s
       JOIN plan p ON p.id = s.plan_id WHERE s.id = $1`,
    [id],
  );
  return rows[0] as { status: string; plan: string; grace_ends_at: Date | null; current_period_end: Date };
}

async function auditorias(tenantId: string) {
  const { rows } = await seed().query(
    `SELECT action, actor_id, resource, at FROM audit_log
      WHERE tenant_id = $1 AND action LIKE 'SUSCRIPCION_%' ORDER BY at`,
    [tenantId],
  );
  return rows as { action: string; actor_id: string | null; resource: string; at: Date }[];
}

/** Deja la suscripción con la prueba terminada en `finPrueba` y los períodos pagados indicados. */
async function preparar(
  b: BarberiaEnPrueba,
  opciones: {
    finPrueba: Date;
    estado: 'TRIAL' | 'ACTIVE' | 'PAST_DUE';
    plan?: string;
    periodos?: { inicio: Date; plan: string }[];
    graciaHasta?: Date;
  },
): Promise<void> {
  let fin = opciones.finPrueba;
  for (const periodo of opciones.periodos ?? []) {
    const { pagoId } = await sembrarPago({
      tenantId: b.tenantId,
      suscripcionId: b.suscripcionId,
      metodo: 'TRANSFERENCIA',
      estado: 'APROBADO',
      plan: periodo.plan === PLAN_PRO ? 'PRO' : 'BASICO',
      cubreDesde: periodo.inicio,
    });
    fin = sumarUnMes(periodo.inicio);
    await seed().query(
      `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuidv7(), b.tenantId, b.suscripcionId, pagoId, periodo.plan, periodo.inicio, fin],
    );
  }
  await seed().query(
    `UPDATE subscription
        SET status = $2, trial_ends_at = $3, current_period_end = $4, grace_ends_at = $5,
            plan_id = COALESCE($6, plan_id)
      WHERE id = $1`,
    [
      b.suscripcionId,
      opciones.estado,
      opciones.finPrueba,
      fin,
      opciones.graciaHasta ?? null,
      opciones.plan ?? null,
    ],
  );
}

describe('Tarea vencer-suscripciones (T052)', () => {
  let entorno: EntornoDePagos;
  const vencer = () => entorno.prueba.app.get(EjecutorTareas).ejecutarAhora('vencer-suscripciones');

  beforeAll(async () => {
    entorno = await iniciarEntornoDePagos();
  });

  afterAll(async () => {
    await entorno.cerrar();
    await cerrarPools();
  });

  it('TRIAL → EXPIRED al terminar la prueba sin pago, auditada con la fecha de fin de la prueba', async () => {
    const b = await barberiaEnPrueba();
    const finPrueba = new Date(Date.now() - HORA);
    await preparar(b, { finPrueba, estado: 'TRIAL' });
    await expect(vencer()).resolves.toMatchObject({ ejecutada: true });
    expect(await suscripcion(b.suscripcionId)).toMatchObject({ status: 'EXPIRED', plan: 'TRIAL' });
    expect(await auditorias(b.tenantId)).toEqual([
      {
        action: 'SUSCRIPCION_VENCIDA',
        actor_id: null,
        resource: `suscripcion:${b.suscripcionId}`,
        at: finPrueba,
      },
    ]);
    // Una segunda corrida no hace nada: la transición es condicional (FR-032).
    await vencer();
    expect(await auditorias(b.tenantId)).toHaveLength(1);
  });

  it('ACTIVE → PAST_DUE al terminar el período sin el siguiente, con 7 días de gracia', async () => {
    const b = await barberiaEnPrueba();
    const inicio = new Date(Date.now() - 32 * DIA);
    const fin = sumarUnMes(inicio);
    await preparar(b, {
      finPrueba: inicio,
      estado: 'ACTIVE',
      plan: PLAN_BASICO,
      periodos: [{ inicio, plan: PLAN_BASICO }],
    });
    await vencer();
    const despues = await suscripcion(b.suscripcionId);
    expect(despues).toMatchObject({ status: 'PAST_DUE', grace_ends_at: finDeGracia(fin) });
    expect(despues.grace_ends_at!.getTime() - fin.getTime()).toBe(7 * DIA);
    expect(await auditorias(b.tenantId)).toEqual([
      expect.objectContaining({ action: 'SUSCRIPCION_EN_GRACIA', at: fin }),
    ]);
  });

  it('PAST_DUE → EXPIRED al terminar la gracia, auditada con el fin de la gracia', async () => {
    const b = await barberiaEnPrueba();
    const inicio = new Date(Date.now() - 40 * DIA);
    const fin = sumarUnMes(inicio);
    await preparar(b, {
      finPrueba: inicio,
      estado: 'PAST_DUE',
      plan: PLAN_BASICO,
      periodos: [{ inicio, plan: PLAN_BASICO }],
      graciaHasta: finDeGracia(fin),
    });
    await vencer();
    expect((await suscripcion(b.suscripcionId)).status).toBe('EXPIRED');
    expect(await auditorias(b.tenantId)).toEqual([
      expect.objectContaining({ action: 'SUSCRIPCION_VENCIDA', at: finDeGracia(fin) }),
    ]);
  });

  it('TRIAL → ACTIVE al terminar la prueba con un período pagado, con el plan de ese período', async () => {
    const b = await barberiaEnPrueba();
    const finPrueba = new Date(Date.now() - HORA);
    await preparar(b, { finPrueba, estado: 'TRIAL', periodos: [{ inicio: finPrueba, plan: PLAN_PRO }] });
    await vencer();
    expect(await suscripcion(b.suscripcionId)).toMatchObject({ status: 'ACTIVE', plan: 'PRO' });
    expect(await auditorias(b.tenantId)).toEqual([
      expect.objectContaining({ action: 'SUSCRIPCION_ACTIVADA', at: finPrueba }),
    ]);
  });

  it('ACTIVE → ACTIVE al empezar un período ya pagado de otro plan (cambia el plan)', async () => {
    const b = await barberiaEnPrueba();
    const inicio = new Date(Date.now() - 31 * DIA);
    const segundo = sumarUnMes(inicio);
    await preparar(b, {
      finPrueba: inicio,
      estado: 'ACTIVE',
      plan: PLAN_BASICO,
      periodos: [
        { inicio, plan: PLAN_BASICO },
        { inicio: segundo, plan: PLAN_PRO },
      ],
    });
    await vencer();
    expect(await suscripcion(b.suscripcionId)).toMatchObject({ status: 'ACTIVE', plan: 'PRO' });
    expect(await auditorias(b.tenantId)).toEqual([
      expect.objectContaining({ action: 'SUSCRIPCION_ACTIVADA', at: segundo }),
    ]);
  });

  it('con la tarea detenida mucho tiempo, aplica cada paso con su fecha y la copia derivada se mantiene', async () => {
    const b = await barberiaEnPrueba();
    const inicio = new Date(Date.now() - 45 * DIA);
    const fin = sumarUnMes(inicio);
    await preparar(b, { finPrueba: inicio, estado: 'TRIAL', periodos: [{ inicio, plan: PLAN_BASICO }] });
    await vencer();
    expect((await suscripcion(b.suscripcionId)).status).toBe('EXPIRED');
    expect((await auditorias(b.tenantId)).map((a) => [a.action, a.at])).toEqual([
      ['SUSCRIPCION_ACTIVADA', inicio],
      ['SUSCRIPCION_EN_GRACIA', fin],
      ['SUSCRIPCION_VENCIDA', finDeGracia(fin)],
    ]);
    // Cobertura derivada (M2): las transiciones no cambian la copia, que sigue siendo el fin del período.
    expect((await suscripcion(b.suscripcionId)).current_period_end).toEqual(fin);
  });

  it('escenario 8: el pago confirmado durante la gracia hace empezar el período al final del vencido', async () => {
    const b = await barberiaEnPrueba();
    const inicio = new Date(Date.now() - 33 * DIA);
    const fin = sumarUnMes(inicio);
    await preparar(b, {
      finPrueba: inicio,
      estado: 'ACTIVE',
      plan: PLAN_BASICO,
      periodos: [{ inicio, plan: PLAN_BASICO }],
    });
    await vencer();
    expect((await suscripcion(b.suscripcionId)).status).toBe('PAST_DUE');

    // Paga durante la gracia: el período objetivo es el que empieza al final del vencido.
    const pago = await sembrarPago({ tenantId: b.tenantId, suscripcionId: b.suscripcionId, cubreDesde: fin });
    await notificar(entorno.prueba, { referencia: pago.referencia }).expect(200);
    expect((await filaDePago(pago.pagoId)).status).toBe('APROBADO');
    const { rows } = await seed().query('SELECT starts_at FROM subscription_period WHERE payment_id = $1', [
      pago.pagoId,
    ]);
    expect(rows[0].starts_at).toEqual(fin);
    // Y la suscripción vuelve a estar activa en ese momento, sin esperar a la tarea (SC-008).
    expect(await suscripcion(b.suscripcionId)).toMatchObject({ status: 'ACTIVE', grace_ends_at: null });
  });
});
