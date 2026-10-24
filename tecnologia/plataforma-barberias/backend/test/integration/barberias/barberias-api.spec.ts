import { BarberiasApi, BarberiaNoDisponible } from '../../../src/modules/acceso-barberias';
import { TenantId, UnitOfWork } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T023 · BarberiasApi (interfaz pública de M01 para M02; ADR-020, ADR-021 decisión 3).

describe('BarberiasApi', () => {
  let prueba: AppDePrueba;
  let api: BarberiasApi;
  let uow: UnitOfWork;

  beforeAll(async () => {
    prueba = await crearApp();
    api = prueba.app.get(BarberiasApi);
    uow = prueba.app.get(UnitOfWork);
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  describe('resolverSlugPublico', () => {
    it('devuelve el tenant de una barbería activa', async () => {
      const activa = await sembrarBarberia({ slug: `activa-${Date.now()}` });
      const tenant = await api.resolverSlugPublico(activa.slug);
      expect(tenant.valor).toBe(activa.tenantId);
    });

    it('da el mismo error con un enlace inexistente, uno anterior a un cambio y uno suspendido', async () => {
      const cambiada = await sembrarBarberia({ slug: `antes-${Date.now()}` });
      const enlaceAnterior = cambiada.slug;
      await poolDe('seed').query('UPDATE tenant SET slug = $1 WHERE id = $2', [
        `despues-${Date.now()}`,
        cambiada.tenantId,
      ]);
      const suspendida = await sembrarBarberia({ slug: `suspendida-${Date.now()}`, estado: 'SUSPENDIDA' });

      const errores = await Promise.all(
        ['no-existe-esta-barberia', enlaceAnterior, suspendida.slug, 'Mal Formado', ''].map((slug) =>
          api.resolverSlugPublico(slug).then(
            () => null,
            (error: unknown) => error,
          ),
        ),
      );
      for (const error of errores) {
        expect(error).toBeInstanceOf(BarberiaNoDisponible);
        expect((error as BarberiaNoDisponible).codigo).toBe('BARBERIA_NO_DISPONIBLE');
        expect((error as BarberiaNoDisponible).message).toBe('Esta barbería no está disponible.');
      }
    });
  });

  // 006 (T030): el enlace y los datos públicos en una sola transacción (R07).
  describe('barberiaPublicaPorEnlace', () => {
    afterEach(() => jest.restoreAllMocks());

    it('devuelve el tenant y los datos públicos en una sola transacción', async () => {
      const barberia = await sembrarBarberia({ nombre: 'Barbería del Enlace', slug: `enlace-${Date.now()}` });
      await poolDe('seed').query("UPDATE tenant SET address = 'Jr. Callao 456' WHERE id = $1", [
        barberia.tenantId,
      ]);
      const sinTenant = jest.spyOn(uow, 'ejecutarSinTenant');
      const ejecutar = jest.spyOn(uow, 'ejecutar');

      const resultado = await api.barberiaPublicaPorEnlace(barberia.slug);

      expect(resultado.tenantId).toBeInstanceOf(TenantId);
      expect(resultado.tenantId.valor).toBe(barberia.tenantId);
      expect(resultado.barberia).toEqual({
        nombre: 'Barbería del Enlace',
        slug: barberia.slug,
        direccion: 'Jr. Callao 456',
        telefono: null,
        descripcion: null,
        zonaHoraria: 'America/Lima',
      });
      expect(sinTenant).toHaveBeenCalledTimes(1);
      expect(ejecutar).not.toHaveBeenCalled();
    });

    it('da BarberiaNoDisponible con un enlace inexistente, mal formado o suspendido, igual que resolverSlugPublico', async () => {
      const suspendida = await sembrarBarberia({ slug: `susp-enlace-${Date.now()}`, estado: 'SUSPENDIDA' });
      for (const slug of ['no-existe-esta-barberia', 'Mal Formado', '', 'a'.repeat(141), suspendida.slug]) {
        const [porEnlace, porSlug] = await Promise.all([
          api.barberiaPublicaPorEnlace(slug).then(
            () => null,
            (error: unknown) => error,
          ),
          api.resolverSlugPublico(slug).then(
            () => null,
            (error: unknown) => error,
          ),
        ]);
        expect(porEnlace).toBeInstanceOf(BarberiaNoDisponible);
        expect(porSlug).toBeInstanceOf(BarberiaNoDisponible);
        expect((porEnlace as BarberiaNoDisponible).message).toBe((porSlug as BarberiaNoDisponible).message);
      }
    });

    it('tras cambiar el enlace, el anterior da BarberiaNoDisponible al instante', async () => {
      const barberia = await sembrarBarberia({ slug: `viejo-${Date.now()}` });
      const anterior = barberia.slug;
      await expect(api.barberiaPublicaPorEnlace(anterior)).resolves.toBeDefined();
      const nuevo = `nuevo-${Date.now()}`;
      await poolDe('seed').query('UPDATE tenant SET slug = $1 WHERE id = $2', [nuevo, barberia.tenantId]);

      await expect(api.barberiaPublicaPorEnlace(anterior)).rejects.toBeInstanceOf(BarberiaNoDisponible);
      const actual = await api.barberiaPublicaPorEnlace(nuevo);
      expect(actual.tenantId.valor).toBe(barberia.tenantId);
      expect(actual.barberia.slug).toBe(nuevo);
    });
  });

  it('configuracionAgenda devuelve los valores de la barbería del contexto', async () => {
    const barberia = await sembrarBarberia();
    await poolDe('seed').query('UPDATE tenant SET cancel_min_notice_minutes = 45 WHERE id = $1', [
      barberia.tenantId,
    ]);
    const configuracion = await uow.ejecutar(TenantId.de(barberia.tenantId), () => api.configuracionAgenda());
    expect(configuracion).toEqual({
      nombre: expect.any(String),
      zonaHoraria: 'America/Lima',
      antelacionCancelacionMinutos: 45,
    });
  });

  it('configuracionAgenda sin contexto de tenant es un error de programación', async () => {
    await expect(uow.ejecutarSinTenant(() => api.configuracionAgenda())).rejects.toBeInstanceOf(Error);
  });

  it('datosPublicos devuelve solo datos públicos, y nada para una barbería suspendida', async () => {
    const barberia = await sembrarBarberia({ nombre: 'Barbería Pública' });
    await poolDe('seed').query(
      "UPDATE tenant SET address = 'Jr. Lima 123', phone = '066 123456', description = 'Cortes clásicos' WHERE id = $1",
      [barberia.tenantId],
    );
    const datos = await api.datosPublicos(TenantId.de(barberia.tenantId));
    expect(datos).toEqual({
      nombre: 'Barbería Pública',
      slug: barberia.slug,
      direccion: 'Jr. Lima 123',
      telefono: '066 123456',
      descripcion: 'Cortes clásicos',
      zonaHoraria: 'America/Lima',
    });
    expect(Object.keys(datos ?? {})).not.toEqual(expect.arrayContaining(['status', 'id', 'propietarioId']));

    const suspendida = await sembrarBarberia({ estado: 'SUSPENDIDA' });
    expect(await api.datosPublicos(TenantId.de(suspendida.tenantId))).toBeNull();
  });
});
