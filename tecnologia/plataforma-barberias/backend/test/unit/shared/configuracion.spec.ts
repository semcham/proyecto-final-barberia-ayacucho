import { Configuracion } from '../../../src/shared/config/configuracion';

// T122 · REFRESH_GRACIA_SEGUNDOS (FR-008a): 10 por defecto, de 0 a 30, error al iniciar si es inválido.

const MINIMAS: Record<string, string> = {
  DATABASE_URL_APP: 'postgres://app@localhost/db',
  DATABASE_URL_PUBLICO: 'postgres://publico@localhost/db',
  JWT_PRIVATE_KEY: 'privada',
  JWT_PUBLIC_KEYS: '{"k1":"publica"}',
  JWT_ACTIVE_KID: 'k1',
  JWT_ISSUER: 'emisor',
  JWT_AUDIENCE: 'audiencia',
};

describe('Configuracion: período de gracia de la renovación', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original, ...MINIMAS };
    delete process.env.REFRESH_GRACIA_SEGUNDOS;
  });

  afterAll(() => {
    process.env = original;
  });

  it('vale 10 segundos si no se define', () => {
    expect(new Configuracion().sesion.graciaRenovacionSegundos).toBe(10);
  });

  it.each(['0', '1', '30'])('acepta %s', (valor) => {
    process.env.REFRESH_GRACIA_SEGUNDOS = valor;
    expect(new Configuracion().sesion.graciaRenovacionSegundos).toBe(Number(valor));
  });

  it.each(['-1', '31', '2.5', 'diez'])('rechaza %s al iniciar', (valor) => {
    process.env.REFRESH_GRACIA_SEGUNDOS = valor;
    expect(() => new Configuracion()).toThrow(/REFRESH_GRACIA_SEGUNDOS/);
  });
});

// T003 · Vía pública (ADR-021) y parámetros de horarios libres (R08).
describe('Configuracion: vía pública y horarios libres', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original, ...MINIMAS };
    delete process.env.HORARIOS_PASO_MINUTOS;
    delete process.env.RESERVA_HORIZONTE_DIAS;
  });

  afterAll(() => {
    process.env = original;
  });

  it('exige DATABASE_URL_PUBLICO', () => {
    delete process.env.DATABASE_URL_PUBLICO;
    expect(() => new Configuracion()).toThrow(/DATABASE_URL_PUBLICO/);
  });

  it('usa 15 minutos y 30 días si no se definen', () => {
    const { horarios } = new Configuracion();
    expect(horarios).toEqual({ pasoMinutos: 15, horizonteDias: 30 });
  });

  it.each(['5', '10', '15', '20', '30', '60'])('acepta un paso de %s minutos', (valor) => {
    process.env.HORARIOS_PASO_MINUTOS = valor;
    expect(new Configuracion().horarios.pasoMinutos).toBe(Number(valor));
  });

  it.each(['4', '7', '25', '45', '61', 'quince'])('rechaza un paso de %s minutos', (valor) => {
    process.env.HORARIOS_PASO_MINUTOS = valor;
    expect(() => new Configuracion()).toThrow(/HORARIOS_PASO_MINUTOS/);
  });

  it.each(['1', '90'])('acepta un horizonte de %s días', (valor) => {
    process.env.RESERVA_HORIZONTE_DIAS = valor;
    expect(new Configuracion().horarios.horizonteDias).toBe(Number(valor));
  });

  it.each(['0', '91', '1.5'])('rechaza un horizonte de %s días', (valor) => {
    process.env.RESERVA_HORIZONTE_DIAS = valor;
    expect(() => new Configuracion()).toThrow(/RESERVA_HORIZONTE_DIAS/);
  });
});

// T007 · Funcionalidad 006: caché, interruptor, proxies de confianza, instancia y pools (data-model.md §4).
describe('Configuracion: caché compartida, balanceo y pools', () => {
  const original = { ...process.env };
  const VARIABLES = [
    'REDIS_URL',
    'CACHE_CATALOGO_ACTIVA',
    'CACHE_HORARIOS_ACTIVA',
    'CACHE_CATALOGO_TTL_SEGUNDOS',
    'CACHE_TIMEOUT_MS',
    'CACHE_FALLOS_PARA_ABRIR',
    'CACHE_PAUSA_MS',
    'PROXIES_CONFIABLES',
    'INSTANCIA_ID',
    'DB_POOL_APP_MAX',
    'DB_POOL_PUBLICO_MAX',
  ];

  beforeEach(() => {
    process.env = { ...original, ...MINIMAS };
    for (const variable of VARIABLES) delete process.env[variable];
  });

  afterAll(() => {
    process.env = original;
  });

  it('valores por defecto', () => {
    const configuracion = new Configuracion();
    expect(configuracion.redisUrl).toBeUndefined();
    expect(configuracion.cache).toEqual({
      catalogoActiva: true,
      horariosActiva: false,
      ttlCatalogoSegundos: 120,
      timeoutMs: 100,
      fallosParaAbrir: 5,
      pausaMs: 10_000,
    });
    expect(configuracion.proxiesConfiables).toEqual(['loopback']);
    expect(configuracion.instanciaId).toBeUndefined();
    expect(configuracion.pools).toEqual({ appMax: 10, publicoMax: 10 });
  });

  it('una variable vacía equivale a no definida', () => {
    process.env.REDIS_URL = '';
    process.env.INSTANCIA_ID = '';
    const configuracion = new Configuracion();
    expect(configuracion.redisUrl).toBeUndefined();
    expect(configuracion.instanciaId).toBeUndefined();
  });

  it.each(['redis://redis:6379', 'redis://localhost:6380/0', 'rediss://cache.example.com:6380'])(
    'acepta REDIS_URL %s',
    (valor) => {
      process.env.REDIS_URL = valor;
      expect(new Configuracion().redisUrl).toBe(valor);
    },
  );

  it.each(['http://redis:6379', 'redis', 'localhost:6379'])('rechaza REDIS_URL %s', (valor) => {
    process.env.REDIS_URL = valor;
    expect(() => new Configuracion()).toThrow(/REDIS_URL/);
  });

  it.each([
    ['CACHE_CATALOGO_ACTIVA', 'false', (c: Configuracion) => c.cache.catalogoActiva, false],
    ['CACHE_HORARIOS_ACTIVA', 'true', (c: Configuracion) => c.cache.horariosActiva, true],
  ])('%s=%s', (variable, valor, leer, esperado) => {
    process.env[variable] = valor;
    expect(leer(new Configuracion())).toBe(esperado);
  });

  it.each(['CACHE_CATALOGO_ACTIVA', 'CACHE_HORARIOS_ACTIVA'])('%s solo acepta true o false', (v) => {
    process.env[v] = 'si';
    expect(() => new Configuracion()).toThrow(new RegExp(v));
  });

  it.each([
    ['CACHE_CATALOGO_TTL_SEGUNDOS', ['10', '300'], ['9', '301', '1.5']],
    ['CACHE_TIMEOUT_MS', ['10', '1000'], ['9', '1001']],
    ['CACHE_FALLOS_PARA_ABRIR', ['1', '50'], ['0', '51']],
    ['CACHE_PAUSA_MS', ['1000', '60000'], ['999', '60001']],
    ['DB_POOL_APP_MAX', ['2', '50'], ['1', '51']],
    ['DB_POOL_PUBLICO_MAX', ['2', '50'], ['1', '51']],
  ])('%s: rango', (variable, validos, invalidos) => {
    for (const valor of validos) {
      process.env[variable] = valor;
      expect(() => new Configuracion()).not.toThrow();
    }
    for (const valor of invalidos) {
      process.env[variable] = valor;
      expect(() => new Configuracion()).toThrow(new RegExp(variable));
    }
  });

  it.each([
    ['172.28.0.10', ['172.28.0.10']],
    ['loopback, 172.28.0.10', ['loopback', '172.28.0.10']],
    ['10.0.0.0/24', ['10.0.0.0/24']],
    ['::1', ['::1']],
  ])('acepta PROXIES_CONFIABLES=%s', (valor, esperado) => {
    process.env.PROXIES_CONFIABLES = valor;
    expect(new Configuracion().proxiesConfiables).toEqual(esperado);
  });

  it.each(['todo', '172.28.0.300', '10.0.0.0/40', 'loopback,,', '*'])(
    'rechaza PROXIES_CONFIABLES=%s',
    (valor) => {
      process.env.PROXIES_CONFIABLES = valor;
      expect(() => new Configuracion()).toThrow(/PROXIES_CONFIABLES/);
    },
  );

  it.each(['backend-1', 'replica2'])('acepta INSTANCIA_ID=%s', (valor) => {
    process.env.INSTANCIA_ID = valor;
    expect(new Configuracion().instanciaId).toBe(valor);
  });

  it.each(['Backend 1', 'a'.repeat(33), '<script>'])('rechaza INSTANCIA_ID=%s', (valor) => {
    process.env.INSTANCIA_ID = valor;
    expect(() => new Configuracion()).toThrow(/INSTANCIA_ID/);
  });
});
