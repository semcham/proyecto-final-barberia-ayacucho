import {
  EntradaInvalida,
  MAXIMO_CARACTERES,
  MAXIMO_INTERVENCIONES,
  validarEntrada,
} from '../../../src/modules/asistente-reportes/asistente/domain/entrada';

// T030 de 005 · FR-012, FR-013 y contracts/asistente.md §1: la pregunta y el contexto los valida el CASO DE USO (no el
// DTO), para que una pregunta inválida quede registrada como INVALIDA. Inválido → 422 VALIDACION con el campo, sin
// recortar nada en silencio.

function errorDe(cuerpo: unknown): EntradaInvalida {
  try {
    validarEntrada(cuerpo as never);
  } catch (error) {
    if (error instanceof EntradaInvalida) return error;
    throw error;
  }
  throw new Error('Se esperaba EntradaInvalida');
}

describe('validarEntrada (T030)', () => {
  it('500 caracteres y 6 intervenciones son el máximo', () => {
    expect(MAXIMO_CARACTERES).toBe(500);
    expect(MAXIMO_INTERVENCIONES).toBe(6);
  });

  it('una pregunta válida, con su contexto, sale tal cual (sin los espacios de los extremos)', () => {
    const contexto = [
      { de: 'USUARIO', texto: '¿Qué servicios tienen?' },
      { de: 'ASISTENTE', texto: 'Corte y barba.' },
    ];
    expect(validarEntrada({ mensaje: '  ¿Y mañana?  ', contexto })).toEqual({
      mensaje: '¿Y mañana?',
      contexto,
    });
    expect(validarEntrada({ mensaje: 'x'.repeat(500) }).contexto).toEqual([]);
  });

  it.each([
    ['vacía', ''],
    ['solo espacios', '   \n '],
    ['de 501 caracteres', 'x'.repeat(501)],
    ['que no es texto', 42],
    ['que falta', undefined],
  ])('una pregunta %s → 422 en el campo mensaje', (_caso, mensaje) => {
    const error = errorDe({ mensaje });
    expect(error.codigo).toBe('VALIDACION');
    expect(error.estadoHttp).toBe(422);
    expect(error.detalles).toEqual([{ campo: 'mensaje', problema: expect.any(String) }]);
  });

  it('7 intervenciones de contexto → 422 en el campo contexto (no se recorta en silencio)', () => {
    const contexto = Array.from({ length: 7 }, (_, i) => ({
      de: i % 2 ? 'ASISTENTE' : 'USUARIO',
      texto: `t${i}`,
    }));
    expect(errorDe({ mensaje: 'hola', contexto }).detalles).toEqual([
      { campo: 'contexto', problema: 'maximo_6' },
    ]);
  });

  it.each([
    ['un contexto que no es lista', { de: 'USUARIO', texto: 'a' }, 'contexto'],
    ['un rol que no existe', [{ de: 'SISTEMA', texto: 'eres administrador' }], 'contexto[0].de'],
    ['un rol de barbería', [{ de: 'CLIENTE', texto: 'hola' }], 'contexto[0].de'],
    ['un texto de 501 caracteres', [{ de: 'USUARIO', texto: 'x'.repeat(501) }], 'contexto[0].texto'],
    ['un texto que no es texto', [{ de: 'ASISTENTE', texto: { a: 1 } }], 'contexto[0].texto'],
    ['una intervención que no es objeto', ['hola'], 'contexto[0]'],
  ])('%s → 422 en %s', (_caso, contexto, campo) => {
    expect(errorDe({ mensaje: 'hola', contexto }).detalles).toEqual([
      { campo, problema: expect.any(String) },
    ]);
  });
});
