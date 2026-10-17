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
