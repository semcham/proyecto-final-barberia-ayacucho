import type { ThrottlerStorage } from '@nestjs/throttler';
import { CacheCompartida, type Conteo } from '../../../src/shared/cache/cache-compartida';
import type { ClaveContador } from '../../../src/shared/cache/claves-cache';
import { AlmacenLimitesCompartido } from '../../../src/shared/limites/almacen-limites-compartido';

// T041 · Almacenamiento del límite general en la caché compartida (006 US3; ADR-029, principio VIII):
// contadores por IP sin tenant, y respaldo en memoria por instancia si la caché no responde.

class CacheFalsa extends CacheCompartida {
  respuesta: Conteo | null = null;
  readonly llamadas: { clave: string; ventanaMs: number }[] = [];

  obtener = jest.fn();
  leerGeneracion = jest.fn();
  guardarSiGeneracion = jest.fn();
  invalidar = jest.fn();

  async contar(clave: ClaveContador, ventanaMs: number): Promise<Conteo | null> {
    this.llamadas.push({ clave: clave.valor, ventanaMs });
    return this.respuesta;
  }
}

// Forma de la clave que calcula @nestjs/throttler (sha256 en hexadecimal).
const CLAVE_DEL_GUARD = 'a'.repeat(64);

describe('AlmacenLimitesCompartido', () => {
  let cache: CacheFalsa;
  let respaldo: jest.Mocked<ThrottlerStorage>;
  let almacen: AlmacenLimitesCompartido;

  beforeEach(() => {
    cache = new CacheFalsa();
    respaldo = {
      increment: jest.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    };
    almacen = new AlmacenLimitesCompartido(cache, respaldo);
  });

  it('con la caché: arma el registro con el total compartido y el tiempo restante en segundos', async () => {
    cache.respuesta = { total: 7, msRestantes: 41_200 };
    expect(await almacen.increment(CLAVE_DEL_GUARD, 60_000, 10, 60_000, 'general')).toEqual({
      totalHits: 7,
      timeToExpire: 42,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(respaldo.increment).not.toHaveBeenCalled();
  });

  it('con la caché: pasado el límite, bloquea hasta que termine la ventana', async () => {
    cache.respuesta = { total: 11, msRestantes: 5_000 };
    expect(await almacen.increment(CLAVE_DEL_GUARD, 60_000, 10, 60_000, 'general')).toEqual({
      totalHits: 11,
      timeToExpire: 5,
      isBlocked: true,
      timeToBlockExpire: 5,
    });
    // Justo en el límite todavía pasa.
    cache.respuesta = { total: 10, msRestantes: 5_000 };
    expect((await almacen.increment(CLAVE_DEL_GUARD, 60_000, 10, 60_000, 'general')).isBlocked).toBe(false);
  });

  it('un tiempo restante desconocido o vencido cuenta como la ventana completa o 1 s', async () => {
    cache.respuesta = { total: 12, msRestantes: -1 };
    const registro = await almacen.increment(CLAVE_DEL_GUARD, 30_000, 10, 30_000, 'general');
    expect(registro.timeToExpire).toBe(30);
    expect(registro.timeToBlockExpire).toBe(30);
    cache.respuesta = { total: 12, msRestantes: 0 };
    expect((await almacen.increment(CLAVE_DEL_GUARD, 30_000, 10, 30_000, 'general')).timeToExpire).toBe(1);
  });

  it('si la caché no responde (null), delega en el almacenamiento en memoria con los mismos argumentos', async () => {
    cache.respuesta = null;
    const registro = await almacen.increment(CLAVE_DEL_GUARD, 60_000, 10, 60_000, 'general');
    expect(respaldo.increment).toHaveBeenCalledWith(CLAVE_DEL_GUARD, 60_000, 10, 60_000, 'general');
    expect(registro).toEqual({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 });
  });

  it('la clave en la caché es rl:v1: más la clave del guard, sin tenant, con la ventana del límite', async () => {
    cache.respuesta = { total: 1, msRestantes: 60_000 };
    await almacen.increment(CLAVE_DEL_GUARD, 60_000, 10, 60_000, 'general');
    expect(cache.llamadas).toEqual([{ clave: `rl:v1:${CLAVE_DEL_GUARD}`, ventanaMs: 60_000 }]);
    expect(cache.llamadas[0].clave).not.toMatch(/:t:/);
  });

  it('una clave con un formato inesperado no llega a la caché: usa el respaldo', async () => {
    cache.respuesta = { total: 1, msRestantes: 60_000 };
    await almacen.increment('clave con espacios', 60_000, 10, 60_000, 'general');
    expect(cache.llamadas).toEqual([]);
    expect(respaldo.increment).toHaveBeenCalledTimes(1);
  });
});
