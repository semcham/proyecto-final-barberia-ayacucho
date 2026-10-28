import {
  estadoPorFechas,
  reactivar,
  siguientePaso,
  suspender,
  TransicionDeSuscripcionInvalida,
} from '../../../src/modules/suscripciones-pagos/suscripciones/domain/estado-suscripcion';
import type {
  Cobertura,
  Periodo,
} from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import type { EstadoSuscripcion } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/suscripcion';

// T008 · PR25: máquina de estados de la suscripción (data-model.md §2, research R12; FR-029 a FR-035).
// Las transiciones automáticas avanzan de a un paso por la línea de tiempo, con la fecha que les
// correspondía (FR-031); las manuales (suspender y reactivar) son del administrador.

const DIA = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T05:00:00Z');
const en = (dias: number) => new Date(T0 + dias * DIA);
const PRUEBA = 'plan-prueba';
const BASICO = 'plan-basico';
const PRO = 'plan-pro';

function periodo(desde: number, hasta: number, planId = BASICO): Periodo {
  return { id: `p${desde}`, pagoId: `pago${desde}`, planId, inicio: en(desde), fin: en(hasta) };
}

function cobertura(finPrueba: number | null, ...periodos: Periodo[]): Cobertura {
  return { finPrueba: finPrueba === null ? null : en(finPrueba), periodos };
}

describe('PR25 · Estado por fechas', () => {
  it.each([
    ['prueba vigente', cobertura(14), 5, 'TRIAL'],
    ['prueba vencida sin pago (sin gracia)', cobertura(14), 14, 'EXPIRED'],
    ['pago durante la prueba: sigue en TRIAL hasta que termina', cobertura(14, periodo(14, 44)), 10, 'TRIAL'],
    ['al terminar la prueba con un período que empieza', cobertura(14, periodo(14, 44)), 14, 'ACTIVE'],
    ['período vigente', cobertura(14, periodo(14, 44)), 30, 'ACTIVE'],
    ['período terminado: gracia de 7 días', cobertura(14, periodo(14, 44)), 44, 'PAST_DUE'],
    ['último instante de la gracia', cobertura(14, periodo(14, 44)), 50.999, 'PAST_DUE'],
    ['gracia terminada', cobertura(14, periodo(14, 44)), 51, 'EXPIRED'],
    [
      'pago en gracia: el período empieza al final del vencido',
      cobertura(14, periodo(14, 44), periodo(44, 74)),
      46,
      'ACTIVE',
    ],
    [
      'pago tras vencer: período desde la aprobación',
      cobertura(14, periodo(14, 44), periodo(60, 90)),
      61,
      'ACTIVE',
    ],
  ] as const)('%s → %s', (_caso, c, dia, esperado) => {
    expect(estadoPorFechas(c, en(dia))).toBe(esperado);
  });
});

describe('PR25 · Transiciones automáticas (un paso a la vez, con la fecha que correspondía)', () => {
  function paso(actual: EstadoSuscripcion, c: Cobertura, dia: number, planActual = PRUEBA) {
    return siguientePaso({ estado: actual, planId: planActual, cobertura: c }, en(dia));
  }

  it('TRIAL → EXPIRED al terminar la prueba sin pago, con la fecha de fin de la prueba', () => {
    expect(paso('TRIAL', cobertura(14), 14.5)).toEqual({
      desde: 'TRIAL',
      hacia: 'EXPIRED',
      fecha: en(14),
      planId: null,
      graciaHasta: null,
    });
  });

  it('TRIAL → ACTIVE al terminar la prueba con un período pagado, aplicando su plan', () => {
    expect(paso('TRIAL', cobertura(14, periodo(14, 44, PRO)), 14.1)).toEqual({
      desde: 'TRIAL',
      hacia: 'ACTIVE',
      fecha: en(14),
      planId: PRO,
      graciaHasta: null,
    });
  });

  it('TRIAL sigue en TRIAL con un pago aprobado durante la prueba', () => {
    expect(paso('TRIAL', cobertura(14, periodo(14, 44)), 3)).toBeNull();
  });

  it('ACTIVE → PAST_DUE al terminar el período sin el siguiente, con 7 días de gracia', () => {
    expect(paso('ACTIVE', cobertura(14, periodo(14, 44)), 45, BASICO)).toEqual({
      desde: 'ACTIVE',
      hacia: 'PAST_DUE',
      fecha: en(44),
      planId: null,
      graciaHasta: en(51),
    });
  });

  it('ACTIVE → ACTIVE al empezar un período ya pagado de otro plan (cambia el plan)', () => {
    expect(
      paso('ACTIVE', cobertura(14, periodo(14, 44, BASICO), periodo(44, 74, PRO)), 44.2, BASICO),
    ).toEqual({
      desde: 'ACTIVE',
      hacia: 'ACTIVE',
      fecha: en(44),
      planId: PRO,
      graciaHasta: null,
    });
  });

  it('ACTIVE con el período siguiente del mismo plan: sin transición', () => {
    expect(paso('ACTIVE', cobertura(14, periodo(14, 44), periodo(44, 74)), 50, BASICO)).toBeNull();
  });

  it('PAST_DUE → EXPIRED al terminar la gracia, con la fecha de fin de la gracia', () => {
    expect(paso('PAST_DUE', cobertura(14, periodo(14, 44)), 52, BASICO)).toEqual({
      desde: 'PAST_DUE',
      hacia: 'EXPIRED',
      fecha: en(51),
      planId: null,
      graciaHasta: null,
    });
  });

  it('PAST_DUE → ACTIVE con el pago aprobado en la gracia (período desde el final del vencido)', () => {
    expect(paso('PAST_DUE', cobertura(14, periodo(14, 44), periodo(44, 74, PRO)), 47, BASICO)).toEqual({
      desde: 'PAST_DUE',
      hacia: 'ACTIVE',
      fecha: en(47),
      planId: PRO,
      graciaHasta: null,
    });
  });

  it('EXPIRED → ACTIVE con un pago aprobado tras vencer', () => {
    expect(paso('EXPIRED', cobertura(14, periodo(60, 90)), 60.5)).toEqual({
      desde: 'EXPIRED',
      hacia: 'ACTIVE',
      fecha: en(60.5),
      planId: BASICO,
      graciaHasta: null,
    });
  });

  it('sin nada que cambiar no hay paso (una transición repetida no hace nada, FR-032)', () => {
    expect(paso('EXPIRED', cobertura(14), 40)).toBeNull();
    expect(paso('PAST_DUE', cobertura(14, periodo(14, 44)), 46, BASICO)).toBeNull();
    expect(paso('ACTIVE', cobertura(14, periodo(14, 44)), 20, BASICO)).toBeNull();
  });

  it('con la tarea detenida mucho tiempo, avanza de a un paso hasta el estado por fechas', () => {
    const c = cobertura(14, periodo(14, 44));
    const pasos: string[] = [];
    let estado: EstadoSuscripcion = 'TRIAL';
    let planId = PRUEBA;
    for (let i = 0; i < 5; i += 1) {
      const siguiente = siguientePaso({ estado, planId, cobertura: c }, en(90));
      if (!siguiente) break;
      pasos.push(`${siguiente.desde}→${siguiente.hacia}@${(siguiente.fecha.getTime() - T0) / DIA}`);
      estado = siguiente.hacia;
      planId = siguiente.planId ?? planId;
    }
    expect(pasos).toEqual(['TRIAL→ACTIVE@14', 'ACTIVE→PAST_DUE@44', 'PAST_DUE→EXPIRED@51']);
    expect(estado).toBe(estadoPorFechas(c, en(90)));
  });

  it.each(['SUSPENDED', 'CANCELLED'] as const)('%s: ninguna transición automática', (estado) => {
    expect(paso(estado, cobertura(14), 40)).toBeNull();
    expect(paso(estado, cobertura(14, periodo(14, 44)), 20)).toBeNull();
  });
});

describe('PR25 · Suspensión y reactivación (administrador, FR-035)', () => {
  it.each(['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED'] as const)('%s → SUSPENDED', (estado) => {
    expect(suspender(estado)).toBe('SUSPENDED');
  });

  it.each(['SUSPENDED', 'CANCELLED'] as const)('suspender desde %s es inválido', (estado) => {
    expect(() => suspender(estado)).toThrow(TransicionDeSuscripcionInvalida);
  });

  it.each([
    ['en prueba', cobertura(14), 5, 'TRIAL', null, null],
    ['activa (el período siguió corriendo)', cobertura(14, periodo(14, 44)), 30, 'ACTIVE', BASICO, null],
    ['en gracia', cobertura(14, periodo(14, 44)), 46, 'PAST_DUE', null, en(51)],
    [
      'vencida (los días suspendidos no se devuelven)',
      cobertura(14, periodo(14, 44)),
      60,
      'EXPIRED',
      null,
      null,
    ],
  ] as const)('reactivar recalcula por fechas: %s', (_caso, c, dia, estado, planId, graciaHasta) => {
    expect(reactivar('SUSPENDED', c, en(dia))).toEqual({ estado, planId, graciaHasta });
  });

  it.each(['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED'] as const)(
    'reactivar desde %s es inválido',
    (estado) => {
      expect(() => reactivar(estado, cobertura(14), en(1))).toThrow(TransicionDeSuscripcionInvalida);
    },
  );
});
