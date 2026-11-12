import {
  ALFABETO_CODIGO,
  esCodigoDeReserva,
  generarCodigoDeReserva,
} from '../../../src/modules/suscripciones-pagos/adelantos/domain/codigo-reserva';
import { normalizarNumeroOperacion } from '../../../src/modules/suscripciones-pagos/adelantos/domain/numero-operacion';

// T003 de 008 · Número de operación del pago (normalizado: sin espacios, en mayúsculas, 4 a 20 alfanuméricos) y
// código de la reserva (6 caracteres de un alfabeto sin 0, O, 1, I ni L) (research R07; FR-010).

describe('Número de operación (R07, FR-010)', () => {
  it.each([
    ['12345678', '12345678'],
    ['abc123', 'ABC123'],
    ['  op 1234 5678 ', 'OP12345678'],
    ['00012', '00012'],
    ['a\tb c\nd', 'ABCD'],
    ['1234', '1234'],
    ['12345678901234567890', '12345678901234567890'],
    ['1234 5678 9012 3456 7890', '12345678901234567890'],
  ])('%j → %j', (entrada, esperado) => {
    expect(normalizarNumeroOperacion(entrada)).toBe(esperado);
  });

  it.each([
    ['', 'vacío'],
    ['   ', 'solo espacios'],
    ['123', 'menos de 4 caracteres'],
    [' 1 2 3 ', 'menos de 4 sin espacios'],
    ['123456789012345678901', 'más de 20 caracteres'],
    ['1234-5678', 'con guion'],
    ['OP#12345', 'con símbolo'],
    ['ÑANDÚ123', 'con letras fuera de A-Z'],
    ['１２３４５', 'dígitos de ancho completo'],
  ])('%j (%s) → null', (entrada) => {
    expect(normalizarNumeroOperacion(entrada)).toBeNull();
  });

  it('dos escrituras del mismo número dan el mismo valor (la unicidad compara lo normalizado)', () => {
    expect(normalizarNumeroOperacion('ab 12 cd')).toBe(normalizarNumeroOperacion('AB12CD'));
  });
});

describe('Código de la reserva (R07)', () => {
  it('el alfabeto no tiene 0, O, 1, I ni L, ni caracteres repetidos', () => {
    for (const ambiguo of ['0', 'O', '1', 'I', 'L']) expect(ALFABETO_CODIGO).not.toContain(ambiguo);
    expect(new Set(ALFABETO_CODIGO).size).toBe(ALFABETO_CODIGO.length);
    expect(ALFABETO_CODIGO).toMatch(/^[A-Z2-9]+$/);
  });

  it('tiene las 23 letras y los 8 dígitos que quedan', () => {
    expect(ALFABETO_CODIGO.length).toBe(31);
  });

  it('genera 6 caracteres del alfabeto', () => {
    let semilla = 7;
    const aleatorio = (n: number) =>
      Uint8Array.from({ length: n }, () => {
        semilla = (semilla * 73 + 41) % 256;
        return semilla;
      });
    for (let i = 0; i < 200; i += 1) {
      const codigo = generarCodigoDeReserva(aleatorio);
      expect(codigo).toHaveLength(6);
      expect(esCodigoDeReserva(codigo)).toBe(true);
    }
  });

  it('descarta los bytes que sesgarían el reparto (rechazo, no módulo)', () => {
    // 248 = 31 × 8: los bytes 248 a 255 se descartan; el resto elige ALFABETO[byte % 31].
    const fuente = [255, 248, 0, 30, 31, 249, 62, 247, 100];
    const aleatorio = (n: number) => Uint8Array.from(fuente.splice(0, n));
    expect(generarCodigoDeReserva(aleatorio)).toBe(
      [0, 30, 31, 62, 247, 100].map((b) => ALFABETO_CODIGO[b % 31]).join(''),
    );
  });

  it.each([
    ['ABC234', true],
    ['XYZ789', true],
    ['abc234', false],
    ['ABC23', false],
    ['ABC2345', false],
    ['ABC0DE', false],
    ['ABCODE', false],
    ['ABC1DE', false],
    ['ABCIDE', false],
    ['ABCLDE', false],
  ])('esCodigoDeReserva(%j) → %s', (codigo, esperado) => {
    expect(esCodigoDeReserva(codigo)).toBe(esperado);
  });
});
