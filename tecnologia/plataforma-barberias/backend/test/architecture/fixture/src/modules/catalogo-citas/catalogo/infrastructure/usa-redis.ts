// Violación a propósito (T015): un módulo de negocio importa ioredis en lugar del puerto CacheCompartida.
import Redis from 'ioredis';

export const cliente = (url: string) => new Redis(url);
