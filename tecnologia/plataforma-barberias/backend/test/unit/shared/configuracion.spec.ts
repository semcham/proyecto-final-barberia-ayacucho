import { Configuracion } from '../../../src/shared/config/configuracion';

// T122 · REFRESH_GRACIA_SEGUNDOS (FR-008a): 10 por defecto, de 0 a 30, error al iniciar si es inválido.

const MINIMAS: Record<string, string> = {
  DATABASE_URL_APP: 'postgres://app@localhost/db',
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
