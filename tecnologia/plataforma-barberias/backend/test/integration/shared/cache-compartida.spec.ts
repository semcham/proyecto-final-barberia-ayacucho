import { Logger } from '@nestjs/common';
import { CacheCompartida } from '../../../src/shared/cache/cache-compartida';
import { CacheInactiva } from '../../../src/shared/cache/cache-inactiva';
import { ClaveContador, ClavesCache } from '../../../src/shared/cache/claves-cache';
import { RedisCacheCompartida } from '../../../src/shared/cache/redis-cache-compartida';
import { RelojDelSistema } from '../../../src/shared/clock/clock';
import { Configuracion } from '../../../src/shared/config/configuracion';
import { TenantId } from '../../../src/shared/tenant/tenant-id';
import { crearApp } from '../../helpers/app';
import { iniciarRedis, type RedisDePrueba } from '../../helpers/redis';

// Fase 2 de 006 (T012–T014): el adaptador Redis cumple el contrato de CacheCompartida
// (contracts/cache-claves.md §4 y §5) con un Redis real, y M06 elige CacheInactiva sin REDIS_URL.

const A = TenantId.de('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const B = TenantId.de('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

async function crearCache(entorno: Record<string, string> = {}): Promise<RedisCacheCompartida> {
  const anterior = { ...process.env };
  Object.assign(process.env, entorno);
  let cache: RedisCacheCompartida;
  try {
    cache = new RedisCacheCompartida(new Configuracion(), new RelojDelSistema());
  } finally {
    process.env = anterior;
  }
  await cache.onModuleInit(); // lo que hace Nest al iniciar el módulo
  return cache;
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

describe('RedisCacheCompartida (Redis real)', () => {
  let redis: RedisDePrueba;
  let cache: RedisCacheCompartida;

  beforeAll(async () => {
    redis = await iniciarRedis();
    cache = await crearCache();
  });

  afterAll(async () => {
    await cache.onApplicationShutdown();
    await redis.cerrar();
  });

  beforeEach(async () => {
    await redis.vaciar();
  });

  it('guarda con la generación vigente, lee el mismo valor y fija el TTL', async () => {
    const clave = ClavesCache.catalogoPublico(A);
    const gen = ClavesCache.generacionCatalogo(A);
    expect(await cache.obtener(clave)).toBeNull();
    expect(await cache.leerGeneracion(gen)).toBe(0);
    expect(await cache.guardarSiGeneracion(clave, gen, 0, { servicios: ['corte'] }, 120)).toBe(true);
    expect(await cache.obtener(clave)).toEqual({ servicios: ['corte'] });
    const ttl = await redis.ttl(clave.valor);
    expect(ttl).toBeGreaterThan(110);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('no guarda si la generación cambió durante la lectura (carrera de R08)', async () => {
    const clave = ClavesCache.catalogoPublico(A);
    const gen = ClavesCache.generacionCatalogo(A);
    const leida = (await cache.leerGeneracion(gen)) as number;
    await cache.invalidar(clave, gen); // un escritor confirma entre la lectura y el guardado
    expect(await cache.guardarSiGeneracion(clave, gen, leida, { viejo: true }, 120)).toBe(false);
    expect(await cache.obtener(clave)).toBeNull();
    expect(await cache.leerGeneracion(gen)).toBe(1);
  });

  it('invalidar borra la entrada, sube la generación y le da 24 h de vida', async () => {
    const clave = ClavesCache.catalogoPublico(A);
    const gen = ClavesCache.generacionCatalogo(A);
    await cache.guardarSiGeneracion(clave, gen, 0, { v: 1 }, 120);
    await cache.invalidar(clave, gen);
    expect(await cache.obtener(clave)).toBeNull();
    expect(await cache.leerGeneracion(gen)).toBe(1);
    expect(await redis.ttl(gen.valor)).toBeGreaterThan(86_000);
  });

  it('las claves de dos barberías no se pisan', async () => {
    const genA = ClavesCache.generacionCatalogo(A);
    const genB = ClavesCache.generacionCatalogo(B);
    await cache.guardarSiGeneracion(ClavesCache.catalogoPublico(A), genA, 0, 'A', 60);
    await cache.guardarSiGeneracion(ClavesCache.catalogoPublico(B), genB, 0, 'B', 60);
    await cache.invalidar(ClavesCache.catalogoPublico(A), genA);
    expect(await cache.obtener(ClavesCache.catalogoPublico(A))).toBeNull();
    expect(await cache.obtener(ClavesCache.catalogoPublico(B))).toBe('B');
    expect(await cache.leerGeneracion(genB)).toBe(0);
    for (const clave of await redis.claves()) expect(clave).toMatch(/^bp:v1:t:[0-9a-f-]{36}:/);
  });

  it.each([
    ['JSON ilegible', '{no es json'],
    ['otra versión del sobre', JSON.stringify({ v: 2, d: 'x' })],
    ['un valor sin sobre', JSON.stringify(['x'])],
  ])('un valor con %s se trata como ausente (FR-015)', async (_caso, texto) => {
    const clave = ClavesCache.catalogoPublico(A);
    await redis.cliente().set(clave.valor, texto);
    expect(await cache.obtener(clave)).toBeNull();
  });

  it('contar suma en la ventana y fija la expiración en el primer incremento', async () => {
    const clave = ClaveContador.desde('limite-ip-198.51.100.7');
    const primero = await cache.contar(clave, 60_000);
    const segundo = await cache.contar(clave, 60_000);
    expect(primero?.total).toBe(1);
    expect(segundo?.total).toBe(2);
    expect(segundo?.msRestantes).toBeGreaterThan(50_000);
    expect(segundo?.msRestantes).toBeLessThanOrEqual(60_000);
  });

  it('el contador vuelve a empezar al vencer la ventana', async () => {
    const clave = ClaveContador.desde('ventana-corta');
    await cache.contar(clave, 300);
    await cache.contar(clave, 300);
    await esperar(400);
    expect((await cache.contar(clave, 300))?.total).toBe(1);
  });

  describe('con Redis caído', () => {
    let caida: RedisCacheCompartida;
    let avisos: jest.SpyInstance;

    beforeAll(async () => {
      avisos = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      caida = await crearCache({ CACHE_FALLOS_PARA_ABRIR: '3', CACHE_PAUSA_MS: '1000' });
      await redis.detener();
    });

    afterAll(async () => {
      avisos.mockRestore();
      await caida.onApplicationShutdown();
      await redis.reiniciar();
    });

    it('ninguna operación lanza y todas devuelven el valor del contrato', async () => {
      const clave = ClavesCache.catalogoPublico(A);
      const gen = ClavesCache.generacionCatalogo(A);
      await expect(caida.obtener(clave)).resolves.toBeNull();
      await expect(caida.leerGeneracion(gen)).resolves.toBeNull();
      await expect(caida.guardarSiGeneracion(clave, gen, 0, 'x', 60)).resolves.toBe(false);
      await expect(caida.invalidar(clave, gen)).resolves.toBeUndefined();
      await expect(caida.contar(ClaveContador.desde('x'), 1000)).resolves.toBeNull();
    });

    it('el interruptor se abre con una sola alerta y luego responde sin esperar a Redis', async () => {
      // Adaptador propio, creado con Redis ya detenido: arranca igual (espera acotada) y cuenta sus alertas.
      const nueva = await crearCache({ CACHE_FALLOS_PARA_ABRIR: '3', CACHE_PAUSA_MS: '5000' });
      try {
        for (let i = 0; i < 10; i += 1) await nueva.obtener(ClavesCache.catalogoPublico(A));
        const alertas = avisos.mock.calls.filter(([texto]) => String(texto).includes('CACHE_NO_DISPONIBLE'));
        expect(alertas).toHaveLength(1);
        const inicio = Date.now();
        for (let i = 0; i < 20; i += 1) await nueva.obtener(ClavesCache.catalogoPublico(A));
        expect(Date.now() - inicio).toBeLessThan(50);
      } finally {
        await nueva.onApplicationShutdown();
      }
    });
  });

  it('tras volver Redis, se recupera sin recrear el adaptador y lo registra', async () => {
    const registros = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const otra = await crearCache({ CACHE_FALLOS_PARA_ABRIR: '2', CACHE_PAUSA_MS: '1000' });
    try {
      await redis.detener();
      for (let i = 0; i < 3; i += 1) await otra.obtener(ClavesCache.catalogoPublico(A));
      await redis.reiniciar();
      await esperar(2_500); // pausa del interruptor + reconexión de ioredis
      const clave = ClavesCache.catalogoPublico(A);
      const gen = ClavesCache.generacionCatalogo(A);
      let guardo = false;
      for (let i = 0; i < 20 && !guardo; i += 1) {
        guardo = await otra.guardarSiGeneracion(clave, gen, 0, 'de nuevo', 60);
        if (!guardo) await esperar(250);
      }
      expect(guardo).toBe(true);
      expect(await otra.obtener(clave)).toBe('de nuevo');
      expect(registros.mock.calls.some(([t]) => String(t).includes('CACHE_RECUPERADA'))).toBe(true);
    } finally {
      registros.mockRestore();
      await otra.onApplicationShutdown();
    }
  });

  it('con Redis lento (pausado), cada operación vuelve en el tiempo límite', async () => {
    const lenta = await crearCache({ CACHE_TIMEOUT_MS: '100', CACHE_FALLOS_PARA_ABRIR: '50' });
    try {
      redis.pausar();
      const inicio = Date.now();
      await expect(lenta.obtener(ClavesCache.catalogoPublico(A))).resolves.toBeNull();
      expect(Date.now() - inicio).toBeLessThan(600);
    } finally {
      redis.reanudar();
      await lenta.onApplicationShutdown();
    }
  });
});

describe('crearApp con escuchar (T017)', () => {
  it('escucha en un puerto libre de 127.0.0.1 y restaura el entorno al terminar de iniciar', async () => {
    process.env.INSTANCIA_ID = 'anterior';
    const prueba = await crearApp({ escuchar: true, entorno: { INSTANCIA_ID: 'backend-1' } });
    try {
      expect(prueba.puerto).toBeGreaterThan(0);
      expect(process.env.INSTANCIA_ID).toBe('anterior');
      expect(prueba.app.get(Configuracion).instanciaId).toBe('backend-1');
      const respuesta = await fetch(`${prueba.url}/api/v1/salud`);
      expect(respuesta.status).toBe(200);
    } finally {
      await prueba.cerrar();
      delete process.env.INSTANCIA_ID;
    }
  });
});

describe('SharedModule elige la caché según REDIS_URL', () => {
  it('sin REDIS_URL usa CacheInactiva', async () => {
    const prueba = await crearApp({ entorno: { REDIS_URL: undefined } });
    try {
      expect(prueba.app.get(CacheCompartida)).toBeInstanceOf(CacheInactiva);
    } finally {
      await prueba.cerrar();
    }
  });

  it('con REDIS_URL usa RedisCacheCompartida y la cierra con la aplicación', async () => {
    const redis = await iniciarRedis();
    try {
      const prueba = await crearApp({ entorno: { REDIS_URL: redis.url } });
      const cache = prueba.app.get(CacheCompartida);
      expect(cache).toBeInstanceOf(RedisCacheCompartida);
      const clave = ClavesCache.catalogoPublico(A);
      const gen = ClavesCache.generacionCatalogo(A);
      expect(await cache.guardarSiGeneracion(clave, gen, 0, 'ok', 30)).toBe(true);
      await prueba.cerrar();
    } finally {
      await redis.cerrar();
    }
  });
});
