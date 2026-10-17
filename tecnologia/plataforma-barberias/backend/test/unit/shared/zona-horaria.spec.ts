import { FechaInvalida, FechaLocal } from '../../../src/shared/tiempo/fecha-local';
import { ZonaHoraria } from '../../../src/shared/tiempo/zona-horaria';

// T016 · Hora local de la barbería (research R07 de 002): America/Lima es UTC−5 todo el año.

const lima = ZonaHoraria.LIMA;

describe('FechaLocal', () => {
  it('acepta fechas reales y las muestra como YYYY-MM-DD', () => {
    expect(FechaLocal.de('2026-10-20').toString()).toBe('2026-10-20');
    expect(FechaLocal.de('2028-02-29').toString()).toBe('2028-02-29');
  });

  it.each(['2026-02-30', '2026-13-01', '2026-1-5', '20-10-2026', '', '2026-10-20T10:00'])(
    'rechaza %j',
    (valor) => {
      expect(() => FechaLocal.de(valor)).toThrow(FechaInvalida);
    },
  );

  it('día de la semana: 0 = domingo … 6 = sábado', () => {
    expect(FechaLocal.de('2026-10-18').diaSemana).toBe(0); // domingo
    expect(FechaLocal.de('2026-10-19').diaSemana).toBe(1); // lunes
    expect(FechaLocal.de('2026-10-24').diaSemana).toBe(6); // sábado
  });

  it('suma días cruzando fin de mes y de año', () => {
    expect(FechaLocal.de('2026-10-31').sumarDias(1).toString()).toBe('2026-11-01');
    expect(FechaLocal.de('2026-12-31').sumarDias(1).toString()).toBe('2027-01-01');
    expect(FechaLocal.de('2027-03-01').sumarDias(-1).toString()).toBe('2027-02-28');
    expect(FechaLocal.de('2026-11-18').diasDesde(FechaLocal.de('2026-10-19'))).toBe(30);
  });
});

describe('ZonaHoraria (America/Lima)', () => {
  it('convierte la hora local en el instante UTC (−05:00)', () => {
    expect(lima.aInstante(FechaLocal.de('2026-10-20'), 10 * 60).toISOString()).toBe(
      '2026-10-20T15:00:00.000Z',
    );
  });

  it('el día local empieza a medianoche local (05:00 UTC) y es semiabierto', () => {
    const fecha = FechaLocal.de('2026-10-20');
    expect(lima.inicioDelDia(fecha).toISOString()).toBe('2026-10-20T05:00:00.000Z');
    expect(lima.finDelDia(fecha).toISOString()).toBe('2026-10-21T05:00:00.000Z');
  });

  it('un instante de madrugada UTC pertenece al día local anterior', () => {
    const momento = lima.aLocal(new Date('2026-10-21T03:30:00Z'));
    expect(momento.fecha.toString()).toBe('2026-10-20');
    expect(momento.minutos).toBe(22 * 60 + 30);
  });

  it('cortes de fin de mes y de año en hora local', () => {
    expect(lima.fechaDe(new Date('2026-11-01T04:59:59Z')).toString()).toBe('2026-10-31');
    expect(lima.fechaDe(new Date('2026-11-01T05:00:00Z')).toString()).toBe('2026-11-01');
    expect(lima.fechaDe(new Date('2027-01-01T04:00:00Z')).toString()).toBe('2026-12-31');
    expect(lima.inicioDelDia(FechaLocal.de('2027-01-01')).toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  it('ida y vuelta: aLocal(aInstante(f, m)) devuelve la misma fecha y minutos', () => {
    const fecha = FechaLocal.de('2026-12-31');
    for (const minutos of [0, 1, 9 * 60, 23 * 60 + 59]) {
      const momento = lima.aLocal(lima.aInstante(fecha, minutos));
      expect({ fecha: momento.fecha.toString(), minutos: momento.minutos }).toEqual({
        fecha: '2026-12-31',
        minutos,
      });
    }
  });

  it('el minuto 1440 es la medianoche del día siguiente', () => {
    expect(lima.aInstante(FechaLocal.de('2026-10-20'), 1440).toISOString()).toBe('2026-10-21T05:00:00.000Z');
  });

  it('formatea en ISO 8601 con el desplazamiento local para la API', () => {
    expect(lima.formatoIso(new Date('2026-10-20T15:00:00Z'))).toBe('2026-10-20T10:00:00-05:00');
    expect(lima.formatoIso(new Date('2027-01-01T04:30:00Z'))).toBe('2026-12-31T23:30:00-05:00');
  });

  it('el día de la semana es el de la fecha local', () => {
    expect(lima.diaSemana(lima.fechaDe(new Date('2026-10-19T03:00:00Z')))).toBe(0); // domingo 22:00 en Lima
  });

  it('rechaza una zona inexistente', () => {
    expect(() => new ZonaHoraria('America/Ayacucho')).toThrow(RangeError);
  });
});
