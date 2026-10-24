import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CatalogoPublicoQuery } from '../../../src/modules/catalogo-citas/catalogo/application/ports/catalogo-publico-query';
import { ServicioRepository } from '../../../src/modules/catalogo-citas/catalogo/application/ports/catalogo-repositorios';
import { KyselyServicioRepository } from '../../../src/modules/catalogo-citas/catalogo/infrastructure/kysely-catalogo-repositorios';
import type { Servicio } from '../../../src/modules/catalogo-citas/catalogo/domain/servicio';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { erroresDeContrato002 } from '../../helpers/contrato';
import { sembrarBloqueo, sembrarCita, sembrarCliente, sembrarServicio } from '../../helpers/fixtures';
import { iniciarRedis, type RedisDePrueba } from '../../helpers/redis';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T031 · Caché compartida del catálogo público (006 US2; FR-008 a FR-015, FR-023; R07 y R08): dos
// instancias (A y B) sobre el mismo PostgreSQL y el mismo Redis. Lo que una guarda lo usa la otra, y lo que
// una cambia lo ve la otra en la visita siguiente.

const RUTA_CLAVES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'specs',
  '006-escalado-cache-balanceo',
  'contracts',
  'cache-claves.md',
);

/** Casos de uso con ✓ en la columna "Catálogo" de la matriz de invalidación (cache-claves.md §3). */
function casosQueInvalidanElCatalogo(): string[] {
  const texto = readFileSync(RUTA_CLAVES, 'utf8');
  const seccion = texto.slice(texto.indexOf('## 3.'), texto.indexOf('## 4.'));
  const casos: string[] = [];
  for (const linea of seccion.split(/\r?\n/)) {
    if (!linea.startsWith('| `')) continue;
    const [caso, , catalogo] = linea
      .split('|')
      .slice(1, -1)
      .map((celda) => celda.trim());
    if (catalogo !== '✓') continue;
    for (const [, nombre] of caso.matchAll(/`(\w+)`/g)) casos.push(nombre);
  }
  return casos;
}

interface Contexto {
  e: BarberiaParaReservar;
  token: string;
  /** Datos que deja `preparar` para el cambio (p. ej. un servicio extra). */
  extra: Record<string, string>;
}

interface CatalogoRespuesta {
  barberia: { nombre: string; slug: string };
  horario: { tramos: { diaSemana: number; inicio: string; fin: string }[] };
  servicios: { id: string; nombre: string; precio: string }[];
  barberos: { id: string; nombre: string; servicioIds: string[] }[];
}

interface Escenario {
  nombre: string;
  preparar?: (c: Contexto, a: AppDePrueba) => Promise<void>;
  cambiar: (c: Contexto, a: AppDePrueba) => Promise<unknown>;
  comprobar: (catalogo: CatalogoRespuesta, c: Contexto) => void;
}

const con = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Un escenario por cada cambio de la matriz. Una fila nueva con ✓ sin escenario hace fallar la prueba. */
const MATRIZ: Record<string, Escenario[]> = {
  CrearServicio: [
    {
      nombre: 'crear servicio',
      cambiar: (c, a) =>
        a.agente
          .post('/api/v1/servicios')
          .set(con(c.token))
          .send({ nombre: 'Barba', precio: '15.00', duracionMinutos: 20 })
          .expect(201),
      comprobar: (cat) => expect(cat.servicios.map((s) => s.nombre)).toContain('Barba'),
    },
  ],
  ActualizarServicio: [
    {
      nombre: 'editar precio',
      cambiar: (c, a) =>
        a.agente
          .patch(`/api/v1/servicios/${c.e.servicioId}`)
          .set(con(c.token))
          .send({ precio: '27.50' })
          .expect(200),
      comprobar: (cat, c) => expect(cat.servicios.find((s) => s.id === c.e.servicioId)?.precio).toBe('27.50'),
    },
    {
      nombre: 'desactivar servicio',
      cambiar: (c, a) =>
        a.agente
          .patch(`/api/v1/servicios/${c.e.servicioId}`)
          .set(con(c.token))
          .send({ activo: false })
          .expect(200),
      comprobar: (cat, c) => {
        expect(cat.servicios.map((s) => s.id)).not.toContain(c.e.servicioId);
        for (const barbero of cat.barberos) expect(barbero.servicioIds).not.toContain(c.e.servicioId);
      },
    },
    {
      nombre: 'reactivar servicio',
      preparar: (c, a) =>
        a.agente
          .patch(`/api/v1/servicios/${c.e.servicioId}`)
          .set(con(c.token))
          .send({ activo: false })
          .expect(200)
          .then(() => undefined),
      cambiar: (c, a) =>
        a.agente
          .patch(`/api/v1/servicios/${c.e.servicioId}`)
          .set(con(c.token))
          .send({ activo: true })
          .expect(200),
      comprobar: (cat, c) => expect(cat.servicios.map((s) => s.id)).toContain(c.e.servicioId),
    },
  ],
  CrearBarbero: [
    {
      nombre: 'crear barbero',
      cambiar: (c, a) =>
        a.agente
          .post('/api/v1/barberos')
          .set(con(c.token))
          .send({ nombre: 'Pedro', servicioIds: [c.e.servicioId] })
          .expect(201),
      comprobar: (cat) => expect(cat.barberos.map((b) => b.nombre)).toContain('Pedro'),
    },
  ],
  ActualizarBarbero: [
    {
      nombre: 'cambiar nombre',
      cambiar: (c, a) =>
        a.agente
          .patch(`/api/v1/barberos/${c.e.barberoId}`)
          .set(con(c.token))
          .send({ nombre: 'Luis Alberto' })
          .expect(200),
      comprobar: (cat, c) =>
        expect(cat.barberos.find((b) => b.id === c.e.barberoId)?.nombre).toBe('Luis Alberto'),
    },
    {
      nombre: 'desactivar barbero',
      cambiar: (c, a) =>
        a.agente
          .patch(`/api/v1/barberos/${c.e.barberoId}`)
          .set(con(c.token))
          .send({ activo: false })
          .expect(200),
      comprobar: (cat, c) => expect(cat.barberos.map((b) => b.id)).not.toContain(c.e.barberoId),
    },
    {
      nombre: 'cambiar servicios asignados',
      preparar: async (c) => {
        c.extra.servicioId = (
          await sembrarServicio({
            tenantId: c.e.barberia.tenantId,
            nombre: 'Tinte',
            precio: '40.00',
            duracionMin: 60,
          })
        ).servicioId;
      },
      cambiar: (c, a) =>
        a.agente
          .patch(`/api/v1/barberos/${c.e.barberoId}`)
          .set(con(c.token))
          .send({ servicioIds: [c.e.servicioId, c.extra.servicioId] })
          .expect(200),
      comprobar: (cat, c) =>
        expect(cat.barberos.find((b) => b.id === c.e.barberoId)?.servicioIds).toContain(c.extra.servicioId),
    },
  ],
  ReemplazarHorarioAtencion: [
    {
      nombre: 'reemplazar horario de atención',
      cambiar: (c, a) =>
        a.agente
          .put('/api/v1/barberia/horario')
          .set(con(c.token))
          .send({ tramos: [{ diaSemana: 1, inicio: '10:00', fin: '18:00' }] })
          .expect(200),
      comprobar: (cat) =>
        expect(cat.horario.tramos).toEqual([{ diaSemana: 1, inicio: '10:00', fin: '18:00' }]),
    },
  ],
};

/** Repositorio que escribe y luego falla: la transacción se revierte (escenario 5). */
class ServicioRepositoryQueFalla extends KyselyServicioRepository {
  override async actualizar(servicio: Servicio): Promise<void> {
    await super.actualizar(servicio);
    throw new Error('falla simulada después de escribir');
  }
}

describe('Caché compartida del catálogo público (dos instancias)', () => {
  let redis: RedisDePrueba;
  let a: AppDePrueba;
  let b: AppDePrueba;
  const fecha = fechaEnDias(4);

  const claveDe = (e: BarberiaParaReservar) => `bp:v1:t:${e.barberia.tenantId}:catalogo-publico`;
  const catalogo = (app: AppDePrueba, slug: string) => app.agente.get(`/api/v1/publico/${slug}`).expect(200);
  const horarios = (app: AppDePrueba, e: BarberiaParaReservar) =>
    app.agente
      .get(`/api/v1/publico/${e.barberia.slug}/horarios?servicio=${e.servicioId}&fecha=${fecha}`)
      .expect(200);

  async function contexto(): Promise<Contexto> {
    const e = await barberiaParaReservar();
    return {
      e,
      token: await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO'),
      extra: {},
    };
  }

  beforeAll(async () => {
    redis = await iniciarRedis();
    a = await crearApp({ entorno: { INSTANCIA_ID: 'backend-a' } });
    b = await crearApp({ entorno: { INSTANCIA_ID: 'backend-b' } });
  });

  afterAll(async () => {
    await a.cerrar();
    await b.cerrar();
    await redis.cerrar();
    await cerrarPools();
  });

  afterEach(() => jest.restoreAllMocks());

  it('fallo y acierto: A lee la base y guarda; B usa la entrada sin leer el catálogo de la base (escenarios 1 y 2)', async () => {
    const { e } = await contexto();
    expect(await redis.claves(claveDe(e))).toEqual([]);

    const primera = await catalogo(a, e.barberia.slug);
    expect(await redis.claves(claveDe(e))).toEqual([claveDe(e)]);

    const consultaB = jest.spyOn(b.app.get(CatalogoPublicoQuery), 'catalogo');
    const segunda = await catalogo(b, e.barberia.slug);
    expect(consultaB).not.toHaveBeenCalled();
    expect(segunda.body).toEqual(primera.body);
  });

  describe('matriz de invalidación (FR-023, SC-003): el cambio por A se ve por B en la visita siguiente', () => {
    const casos = casosQueInvalidanElCatalogo();

    it('la matriz tiene filas con ✓ y cada una tiene al menos un escenario', () => {
      expect(casos.length).toBeGreaterThanOrEqual(5);
      expect(casos.filter((caso) => !MATRIZ[caso]?.length)).toEqual([]);
    });

    const escenarios = casos.flatMap((caso) =>
      (MATRIZ[caso] ?? []).map((escenario) => [`${caso} (${escenario.nombre})`, escenario] as const),
    );
    it.each(escenarios)('%s', async (_nombre, escenario) => {
      const c = await contexto();
      await escenario.preparar?.(c, a);
      await catalogo(b, c.e.barberia.slug); // B llena la entrada
      expect(await redis.claves(claveDe(c.e))).toEqual([claveDe(c.e)]);

      await escenario.cambiar(c, a);

      const { body } = await catalogo(b, c.e.barberia.slug);
      escenario.comprobar(body, c);
    });
  });

  it('enlace: ActualizarBarberia cambia nombre y enlace, B los refleja y el enlace anterior da 404 (escenario 4)', async () => {
    const c = await contexto();
    const anterior = c.e.barberia.slug;
    await catalogo(b, anterior);
    const nuevo = `${anterior}-renovada`;

    await a.agente
      .patch('/api/v1/barberia')
      .set(con(c.token))
      .send({ nombre: 'Barbería Renovada', slug: nuevo })
      .expect(200);

    const { body } = await catalogo(b, nuevo);
    expect(body.barberia).toMatchObject({ nombre: 'Barbería Renovada', slug: nuevo });
    const viejo = await b.agente.get(`/api/v1/publico/${anterior}`).expect(404);
    expect(viejo.body.codigo).toBe('BARBERIA_NO_DISPONIBLE');
  });

  it('revertido: un cambio que falla a mitad no invalida y la entrada sigue igual (escenario 5)', async () => {
    const conFallo = await crearApp({
      entorno: { INSTANCIA_ID: 'backend-con-fallo' },
      ajustar: (constructor) =>
        constructor.overrideProvider(ServicioRepository).useClass(ServicioRepositoryQueFalla),
    });
    try {
      const c = await contexto();
      const antes = await catalogo(b, c.e.barberia.slug);
      const valorAntes = await redis.cliente().get(claveDe(c.e));
      const generacion = `${claveDe(c.e)}:gen`;
      const genAntes = await redis.cliente().get(generacion);

      await conFallo.agente
        .patch(`/api/v1/servicios/${c.e.servicioId}`)
        .set(con(c.token))
        .send({ precio: '99.00' })
        .expect(500);

      expect(await redis.cliente().get(claveDe(c.e))).toBe(valorAntes);
      expect(await redis.cliente().get(generacion)).toBe(genAntes);
      const despues = await catalogo(b, c.e.barberia.slug);
      expect(despues.body).toEqual(antes.body);
      expect(despues.body.servicios.find((s: { id: string }) => s.id === c.e.servicioId).precio).toBe(
        '20.00',
      );
    } finally {
      await conFallo.cerrar();
    }
  });

  it('carrera (R08): si un cambio se confirma entre la lectura y el guardado, la entrada vieja no se guarda', async () => {
    const c = await contexto();
    const consultaA = a.app.get(CatalogoPublicoQuery);
    const original = consultaA.catalogo.bind(consultaA);
    let avisarLectura!: () => void;
    let liberar!: () => void;
    const leyo = new Promise<void>((resolver) => (avisarLectura = resolver));
    const liberada = new Promise<void>((resolver) => (liberar = resolver));
    jest.spyOn(consultaA, 'catalogo').mockImplementationOnce(async (tenantId) => {
      const datos = await original(tenantId);
      avisarLectura();
      await liberada; // se detiene entre su lectura y su retorno
      return datos;
    });

    // supertest no envía la solicitud hasta que se pide el resultado: `then` la arranca ya.
    const visitaLenta = catalogo(a, c.e.barberia.slug).then((respuesta) => respuesta);
    await leyo;
    await b.agente
      .patch(`/api/v1/servicios/${c.e.servicioId}`)
      .set(con(c.token))
      .send({ precio: '31.00' })
      .expect(200);
    liberar();
    const lenta = await visitaLenta;
    expect(lenta.body.servicios[0].precio).toBe('20.00'); // lo que leyó antes del cambio

    expect(await redis.claves(claveDe(c.e))).toEqual([]);
    const siguiente = await catalogo(b, c.e.barberia.slug);
    expect(siguiente.body.servicios.find((s: { id: string }) => s.id === c.e.servicioId).precio).toBe(
      '31.00',
    );
  });

  it('ráfaga tras una invalidación (T066, caso límite): 50 visitas simultáneas dan 0 × 5xx y una sola entrada con el dato nuevo', async () => {
    const c = await contexto();
    await catalogo(b, c.e.barberia.slug);
    await a.agente
      .patch(`/api/v1/servicios/${c.e.servicioId}`)
      .set(con(c.token))
      .send({ precio: '44.00' })
      .expect(200);
    expect(await redis.claves(claveDe(c.e))).toEqual([]); // recién invalidada

    // Leer varias veces de la base en ese instante es aceptable (spec.md, casos límite).
    const respuestas = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        (i % 2 === 0 ? a : b).agente.get(`/api/v1/publico/${c.e.barberia.slug}`),
      ),
    );
    expect(respuestas.filter((r) => r.status >= 500)).toEqual([]);
    expect(respuestas.every((r) => r.status === 200)).toBe(true);
    expect(new Set(respuestas.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(respuestas[0].body.servicios.find((s: { id: string }) => s.id === c.e.servicioId).precio).toBe(
      '44.00',
    );

    expect(await redis.claves(`bp:v1:t:${c.e.barberia.tenantId}:*`)).toEqual(
      expect.arrayContaining([claveDe(c.e)]),
    );
    expect((await redis.claves(`bp:v1:t:${c.e.barberia.tenantId}:catalogo-publico`)).length).toBe(1);
    const sobre = JSON.parse((await redis.cliente().get(claveDe(c.e))) as string);
    const generacion = Number(await redis.cliente().get(`${claveDe(c.e)}:gen`));
    expect(sobre.d.generacion).toBe(generacion);
    expect(sobre.d.servicios.find((s: { id: string }) => s.id === c.e.servicioId).precio).toBe('44.00');
  });

  it('TTL: con CACHE_CATALOGO_TTL_SEGUNDOS=10 la clave vive 10 s o menos', async () => {
    const corta = await crearApp({ entorno: { CACHE_CATALOGO_TTL_SEGUNDOS: '10' } });
    try {
      const { e } = await contexto();
      await catalogo(corta, e.barberia.slug);
      const ttl = await redis.ttl(claveDe(e));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    } finally {
      await corta.cerrar();
    }
  });

  it('horarios: con la entrada en caché, una cita o un bloqueo nuevos cambian los horarios en la visita siguiente (escenario 9)', async () => {
    const { e } = await contexto();
    await catalogo(a, e.barberia.slug);
    const valor = await redis.cliente().get(claveDe(e));
    expect(valor).not.toBeNull();

    const inicios = async (app: AppDePrueba) =>
      ((await horarios(app, e)).body.horas as { inicio: string; barberoIds: string[] }[])
        .filter((h) => h.barberoIds.includes(e.barberoId))
        .map((h) => h.inicio);
    const antes = await inicios(b);
    expect(antes).toEqual(expect.arrayContaining([horaLima(fecha, '10:00'), horaLima(fecha, '15:00')]));

    await sembrarBloqueo({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      inicio: new Date(horaLima(fecha, '10:00')),
      fin: new Date(horaLima(fecha, '11:00')),
    });
    const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId });
    await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId: cliente.clienteId,
      inicio: new Date(horaLima(fecha, '15:00')),
    });

    for (const app of [a, b]) {
      const despues = await inicios(app);
      expect(despues).not.toContain(horaLima(fecha, '10:00'));
      expect(despues).not.toContain(horaLima(fecha, '15:00'));
    }
    // La ocupación no está en la entrada: no hizo falta invalidarla.
    expect(await redis.cliente().get(claveDe(e))).toBe(valor);
  });

  it('un bloqueo creado por la API tampoco invalida la entrada del catálogo (fuera de la matriz)', async () => {
    const c = await contexto();
    await catalogo(a, c.e.barberia.slug);
    const valor = await redis.cliente().get(claveDe(c.e));
    await a.agente
      .post(`/api/v1/barberos/${c.e.barberoId}/bloqueos`)
      .set(con(c.token))
      .send({ inicio: horaLima(fecha, '12:00'), fin: horaLima(fecha, '13:00'), motivo: 'almuerzo' })
      .expect(201);
    expect(await redis.cliente().get(claveDe(c.e))).toBe(valor);
  });

  it('desactivada: con CACHE_CATALOGO_ACTIVA=false no se escribe ninguna clave bp:v1:*', async () => {
    const sinCache = await crearApp({ entorno: { CACHE_CATALOGO_ACTIVA: 'false' } });
    try {
      await redis.vaciar();
      const { e } = await contexto();
      await catalogo(sinCache, e.barberia.slug);
      await horarios(sinCache, e);
      expect(await redis.claves('bp:v1:*')).toEqual([]);
    } finally {
      await sinCache.cerrar();
    }
  });

  it('contrato: GET /publico/{slug} y sus horarios validan contra el esquema de 002, sin y con entrada', async () => {
    const { e } = await contexto();
    // Los horarios leen la entrada sin llenarla: siguen sin entrada hasta la primera visita al catálogo.
    const horariosSinEntrada = await horarios(b, e);
    expect(await redis.claves(claveDe(e))).toEqual([]);
    const sinEntrada = await catalogo(a, e.barberia.slug);
    expect(await redis.claves(claveDe(e))).toEqual([claveDe(e)]);
    const conEntrada = await catalogo(b, e.barberia.slug);
    const horariosConEntrada = await horarios(b, e);

    expect(erroresDeContrato002('/publico/{slug}', 'get', 200, sinEntrada.body)).toEqual([]);
    expect(erroresDeContrato002('/publico/{slug}', 'get', 200, conEntrada.body)).toEqual([]);
    expect(erroresDeContrato002('/publico/{slug}/horarios', 'get', 200, horariosSinEntrada.body)).toEqual([]);
    expect(erroresDeContrato002('/publico/{slug}/horarios', 'get', 200, horariosConEntrada.body)).toEqual([]);
    expect(conEntrada.body).toEqual(sinEntrada.body);
    expect({ ...horariosConEntrada.body, calculadoEn: null }).toEqual({
      ...horariosSinEntrada.body,
      calculadoEn: null,
    });
  });
});
