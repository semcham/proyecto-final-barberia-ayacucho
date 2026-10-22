import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import Redis from 'ioredis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

/**
 * T016 · Redis para las pruebas de integración de 006, con el mismo comando sin persistencia que Docker
 * Compose (research.md R12). Usa `testcontainers` (ya instalado); la imagen queda en los datos de Docker.
 *
 * El puerto del equipo es fijo durante la prueba, así `detener()` y `reiniciar()` conservan la misma
 * `REDIS_URL` y la aplicación puede reconectarse sola (demostración de caída y recuperación, PR05).
 */

export const IMAGEN_REDIS = 'redis:7.4-alpine';

const COMANDO = [
  'redis-server',
  '--save',
  '',
  '--appendonly',
  'no',
  '--maxmemory',
  '48mb',
  '--maxmemory-policy',
  'allkeys-lru',
];

export interface RedisDePrueba {
  url: string;
  /** Detiene el contenedor: conexión rechazada (Redis caído). */
  detener(): Promise<void>;
  /** Lo vuelve a iniciar en el mismo puerto (vacío: no hay persistencia). */
  reiniciar(): Promise<void>;
  /** Congela el proceso: Redis lento, la conexión no responde (`docker pause`). */
  pausar(): void;
  reanudar(): void;
  vaciar(): Promise<void>;
  claves(patron?: string): Promise<string[]>;
  /** Todos los valores de texto guardados (para buscar datos canario). */
  valores(): Promise<string[]>;
  ttl(clave: string): Promise<number>;
  cliente(): Redis;
  cerrar(): Promise<void>;
}

function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const servidor = createServer();
    servidor.unref();
    servidor.on('error', rechazar);
    servidor.listen(0, '127.0.0.1', () => {
      const direccion = servidor.address();
      const puerto = typeof direccion === 'object' && direccion ? direccion.port : 0;
      servidor.close(() => resolver(puerto));
    });
  });
}

function docker(...argumentos: string[]): void {
  const resultado = spawnSync('docker', argumentos, { encoding: 'utf8' });
  if (resultado.status !== 0) {
    throw new Error(`docker ${argumentos.join(' ')} falló: ${resultado.stderr}`);
  }
}

async function esperarListo(url: string, intentos = 50): Promise<void> {
  for (let i = 0; i < intentos; i += 1) {
    const sonda = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 500 });
    sonda.on('error', () => undefined);
    try {
      await sonda.connect();
      if ((await sonda.ping()) === 'PONG') return;
    } catch {
      // Todavía arrancando.
    } finally {
      sonda.disconnect();
    }
    await new Promise((resolver) => setTimeout(resolver, 100));
  }
  throw new Error('Redis de prueba no respondió a tiempo');
}

/** Inicia Redis y fija `REDIS_URL` para las aplicaciones que se creen después. */
export async function iniciarRedis(): Promise<RedisDePrueba> {
  const puerto = await puertoLibre();
  const contenedor: StartedTestContainer = await new GenericContainer(IMAGEN_REDIS)
    .withCommand(COMANDO)
    .withExposedPorts({ container: 6379, host: puerto })
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  const url = `redis://127.0.0.1:${puerto}`;
  process.env.REDIS_URL = url;

  let detenido = false;
  let inspector: Redis | null = null;
  const cliente = (): Redis => {
    if (!inspector) {
      inspector = new Redis(url, { maxRetriesPerRequest: 1 });
      inspector.on('error', () => undefined);
    }
    return inspector;
  };
  const soltarInspector = (): void => {
    inspector?.disconnect();
    inspector = null;
  };

  return {
    url,
    async detener() {
      soltarInspector();
      docker('stop', '-t', '1', contenedor.getId());
      detenido = true;
    },
    async reiniciar() {
      docker('start', contenedor.getId());
      await esperarListo(url);
      detenido = false;
    },
    pausar() {
      docker('pause', contenedor.getId());
    },
    reanudar() {
      docker('unpause', contenedor.getId());
    },
    /** Sin efecto con Redis detenido: al reiniciarse ya está vacío (no hay persistencia). */
    async vaciar() {
      if (!detenido) await cliente().flushall();
    },
    claves(patron = '*') {
      return cliente().keys(patron);
    },
    async valores() {
      const claves = await cliente().keys('*');
      const valores: string[] = [];
      for (const clave of claves) {
        if ((await cliente().type(clave)) === 'string') {
          const valor = await cliente().get(clave);
          if (valor !== null) valores.push(valor);
        }
      }
      return valores;
    },
    ttl(clave: string) {
      return cliente().ttl(clave);
    },
    cliente,
    async cerrar() {
      soltarInspector();
      if (process.env.REDIS_URL === url) delete process.env.REDIS_URL;
      if (detenido) docker('start', contenedor.getId());
      await contenedor.stop();
    },
  };
}
