import { v7 as uuidv7 } from 'uuid';
import { SuscripcionRepository } from '../../../src/modules/suscripciones-pagos/suscripciones/application/ports/suscripcion-repository';
import { PeriodoYaCubierto } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/errores';
import { sumarUnMes } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import { TenantId, UnitOfWork } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia, sembrarPago, sembrarSuscripcion } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// Garantías de dinero de 003 en PostgreSQL (migración 0015; FR-004, FR-012, FR-022b, SC-011) y el
// repositorio de períodos (T025): cada garantía crítica está en la base y se prueba aquí directamente,
// además de por los casos de uso de las historias.

const DIA = 24 * 60 * 60 * 1000;

interface Escenario {
  tenantId: string;
  suscripcionId: string;
  finPrueba: Date;
}

async function escenario(): Promise<Escenario> {
  const { tenantId } = await sembrarBarberia();
  const finPrueba = new Date(Math.floor(Date.now() / 1000) * 1000 + 10 * DIA);
  const { suscripcionId } = await sembrarSuscripcion({ tenantId, trialEndsAt: finPrueba });
  return { tenantId, suscripcionId, finPrueba };
}

async function pagoAprobado(e: Escenario, numeroOperacion?: string): Promise<string> {
  const { pagoId } = await sembrarPago({
    tenantId: e.tenantId,
    suscripcionId: e.suscripcionId,
    metodo: 'TRANSFERENCIA',
    estado: 'APROBADO',
    numeroOperacion,
  });
  return pagoId;
}

const PLAN_BASICO = '01923a00-0000-7000-8000-000000000002';
const PLAN_PRO = '01923a00-0000-7000-8000-000000000003';

describe('Garantías de dinero en PostgreSQL (003)', () => {
  let prueba: AppDePrueba;
  let repositorio: SuscripcionRepository;
  let uow: UnitOfWork;

  beforeAll(async () => {
    prueba = await crearApp();
    repositorio = prueba.app.get(SuscripcionRepository, { strict: false });
    uow = prueba.app.get(UnitOfWork, { strict: false });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const enTenant = <T>(e: Escenario, fn: () => Promise<T>) => uow.ejecutar(TenantId.de(e.tenantId), fn);
  const periodoDe = (e: Escenario, pagoId: string, inicio: Date, planId = PLAN_BASICO) => ({
    id: uuidv7(),
    suscripcionId: e.suscripcionId,
    pagoId,
    planId,
    inicio,
    fin: sumarUnMes(inicio),
  });

  async function finCobertura(e: Escenario): Promise<Date> {
    const { rows } = await poolDe('seed').query<{ fin: Date }>(
      'SELECT current_period_end AS fin FROM subscription WHERE id = $1',
      [e.suscripcionId],
    );
    return rows[0].fin;
  }

  describe('períodos (subscription_period)', () => {
    it('inserta el período y actualiza la copia derivada current_period_end en la misma transacción (M2)', async () => {
      const e = await escenario();
      const pagoId = await pagoAprobado(e);
      const periodo = periodoDe(e, pagoId, e.finPrueba);
      await enTenant(e, () => repositorio.insertarPeriodo(periodo));
      expect(await finCobertura(e)).toEqual(periodo.fin);
      const periodos = await enTenant(e, () => repositorio.periodos(e.suscripcionId));
      expect(periodos).toEqual([
        { id: periodo.id, pagoId, planId: PLAN_BASICO, inicio: periodo.inicio, fin: periodo.fin },
      ]);
    });

    it('un período que se solapa con otro se rechaza (EXCLUDE) como PeriodoYaCubierto, y la transacción sigue viva', async () => {
      const e = await escenario();
      const primero = await pagoAprobado(e);
      const segundo = await pagoAprobado(e);
      const resultado = await enTenant(e, async () => {
        await repositorio.insertarPeriodo(periodoDe(e, primero, e.finPrueba));
        const error = await repositorio
          .insertarPeriodo(periodoDe(e, segundo, new Date(e.finPrueba.getTime() + 5 * DIA)))
          .catch((err: unknown) => err);
        // La transacción no quedó abortada: se puede seguir leyendo y escribiendo en ella.
        const periodos = await repositorio.periodos(e.suscripcionId);
        return { error, periodos: periodos.length };
      });
      expect(resultado.error).toBeInstanceOf(PeriodoYaCubierto);
      expect(resultado.periodos).toBe(1);
    });

    it('dos aprobaciones simultáneas del mismo tramo dejan un solo período', async () => {
      const e = await escenario();
      const pagos = [await pagoAprobado(e), await pagoAprobado(e)];
      const resultados = await Promise.allSettled(
        pagos.map((pagoId) =>
          enTenant(e, () => repositorio.insertarPeriodo(periodoDe(e, pagoId, e.finPrueba))),
        ),
      );
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rechazo.reason).toBeInstanceOf(PeriodoYaCubierto);
      const { rows } = await poolDe('seed').query(
        'SELECT count(*)::int AS n FROM subscription_period WHERE subscription_id = $1',
        [e.suscripcionId],
      );
      expect(rows[0].n).toBe(1);
    });

    it('un pago crea a lo sumo un período (UNIQUE payment_id), aunque el segundo no se solape', async () => {
      const e = await escenario();
      const pagoId = await pagoAprobado(e);
      await enTenant(e, () => repositorio.insertarPeriodo(periodoDe(e, pagoId, e.finPrueba)));
      await expect(
        enTenant(e, () => repositorio.insertarPeriodo(periodoDe(e, pagoId, sumarUnMes(e.finPrueba)))),
      ).rejects.toBeInstanceOf(PeriodoYaCubierto);
    });

    it('el período debe ser del mismo plan y suscripción que su pago (FK compuesta)', async () => {
      const e = await escenario();
      const pagoId = await pagoAprobado(e);
      await expect(
        poolDe('seed').query(
          `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [uuidv7(), e.tenantId, e.suscripcionId, pagoId, PLAN_PRO, e.finPrueba, sumarUnMes(e.finPrueba)],
        ),
      ).rejects.toThrow(/foreign key/);
    });

    it.each([
      ['de 40 días', 40],
      ['de 27 días', 27],
    ])('un período %s se rechaza (duración mensual)', async (_caso, dias) => {
      const e = await escenario();
      const pagoId = await pagoAprobado(e);
      await expect(
        poolDe('seed').query(
          `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            uuidv7(),
            e.tenantId,
            e.suscripcionId,
            pagoId,
            PLAN_BASICO,
            e.finPrueba,
            new Date(e.finPrueba.getTime() + dias * DIA),
          ],
        ),
      ).rejects.toThrow(/subscription_period_duracion_mensual/);
    });
  });

  describe('pagos (payment)', () => {
    it('un solo pago abierto por suscripción; tras anularlo se puede abrir otro', async () => {
      const e = await escenario();
      const { pagoId } = await sembrarPago({ tenantId: e.tenantId, suscripcionId: e.suscripcionId });
      await expect(sembrarPago({ tenantId: e.tenantId, suscripcionId: e.suscripcionId })).rejects.toThrow(
        /payment_un_pago_abierto/,
      );
      await expect(
        sembrarPago({ tenantId: e.tenantId, suscripcionId: e.suscripcionId, metodo: 'TRANSFERENCIA' }),
      ).rejects.toThrow(/payment_un_pago_abierto/);
      await poolDe('seed').query(`UPDATE payment SET status = 'ANULADO', closed_at = now() WHERE id = $1`, [
        pagoId,
      ]);
      await expect(
        sembrarPago({ tenantId: e.tenantId, suscripcionId: e.suscripcionId }),
      ).resolves.toBeDefined();
    });

    it('un número de operación se aprueba una sola vez entre todas las barberías (FR-022b)', async () => {
      const a = await escenario();
      const b = await escenario();
      const numero = `OP${Date.now()}`;
      await pagoAprobado(a, numero);
      await expect(pagoAprobado(b, numero)).rejects.toThrow(/payment_numero_operacion_aprobado/);
      // En revisión sí puede repetirse: el administrador lo ve señalado y no puede aprobarlo.
      await expect(
        sembrarPago({
          tenantId: b.tenantId,
          suscripcionId: b.suscripcionId,
          metodo: 'TRANSFERENCIA',
          estado: 'EN_REVISION',
          numeroOperacion: numero,
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      [
        'un pago PENDIENTE por transferencia',
        `UPDATE payment SET status = 'PENDIENTE', closed_at = NULL, approved_at = NULL WHERE id = $1`,
        /payment_estado_del_medio/,
      ],
      ['un importe de cero', `UPDATE payment SET amount_cents = 0 WHERE id = $1`, /amount_cents/],
      ['otra moneda', `UPDATE payment SET currency = 'USD' WHERE id = $1`, /currency/],
      [
        'aprobado sin fecha de aprobación',
        `UPDATE payment SET approved_at = NULL WHERE id = $1`,
        /payment_aprobado_con_fecha/,
      ],
      [
        'un número de operación con caracteres no normalizados',
        `UPDATE payment SET bank_operation_number = 'op-123 45' WHERE id = $1`,
        /bank_operation_number/,
      ],
      [
        'una transferencia con referencia del proveedor',
        `UPDATE payment SET provider_reference = 'ses_x' WHERE id = $1`,
        /payment_datos_del_medio/,
      ],
    ])('la base rechaza %s', async (_caso, sentencia, error) => {
      const e = await escenario();
      const pagoId = await pagoAprobado(e);
      await expect(poolDe('seed').query(sentencia, [pagoId])).rejects.toThrow(error);
    });

    it('una activación manual solo puede existir aprobada y con su motivo', async () => {
      const e = await escenario();
      await expect(
        poolDe('seed').query(
          `INSERT INTO payment (id, tenant_id, subscription_id, plan_id, amount_cents, method, status, covers_after,
                                manual_reason, created_by, closed_at)
           VALUES ($1, $2, $3, $4, 4900, 'MANUAL', 'ANULADO', now(), 'Pago en efectivo en la oficina', $1, now())`,
          [uuidv7(), e.tenantId, e.suscripcionId, PLAN_BASICO],
        ),
      ).rejects.toThrow(/payment_estado_del_medio/);
    });
  });

  describe('transición condicional de la suscripción (FR-032)', () => {
    it('se aplica una sola vez: la segunda vez no encuentra el estado esperado', async () => {
      const e = await escenario();
      const paso = {
        desde: 'TRIAL' as const,
        hacia: 'EXPIRED' as const,
        fecha: e.finPrueba,
        planId: null,
        graciaHasta: null,
      };
      expect(await enTenant(e, () => repositorio.aplicarPaso(e.suscripcionId, paso))).toBe(true);
      expect(await enTenant(e, () => repositorio.aplicarPaso(e.suscripcionId, paso))).toBe(false);
    });

    it('con otro tenant fijado no cambia nada (RLS y filtro por tenant)', async () => {
      const a = await escenario();
      const b = await escenario();
      const paso = {
        desde: 'TRIAL' as const,
        hacia: 'EXPIRED' as const,
        fecha: a.finPrueba,
        planId: null,
        graciaHasta: null,
      };
      expect(await enTenant(b, () => repositorio.aplicarPaso(a.suscripcionId, paso))).toBe(false);
      const { rows } = await poolDe('seed').query('SELECT status FROM subscription WHERE id = $1', [
        a.suscripcionId,
      ]);
      expect(rows[0].status).toBe('TRIAL');
    });

    it('PAST_DUE exige la fecha de fin de la gracia', async () => {
      const e = await escenario();
      await expect(
        poolDe('seed').query(`UPDATE subscription SET status = 'PAST_DUE' WHERE id = $1`, [e.suscripcionId]),
      ).rejects.toThrow(/subscription_gracia_con_fecha/);
    });
  });
});
