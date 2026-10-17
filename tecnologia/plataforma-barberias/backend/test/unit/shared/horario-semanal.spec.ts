import { HorarioInvalido, HorarioSemanal, type Tramo } from '../../../src/shared/tiempo/horario-semanal';

// T016 · Horario semanal en tramos (FR-002, FR-013 de 002).

const h = (hora: string) => HorarioSemanal.minutosDe(hora);
const tramo = (diaSemana: number, inicio: string, fin: string): Tramo => ({
  diaSemana,
  inicioMin: h(inicio),
  finMin: h(fin),
});

function problemaDe(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof HorarioInvalido) return error.detalles[0].problema as string;
    throw error;
  }
  return undefined;
}

describe('HorarioSemanal', () => {
  it('acepta tramos válidos y contiguos (09:00–13:00 y 13:00–19:00)', () => {
    const horario = HorarioSemanal.crear([tramo(1, '13:00', '19:00'), tramo(1, '09:00', '13:00')]);
    expect(horario.tramosDe(1).map((t) => t.inicioMin)).toEqual([h('09:00'), h('13:00')]);
  });

  it('rechaza inicio mayor o igual que fin', () => {
    expect(problemaDe(() => HorarioSemanal.crear([tramo(2, '19:00', '09:00')]))).toBe(
      'inicio_no_menor_que_fin',
    );
    expect(problemaDe(() => HorarioSemanal.crear([tramo(2, '09:00', '09:00')]))).toBe(
      'inicio_no_menor_que_fin',
    );
  });

  it('rechaza tramos que se solapan en el mismo día, indicando el día', () => {
    expect(
      problemaDe(() => HorarioSemanal.crear([tramo(3, '09:00', '13:00'), tramo(3, '12:00', '18:00')])),
    ).toBe('solape');
  });

  it('el mismo rango en días distintos no es solape', () => {
    expect(() =>
      HorarioSemanal.crear([tramo(1, '09:00', '18:00'), tramo(2, '09:00', '18:00')]),
    ).not.toThrow();
  });

  it.each([
    [{ diaSemana: 7, inicioMin: 0, finMin: 60 }, 'dia'],
    [{ diaSemana: -1, inicioMin: 0, finMin: 60 }, 'dia'],
    [{ diaSemana: 1, inicioMin: -5, finMin: 60 }, 'rango'],
    [{ diaSemana: 1, inicioMin: 60, finMin: 1441 }, 'rango'],
    [{ diaSemana: 1, inicioMin: 1.5, finMin: 60 }, 'rango'],
  ])('rechaza %j (%s)', (t, problema) => {
    expect(problemaDe(() => HorarioSemanal.crear([t]))).toBe(problema);
  });

  it('convierte horas de PostgreSQL (HH:MM:SS) a minutos y de vuelta', () => {
    expect(HorarioSemanal.minutosDe('09:30:00')).toBe(570);
    expect(HorarioSemanal.horaDe(570)).toBe('09:30');
    expect(() => HorarioSemanal.minutosDe('9:30')).toThrow(HorarioInvalido);
  });

  it('contiene: la disponibilidad debe caber dentro del horario de atención (FR-013)', () => {
    const atencion = HorarioSemanal.crear([tramo(1, '09:00', '19:00'), tramo(2, '09:00', '13:00')]);
    expect(atencion.contiene(HorarioSemanal.crear([tramo(1, '10:00', '18:00')]))).toBe(true);
    expect(atencion.contiene(HorarioSemanal.crear([tramo(1, '08:00', '10:00')]))).toBe(false);
    expect(atencion.contiene(HorarioSemanal.crear([tramo(2, '12:00', '14:00')]))).toBe(false);
    // Un día cerrado en la atención no admite disponibilidad.
    expect(atencion.contiene(HorarioSemanal.crear([tramo(0, '10:00', '12:00')]))).toBe(false);
    expect(atencion.contiene(HorarioSemanal.vacio())).toBe(true);
  });

  it('interseccion: minutos en que ambos horarios están abiertos ese día', () => {
    const atencion = HorarioSemanal.crear([tramo(1, '09:00', '19:00')]);
    const barbero = HorarioSemanal.crear([tramo(1, '08:00', '13:00'), tramo(1, '14:00', '20:00')]);
    expect(atencion.interseccion(barbero, 1)).toEqual([
      tramo(1, '09:00', '13:00'),
      tramo(1, '14:00', '19:00'),
    ]);
    expect(atencion.interseccion(barbero, 2)).toEqual([]);
  });
});
