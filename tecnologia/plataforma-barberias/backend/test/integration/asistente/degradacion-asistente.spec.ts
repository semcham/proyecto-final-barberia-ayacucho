import type { ModoFalso } from '../../../src/modules/asistente-reportes/asistente/infrastructure/proveedor-ia-falso';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  barberiaDelAsistente,
  type BarberiaDelAsistente,
  ENTORNO_SIN_LIMITE,
  falsoDe,
  preguntar,
  preguntasDe,
  usoDeCuota,
} from '../../helpers/asistente';
import { erroresDeContrato005 } from '../../helpers/contrato';
import { pedirReportes } from '../../helpers/reportes';
import { cerrarPools } from '../../helpers/test-db';

// T034 de 005 · PR06 (EQ-06), FR-008, FR-026, SC-003 y research R11: con el proveedor caído, lento, con error o con
// una respuesta rota, el cliente recibe 503 ASISTENTE_NO_DISPONIBLE con la alternativa manual en 3 s o menos desde la
// solicitud; la cuota se devuelve; el resto de la plataforma responde igual. Tras 5 fallas en 60 s el interruptor se
// abre y ni siquiera se llama al proveedor. Diez preguntas a la vez de la misma barbería con el proveedor lento no se
// esperan unas a otras: la llamada al proveedor va fuera de toda transacción y no retiene la fila de la cuota.
//
// Cada prueba usa una aplicación nueva: el interruptor es de cada instancia y no debe arrastrar fallas de otra prueba.

const LIMITE_MS = 3000;

async function medir<T>(fn: () => Promise<T>): Promise<{ ms: number; valor: T }> {
  const inicio = performance.now();
  const valor = await fn();
  return { ms: Math.round(performance.now() - inicio), valor };
}

describe('T034 · Degradación del asistente en 3 s o menos (PR06)', () => {
  let prueba: AppDePrueba;
  let b: BarberiaDelAsistente;

  beforeEach(async () => {
    prueba = await crearApp({ entorno: ENTORNO_SIN_LIMITE });
    b = await barberiaDelAsistente();
  });

  afterEach(async () => {
    await prueba.cerrar();
  });

  afterAll(cerrarPools);

  /** El 503 esperado: con la alternativa en detalles[0], dentro del límite, con la cuota devuelta y registrado. */
  async function esperarNoDisponible(): Promise<number> {
    const { ms, valor: respuesta } = await medir(() => preguntar(prueba, b.cliente.token, 'precios'));
    expect(respuesta.status).toBe(503);
    expect(respuesta.body).toEqual({
      codigo: 'ASISTENTE_NO_DISPONIBLE',
      mensaje: expect.stringMatching(/no está disponible/),
      detalles: [{ alternativa: { tipo: 'RESERVAR' } }],
    });
    expect(erroresDeContrato005('/asistente/mensajes', 'post', 503, respuesta.body)).toEqual([]);
    expect(ms).toBeLessThanOrEqual(LIMITE_MS);
    expect(await usoDeCuota(b.tenantId, 'USUARIO', b.cliente.usuarioId)).toBe(0);
    expect(await usoDeCuota(b.tenantId, 'BARBERIA', b.tenantId)).toBe(0);
    expect((await preguntasDe(b.tenantId)).at(-1)?.result).toBe('PROVEEDOR_NO_DISPONIBLE');
    return ms;
  }

  it.each<[string, ModoFalso]>([
    ['caído', { tipo: 'caido' }],
    ['lento (más que el tiempo límite de 2,5 s)', { tipo: 'lento', ms: 10_000 }],
    ['con error 500 (reintenta una vez y falla)', { tipo: 'error', estado: 500 }],
    ['con error 429 que no se recupera', { tipo: 'error', estado: 429 }],
    ['con una respuesta rota (JSON inválido)', { tipo: 'invalido' }],
  ])('proveedor %s → 503 con la alternativa en ≤ 3 s y la cuota devuelta', async (_caso, modo) => {
    falsoDe(prueba).fijarModo(modo);
    const ms = await esperarNoDisponible();
    console.info('PR06 · asistente no disponible', { modo: modo.tipo, ms });
  });

  it('un 429 que se recupera al reintentar: un solo reintento dentro del presupuesto, y responde', async () => {
    const falso = falsoDe(prueba);
    falso.fijarModo({ tipo: 'error', estado: 429, veces: 1 });
    falso.limpiarLlamadas();
    const { ms, valor } = await medir(() => preguntar(prueba, b.cliente.token, 'precios'));
    expect(valor.status).toBe(200);
    expect(valor.body.resultado).toBe('RESPONDIDA');
    expect(falso.llamadas).toHaveLength(2);
    expect(ms).toBeLessThanOrEqual(LIMITE_MS);
  });

  it('un error 500 se reintenta UNA sola vez', async () => {
    const falso = falsoDe(prueba);
    falso.fijarModo({ tipo: 'error', estado: 500 });
    falso.limpiarLlamadas();
    await preguntar(prueba, b.cliente.token, 'precios').expect(503);
    expect(falso.llamadas).toHaveLength(2);
  });

  it('tras 5 fallas en 60 s el interruptor se abre: el 503 llega al instante sin llamar al proveedor', async () => {
    const falso = falsoDe(prueba);
    falso.fijarModo({ tipo: 'caido' });
    for (let i = 0; i < 5; i++) await preguntar(prueba, b.cliente.token, 'precios').expect(503);
    falso.limpiarLlamadas();
    falso.restaurar();
    const ms = await esperarNoDisponible();
    expect(falso.llamadas).toEqual([]);
    expect(ms).toBeLessThan(500);
  });

  it('durante la falla, los reportes y el catálogo público responden igual (FR-026)', async () => {
    falsoDe(prueba).fijarModo({ tipo: 'caido' });
    await preguntar(prueba, b.cliente.token, 'precios').expect(503);
    await pedirReportes(prueba, b.propietario, { desde: '2026-11-01', hasta: '2026-11-30' }).expect(200);
    await prueba.agente.get(`/api/v1/publico/${b.slug}`).expect(200);
  });

  it('10 preguntas simultáneas de la misma barbería con el proveedor lento: ninguna espera a otra, todas en ≤ 3 s', async () => {
    falsoDe(prueba).fijarModo({ tipo: 'lento', ms: 10_000 });
    const usadoAntes = await usoDeCuota(b.tenantId, 'BARBERIA', b.tenantId);
    const inicio = performance.now();
    const tiempos = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const { ms, valor } = await medir(() => preguntar(prueba, b.cliente.token, 'precios'));
        expect(valor.status).toBe(503);
        return ms;
      }),
    );
    const total = Math.round(performance.now() - inicio);
    console.info('PR06 · 10 preguntas simultáneas, proveedor lento', { tiemposMs: tiempos, totalMs: total });
    for (const ms of tiempos) expect(ms).toBeLessThanOrEqual(LIMITE_MS);
    // Si se esperaran en la fila de la cuota, el total sería unas 10 × 2,5 s.
    expect(total).toBeLessThanOrEqual(LIMITE_MS + 500);
    expect(await usoDeCuota(b.tenantId, 'BARBERIA', b.tenantId)).toBe(usadoAntes);
    expect(await usoDeCuota(b.tenantId, 'USUARIO', b.cliente.usuarioId)).toBe(0);
  });
});
