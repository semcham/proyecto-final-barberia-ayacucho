import {
  evaluarLimiteDeEnlace,
  LIMITES_DE_ENLACES,
  type TipoIntentoEnlace,
} from '../../../src/modules/acceso-barberias/identidad/domain/limite-enlaces';

// T029 de 010 · Límites de los enlaces de cuenta (research R08): reenvío 3/h por cuenta y 20/h por origen;
// recuperación 3/h y 10/h; usos fallidos 20/h por origen. Por encima, cuántos segundos esperar.

const MIN = 60 * 1000;
const AHORA = new Date('2026-11-23T15:00:00Z');
const hace = (ms: number) => new Date(AHORA.getTime() - ms);
/** `n` intentos, uno por minuto, el más reciente hace 1 min. */
const intentos = (n: number) => Array.from({ length: n }, (_, i) => hace((n - i) * MIN));

describe('Límites de los enlaces de cuenta', () => {
  it('los valores por defecto son los de research R08', () => {
    expect(LIMITES_DE_ENLACES).toEqual({
      REENVIO: { porCuenta: 3, porOrigen: 20 },
      RECUPERACION: { porCuenta: 3, porOrigen: 10 },
      USO_FALLIDO: { porCuenta: null, porOrigen: 20 },
    });
  });

  it.each<[TipoIntentoEnlace, number]>([
    ['REENVIO', 3],
    ['RECUPERACION', 3],
  ])('%s: permite hasta %i por cuenta en una hora y rechaza el siguiente', (tipo, maximo) => {
    expect(evaluarLimiteDeEnlace(tipo, { porCuenta: intentos(maximo - 1), porOrigen: [] }, AHORA)).toEqual({
      permitido: true,
    });
    const decision = evaluarLimiteDeEnlace(tipo, { porCuenta: intentos(maximo), porOrigen: [] }, AHORA);
    expect(decision.permitido).toBe(false);
  });

  it.each<[TipoIntentoEnlace, number]>([
    ['REENVIO', 20],
    ['RECUPERACION', 10],
    ['USO_FALLIDO', 20],
  ])(
    '%s: permite hasta %i por origen en una hora (con cuentas distintas) y rechaza el siguiente',
    (tipo, maximo) => {
      expect(
        evaluarLimiteDeEnlace(tipo, { porCuenta: [], porOrigen: intentos(maximo - 1) }, AHORA).permitido,
      ).toBe(true);
      expect(
        evaluarLimiteDeEnlace(tipo, { porCuenta: [], porOrigen: intentos(maximo) }, AHORA).permitido,
      ).toBe(false);
    },
  );

  it('USO_FALLIDO no tiene límite por cuenta', () => {
    expect(evaluarLimiteDeEnlace('USO_FALLIDO', { porCuenta: intentos(50), porOrigen: [] }, AHORA)).toEqual({
      permitido: true,
    });
  });

  it('los intentos de hace más de una hora no cuentan', () => {
    const viejos = [hace(61 * MIN), hace(70 * MIN), hace(90 * MIN)];
    expect(evaluarLimiteDeEnlace('REENVIO', { porCuenta: viejos, porOrigen: [] }, AHORA).permitido).toBe(
      true,
    );
  });

  it('reintentarEnSegundos: hasta que el intento más viejo de la ventana salga de ella', () => {
    // 3 reenvíos, hace 40, 20 y 10 min: hay lugar cuando el de hace 40 min cumpla la hora, en 20 min.
    const decision = evaluarLimiteDeEnlace(
      'REENVIO',
      { porCuenta: [hace(40 * MIN), hace(20 * MIN), hace(10 * MIN)], porOrigen: [] },
      AHORA,
    );
    expect(decision).toEqual({ permitido: false, reintentarEnSegundos: 20 * 60 });
  });

  it('con más intentos que el máximo, espera al que deja lugar para uno más', () => {
    // 5 por cuenta con máximo 3: hay que esperar a que salga el tercero más viejo (hace 30 min → en 30 min).
    const decision = evaluarLimiteDeEnlace(
      'RECUPERACION',
      {
        porCuenta: [hace(50 * MIN), hace(40 * MIN), hace(30 * MIN), hace(20 * MIN), hace(10 * MIN)],
        porOrigen: [],
      },
      AHORA,
    );
    expect(decision).toEqual({ permitido: false, reintentarEnSegundos: 30 * 60 });
  });

  it('si fallan los dos límites, se espera el mayor', () => {
    const decision = evaluarLimiteDeEnlace(
      'RECUPERACION',
      { porCuenta: [hace(55 * MIN), hace(2 * MIN), hace(1 * MIN)], porOrigen: intentos(10) },
      AHORA,
    );
    // Cuenta: el de hace 55 min sale en 5 min. Origen: 10 intentos (el más viejo hace 10 min) → en 50 min.
    expect(decision).toEqual({ permitido: false, reintentarEnSegundos: 50 * 60 });
  });

  it('reintentarEnSegundos es al menos 1', () => {
    const decision = evaluarLimiteDeEnlace(
      'REENVIO',
      { porCuenta: [hace(60 * MIN - 100), hace(MIN), hace(MIN)], porOrigen: [] },
      AHORA,
    );
    expect(decision).toEqual({ permitido: false, reintentarEnSegundos: 1 });
  });
});
