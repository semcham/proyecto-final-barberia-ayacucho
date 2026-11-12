import { AvanzarSuscripcion } from '../../../src/modules/suscripciones-pagos/suscripciones/application/avanzar-suscripcion';
import { sumarUnMes } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import { SuscripcionRepository } from '../../../src/modules/suscripciones-pagos/suscripciones/application/ports/suscripcion-repository';
import type { Suscripcion } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/suscripcion';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, BusDeEventos, EjecutorTareas } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia, sembrarPago } from '../../helpers/fixtures';
import { filaDePago, notificar, PLAN_BASICO } from '../../helpers/pagos';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T053 · Vencimiento con dos réplicas (FR-032, FR-033; ADR-024; R14): dos instancias de la aplicación sobre
// la misma base ejecutan la tarea a la vez sobre 50 suscripciones vencidas y cada una cambia una sola vez,
// con una sola auditoría; una instancia que falla a mitad deja que la siguiente corrida termine el resto sin
// repetir; un pago aprobado al mismo tiempo deja la suscripción ACTIVE; scheduled_job_run registra a ambas.

const seed = () => poolDe('seed');
const vencer = (prueba: AppDePrueba) => prueba.app.get(EjecutorTareas).ejecutarAhora('vencer-suscripciones');

/** `n` barberías con la prueba vencida hace una hora. */
async function vencidas(n: number): Promise<string[]> {
  const tenants: string[] = [];
  for (let i = 0; i < n; i += 1) tenants.push((await sembrarBarberia()).tenantId);
  await seed().query(
    `UPDATE subscription SET trial_ends_at = now() - interval '1 hour', current_period_end = now() - interval '1 hour'
      WHERE tenant_id = ANY($1)`,
    [tenants],
  );
  return tenants;
}

async function resumen(tenants: string[]) {
  const estados = await seed().query(
    `SELECT status, count(*)::int AS n FROM subscription WHERE tenant_id = ANY($1) GROUP BY status`,
    [tenants],
  );
  const auditorias = await seed().query(
    `SELECT tenant_id, count(*)::int AS n FROM audit_log
      WHERE tenant_id = ANY($1) AND action = 'SUSCRIPCION_VENCIDA' GROUP BY tenant_id`,
    [tenants],
  );
  return {
    estados: Object.fromEntries(estados.rows.map((f) => [f.status, f.n])),
    auditadas: auditorias.rows.length,
    maximoPorBarberia: Math.max(0, ...auditorias.rows.map((f) => f.n)),
  };
}

/**
 * T125 de 004 (SC-013): eventos de un tipo por barbería en outbox_event. Cada transición publica UNO, en su misma
 * transacción, aunque las dos réplicas corran la tarea a la vez.
 */
async function eventos(tenants: string[], tipo: string) {
  const { rows } = await seed().query(
    `SELECT tenant_id, count(*)::int AS n FROM outbox_event
      WHERE tenant_id = ANY($1) AND type = $2 GROUP BY tenant_id`,
    [tenants, tipo],
  );
  return { barberias: rows.length, maximoPorBarberia: Math.max(0, ...rows.map((f) => f.n)) };
}

/** `n` barberías activas cuyo período pagado terminó hace una hora, sin el siguiente. */
async function periodosTerminados(n: number): Promise<string[]> {
  const tenants: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const { tenantId } = await sembrarBarberia();
    const { rows } = await seed().query('SELECT id FROM subscription WHERE tenant_id = $1', [tenantId]);
    const suscripcionId = rows[0].id as string;
    // Un período de un mes (CHECK de la base) que terminó hace 1 a 3 días: dentro de los 7 de gracia.
    const inicio = new Date(Date.now() - 33 * 24 * 60 * 60 * 1000);
    const fin = sumarUnMes(inicio);
    const { pagoId } = await sembrarPago({
      tenantId,
      suscripcionId,
      metodo: 'TRANSFERENCIA',
      estado: 'APROBADO',
      cubreDesde: inicio,
    });
    await seed().query(
      `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuidv7(), tenantId, suscripcionId, pagoId, PLAN_BASICO, inicio, fin],
    );
    await seed().query(
      `UPDATE subscription SET status = 'ACTIVE', plan_id = $2, trial_ends_at = $3, current_period_end = $4
        WHERE id = $1`,
      [suscripcionId, PLAN_BASICO, inicio, fin],
    );
    tenants.push(tenantId);
  }
  return tenants;
}

describe('Vencimiento con dos réplicas (T053)', () => {
  let a: AppDePrueba;
  let b: AppDePrueba;

  beforeAll(async () => {
    a = await crearApp({ entorno: { INSTANCIA_ID: 'replica-a' } });
    b = await crearApp({ entorno: { INSTANCIA_ID: 'replica-b' } });
  });

  afterAll(async () => {
    await a.cerrar();
    await b.cerrar();
    await cerrarPools();
  });

  it('las dos a la vez sobre 50 suscripciones vencidas: 50 transiciones y 50 auditorías, sin repetir', async () => {
    const tenants = await vencidas(50);
    await Promise.all([vencer(a), vencer(b)]);
    expect(await resumen(tenants)).toEqual({ estados: { EXPIRED: 50 }, auditadas: 50, maximoPorBarberia: 1 });
    // Otra corrida de cualquiera de las dos no repite nada.
    await Promise.all([vencer(a), vencer(b)]);
    expect(await resumen(tenants)).toEqual({ estados: { EXPIRED: 50 }, auditadas: 50, maximoPorBarberia: 1 });
    // T125 de 004: un evento SuscripcionVencida por suscripción, sin duplicados.
    expect(await eventos(tenants, 'SuscripcionVencida')).toEqual({ barberias: 50, maximoPorBarberia: 1 });
  });

  it('T125 de 004: el paso a gracia con las dos a la vez publica un SuscripcionEnGracia por suscripción', async () => {
    const tenants = await periodosTerminados(20);
    await Promise.all([vencer(a), vencer(b)]);
    await Promise.all([vencer(a), vencer(b)]);
    const { rows } = await seed().query(
      `SELECT status, count(*)::int AS n FROM subscription WHERE tenant_id = ANY($1) GROUP BY status`,
      [tenants],
    );
    expect(Object.fromEntries(rows.map((f) => [f.status, f.n]))).toEqual({ PAST_DUE: 20 });
    expect(await eventos(tenants, 'SuscripcionEnGracia')).toEqual({ barberias: 20, maximoPorBarberia: 1 });
    expect(await eventos(tenants, 'SuscripcionVencida')).toEqual({ barberias: 0, maximoPorBarberia: 0 });
  });

  it('una instancia que falla a mitad deja que la siguiente corrida termine el resto sin repetir', async () => {
    let avanzadas = 0;
    const conFalla = await crearApp({
      entorno: { INSTANCIA_ID: 'replica-falla' },
      ajustar: (constructor) =>
        constructor.overrideProvider(AvanzarSuscripcion).useFactory({
          inject: [SuscripcionRepository, AuditLog, BusDeEventos],
          factory: (repositorio: SuscripcionRepository, auditoria: AuditLog, bus: BusDeEventos) => {
            const real = new AvanzarSuscripcion(repositorio, auditoria, bus);
            return {
              ejecutar: (suscripcion: Suscripcion, ahora: Date) => {
                avanzadas += 1;
                if (avanzadas > 20) throw new Error('la réplica falla a mitad de la corrida');
                return real.ejecutar(suscripcion, ahora);
              },
            };
          },
        }),
    });
    try {
      const tenants = await vencidas(50);
      const corrida = await vencer(conFalla);
      expect(corrida).toMatchObject({ ejecutada: true, procesados: expect.any(Number) });
      const tras = await resumen(tenants);
      expect(tras.estados.EXPIRED).toBe(20);
      expect(tras.estados.TRIAL).toBe(30);

      await vencer(b);
      expect(await resumen(tenants)).toEqual({
        estados: { EXPIRED: 50 },
        auditadas: 50,
        maximoPorBarberia: 1,
      });
    } finally {
      await conFalla.cerrar();
    }

    const { rows } = await seed().query(
      `SELECT DISTINCT replica FROM scheduled_job_run WHERE job = 'vencer-suscripciones'
         AND replica IN ('replica-a', 'replica-b', 'replica-falla')`,
    );
    expect(rows.map((f) => f.replica).sort()).toEqual(expect.arrayContaining(['replica-b', 'replica-falla']));
  });

  it('un pago aprobado al mismo tiempo que el vencimiento deja la suscripción ACTIVE (FR-033)', async () => {
    for (let intento = 0; intento < 5; intento += 1) {
      const [tenantId] = await vencidas(1);
      const { rows } = await seed().query('SELECT id, trial_ends_at FROM subscription WHERE tenant_id = $1', [
        tenantId,
      ]);
      const pago = await sembrarPago({
        tenantId,
        suscripcionId: rows[0].id,
        cubreDesde: rows[0].trial_ends_at,
      });
      await Promise.all([vencer(a), notificar(b, { referencia: pago.referencia }).expect(200)]);
      // Si el vencimiento encontró la suscripción bloqueada por la aprobación, la próxima corrida la revisa.
      await vencer(a);
      expect((await filaDePago(pago.pagoId)).status).toBe('APROBADO');
      const final = await seed().query('SELECT status FROM subscription WHERE tenant_id = $1', [tenantId]);
      expect(final.rows[0].status).toBe('ACTIVE');
    }
  });

  it('scheduled_job_run registra las corridas de las dos réplicas, solo con conteos', async () => {
    const { rows } = await seed().query(
      `SELECT replica, processed, failed, error_summary FROM scheduled_job_run
        WHERE job = 'vencer-suscripciones' AND replica IN ('replica-a', 'replica-b')`,
    );
    expect(new Set(rows.map((f) => f.replica))).toEqual(new Set(['replica-a', 'replica-b']));
    expect(rows.every((f) => Number.isInteger(f.processed) && Number.isInteger(f.failed))).toBe(true);
  });
});
