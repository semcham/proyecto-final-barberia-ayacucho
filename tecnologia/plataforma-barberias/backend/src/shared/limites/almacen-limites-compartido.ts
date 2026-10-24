import type { OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { CacheCompartida } from '../cache/cache-compartida';
import { ClaveContador } from '../cache/claves-cache';

/** Registro que espera el guard (el paquete no exporta su tipo desde la raíz). */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * T043 (006) · Almacenamiento del límite general de solicitudes por IP en la caché compartida (ADR-029,
 * principio VIII): las réplicas cuentan juntas, así el límite es el mismo con una o dos instancias
 * (FR-016). Ventana fija por clave (`INCR` + `PEXPIRE`, contracts/cache-claves.md §4).
 *
 * Contadores no críticos, tolerantes a pérdida: si la caché no responde (`contar` devuelve `null`), cada
 * instancia cuenta en memoria con el almacenamiento de `@nestjs/throttler` (FR-018). Los intentos de inicio
 * de sesión no pasan por aquí: siguen en PostgreSQL (FR-017).
 */
export class AlmacenLimitesCompartido implements ThrottlerStorage, OnApplicationShutdown {
  constructor(
    private readonly cache: CacheCompartida,
    private readonly respaldo: ThrottlerStorage,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    let clave: ClaveContador;
    try {
      clave = ClaveContador.desde(key);
    } catch {
      // La clave la calcula el guard (sha256): otro formato no debería llegar; se cuenta en memoria.
      return this.respaldo.increment(key, ttl, limit, blockDuration, throttlerName);
    }
    const conteo = await this.cache.contar(clave, ttl);
    if (!conteo) return this.respaldo.increment(key, ttl, limit, blockDuration, throttlerName);

    // Segundos restantes de la ventana; sin vencimiento conocido (PTTL negativo), la ventana completa.
    const restanteMs = conteo.msRestantes < 0 ? ttl : conteo.msRestantes;
    const segundos = Math.max(1, Math.ceil(restanteMs / 1000));
    const bloqueado = conteo.total > limit;
    return {
      totalHits: conteo.total,
      timeToExpire: segundos,
      isBlocked: bloqueado,
      // Con ventana fija, el bloqueo dura lo que le queda a la ventana.
      timeToBlockExpire: bloqueado ? segundos : 0,
    };
  }

  onApplicationShutdown(): void {
    (this.respaldo as Partial<OnApplicationShutdown>).onApplicationShutdown?.();
  }
}
