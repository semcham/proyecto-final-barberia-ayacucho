import {
  esFechaAnteriorAlPago,
  esFechaTransferenciaValida,
  normalizarNumeroOperacion,
} from '../../../src/modules/suscripciones-pagos/pagos/domain/transferencia';
import { ZonaHoraria } from '../../../src/shared';

// Reglas de la fecha de la transferencia (US3, FR-020b): no futura y de los últimos 30 días (si no, se
// rechaza); anterior al día de inicio del pago con un día de tolerancia (se acepta con una marca). Los días son
// de la barbería: hora de Lima.

const HOY = '2026-10-28';

describe('Fecha de la transferencia (FR-020b)', () => {
  describe('válida: no futura y de los últimos 30 días', () => {
    it.each([
      ['hoy', '2026-10-28', true],
      ['ayer', '2026-10-27', true],
      ['hace exactamente 30 días', '2026-09-28', true],
      ['hace 31 días', '2026-09-27', false],
      ['mañana (futura)', '2026-10-29', false],
      ['el año próximo', '2027-10-28', false],
      ['el 31 de febrero', '2026-02-31', false],
      ['sin ceros', '2026-10-8', false],
      ['con hora', '2026-10-28T10:00', false],
      ['vacía', '', false],
    ])('%s (%s) → %s', (_caso, fecha, valida) => {
      expect(esFechaTransferenciaValida(fecha, HOY)).toBe(valida);
    });
  });

  describe('anterior al día de inicio del pago, con un día de tolerancia', () => {
    const INICIO = '2026-10-20';
    it.each([
      ['el mismo día del inicio', '2026-10-20', false],
      ['un día antes (tolerancia)', '2026-10-19', false],
      ['dos días antes', '2026-10-18', true],
      ['un mes antes', '2026-09-20', true],
      ['después del inicio', '2026-10-25', false],
      // Cambio de mes y de año.
      ['dos días antes, en el mes anterior', '2026-09-30', true],
    ])('%s (%s) → %s', (_caso, fecha, anterior) => {
      expect(esFechaAnteriorAlPago(fecha, INICIO)).toBe(anterior);
    });

    it('el día de inicio es el de Lima: un pago iniciado a las 22:00 de Lima ya es el día siguiente en UTC', () => {
      // 2026-10-28T03:00Z son las 22:00 del 27 en Lima (UTC−5): el pago se inició el 27, no el 28.
      const creadoEn = new Date('2026-10-28T03:00:00Z');
      const inicioEnLima = ZonaHoraria.LIMA.fechaDe(creadoEn).toString();
      expect(inicioEnLima).toBe('2026-10-27');
      // Con el día de Lima, el 26 está dentro de la tolerancia; con el de UTC (28) se marcaría por error.
      expect(esFechaAnteriorAlPago('2026-10-26', inicioEnLima)).toBe(false);
      expect(esFechaAnteriorAlPago('2026-10-26', creadoEn.toISOString().slice(0, 10))).toBe(true);
      expect(esFechaAnteriorAlPago('2026-10-25', inicioEnLima)).toBe(true);
    });

    it('a la misma hora de Lima antes de medianoche y después, el día de inicio cambia', () => {
      expect(ZonaHoraria.LIMA.fechaDe(new Date('2026-10-28T04:59:59Z')).toString()).toBe('2026-10-27');
      expect(ZonaHoraria.LIMA.fechaDe(new Date('2026-10-28T05:00:00Z')).toString()).toBe('2026-10-28');
    });
  });

  it('el número de operación se normaliza (letras y dígitos, en mayúsculas)', () => {
    expect(normalizarNumeroOperacion(' op-4567 89ab ')).toBe('OP456789AB');
    expect(normalizarNumeroOperacion('12-3')).toBeNull();
    expect(normalizarNumeroOperacion('OP<script>')).toBeNull();
  });
});
