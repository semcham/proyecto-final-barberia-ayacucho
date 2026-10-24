import { randomBytes } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { type BarberiaSembrada, sembrarBarberia } from '../../helpers/fixtures';
import { iniciarRedis, type RedisDePrueba } from '../../helpers/redis';
import { cerrarPools } from '../../helpers/test-db';

// T042 · Límite general por IP compartido entre réplicas (006 US3; FR-016 a FR-018, SC-006; ADR-029): dos
// instancias sobre el mismo Redis. La app confía en X-Forwarded-For desde loopback (trust proxy), así se
// simulan IP distintas. Los intentos de inicio de sesión siguen en PostgreSQL (principio VIII).

const LIMITE_PUBLICO = 10;
const LIMITE_REGISTRO = 4;
const VENTANA_CORTA_MS = 2_000;

/** Variables que los `@Throttle` leen en cada solicitud; se restauran al terminar. */
const ENTORNO = {
  PUBLICO_LIMITE_POR_MINUTO: String(LIMITE_PUBLICO),
  REGISTRO_LIMITE_POR_MINUTO: String(LIMITE_REGISTRO),
};

let ipSiguiente = 10;
/** Una IP de documentación nueva por caso: los contadores no se mezclan entre casos. */
const nuevaIp = () => `198.51.100.${(ipSiguiente += 1)}`;

describe('Límite de solicitudes por IP compartido entre dos instancias', () => {
  let redis: RedisDePrueba;
  let uno: AppDePrueba;
  let dos: AppDePrueba;
  let barberia: BarberiaSembrada;
  const anteriores = new Map<string, string | undefined>();

  const instancias = () => [uno, dos];
  /** Envía `total` solicitudes alternando instancias y devuelve los estados. */
  async function alternar(
    total: number,
    enviar: (app: AppDePrueba, i: number) => Promise<{ status: number }>,
  ): Promise<number[]> {
    const estados: number[] = [];
    for (let i = 0; i < total; i += 1) estados.push((await enviar(instancias()[i % 2], i)).status);
    return estados;
  }
  const contar = (estados: number[], estado: number) => estados.filter((e) => e === estado).length;
  const catalogo = (app: AppDePrueba, ip: string) =>
    app.agente.get(`/api/v1/publico/${barberia.slug}`).set('X-Forwarded-For', ip);

  beforeAll(async () => {
    for (const [variable, valor] of Object.entries(ENTORNO)) {
      anteriores.set(variable, process.env[variable]);
      process.env[variable] = valor;
    }
    redis = await iniciarRedis();
    uno = await crearApp({ entorno: { INSTANCIA_ID: 'backend-1' } });
    dos = await crearApp({ entorno: { INSTANCIA_ID: 'backend-2' } });
    barberia = await sembrarBarberia();
  });

  afterAll(async () => {
    await uno.cerrar();
    await dos.cerrar();
    await redis.cerrar();
    await cerrarPools();
    for (const [variable, valor] of anteriores) {
      if (valor === undefined) delete process.env[variable];
      else process.env[variable] = valor;
    }
  });

  it('compartido: 20 visitas de una IP repartidas entre ambas instancias dan 10 aceptadas y 10 × 429 (escenario 1, SC-006)', async () => {
    const ip = nuevaIp();
    const respuestas: { status: number; body: { codigo?: string }; headers: Record<string, string> }[] = [];
    await alternar(20, async (app) => {
      const r = await catalogo(app, ip);
      respuestas.push(r);
      return r;
    });
    const estados = respuestas.map((r) => r.status);
    expect({ aceptadas: contar(estados, 200), rechazadas: contar(estados, 429) }).toEqual({
      aceptadas: LIMITE_PUBLICO,
      rechazadas: 20 - LIMITE_PUBLICO,
    });
    // Las 10 primeras pasan y las siguientes no, sin importar la instancia.
    expect(estados.slice(0, LIMITE_PUBLICO).every((e) => e === 200)).toBe(true);
    for (const rechazada of respuestas.filter((r) => r.status === 429)) {
      expect(rechazada.body.codigo).toBe('DEMASIADOS_INTENTOS');
      const espera = Number(rechazada.headers['retry-after-general']);
      expect(espera).toBeGreaterThan(0);
      expect(espera).toBeLessThanOrEqual(60);
    }
    expect((await redis.claves('rl:v1:*')).length).toBeGreaterThan(0);
  });

  it('otra IP no se ve afectada (escenario 3)', async () => {
    const agotada = nuevaIp();
    await alternar(LIMITE_PUBLICO + 2, (app) => catalogo(app, agotada));
    for (const app of instancias()) await catalogo(app, agotada).expect(429);
    for (const app of instancias()) await catalogo(app, nuevaIp()).expect(200);
  });

  it('ventana: pasada la ventana, la IP vuelve a ser atendida (escenario 2)', async () => {
    const corto = 'PUBLICO_VENTANA_MS';
    const anterior = process.env[corto];
    process.env[corto] = String(VENTANA_CORTA_MS);
    try {
      const ip = nuevaIp();
      const estados = await alternar(LIMITE_PUBLICO + 1, (app) => catalogo(app, ip));
      expect(estados.at(-1)).toBe(429);
      await new Promise((resolver) => setTimeout(resolver, VENTANA_CORTA_MS + 500));
      await catalogo(dos, ip).expect(200);
      await catalogo(uno, ip).expect(200);
    } finally {
      if (anterior === undefined) delete process.env[corto];
      else process.env[corto] = anterior;
    }
  });

  it('formularios abiertos (FR-016): 8 POST /clientes/registro de una IP dan como máximo 4 que no son 429', async () => {
    const ip = nuevaIp();
    const estados = await alternar(8, (app) =>
      app.agente
        .post('/api/v1/clientes/registro')
        .set('X-Forwarded-For', ip)
        .send({
          barberia: barberia.slug,
          nombre: 'Cliente del Límite',
          correo: `limite-${randomBytes(4).toString('hex')}@prueba.pe`,
          telefono: '966111222',
          contrasena: 'una clave larga y propia',
          aceptaPoliticaDatos: true,
          versionPoliticaDatos: '2026-10',
        }),
    );
    expect(estados.filter((e) => e !== 429).length).toBeLessThanOrEqual(LIMITE_REGISTRO);
    expect(contar(estados, 429)).toBe(8 - LIMITE_REGISTRO);
    expect(estados.every((e) => e < 500)).toBe(true);
  });

  it('sin Redis para los intentos (FR-017): el bloqueo de inicio de sesión rige en ambas instancias y Redis no guarda intentos', async () => {
    const ip = nuevaIp();
    const cuenta = await sembrarBarberia();
    const login = (app: AppDePrueba, contrasena: string) =>
      app.agente
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ correo: cuenta.correo, contrasena });

    await alternar(5, (app) => login(app, 'contrasena-errada').expect(401));
    for (const app of instancias()) {
      const bloqueado = await login(app, cuenta.contrasena).expect(429);
      expect(bloqueado.body.codigo).toBe('DEMASIADOS_INTENTOS');
    }
    const claves = await redis.claves('*');
    expect(claves.filter((clave) => !/^(rl|bp):v1:/.test(clave))).toEqual([]);
    expect(claves.join('\n')).not.toContain(cuenta.correo);
  });

  it('Redis detenido: cada instancia aplica el límite por su cuenta, hasta 10 por instancia, sin 5xx (US4, escenario 4)', async () => {
    await redis.detener();
    try {
      const ip = nuevaIp();
      const estados = await alternar(30, (app) => catalogo(app, ip));
      expect(estados.every((e) => e === 200 || e === 429)).toBe(true);
      expect(contar(estados, 200)).toBe(2 * LIMITE_PUBLICO);
      expect(contar(estados, 429)).toBe(30 - 2 * LIMITE_PUBLICO);
    } finally {
      await redis.reiniciar();
    }
  });
});
