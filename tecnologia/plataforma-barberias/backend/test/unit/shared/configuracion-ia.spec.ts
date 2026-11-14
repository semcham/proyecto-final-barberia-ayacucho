import { inspect } from 'node:util';
import { Configuracion } from '../../../src/shared/config/configuracion';

// T006 de 005 · FR-015 y ADR-027: la configuración del proveedor de IA. Solo del servidor; OpenRouter, solo en
// desarrollo (con NODE_ENV=production el servidor no arranca); el tiempo límite, de 500 a 2800 ms para que la
// respuesta quepa en 3 s (SC-003); y la llave nunca aparece en un mensaje de error ni en un registro.

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
  ENLACES_LLAVE: Buffer.alloc(32, 9).toString('base64'),
  ENLACES_SAL_IP: 'sal-de-la-ip-de-pruebas-0123',
  SMTP_HOST: 'localhost',
  CORREO_REMITENTE: 'no-responder@barberias.local',
};

const VARIABLES_IA = [
  'IA_PROVEEDOR',
  'IA_OPENROUTER_LLAVE',
  'IA_OPENROUTER_MODELO',
  'IA_TIEMPO_LIMITE_MS',
  'IA_CUOTA_USUARIO_DIA',
  'IA_CUOTA_BARBERIA_DIA',
  'IA_FALSO_MODO',
  'NODE_ENV',
];

/** Una llave de prueba con forma de llave real, para buscarla después en los mensajes y registros. */
const LLAVE = 'sk-or-v1-llave-de-prueba-que-no-debe-salir-0123456789';

describe('Configuracion: proveedor de IA (ADR-027)', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original, ...MINIMAS };
    for (const variable of VARIABLES_IA) delete process.env[variable];
  });

  afterAll(() => {
    process.env = original;
  });

  it('por defecto: sin proveedor (ninguno), 2500 ms, 20 por usuario, 200 por barbería y modo falso normal', () => {
    expect(new Configuracion().ia).toEqual({
      proveedor: 'ninguno',
      tiempoLimiteMs: 2500,
      cuotaUsuarioDia: 20,
      cuotaBarberiaDia: 200,
      falsoModo: 'normal',
      openrouter: null,
    });
  });

  it.each(['falso', 'ninguno'])('acepta IA_PROVEEDOR=%s', (valor) => {
    process.env.IA_PROVEEDOR = valor;
    expect(new Configuracion().ia.proveedor).toBe(valor);
  });

  it.each(['openai', 'OpenRouter', 'simulado'])('rechaza IA_PROVEEDOR=%s al iniciar', (valor) => {
    process.env.IA_PROVEEDOR = valor;
    expect(() => new Configuracion()).toThrow(/IA_PROVEEDOR/);
  });

  it.each(['500', '2500', '2800'])('acepta IA_TIEMPO_LIMITE_MS=%s', (valor) => {
    process.env.IA_TIEMPO_LIMITE_MS = valor;
    expect(new Configuracion().ia.tiempoLimiteMs).toBe(Number(valor));
  });

  it.each(['499', '2801', '10000', '0', 'rápido'])('rechaza IA_TIEMPO_LIMITE_MS=%s al iniciar', (valor) => {
    process.env.IA_TIEMPO_LIMITE_MS = valor;
    expect(() => new Configuracion()).toThrow(/IA_TIEMPO_LIMITE_MS/);
  });

  it('las cuotas se pueden bajar para la demostración y rechazan valores no válidos', () => {
    process.env.IA_CUOTA_USUARIO_DIA = '3';
    process.env.IA_CUOTA_BARBERIA_DIA = '5';
    expect(new Configuracion().ia).toMatchObject({ cuotaUsuarioDia: 3, cuotaBarberiaDia: 5 });
    process.env.IA_CUOTA_USUARIO_DIA = '0';
    expect(() => new Configuracion()).toThrow(/IA_CUOTA_USUARIO_DIA/);
    process.env.IA_CUOTA_USUARIO_DIA = '3';
    process.env.IA_CUOTA_BARBERIA_DIA = '-1';
    expect(() => new Configuracion()).toThrow(/IA_CUOTA_BARBERIA_DIA/);
  });

  it.each(['normal', 'caido', 'lento'])('acepta IA_FALSO_MODO=%s', (valor) => {
    process.env.IA_PROVEEDOR = 'falso';
    process.env.IA_FALSO_MODO = valor;
    expect(new Configuracion().ia.falsoModo).toBe(valor);
  });

  it('rechaza un IA_FALSO_MODO desconocido al iniciar', () => {
    process.env.IA_PROVEEDOR = 'falso';
    process.env.IA_FALSO_MODO = 'guion';
    expect(() => new Configuracion()).toThrow(/IA_FALSO_MODO/);
  });

  describe('OpenRouter (solo desarrollo)', () => {
    beforeEach(() => {
      process.env.IA_PROVEEDOR = 'openrouter';
      process.env.IA_OPENROUTER_LLAVE = LLAVE;
      process.env.IA_OPENROUTER_MODELO = 'proveedor/modelo-de-prueba';
    });

    it('con la llave y el modelo, en desarrollo, arranca', () => {
      process.env.NODE_ENV = 'development';
      const ia = new Configuracion().ia;
      expect(ia.proveedor).toBe('openrouter');
      expect(ia.openrouter?.modelo).toBe('proveedor/modelo-de-prueba');
      expect(ia.openrouter?.llave).toBe(LLAVE);
    });

    it('con NODE_ENV=production NO arranca, y el mensaje no trae la llave', () => {
      process.env.NODE_ENV = 'production';
      expect(() => new Configuracion()).toThrow(/IA_PROVEEDOR=openrouter.*NODE_ENV=production/);
      expect(mensajeDe(() => new Configuracion())).not.toContain(LLAVE);
    });

    it('sin IA_OPENROUTER_LLAVE no arranca', () => {
      delete process.env.IA_OPENROUTER_LLAVE;
      expect(() => new Configuracion()).toThrow(/IA_OPENROUTER_LLAVE/);
    });

    it('sin IA_OPENROUTER_MODELO no arranca, y el mensaje no trae la llave', () => {
      delete process.env.IA_OPENROUTER_MODELO;
      expect(() => new Configuracion()).toThrow(/IA_OPENROUTER_MODELO/);
      expect(mensajeDe(() => new Configuracion())).not.toContain(LLAVE);
    });

    it('la llave no aparece al registrar la configuración (JSON ni inspect)', () => {
      const configuracion = new Configuracion();
      expect(JSON.stringify(configuracion.ia)).not.toContain(LLAVE);
      expect(inspect(configuracion.ia, { depth: 5 })).not.toContain(LLAVE);
      expect(inspect(configuracion, { depth: 5 })).not.toContain(LLAVE);
    });

    it('con otro proveedor, la llave no se lee aunque esté en el entorno', () => {
      process.env.IA_PROVEEDOR = 'falso';
      expect(new Configuracion().ia.openrouter).toBeNull();
    });
  });
});

function mensajeDe(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}
