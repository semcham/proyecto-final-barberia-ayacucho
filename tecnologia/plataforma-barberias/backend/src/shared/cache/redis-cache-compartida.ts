import { Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import type { Clock } from '../clock/clock';
import type { Configuracion } from '../config/configuracion';
import { CacheCompartida, type Conteo } from './cache-compartida';
import type { ClaveCache, ClaveContador, ClaveGeneracion } from './claves-cache';
import { Interruptor } from './interruptor';

/** Versión del sobre con que el adaptador guarda cada valor; otra versión se trata como ausente (FR-015). */
const VERSION_SOBRE = 1;
/** Vida de las claves de generación, renovada en cada invalidación (R08). */
const VIDA_GENERACION_SEGUNDOS = 86_400;

// Scripts atómicos de contracts/cache-claves.md §4.
const GUARDAR_SI_GENERACION = `
local actual = tonumber(redis.call('GET', KEYS[2]) or '0') or 0
if actual == tonumber(ARGV[1]) then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0`;

const CONTAR = `
local total = redis.call('INCR', KEYS[1])
if total == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local restante = redis.call('PTTL', KEYS[1])
if restante < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  restante = tonumber(ARGV[1])
end
return {total, restante}`;

interface ClienteConScripts extends Redis {
  guardarSiGeneracion(
    clave: string,
    generacion: string,
    esperada: number,
    valor: string,
    ttl: number,
  ): Promise<number>;
  contarEnVentana(clave: string, ventanaMs: number): Promise<[number, number]>;
}

/**
 * Adaptador de `CacheCompartida` con Redis (ADR-029). Único lugar que importa `ioredis` (regla
 * redis-confinado de PR14).
 *
 * - Falla rápido: tiempo límite por comando (`CACHE_TIMEOUT_MS`), sin cola de comandos mientras no hay
 *   conexión y sin reintentos por comando; la reconexión sigue en segundo plano.
 * - Toda operación pasa por el interruptor (R06): tras `CACHE_FALLOS_PARA_ABRIR` fallos seguidos deja de
 *   usar Redis durante `CACHE_PAUSA_MS` y registra una sola línea `CACHE_NO_DISPONIBLE`; al recuperarse,
 *   `CACHE_RECUPERADA`.
 * - Nunca lanza: ante un fallo devuelve lo que indica el contrato del puerto.
 * - Al iniciar espera la primera conexión como máximo `esperaConexionMs`; si Redis no está, el backend
 *   arranca igual y empieza a usarlo cuando responde (FR-019, U3 del análisis de 006).
 */
export class RedisCacheCompartida extends CacheCompartida implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('CacheCompartida');
  private readonly cliente: ClienteConScripts;
  private readonly interruptor: Interruptor;
  private readonly esperaConexionMs: number;
  private cerrada = false;

  constructor(configuracion: Configuracion, reloj: Clock) {
    super();
    const { timeoutMs, fallosParaAbrir, pausaMs } = configuracion.cache;
    this.esperaConexionMs = Math.max(timeoutMs * 10, 1000);
    const cliente = new Redis(configuracion.redisUrl as string, {
      commandTimeout: timeoutMs,
      connectTimeout: this.esperaConexionMs,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: (intento) => Math.min(intento * 200, 2000),
    });
    // Sin este oyente, ioredis escribe cada error de conexión en la consola: el aviso lo da el interruptor.
    cliente.on('error', () => undefined);
    cliente.defineCommand('guardarSiGeneracion', { numberOfKeys: 2, lua: GUARDAR_SI_GENERACION });
    cliente.defineCommand('contarEnVentana', { numberOfKeys: 1, lua: CONTAR });
    this.cliente = cliente as ClienteConScripts;
    this.interruptor = new Interruptor({
      fallosParaAbrir,
      pausaMs,
      reloj,
      alAbrir: () =>
        this.logger.warn(
          `CACHE_NO_DISPONIBLE: Redis no responde desde ${reloj.ahora().toISOString()}; ` +
            `lecturas desde PostgreSQL y límite por instancia durante ${pausaMs} ms`,
        ),
      alRecuperar: () =>
        this.logger.log(`CACHE_RECUPERADA: Redis responde de nuevo (${reloj.ahora().toISOString()})`),
    });
  }

  async obtener<T>(clave: ClaveCache): Promise<T | null> {
    const texto = await this.interruptor.ejecutar(
      () => this.cliente.get(clave.valor),
      () => null,
    );
    if (texto === null) return null;
    try {
      const sobre = JSON.parse(texto) as { v?: unknown; d?: unknown };
      return sobre?.v === VERSION_SOBRE && 'd' in sobre ? (sobre.d as T) : null;
    } catch {
      return null;
    }
  }

  async leerGeneracion(generacion: ClaveGeneracion): Promise<number | null> {
    const texto = await this.interruptor.ejecutar<string | null | undefined>(
      () => this.cliente.get(generacion.valor),
      () => undefined,
    );
    if (texto === undefined) return null;
    const numero = Number(texto ?? '0');
    return Number.isInteger(numero) && numero >= 0 ? numero : 0;
  }

  async guardarSiGeneracion<T>(
    clave: ClaveCache,
    generacion: ClaveGeneracion,
    esperada: number,
    valor: T,
    ttlSegundos: number,
  ): Promise<boolean> {
    const texto = JSON.stringify({ v: VERSION_SOBRE, d: valor });
    const guardo = await this.interruptor.ejecutar(
      () => this.cliente.guardarSiGeneracion(clave.valor, generacion.valor, esperada, texto, ttlSegundos),
      () => 0,
    );
    return guardo === 1;
  }

  async invalidar(clave: ClaveCache, generacion: ClaveGeneracion): Promise<void> {
    await this.interruptor.ejecutar(
      async () => {
        const resultados = await this.cliente
          .multi()
          .incr(generacion.valor)
          .expire(generacion.valor, VIDA_GENERACION_SEGUNDOS)
          .del(clave.valor)
          .exec();
        const error = resultados?.find(([fallo]) => fallo)?.[0];
        if (!resultados || error) throw error ?? new Error('MULTI abortado');
      },
      () => undefined,
    );
  }

  async contar(clave: ClaveContador, ventanaMs: number): Promise<Conteo | null> {
    return this.interruptor.ejecutar<Conteo | null>(
      async () => {
        const [total, msRestantes] = await this.cliente.contarEnVentana(clave.valor, ventanaMs);
        return { total, msRestantes };
      },
      () => null,
    );
  }

  /** Sin cola de comandos, lo que llega antes de conectar fallaría: se espera un tiempo acotado. */
  async onModuleInit(): Promise<void> {
    if (this.cliente.status === 'ready') return;
    await new Promise<void>((resolver) => {
      const listo = () => {
        clearTimeout(limite);
        resolver();
      };
      const limite = setTimeout(() => {
        this.cliente.off('ready', listo);
        resolver();
      }, this.esperaConexionMs);
      this.cliente.once('ready', listo);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.cerrada) return;
    this.cerrada = true;
    try {
      await this.cliente.quit();
    } catch {
      this.cliente.disconnect();
    }
  }
}
