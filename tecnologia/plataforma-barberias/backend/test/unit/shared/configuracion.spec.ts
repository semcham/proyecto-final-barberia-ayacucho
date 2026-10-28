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
  DATABASE_URL_PLATAFORMA: 'postgres://plataforma@localhost/db',
  PLATAFORMA_LLAVE_TOTP: Buffer.alloc(32, 7).toString('base64'),
  PAGOS_URL_BASE: 'http://localhost:3100',
  PAGOS_LLAVE_SECRETA: 'sk_prueba_123',
  PAGOS_SECRETO_FIRMA: 'whsec_prueba_0123456789',
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
    expect(configuracion.pools).toEqual({ appMax: 10, publicoMax: 10, plataformaMax: 4 });
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

// T002 de 003 · Pagos, plataforma y tareas (ADR-022, ADR-024, ADR-031): valores por defecto, errores claros
// al iniciar y ningún secreto en los mensajes.
describe('Configuracion: pagos, plataforma y tareas (003)', () => {
  const original = { ...process.env };
  const OPCIONALES = [
    'PAGOS_PROVEEDOR',
    'PAGOS_LLAVE_PUBLICA',
    'PAGOS_URL_RETORNO',
    'PAGOS_TIEMPO_LIMITE_MS',
    'PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO',
    'PAGOS_CUENTA_BANCO',
    'PAGOS_CUENTA_TITULAR',
    'PAGOS_CUENTA_NUMERO',
    'PAGOS_CUENTA_CCI',
    'TAREAS_ACTIVAS',
    'TAREAS_INTERVALO_MS',
    'DB_POOL_PLATAFORMA_MAX',
    'FRONTEND_BASE_URL',
  ];

  beforeEach(() => {
    process.env = { ...original, ...MINIMAS };
    for (const variable of OPCIONALES) delete process.env[variable];
  });

  afterAll(() => {
    process.env = original;
  });

  /** Mensaje del error que lanza el constructor con el entorno actual. */
  function errorAlIniciar(): string {
    try {
      new Configuracion();
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('Se esperaba un error al iniciar');
  }

  it('valores por defecto', () => {
    const { pagos, plataforma, tareas } = new Configuracion();
    expect(pagos).toEqual({
      proveedor: 'simulado',
      urlBase: 'http://localhost:3100',
      llavePublica: undefined,
      llaveSecreta: 'sk_prueba_123',
      secretoFirma: 'whsec_prueba_0123456789',
      urlRetorno: 'http://localhost:5173/app/suscripcion',
      tiempoLimiteMs: 2000,
      notificacionesPorMinuto: 600,
      cuenta: { banco: undefined, titular: undefined, numero: undefined, cci: undefined },
    });
    expect(plataforma.databaseUrl).toBe('postgres://plataforma@localhost/db');
    expect(plataforma.llaveTotp).toEqual(Buffer.alloc(32, 7));
    expect(tareas).toEqual({ activas: true, intervaloMs: 300_000 });
  });

  it.each([
    'PAGOS_URL_BASE',
    'PAGOS_LLAVE_SECRETA',
    'PAGOS_SECRETO_FIRMA',
    'DATABASE_URL_PLATAFORMA',
    'PLATAFORMA_LLAVE_TOTP',
  ])('exige %s', (variable) => {
    delete process.env[variable];
    expect(errorAlIniciar()).toContain(variable);
  });

  it.each(['simulado', 'culqi'])('acepta PAGOS_PROVEEDOR=%s', (valor) => {
    process.env.PAGOS_PROVEEDOR = valor;
    expect(new Configuracion().pagos.proveedor).toBe(valor);
  });

  it.each(['Culqi', 'stripe', 'real'])('rechaza PAGOS_PROVEEDOR=%s', (valor) => {
    process.env.PAGOS_PROVEEDOR = valor;
    expect(errorAlIniciar()).toContain('PAGOS_PROVEEDOR');
  });

  it.each([
    ['PAGOS_URL_BASE', 'ftp://pasarela'],
    ['PAGOS_URL_BASE', 'pasarela:3100'],
    ['PAGOS_URL_RETORNO', 'javascript:alert(1)'],
  ])('rechaza %s=%s', (variable, valor) => {
    process.env[variable] = valor;
    expect(errorAlIniciar()).toContain(variable);
  });

  it('quita la barra final de la URL de la pasarela', () => {
    process.env.PAGOS_URL_BASE = 'https://api.pasarela.pe/';
    expect(new Configuracion().pagos.urlBase).toBe('https://api.pasarela.pe');
  });

  it('el retorno por defecto sigue a FRONTEND_BASE_URL', () => {
    process.env.FRONTEND_BASE_URL = 'https://barberias.pe';
    expect(new Configuracion().pagos.urlRetorno).toBe('https://barberias.pe/app/suscripcion');
  });

  it.each([
    ['PAGOS_TIEMPO_LIMITE_MS', ['100', '10000'], ['99', '10001', '2.5']],
    ['PAGOS_NOTIFICACIONES_LIMITE_POR_MINUTO', ['1', '100000'], ['0', '100001']],
    ['TAREAS_INTERVALO_MS', ['10000', '86400000'], ['9999', 'cinco']],
    ['DB_POOL_PLATAFORMA_MAX', ['2', '20'], ['1', '21']],
  ])('%s: rango', (variable, validos, invalidos) => {
    for (const valor of validos) {
      process.env[variable] = valor;
      expect(() => new Configuracion()).not.toThrow();
    }
    for (const valor of invalidos) {
      process.env[variable] = valor;
      expect(errorAlIniciar()).toContain(variable);
    }
  });

  it('TAREAS_ACTIVAS solo acepta true o false', () => {
    process.env.TAREAS_ACTIVAS = 'false';
    expect(new Configuracion().tareas.activas).toBe(false);
    process.env.TAREAS_ACTIVAS = 'no';
    expect(errorAlIniciar()).toContain('TAREAS_ACTIVAS');
  });

  it.each([
    ['vacía', ''],
    ['de 16 bytes', Buffer.alloc(16, 1).toString('base64')],
    ['de 33 bytes', Buffer.alloc(33, 1).toString('base64')],
    ['que no es base64', 'llave-secreta-que-no-es-base64-!!'],
  ])('rechaza una PLATAFORMA_LLAVE_TOTP %s, sin mostrarla', (_caso, valor) => {
    process.env.PLATAFORMA_LLAVE_TOTP = valor;
    const mensaje = errorAlIniciar();
    expect(mensaje).toContain('PLATAFORMA_LLAVE_TOTP');
    if (valor) expect(mensaje).not.toContain(valor);
  });

  it('un secreto corto se rechaza sin mostrarlo', () => {
    process.env.PAGOS_SECRETO_FIRMA = 'corto-123';
    const mensaje = errorAlIniciar();
    expect(mensaje).toContain('PAGOS_SECRETO_FIRMA');
    expect(mensaje).not.toContain('corto-123');
    process.env.PAGOS_SECRETO_FIRMA = MINIMAS.PAGOS_SECRETO_FIRMA;
    process.env.PAGOS_LLAVE_SECRETA = 'sk_1';
    const otro = errorAlIniciar();
    expect(otro).toContain('PAGOS_LLAVE_SECRETA');
    expect(otro).not.toContain('sk_1');
  });
});
