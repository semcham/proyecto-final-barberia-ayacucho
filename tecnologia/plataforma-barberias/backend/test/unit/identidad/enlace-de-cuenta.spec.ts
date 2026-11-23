import {
  EnlaceDeCuenta,
  solicitarReemplazando,
  VIGENCIA_ENLACE_MS,
} from '../../../src/modules/acceso-barberias/identidad/domain/enlace-de-cuenta';
import { EnlaceNoValido } from '../../../src/modules/acceso-barberias/identidad/domain/errores';

// T028 de 010 · Reglas del enlace de cuenta (data-model §2; research R01 y R02): vigencia de 24 h y de 1 h, un solo
// uso, anulación al pedir otro del mismo propósito, vencimiento calculado al leer y el mismo error para todo enlace
// que no sirve.

const HORA = 60 * 60 * 1000;
const T0 = new Date('2026-11-23T15:00:00Z');
const despues = (ms: number) => new Date(T0.getTime() + ms);

const verificar = (id = 'e1') =>
  EnlaceDeCuenta.solicitar(id, 'tenant-a', 'usuario-1', 'VERIFICAR_CORREO', T0);
const recuperar = (id = 'r1') =>
  EnlaceDeCuenta.solicitar(id, 'tenant-a', 'usuario-1', 'RECUPERAR_CONTRASENA', T0);

/** Un enlace ya enviado (con su token emitido). */
function enviado(enlace: EnlaceDeCuenta): EnlaceDeCuenta {
  enlace.emitirToken(T0);
  return enlace;
}

describe('EnlaceDeCuenta', () => {
  it('verificar el correo vence a las 24 h; recuperar la contraseña, a la hora', () => {
    expect(VIGENCIA_ENLACE_MS.VERIFICAR_CORREO).toBe(24 * HORA);
    expect(VIGENCIA_ENLACE_MS.RECUPERAR_CONTRASENA).toBe(HORA);
    expect(verificar().venceEn).toEqual(despues(24 * HORA));
    expect(recuperar().venceEn).toEqual(despues(HORA));
  });

  it('nace sin token ("por enviar") y pasa a vigente al emitirlo; reemitir no mueve el vencimiento', () => {
    const enlace = verificar();
    expect(enlace.estado(T0)).toBe('POR_ENVIAR');
    enlace.emitirToken(T0);
    expect(enlace.estado(T0)).toBe('VIGENTE');
    enlace.emitirToken(despues(HORA));
    expect(enlace.venceEn).toEqual(despues(24 * HORA));
  });

  it('el vencimiento se calcula al leer: vigente un instante antes, vencido justo al llegar', () => {
    const enlace = enviado(recuperar());
    expect(enlace.estado(despues(HORA - 1))).toBe('VIGENTE');
    expect(enlace.estado(despues(HORA))).toBe('VENCIDO');
    expect(enlace.puedeEmitirToken(despues(HORA))).toBe(false);
  });

  it('sirve una sola vez', () => {
    const enlace = enviado(verificar());
    enlace.usar(despues(HORA));
    expect(enlace.estado(despues(HORA))).toBe('USADO');
    expect(enlace.usadoEn).toEqual(despues(HORA));
    expect(() => enlace.usar(despues(2 * HORA))).toThrow(EnlaceNoValido);
  });

  it.each([
    ['usado', (e: EnlaceDeCuenta) => e.usar(T0), T0],
    ['anulado', (e: EnlaceDeCuenta) => e.anular(T0), T0],
    ['vencido', () => undefined, despues(24 * HORA)],
  ])('un enlace %s da el mismo error al usarlo', (_caso, preparar, cuando) => {
    const enlace = enviado(verificar());
    preparar(enlace);
    expect(() => enlace.usar(cuando)).toThrow(EnlaceNoValido);
  });

  it('un enlace por enviar (sin token) tampoco se puede usar', () => {
    expect(() => verificar().usar(T0)).toThrow(EnlaceNoValido);
  });

  it('un enlace usado, anulado o vencido no emite token', () => {
    const usado = enviado(verificar('a'));
    usado.usar(T0);
    const anulado = verificar('b');
    anulado.anular(T0);
    for (const enlace of [usado, anulado]) {
      expect(enlace.puedeEmitirToken(T0)).toBe(false);
      expect(() => enlace.emitirToken(T0)).toThrow(EnlaceNoValido);
    }
    expect(() => verificar('c').emitirToken(despues(24 * HORA))).toThrow(EnlaceNoValido);
  });

  it('el error no revela el motivo: el mismo código y mensaje para todos los casos', () => {
    const error = new EnlaceNoValido();
    expect(error.codigo).toBe('ENLACE_NO_VALIDO');
    expect(error.message).not.toMatch(/usad|venci|anulad|existe/i);
  });

  it('anular un enlace usado no lo cambia', () => {
    const enlace = enviado(verificar());
    enlace.usar(T0);
    enlace.anular(despues(HORA));
    expect(enlace.anuladoEn).toBeNull();
    expect(enlace.estado(despues(HORA))).toBe('USADO');
  });
});

describe('solicitarReemplazando', () => {
  it('pedir otro del mismo propósito anula el anterior y deja vigente solo el nuevo', () => {
    const anterior = enviado(verificar('viejo'));
    const nuevo = solicitarReemplazando(
      [anterior],
      { id: 'nuevo', tenantId: 'tenant-a', usuarioId: 'usuario-1', proposito: 'VERIFICAR_CORREO' },
      despues(HORA),
    );
    expect(anterior.estado(despues(HORA))).toBe('ANULADO');
    expect(() => anterior.usar(despues(HORA))).toThrow(EnlaceNoValido);
    expect(nuevo.id).toBe('nuevo');
    expect(nuevo.estado(despues(HORA))).toBe('POR_ENVIAR');
    expect(nuevo.venceEn).toEqual(despues(25 * HORA));
  });

  it('no toca los enlaces de otro propósito', () => {
    const deRecuperacion = enviado(recuperar());
    solicitarReemplazando(
      [deRecuperacion],
      { id: 'nuevo', tenantId: 'tenant-a', usuarioId: 'usuario-1', proposito: 'VERIFICAR_CORREO' },
      T0,
    );
    expect(deRecuperacion.estado(T0)).toBe('VIGENTE');
  });
});
