import {
  type Cobertura,
  coberturaHasta,
  decidirAprobacion,
  inicioDelProximoPeriodo,
  type Periodo,
  planVigente,
  sumarUnMes,
  tienePeriodoPorAdelantado,
} from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';

// T009 · PR25: períodos pagados (FR-003, FR-004, FR-005, FR-012a; research R04; data-model.md §3, regla de
// aprobación). Un mes calendario de Lima (sin horario de verano), ajustado al fin de mes.

const DIA = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T05:00:00Z');
const en = (dias: number) => new Date(T0 + dias * DIA);

function periodo(desde: number, hasta: number, planId = 'BASICO'): Periodo {
  return { id: `p${desde}`, pagoId: `pago${desde}`, planId, inicio: en(desde), fin: en(hasta) };
}
const cobertura = (finPrueba: number | null, ...periodos: Periodo[]): Cobertura => ({
  finPrueba: finPrueba === null ? null : en(finPrueba),
  periodos,
});

describe('PR25 · Un mes calendario, ajustado al fin de mes', () => {
  it.each([
    ['2026-01-31T05:00:00Z', '2026-02-28T05:00:00Z'],
    ['2028-01-31T05:00:00Z', '2028-02-29T05:00:00Z'],
    ['2026-03-31T15:30:00Z', '2026-04-30T15:30:00Z'],
    ['2026-01-15T10:00:00Z', '2026-02-15T10:00:00Z'],
    ['2026-12-31T05:00:00Z', '2027-01-31T05:00:00Z'],
    ['2026-10-31T23:00:00Z', '2026-11-30T23:00:00Z'],
  ])('%s → %s', (inicio, fin) => {
    expect(sumarUnMes(new Date(inicio)).toISOString()).toBe(new Date(fin).toISOString());
  });

  it('usa la fecha de Lima, no la de UTC (30 de enero a las 22:00 en Lima → 28 de febrero a las 22:00)', () => {
    // 2026-01-30 22:00 en Lima es 2026-01-31 03:00 UTC: en UTC daría el 28 de febrero a las 03:00.
    expect(sumarUnMes(new Date('2026-01-31T03:00:00Z')).toISOString()).toBe('2026-03-01T03:00:00.000Z');
  });

  it('el período dura entre 28 y 31 días (la base lo vuelve a exigir)', () => {
    for (let mes = 0; mes < 24; mes += 1) {
      const inicio = new Date(Date.UTC(2026, mes, 31, 5));
      const dias = (sumarUnMes(inicio).getTime() - inicio.getTime()) / DIA;
      expect(dias).toBeGreaterThanOrEqual(28);
      expect(dias).toBeLessThanOrEqual(31);
    }
  });
});

describe('PR25 · Inicio del período (FR-004)', () => {
  it('en prueba vigente: al terminar la prueba (no se pierden días)', () => {
    expect(inicioDelProximoPeriodo(cobertura(14), en(3))).toEqual(en(14));
  });

  it('con un período vigente: al terminar ese período', () => {
    expect(inicioDelProximoPeriodo(cobertura(14, periodo(14, 44)), en(20))).toEqual(en(44));
  });

  it('en gracia: al final del período vencido (P2: A, escenario 8 de US2)', () => {
    expect(inicioDelProximoPeriodo(cobertura(14, periodo(14, 44)), en(47))).toEqual(en(44));
  });

  it('vencida tras la gracia: al aprobarse', () => {
    expect(inicioDelProximoPeriodo(cobertura(14, periodo(14, 44)), en(60))).toEqual(en(60));
  });

  it('prueba vencida sin pago (sin gracia): al aprobarse', () => {
    expect(inicioDelProximoPeriodo(cobertura(14), en(20))).toEqual(en(20));
  });

  it('la cobertura llega hasta el fin del último período o de la prueba', () => {
    expect(coberturaHasta(cobertura(14))).toEqual(en(14));
    expect(coberturaHasta(cobertura(14, periodo(14, 44), periodo(44, 74)))).toEqual(en(74));
    expect(coberturaHasta(cobertura(null))).toBeNull();
  });
});

describe('PR25 · Como máximo un período por adelantado', () => {
  it('en prueba con un período ya pagado que empieza después: hay adelanto', () => {
    expect(tienePeriodoPorAdelantado(cobertura(14, periodo(14, 44)), en(3))).toBe(true);
  });

  it('con el siguiente período ya pagado: hay adelanto', () => {
    expect(tienePeriodoPorAdelantado(cobertura(14, periodo(14, 44), periodo(44, 74)), en(20))).toBe(true);
  });

  it('solo con el período vigente: no hay adelanto', () => {
    expect(tienePeriodoPorAdelantado(cobertura(14, periodo(14, 44)), en(20))).toBe(false);
  });
});

describe('PR25 · Regla de aprobación (período objetivo, H1)', () => {
  it('aplica el período objetivo libre a continuación de la cobertura', () => {
    expect(decidirAprobacion(cobertura(14), en(14), en(5))).toEqual({
      tipo: 'PERIODO',
      inicio: en(14),
      fin: sumarUnMes(en(14)),
    });
  });

  it('dos aprobaciones del mismo período objetivo: la segunda es DUPLICADO aunque no se solaparía', () => {
    const tomada = cobertura(14, { ...periodo(14, 14), fin: sumarUnMes(en(14)) });
    expect(decidirAprobacion(tomada, en(14), en(6))).toEqual({ tipo: 'DUPLICADO', motivo: 'PERIODO_TOMADO' });
  });

  it('un pago iniciado con la barbería vencida, aprobado después de otro: DUPLICADO', () => {
    // A se inició vencida en el día 20 (cubre desde 20); B se aprobó en el 21 y creó [21, 21+1 mes).
    const c = cobertura(14, { ...periodo(21, 21), fin: sumarUnMes(en(21)) });
    expect(decidirAprobacion(c, en(20), en(25))).toEqual({ tipo: 'DUPLICADO', motivo: 'PERIODO_TOMADO' });
  });

  it('en gracia: el período empieza al final del vencido', () => {
    expect(decidirAprobacion(cobertura(14, periodo(14, 44)), en(44), en(46))).toEqual({
      tipo: 'PERIODO',
      inicio: en(44),
      fin: sumarUnMes(en(44)),
    });
  });

  it('aprobado tras vencer: el período empieza al aprobarse', () => {
    expect(decidirAprobacion(cobertura(14, periodo(14, 44)), en(44), en(60))).toEqual({
      tipo: 'PERIODO',
      inicio: en(60),
      fin: sumarUnMes(en(60)),
    });
  });

  it('el tope de un período por adelantado se comprueba otra vez al aprobar', () => {
    // Iniciado con la prueba vigente (objetivo: día 14); al aprobarse ya hay un período que empieza el 14...
    // y otro pago que cubre desde el 44 excedería el tope.
    const c = cobertura(14, { ...periodo(14, 14), fin: sumarUnMes(en(14)) });
    expect(decidirAprobacion(c, sumarUnMes(en(14)), en(5))).toEqual({
      tipo: 'DUPLICADO',
      motivo: 'EXCEDE_ADELANTO',
    });
  });
});

describe('PR25 · Plan vigente (FR-005)', () => {
  it('es el del período que cubre el instante; en prueba, el de prueba', () => {
    const c = cobertura(14, periodo(14, 44, 'BASICO'), periodo(44, 74, 'PRO'));
    expect(planVigente(c, en(5), 'TRIAL')).toBe('TRIAL');
    expect(planVigente(c, en(20), 'TRIAL')).toBe('BASICO');
    expect(planVigente(c, en(44), 'TRIAL')).toBe('PRO');
  });

  it('sin período vigente se mantiene el último plan conocido', () => {
    const c = cobertura(14, periodo(14, 44, 'PRO'));
    expect(planVigente(c, en(47), 'TRIAL')).toBe('PRO');
  });
});
