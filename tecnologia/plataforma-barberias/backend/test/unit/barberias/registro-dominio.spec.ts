import { AceptacionTerminos } from '../../../src/modules/acceso-barberias/barberias/domain/aceptacion-terminos';
import { NombreBarberia } from '../../../src/modules/acceso-barberias/barberias/domain/nombre-barberia';
import { Slug } from '../../../src/modules/acceso-barberias/barberias/domain/slug';
import { ValorInvalido } from '../../../src/modules/acceso-barberias/identidad/domain/errores';
import { Plan } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/plan';
import { Suscripcion } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/suscripcion';

// T056 · Reglas de dominio del registro (sin infraestructura).

function problemaDe(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValorInvalido) return error.detalles[0]?.problema;
    throw error;
  }
  return undefined;
}

describe('NombreBarberia', () => {
  it('recorta espacios y conserva tildes', () => {
    expect(NombreBarberia.crear('  Barbería Huamanga  ').valor).toBe('Barbería Huamanga');
  });

  it.each([
    ['', 'muy_corto'],
    ['A', 'muy_corto'],
    ['   ', 'muy_corto'],
    ['x'.repeat(121), 'demasiado_largo'],
    ['Barbería\u0000Oculta', 'caracteres_no_permitidos'],
    ['Linea\nNueva', 'caracteres_no_permitidos'],
  ])('rechaza %j (%s)', (entrada, problema) => {
    expect(problemaDe(() => NombreBarberia.crear(entrada))).toBe(problema);
  });
});

describe('Slug', () => {
  it.each([
    ['Barbería Huamanga', 'barberia-huamanga'],
    ['  El Corte  Fino!! ', 'el-corte-fino'],
    ['Ñaño & Hijos', 'nano-hijos'],
    ['---', 'barberia'],
    ['美容院', 'barberia'],
  ])('%j → %j', (nombre, esperado) => {
    expect(Slug.desdeNombre(nombre).valor).toBe(esperado);
  });

  it('solo produce caracteres [a-z0-9-] sin guiones al inicio, al final ni repetidos', () => {
    const slug = Slug.desdeNombre(`¿${'Peluquería ÁÉÍÓÚ '.repeat(20)}?`).valor;
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slug.length).toBeLessThanOrEqual(120);
  });

  it('agrega un sufijo para resolver choques sin pasar de 140 caracteres', () => {
    const base = Slug.desdeNombre('Barbería Huamanga');
    expect(base.conSufijo('a1b2').valor).toBe('barberia-huamanga-a1b2');
    const largo = Slug.desdeNombre('x'.repeat(200));
    expect(largo.conSufijo('a1b2').valor.length).toBeLessThanOrEqual(140);
  });
});

describe('AceptacionTerminos', () => {
  it('acepta solo la versión vigente del texto (FR-005)', () => {
    expect(AceptacionTerminos.aceptar('TERMINOS', '2026-10', '2026-10').version).toBe('2026-10');
    expect(problemaDe(() => AceptacionTerminos.aceptar('TERMINOS', '2025-01', '2026-10'))).toBe(
      'version_no_vigente',
    );
  });
});

describe('Suscripcion.iniciarPrueba', () => {
  const plan = Plan.reconstruir({
    id: 'p1',
    codigo: 'TRIAL',
    diasPrueba: 14,
    maxUsuarios: 5,
    maxBarberos: 5,
  });
  const ahora = new Date('2026-10-15T15:00:00Z');

  it('crea una suscripción TRIAL que vence a los días de prueba del plan (FR-003)', () => {
    const suscripcion = Suscripcion.iniciarPrueba('s1', 'tenant-a', plan, ahora);
    expect(suscripcion.estado).toBe('TRIAL');
    expect(suscripcion.iniciaEn).toEqual(ahora);
    expect(suscripcion.vencePruebaEn).toEqual(new Date('2026-10-29T15:00:00Z'));
  });

  it('no inicia una prueba con un plan sin días de prueba', () => {
    const sinPrueba = Plan.reconstruir({
      id: 'p2',
      codigo: 'BASICO',
      diasPrueba: null,
      maxUsuarios: 5,
      maxBarberos: 5,
    });
    expect(() => Suscripcion.iniciarPrueba('s1', 'tenant-a', sinPrueba, ahora)).toThrow();
  });
});
