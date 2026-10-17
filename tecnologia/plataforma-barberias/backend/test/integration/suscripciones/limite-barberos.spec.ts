import { SuscripcionesApi } from '../../../src/modules/suscripciones-pagos';
import { TenantId, UnitOfWork } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia, sembrarSuscripcion } from '../../helpers/fixtures';
import { cerrarPools } from '../../helpers/test-db';

// T024 · Límite de barberos del plan (FR-012 de 002, research R13): con la suscripción bloqueada.

const DIA_MS = 24 * 60 * 60 * 1000;

describe('SuscripcionesApi.obtenerLimiteBarberos', () => {
  let prueba: AppDePrueba;
  let api: SuscripcionesApi;
  let uow: UnitOfWork;

  beforeAll(async () => {
    prueba = await crearApp();
    api = prueba.app.get(SuscripcionesApi);
    uow = prueba.app.get(UnitOfWork);
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('devuelve max_barbers del plan TRIAL (5 en la semilla de 0004)', async () => {
    const barberia = await sembrarBarberia();
    await sembrarSuscripcion({
      tenantId: barberia.tenantId,
      trialEndsAt: new Date(Date.now() + 14 * DIA_MS),
    });
    const tenant = TenantId.de(barberia.tenantId);
    expect(await uow.ejecutar(tenant, () => api.obtenerLimiteBarberos(tenant))).toBe(5);
  });

  it('bloquea la suscripción: una segunda transacción espera a que termine la primera', async () => {
    const barberia = await sembrarBarberia();
    await sembrarSuscripcion({
      tenantId: barberia.tenantId,
      trialEndsAt: new Date(Date.now() + 14 * DIA_MS),
    });
    const tenant = TenantId.de(barberia.tenantId);
    const orden: string[] = [];
    const primera = uow.ejecutar(tenant, async () => {
      await api.obtenerLimiteBarberos(tenant);
      orden.push('primera bloqueó');
      await new Promise((resolver) => setTimeout(resolver, 300));
      orden.push('primera terminó');
    });
    await new Promise((resolver) => setTimeout(resolver, 50));
    const segunda = uow.ejecutar(tenant, async () => {
      await api.obtenerLimiteBarberos(tenant);
      orden.push('segunda obtuvo el límite');
    });
    await Promise.all([primera, segunda]);
    expect(orden).toEqual(['primera bloqueó', 'primera terminó', 'segunda obtuvo el límite']);
  });

  it('exige la transacción del mismo tenant', async () => {
    const a = await sembrarBarberia();
    const b = await sembrarBarberia();
    await expect(
      uow.ejecutar(TenantId.de(a.tenantId), () => api.obtenerLimiteBarberos(TenantId.de(b.tenantId))),
    ).rejects.toThrow(/mismo tenant/);
  });
});
