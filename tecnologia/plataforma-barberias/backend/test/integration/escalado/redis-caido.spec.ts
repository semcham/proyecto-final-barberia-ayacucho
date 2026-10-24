import { Logger } from '@nestjs/common';
import { CatalogoPublicoQuery } from '../../../src/modules/catalogo-citas/catalogo/application/ports/catalogo-publico-query';
import { CacheCompartida } from '../../../src/shared';
import { CacheInactiva } from '../../../src/shared/cache/cache-inactiva';
import { LecturaPublica } from '../../../src/shared/lectura-publica';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { iniciarRedis, type RedisDePrueba } from '../../helpers/redis';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T045 · PR05 funcional (006 US4; FR-019 a FR-021, ADR-029 R06): con Redis caído o lento la plataforma
// responde igual desde PostgreSQL, el límite pasa a ser por instancia, queda una sola alerta y la caché se
// vuelve a usar sola, sin reiniciar la aplicación.

const INTERRUPTOR = { CACHE_FALLOS_PARA_ABRIR: '5', CACHE_PAUSA_MS: '1000' };
const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

type Linea = [unknown, ...unknown[]];
const conTexto = (llamadas: Linea[], texto: string) =>
  llamadas.filter(([mensaje]) => String(mensaje).includes(texto)).length;

describe('PR05 · La plataforma sigue funcionando si Redis cae o se pone lento', () => {
  let redis: RedisDePrueba;
  const abiertas: AppDePrueba[] = [];
  const fecha = fechaEnDias(3);

  async function instancia(entorno: Record<string, string | undefined> = {}): Promise<AppDePrueba> {
    const app = await crearApp({ entorno: { ...INTERRUPTOR, ...entorno } });
    abiertas.push(app);
    return app;
  }
  const catalogo = (app: AppDePrueba, e: BarberiaParaReservar) =>
    app.agente.get(`/api/v1/publico/${e.barberia.slug}`);
  const horarios = (app: AppDePrueba, e: BarberiaParaReservar) =>
    app.agente.get(`/api/v1/publico/${e.barberia.slug}/horarios?servicio=${e.servicioId}&fecha=${fecha}`);
  /** Duración de una solicitud en ms, con su respuesta. */
  async function medir<T>(solicitud: PromiseLike<T>): Promise<{ respuesta: T; ms: number }> {
    const inicio = performance.now();
    const respuesta = await solicitud;
    return { respuesta, ms: performance.now() - inicio };
  }
  const sinHora = (cuerpo: object) => ({ ...cuerpo, calculadoEn: null });

  beforeAll(async () => {
    redis = await iniciarRedis();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    while (abiertas.length > 0) await abiertas.pop()?.cerrar();
    // Cada caso deja Redis en marcha y vacío para el siguiente.
    try {
      redis.reanudar();
    } catch {
      // No estaba en pausa.
    }
    await redis.reiniciar();
    await redis.vaciar();
  });

  afterAll(async () => {
    await redis.cerrar();
    await cerrarPools();
  });

  it('lecturas sin Redis: catálogo y horarios responden 200 con los mismos datos, cada uno en menos de 2 s (escenario 1)', async () => {
    const app = await instancia();
    const e = await barberiaParaReservar();
    const catalogoAntes = (await catalogo(app, e).expect(200)).body;
    const horariosAntes = (await horarios(app, e).expect(200)).body;

    await redis.detener();
    for (let i = 0; i < 3; i += 1) {
      const c = await medir(catalogo(app, e));
      expect(c.respuesta.status).toBe(200);
      expect(c.respuesta.body).toEqual(catalogoAntes);
      expect(c.ms).toBeLessThan(2_000);
      const h = await medir(horarios(app, e));
      expect(h.respuesta.status).toBe(200);
      expect(sinHora(h.respuesta.body)).toEqual(sinHora(horariosAntes));
      expect(h.ms).toBeLessThan(2_000);
    }
  });

  it('escrituras sin Redis: reservar, cancelar y cambiar estado dan lo mismo que con Redis, y la doble reserva sigue en 409 (escenario 2)', async () => {
    const app = await instancia();
    async function secuencia(): Promise<unknown[]> {
      const e = await barberiaParaReservar();
      const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
      const [uno, dos] = [await sesionCliente(e.barberia.tenantId), await sesionCliente(e.barberia.tenantId)];
      const reservar = (token: string, hora: string) =>
        app.agente
          .post('/api/v1/citas')
          .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': nuevaClave() })
          .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(fecha, hora) });

      const primera = await reservar(uno.token, '10:00');
      const doble = await reservar(dos.token, '10:00');
      const segunda = await reservar(uno.token, '12:00');
      const estado = await app.agente
        .post(`/api/v1/citas/${segunda.body.id}/estado`)
        .set({ Authorization: `Bearer ${propietario}` })
        .send({ estado: 'CONFIRMADA' });
      const cancelada = await app.agente
        .post(`/api/v1/citas/${primera.body.id}/cancelar`)
        .set({ Authorization: `Bearer ${uno.token}` });
      // El horario cancelado vuelve a estar libre al instante.
      const otraVez = await reservar(dos.token, '10:00');
      return [
        [primera.status, primera.body.estado],
        [doble.status, doble.body.codigo],
        [estado.status, estado.body.estado],
        [cancelada.status, cancelada.body.estado],
        [otraVez.status, otraVez.body.estado],
      ];
    }

    const conRedis = await secuencia();
    await redis.detener();
    const sinRedis = await secuencia();
    expect(sinRedis).toEqual(conRedis);
    expect(conRedis[1]).toEqual([409, expect.any(String)]);
    expect(conRedis.filter((paso) => (paso as [number])[0] >= 500)).toEqual([]);
  });

  it('cambio durante la caída: se guarda, y la entrada vieja que queda en Redis no sobrevive al TTL de prueba (escenario 3, FR-021)', async () => {
    const app = await instancia({ CACHE_CATALOGO_TTL_SEGUNDOS: '10' });
    const e = await barberiaParaReservar();
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const precio = async () =>
      (await catalogo(app, e).expect(200)).body.servicios.find((s: { id: string }) => s.id === e.servicioId)
        .precio;
    expect(await precio()).toBe('20.00');
    const clave = `bp:v1:t:${e.barberia.tenantId}:catalogo-publico`;
    expect(await redis.claves(clave)).toEqual([clave]);

    // En pausa, Redis conserva la entrada vieja y la invalidación no llega.
    redis.pausar();
    await app.agente
      .patch(`/api/v1/servicios/${e.servicioId}`)
      .set({ Authorization: `Bearer ${propietario}` })
      .send({ precio: '35.00' })
      .expect(200);
    expect(await precio()).toBe('35.00'); // durante la caída se lee de PostgreSQL
    redis.reanudar();

    const ttl = await redis.ttl(clave);
    expect(ttl).toBeLessThanOrEqual(10);
    await esperar((ttl + 1) * 1_000);
    expect(await precio()).toBe('35.00');
    // La caché se vuelve a usar sola (el interruptor se cierra con la primera operación que responde).
    for (let i = 0; i < 10 && (await redis.claves(clave)).length === 0; i += 1) {
      expect(await precio()).toBe('35.00');
      await esperar(200);
    }
    const entrada = JSON.parse((await redis.cliente().get(clave)) as string);
    expect(entrada.d.servicios.find((s: { id: string }) => s.id === e.servicioId).precio).toBe('35.00');
  }, 60_000);

  it('una sola alerta: tras más de 5 solicitudes con Redis detenido, una sola línea CACHE_NO_DISPONIBLE (escenario 5)', async () => {
    const avisos = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const app = await instancia();
    const e = await barberiaParaReservar();
    await redis.detener();
    // Más de 5 solicitudes, y más que la pausa: las pruebas del semiabierto fallan sin repetir el aviso.
    const inicio = Date.now();
    while (Date.now() - inicio < 2_500) {
      await catalogo(app, e).expect(200);
      await horarios(app, e).expect(200);
    }
    expect(conTexto(avisos.mock.calls as Linea[], 'CACHE_NO_DISPONIBLE')).toBe(1);
  });

  it('recuperación: con Redis de nuevo, tras la pausa vuelve a escribir bp:v1:* sin reiniciar y registra CACHE_RECUPERADA (escenario 6)', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const registros = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const app = await instancia();
    const e = await barberiaParaReservar();
    await redis.detener();
    for (let i = 0; i < 6; i += 1) await catalogo(app, e).expect(200);
    expect(await redis.claves('bp:v1:*').catch(() => [])).toEqual([]);

    await redis.reiniciar();
    await esperar(1_200); // pasa la pausa del interruptor
    const clave = `bp:v1:t:${e.barberia.tenantId}:catalogo-publico`;
    for (let i = 0; i < 10 && (await redis.claves(clave)).length === 0; i += 1) {
      await catalogo(app, e).expect(200);
      await esperar(100);
    }
    expect(await redis.claves(clave)).toEqual([clave]);
    expect(conTexto(registros.mock.calls as Linea[], 'CACHE_RECUPERADA')).toBe(1);
  });

  it('Redis lento (docker pause): cada lectura responde en menos de 1 s con los datos correctos, el interruptor se abre tras 5 tiempos límite y con unpause se recupera', async () => {
    const avisos = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const registros = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const app = await instancia({ CACHE_TIMEOUT_MS: '100' });
    const e = await barberiaParaReservar();
    const catalogoAntes = (await catalogo(app, e).expect(200)).body;
    const horariosAntes = (await horarios(app, e).expect(200)).body;

    redis.pausar();
    for (let i = 0; i < 4; i += 1) {
      const c = await medir(catalogo(app, e));
      expect(c.respuesta.status).toBe(200);
      expect(c.respuesta.body).toEqual(catalogoAntes);
      expect(c.ms).toBeLessThan(1_000);
      const h = await medir(horarios(app, e));
      expect(h.respuesta.status).toBe(200);
      expect(sinHora(h.respuesta.body)).toEqual(sinHora(horariosAntes));
      expect(h.ms).toBeLessThan(1_000);
    }
    expect(conTexto(avisos.mock.calls as Linea[], 'CACHE_NO_DISPONIBLE')).toBe(1);

    redis.reanudar();
    await esperar(1_200);
    for (let i = 0; i < 5; i += 1) await catalogo(app, e).expect(200);
    expect(conTexto(registros.mock.calls as Linea[], 'CACHE_RECUPERADA')).toBe(1);
  });

  it('con el interruptor abierto ninguna solicitud espera el tiempo límite de Redis', async () => {
    const avisos = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // El máximo admitido (CACHE_TIMEOUT_MS ≤ 1000): deja margen sobre lo que tarda PostgreSQL con la suite
    // completa cargando el equipo (hasta ~500 ms medidos), así una espera a Redis no se confunde con carga.
    const limiteMs = 1_000;
    const app = await instancia({ CACHE_TIMEOUT_MS: String(limiteMs), CACHE_PAUSA_MS: '30000' });
    const e = await barberiaParaReservar();
    await catalogo(app, e).expect(200);

    redis.pausar();
    // Con el interruptor cerrado cada solicitud espera al menos un tiempo límite.
    while (conTexto(avisos.mock.calls as Linea[], 'CACHE_NO_DISPONIBLE') === 0) {
      const { ms } = await medir(catalogo(app, e).expect(200));
      expect(ms).toBeGreaterThanOrEqual(limiteMs * 0.9);
    }
    for (let i = 0; i < 10; i += 1) {
      const c = await medir(catalogo(app, e).expect(200));
      expect(c.ms).toBeLessThan(limiteMs);
      const h = await medir(horarios(app, e).expect(200));
      expect(h.ms).toBeLessThan(limiteMs);
    }
  });

  it('horarios sin entrada: con Redis detenido usan fuenteCompleta, en una transacción pública', async () => {
    const app = await instancia();
    const e = await barberiaParaReservar();
    await catalogo(app, e).expect(200); // la entrada existe, pero Redis no responde
    await redis.detener();
    const consulta = app.app.get(CatalogoPublicoQuery);
    const completa = jest.spyOn(consulta, 'fuenteCompleta');
    const delDia = jest.spyOn(consulta, 'fuenteDelDia');
    const transacciones = jest.spyOn(LecturaPublica.prototype, 'ejecutar');

    await horarios(app, e).expect(200);

    expect(completa).toHaveBeenCalledTimes(1);
    expect(delDia).not.toHaveBeenCalled();
    expect(transacciones).toHaveBeenCalledTimes(1);
  });

  it('sin REDIS_URL: CacheInactiva, todo responde y no hay alertas', async () => {
    const avisos = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const app = await instancia({ REDIS_URL: undefined });
    expect(app.app.get(CacheCompartida)).toBeInstanceOf(CacheInactiva);
    const e = await barberiaParaReservar();
    for (let i = 0; i < 6; i += 1) {
      await catalogo(app, e).expect(200);
      await horarios(app, e).expect(200);
    }
    expect(conTexto(avisos.mock.calls as Linea[], 'CACHE_')).toBe(0);
    expect(await redis.claves('*')).toEqual([]);
  });
});
