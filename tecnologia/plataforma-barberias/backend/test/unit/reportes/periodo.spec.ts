import { ESTADO_POR_CODIGO } from '../../../src/host/error.filter';
import {
  MAXIMO_DIAS_DEL_PERIODO,
  Periodo,
  PeriodoInvalido,
} from '../../../src/modules/asistente-reportes/reportes/domain/periodo';
import { ZonaHoraria } from '../../../src/shared';

// T014 de 005 · FR-020 y data-model §4: el período de los reportes son dos fechas LOCALES de la barbería, ambas
// incluidas, de hasta 366 días. Un período inválido se rechaza con 422 VALIDACION y el campo a corregir. Las cuentas
// usan el rango semiabierto [inicio del día `desde`, inicio del día siguiente a `hasta`) en la zona de la barbería.

const LIMA = new ZonaHoraria('America/Lima');
const inicioEnLima = (fecha: Parameters<ZonaHoraria['inicioDelDia']>[0]) => LIMA.inicioDelDia(fecha);

function errorDe(fn: () => unknown): PeriodoInvalido {
  try {
    fn();
  } catch (error) {
    if (error instanceof PeriodoInvalido) return error;
    throw error;
  }
  throw new Error('Se esperaba PeriodoInvalido');
}

describe('Periodo de los reportes (T014 de 005)', () => {
  it('desde y hasta son fechas locales incluidas: un solo día vale', () => {
    const periodo = Periodo.crear('2026-11-14', '2026-11-14');
    expect(periodo.desde.toString()).toBe('2026-11-14');
    expect(periodo.hasta.toString()).toBe('2026-11-14');
    expect(periodo.dias).toBe(1);
  });

  it(`acepta hasta ${MAXIMO_DIAS_DEL_PERIODO} días (un año bisiesto completo) y rechaza 367`, () => {
    expect(MAXIMO_DIAS_DEL_PERIODO).toBe(366);
    expect(Periodo.crear('2028-01-01', '2028-12-31').dias).toBe(366);
    const error = errorDe(() => Periodo.crear('2026-01-01', '2027-01-02'));
    expect(error.detalles).toEqual([{ campo: 'hasta', problema: 'maximo_366_dias' }]);
    expect(error.message).toMatch(/366 días/);
  });

  it('desde posterior a hasta se rechaza en el campo desde, con un mensaje claro', () => {
    const error = errorDe(() => Periodo.crear('2026-11-15', '2026-11-14'));
    expect(error.detalles).toEqual([{ campo: 'desde', problema: 'posterior_a_hasta' }]);
    expect(error.message).toMatch(/inicio/i);
  });

  it.each([
    ['desde', undefined, '2026-11-14', 'obligatorio'],
    ['hasta', '2026-11-01', undefined, 'obligatorio'],
    ['desde', '', '2026-11-14', 'obligatorio'],
    ['desde', '14/11/2026', '2026-11-14', 'formato'],
    ['hasta', '2026-11-01', '2026-02-30', 'formato'],
    ['hasta', '2026-11-01', '2026-13-45', 'formato'],
    ['desde', '2026-11-01T00:00:00Z', '2026-11-14', 'formato'],
  ])('%s inválido (%j, %j) → %s', (campo, desde, hasta, problema) => {
    const error = errorDe(() => Periodo.crear(desde, hasta));
    expect(error.detalles).toEqual([{ campo, problema }]);
    expect(error.message.length).toBeGreaterThan(10);
  });

  it('es 422 VALIDACION, como dice el contrato de GET /reportes', () => {
    const error = errorDe(() => Periodo.crear(undefined, undefined));
    expect(error.codigo).toBe('VALIDACION');
    expect(error.estadoHttp).toBe(422);
    // El código general VALIDACION sigue siendo 400 para el resto de las rutas: el 422 es propio de este error.
    expect(ESTADO_POR_CODIGO.VALIDACION).toBe(400);
  });

  describe('conversión a instantes en America/Lima (UTC−5)', () => {
    it('desde el inicio del día desde hasta el inicio del día siguiente a hasta', () => {
      expect(Periodo.crear('2026-11-01', '2026-11-30').rango(inicioEnLima)).toEqual({
        inicio: new Date('2026-11-01T05:00:00.000Z'),
        fin: new Date('2026-12-01T05:00:00.000Z'),
      });
    });

    it('un solo día cubre exactamente 24 horas locales', () => {
      const { inicio, fin } = Periodo.crear('2026-11-14', '2026-11-14').rango(inicioEnLima);
      expect(fin.getTime() - inicio.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('las 00:00 y las 23:59 de Lima del último día entran; las 00:00 del día siguiente, no', () => {
      const { inicio, fin } = Periodo.crear('2026-11-01', '2026-11-30').rango(inicioEnLima);
      const dentro = (instante: string) => {
        const t = new Date(instante).getTime();
        return t >= inicio.getTime() && t < fin.getTime();
      };
      expect(dentro('2026-11-01T00:00:00-05:00')).toBe(true);
      expect(dentro('2026-11-30T23:59:00-05:00')).toBe(true);
      expect(dentro('2026-12-01T00:00:00-05:00')).toBe(false);
      expect(dentro('2026-10-31T23:59:59-05:00')).toBe(false);
    });
  });
});
