import { CacheCompartida, type Conteo } from './cache-compartida';

/**
 * Caché sin Redis (sin `REDIS_URL`): siempre ausente y nunca falla. La lectura va a PostgreSQL y el límite
 * de solicitudes usa el almacenamiento por instancia (principio VIII). La usan las pruebas de 001 y 002 y el
 * backend local sin Docker.
 */
export class CacheInactiva extends CacheCompartida {
  async obtener<T>(): Promise<T | null> {
    return null;
  }

  async leerGeneracion(): Promise<number | null> {
    return null;
  }

  async guardarSiGeneracion(): Promise<boolean> {
    return false;
  }

  async invalidar(): Promise<void> {}

  async contar(): Promise<Conteo | null> {
    return null;
  }
}
