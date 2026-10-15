import { performance } from 'node:perf_hooks';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools } from '../../helpers/test-db';

// T119 · SC-008: el inicio de sesión con credenciales correctas se completa en menos de 2 s para el 95 %
// de los intentos en operación normal. 50 inicios de sesión secuenciales con Argon2id (m = 19 MiB, t = 2).

const INTENTOS = 50;
const P95_MAXIMO_MS = 2000;

describe('SC-008 · Rendimiento del inicio de sesión', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it(`p95 de ${INTENTOS} inicios de sesión secuenciales < ${P95_MAXIMO_MS} ms`, async () => {
    const { correo, contrasena } = await sembrarBarberia();
    const duraciones: number[] = [];
    for (let i = 0; i < INTENTOS; i += 1) {
      const inicio = performance.now();
      await prueba.agente.post('/api/v1/auth/login').send({ correo, contrasena }).expect(200);
      duraciones.push(performance.now() - inicio);
    }
    duraciones.sort((a, b) => a - b);
    const p95 = duraciones[Math.ceil(INTENTOS * 0.95) - 1];
    const mediana = duraciones[Math.floor(INTENTOS / 2)];
    // Se informa el resultado para la evidencia de SC-008.
    process.stdout.write(
      `\nSC-008 · login: mediana ${mediana.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, máximo ${duraciones.at(-1)?.toFixed(0)} ms\n`,
    );
    expect(p95).toBeLessThan(P95_MAXIMO_MS);
  }, 120_000);
});
