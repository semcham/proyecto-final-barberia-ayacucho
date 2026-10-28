import { ESTADO_POR_CODIGO } from '../../../src/host/error.filter';
import { SuscripcionesApi, SuscripcionNoPermite } from '../../../src/modules/suscripciones-pagos';
import { TenantId, UnitOfWork } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia, sembrarSuscripcion } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T032 · SuscripcionesApi.exigirOperacion y estadoOperativo (FR-006, R10): leen la suscripción en la
// transacción del llamador, con su tenant y RLS. Todavía no tienen llamadores: la prueba completa de la
// matriz contra la API real es restricciones-estado.spec.ts (US2).

const DIA = 24 * 60 * 60 * 1000;

describe('SuscripcionesApi: restricciones por estado (T032)', () => {
  let prueba: AppDePrueba;
  let api: SuscripcionesApi;
  let uow: UnitOfWork;

  beforeAll(async () => {
    prueba = await crearApp();
    api = prueba.app.get(SuscripcionesApi, { strict: false });
    uow = prueba.app.get(UnitOfWork, { strict: false });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  async function barberiaEn(estado: 'TRIAL' | 'EXPIRED'): Promise<TenantId> {
    const { tenantId } = await sembrarBarberia();
    const { suscripcionId } = await sembrarSuscripcion({
      tenantId,
      trialEndsAt: new Date(Date.now() + 14 * DIA),
    });
    if (estado === 'EXPIRED') {
      await poolDe('seed').query(`UPDATE subscription SET status = 'EXPIRED' WHERE id = $1`, [suscripcionId]);
    }
    return TenantId.de(tenantId);
  }

  it('en prueba permite reservar y configurar', async () => {
    const tenant = await barberiaEn('TRIAL');
    await uow.ejecutar(tenant, async () => {
      await expect(api.exigirOperacion(tenant, 'RESERVAR')).resolves.toBeUndefined();
      await expect(api.estadoOperativo(tenant)).resolves.toEqual({
        estado: 'TRIAL',
        aceptaReservas: true,
        configuracionEditable: true,
        mensaje: null,
      });
    });
  });

  it('vencida rechaza reservar con SUSCRIPCION_NO_PERMITE y permite gestionar citas y pagar', async () => {
    const tenant = await barberiaEn('EXPIRED');
    await uow.ejecutar(tenant, async () => {
      const error = await api.exigirOperacion(tenant, 'RESERVAR').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SuscripcionNoPermite);
      expect((error as SuscripcionNoPermite).detalles).toEqual([{ estado: 'EXPIRED', accion: 'RESERVAR' }]);
      await expect(api.exigirOperacion(tenant, 'GESTIONAR_CITAS')).resolves.toBeUndefined();
      await expect(api.exigirOperacion(tenant, 'PAGAR')).resolves.toBeUndefined();
      await expect(api.estadoOperativo(tenant)).resolves.toEqual({
        estado: 'EXPIRED',
        aceptaReservas: false,
        configuracionEditable: false,
        mensaje: 'Esta barbería no acepta reservas por ahora',
      });
    });
  });

  it('se niega a consultar el estado de otra barbería que la de la transacción', async () => {
    const a = await barberiaEn('TRIAL');
    const b = await barberiaEn('EXPIRED');
    await uow.ejecutar(a, async () => {
      await expect(api.exigirOperacion(b, 'RESERVAR')).rejects.toThrow(/mismo tenant/);
    });
  });

  it('una respuesta 403 de SUSCRIPCION_NO_PERMITE está en el mapa de errores del host', () => {
    expect(ESTADO_POR_CODIGO.SUSCRIPCION_NO_PERMITE).toBe(403);
  });
});
