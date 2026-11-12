import { SinTiempoParaAdelanto } from '../../../src/modules/suscripciones-pagos/adelantos/domain/errores';
import { PoliticaAdelanto } from '../../../src/modules/suscripciones-pagos/adelantos/domain/politica-adelanto';

// T001 de 008 · Monto, hora límite y límite máximo adicional del adelanto (research R04; FR-006, FR-007,
// FR-018; aclaración Q1). Reglas puras, en céntimos enteros.

const MIN = 60_000;
const HORA = 60 * MIN;
const reserva = new Date('2026-11-20T10:00:00-05:00');
const despues = (ms: number) => new Date(reserva.getTime() + ms);

describe('PoliticaAdelanto · monto (R04, FR-006)', () => {
  it('monto fijo: el configurado', () => {
    expect(PoliticaAdelanto.monto({ tipo: 'FIJO', montoCentimos: 1000 }, 3000)).toBe(1000);
  });

  it('monto fijo nunca mayor que el precio del servicio', () => {
    expect(PoliticaAdelanto.monto({ tipo: 'FIJO', montoCentimos: 5000 }, 3000)).toBe(3000);
  });

  it.each([
    [20, 3000, 600],
    [15, 2550, 383], // 382,5 → 383 (mitad hacia arriba)
    [10, 1005, 101], // 100,5 → 101
    [33, 1000, 330],
    [100, 4500, 4500],
  ])(
    'porcentaje %i%% de %i céntimos → %i (redondeado al céntimo, mitad hacia arriba)',
    (porcentaje, precio, esperado) => {
      expect(PoliticaAdelanto.monto({ tipo: 'PORCENTAJE', porcentaje }, precio)).toBe(esperado);
    },
  );

  it('el porcentaje nunca supera el precio', () => {
    expect(PoliticaAdelanto.monto({ tipo: 'PORCENTAJE', porcentaje: 100 }, 1999)).toBe(1999);
  });

  it('precio cero → sin adelanto (null), con cualquier tipo', () => {
    expect(PoliticaAdelanto.monto({ tipo: 'FIJO', montoCentimos: 1000 }, 0)).toBeNull();
    expect(PoliticaAdelanto.monto({ tipo: 'PORCENTAJE', porcentaje: 50 }, 0)).toBeNull();
  });

  it('un porcentaje que redondea a cero céntimos → sin adelanto (null)', () => {
    expect(PoliticaAdelanto.monto({ tipo: 'PORCENTAJE', porcentaje: 1 }, 49)).toBeNull();
    expect(PoliticaAdelanto.monto({ tipo: 'PORCENTAJE', porcentaje: 1 }, 50)).toBe(1);
  });

  it('el resultado es siempre un entero de céntimos', () => {
    for (let precio = 1; precio <= 500; precio += 7) {
      for (const porcentaje of [1, 7, 33, 50, 99]) {
        const monto = PoliticaAdelanto.monto({ tipo: 'PORCENTAJE', porcentaje }, precio);
        if (monto !== null) expect(Number.isInteger(monto)).toBe(true);
      }
    }
  });
});

describe('PoliticaAdelanto · hora límite (R04, FR-007)', () => {
  it('con tiempo de sobra: la reserva más el plazo', () => {
    const inicio = despues(2 * 24 * HORA);
    expect(PoliticaAdelanto.horaLimite(reserva, inicio, 30)).toEqual(despues(30 * MIN));
  });

  it('si el plazo pasa de inicio − 30 min, la hora límite es inicio − 30 min', () => {
    const inicio = despues(90 * MIN);
    expect(PoliticaAdelanto.horaLimite(reserva, inicio, 120)).toEqual(despues(60 * MIN));
  });

  it('justo en el borde: reserva + plazo = inicio − 30 min', () => {
    const inicio = despues(90 * MIN);
    expect(PoliticaAdelanto.horaLimite(reserva, inicio, 60)).toEqual(despues(60 * MIN));
  });

  it.each([
    ['el inicio está a 30 min exactos', 30 * MIN],
    ['el inicio está a 20 min', 20 * MIN],
    ['el inicio ya pasó', -10 * MIN],
  ])('SIN_TIEMPO_PARA_ADELANTO si %s (la hora límite no queda después de la reserva)', (_caso, ms) => {
    const intento = () => PoliticaAdelanto.horaLimite(reserva, despues(ms), 30);
    expect(intento).toThrow(SinTiempoParaAdelanto);
    try {
      intento();
    } catch (error) {
      expect((error as SinTiempoParaAdelanto).codigo).toBe('SIN_TIEMPO_PARA_ADELANTO');
    }
  });

  it('con 31 min hasta el inicio queda 1 min para pagar', () => {
    expect(PoliticaAdelanto.horaLimite(reserva, despues(31 * MIN), 30)).toEqual(despues(1 * MIN));
  });
});

describe('PoliticaAdelanto · límite máximo adicional (R04, FR-018, aclaración Q1)', () => {
  it('lejos del inicio: la hora límite + 24 h', () => {
    const horaLimite = despues(30 * MIN);
    const inicio = despues(5 * 24 * HORA);
    expect(PoliticaAdelanto.limiteRevision(horaLimite, inicio)).toEqual(despues(30 * MIN + 24 * HORA));
  });

  it('cerca del inicio: inicio − 2 h', () => {
    const horaLimite = despues(30 * MIN);
    const inicio = despues(10 * HORA);
    expect(PoliticaAdelanto.limiteRevision(horaLimite, inicio)).toEqual(despues(8 * HORA));
  });

  it('si inicio − 2 h queda antes de la hora límite, el límite es el inicio', () => {
    const horaLimite = despues(30 * MIN);
    const inicio = despues(90 * MIN);
    expect(PoliticaAdelanto.limiteRevision(horaLimite, inicio)).toEqual(inicio);
  });

  it('si inicio − 2 h coincide con la hora límite, se queda en la hora límite', () => {
    const horaLimite = despues(60 * MIN);
    const inicio = despues(3 * HORA);
    expect(PoliticaAdelanto.limiteRevision(horaLimite, inicio)).toEqual(horaLimite);
  });

  it('el límite nunca queda antes de la hora límite (CHECK review_limit_at >= due_at)', () => {
    for (const minutosHastaInicio of [31, 45, 60, 119, 120, 121, 150, 600, 3000]) {
      const inicio = despues(minutosHastaInicio * MIN);
      const horaLimite = PoliticaAdelanto.horaLimite(reserva, inicio, 30);
      const limite = PoliticaAdelanto.limiteRevision(horaLimite, inicio);
      expect(limite.getTime()).toBeGreaterThanOrEqual(horaLimite.getTime());
      expect(limite.getTime()).toBeLessThanOrEqual(inicio.getTime());
    }
  });
});

describe('PoliticaAdelanto · calcular (todo junto, al reservar)', () => {
  const regla = { tipo: 'PORCENTAJE' as const, porcentaje: 20, plazoMinutos: 30 };

  it('devuelve el monto, la hora límite y el límite máximo adicional', () => {
    const inicio = despues(2 * 24 * HORA);
    expect(PoliticaAdelanto.calcular(regla, { precioCentimos: 3000, reservadaEn: reserva, inicio })).toEqual({
      montoCentimos: 600,
      horaLimite: despues(30 * MIN),
      limiteRevision: despues(30 * MIN + 24 * HORA),
    });
  });

  it('precio cero → null, aunque no quede tiempo (no se pide adelanto)', () => {
    expect(
      PoliticaAdelanto.calcular(regla, {
        precioCentimos: 0,
        reservadaEn: reserva,
        inicio: despues(10 * MIN),
      }),
    ).toBeNull();
  });

  it('sin tiempo para pagar → SIN_TIEMPO_PARA_ADELANTO', () => {
    expect(() =>
      PoliticaAdelanto.calcular(regla, {
        precioCentimos: 3000,
        reservadaEn: reserva,
        inicio: despues(25 * MIN),
      }),
    ).toThrow(SinTiempoParaAdelanto);
  });
});
