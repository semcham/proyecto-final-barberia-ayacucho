import {
  type BarberoParaCalculo,
  calcularHorariosLibres,
  type EntradaCalculoHorarios,
} from '../../../src/modules/catalogo-citas/catalogo/domain/calculadora-horarios';

// T063 · CalculadoraHorarios (research R08): función pura, sin base de datos ni zonas horarias. Trabaja con
// minutos locales del día consultado.

const h = (hora: string): number => {
  const [hh, mm] = hora.split(':').map(Number);
  return hh * 60 + mm;
};
const tramo = (inicio: string, fin: string) => ({ inicioMin: h(inicio), finMin: h(fin) });

function barbero(id: string, cambios: Partial<BarberoParaCalculo> = {}): BarberoParaCalculo {
  return {
    barberoId: id,
    activo: true,
    ofreceServicio: true,
    disponibilidad: [tramo('09:00', '12:00')],
    ocupado: [],
    ...cambios,
  };
}

function entrada(cambios: Partial<EntradaCalculoHorarios> = {}): EntradaCalculoHorarios {
  return {
    atencion: [tramo('09:00', '19:00')],
    barberos: [barbero('luis')],
    duracionMin: 30,
    pasoMin: 15,
    diasDesdeHoy: 1,
    ahoraMin: h('08:00'),
    horizonteDias: 30,
    ...cambios,
  };
}

/** Horas de inicio como 'HH:MM' para comparar fácil. */
const horas = (e: EntradaCalculoHorarios): string[] =>
  calcularHorariosLibres(e).map(
    (libre) =>
      `${String(Math.floor(libre.inicioMin / 60)).padStart(2, '0')}:${String(libre.inicioMin % 60).padStart(2, '0')}`,
  );

describe('CalculadoraHorarios', () => {
  it('ofrece inicios cada 15 minutos donde el servicio cabe entero en la disponibilidad', () => {
    expect(horas(entrada())).toEqual([
      '09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45',
      '11:00', '11:15', '11:30',
    ]); // prettier-ignore
  });

  it('usa la intersección de la disponibilidad del barbero con el horario de atención', () => {
    const resultado = horas(
      entrada({
        atencion: [tramo('10:00', '19:00')],
        barberos: [barbero('luis', { disponibilidad: [tramo('09:00', '11:00')] })],
      }),
    );
    expect(resultado).toEqual(['10:00', '10:15', '10:30']);
  });

  it('resta los bloqueos y las citas activas; las citas canceladas o completadas no restan', () => {
    const resultado = horas(
      entrada({
        barberos: [
          barbero('luis', {
            disponibilidad: [tramo('09:00', '11:00')],
            ocupado: [
              { ...tramo('09:00', '09:30') }, // bloqueo
              { ...tramo('10:00', '10:30'), estadoCita: 'CONFIRMADA' },
              { ...tramo('09:30', '10:00'), estadoCita: 'CANCELADA' },
              { ...tramo('10:30', '11:00'), estadoCita: 'COMPLETADA' },
            ],
          }),
        ],
      }),
    );
    expect(resultado).toEqual(['09:30', '10:30']);
  });

  it('el servicio debe caber entero: un hueco de 20 minutos no sirve para uno de 30', () => {
    const resultado = horas(
      entrada({
        barberos: [
          barbero('luis', {
            disponibilidad: [tramo('09:00', '10:00')],
            ocupado: [{ ...tramo('09:20', '10:00'), estadoCita: 'PENDIENTE' }],
          }),
        ],
      }),
    );
    expect(resultado).toEqual([]);
  });

  it('los inicios se alinean a múltiplos del paso desde la medianoche local, aunque el tramo empiece a deshora', () => {
    const resultado = horas(
      entrada({ barberos: [barbero('luis', { disponibilidad: [tramo('09:10', '10:10')] })] }),
    );
    expect(resultado).toEqual(['09:15', '09:30']);
    expect(
      horas(
        entrada({ pasoMin: 30, barberos: [barbero('luis', { disponibilidad: [tramo('09:00', '10:30')] })] }),
      ),
    ).toEqual(['09:00', '09:30', '10:00']);
  });

  it('hoy excluye las horas que ya pasaron o empiezan justo ahora', () => {
    expect(horas(entrada({ diasDesdeHoy: 0, ahoraMin: h('10:00') }))).toEqual([
      '10:15', '10:30', '10:45', '11:00', '11:15', '11:30',
    ]); // prettier-ignore
  });

  it('una fecha pasada o fuera del horizonte no tiene horarios; el último día del horizonte sí', () => {
    expect(horas(entrada({ diasDesdeHoy: -1 }))).toEqual([]);
    expect(horas(entrada({ diasDesdeHoy: 31 }))).toEqual([]);
    expect(horas(entrada({ diasDesdeHoy: 30 }))).not.toEqual([]);
  });

  it('con "cualquier barbero" lista por hora los barberos libres, en el orden recibido', () => {
    const libres = calcularHorariosLibres(
      entrada({
        barberos: [
          barbero('luis', { disponibilidad: [tramo('09:00', '10:00')] }),
          barbero('ana', {
            disponibilidad: [tramo('09:00', '10:00')],
            ocupado: [{ ...tramo('09:00', '09:30'), estadoCita: 'CONFIRMADA' }],
          }),
        ],
      }),
    );
    expect(libres).toEqual([
      { inicioMin: h('09:00'), barberoIds: ['luis'] },
      { inicioMin: h('09:15'), barberoIds: ['luis'] },
      { inicioMin: h('09:30'), barberoIds: ['luis', 'ana'] },
    ]);
  });

  it('con un barbero pedido, solo cuenta ese barbero', () => {
    const libres = calcularHorariosLibres(
      entrada({
        barberoId: 'ana',
        barberos: [barbero('luis'), barbero('ana', { disponibilidad: [tramo('11:00', '12:00')] })],
      }),
    );
    expect(libres.map((l) => l.barberoIds)).toEqual([['ana'], ['ana'], ['ana']]);
  });

  it('excluye al barbero inactivo y al que no ofrece el servicio', () => {
    expect(horas(entrada({ barberos: [barbero('luis', { activo: false })] }))).toEqual([]);
    expect(horas(entrada({ barberos: [barbero('luis', { ofreceServicio: false })] }))).toEqual([]);
  });

  it('un día sin horario de atención (cerrado) no tiene horarios', () => {
    expect(horas(entrada({ atencion: [] }))).toEqual([]);
  });

  it('una ocupación que empieza antes del día o termina después se recorta sin fallar', () => {
    const resultado = horas(
      entrada({
        barberos: [
          barbero('luis', {
            disponibilidad: [tramo('00:00', '24:00')],
            ocupado: [{ inicioMin: -60, finMin: h('23:00') }],
          }),
        ],
        atencion: [tramo('00:00', '24:00')],
      }),
    );
    expect(resultado).toEqual(['23:00', '23:15', '23:30']);
  });
});
