import { TransicionInvalida } from '../../../src/modules/catalogo-citas/catalogo/domain/errores';
import { RangoHorario } from '../../../src/modules/catalogo-citas/catalogo/domain/rango-horario';
import { Cita } from '../../../src/modules/catalogo-citas/citas/domain/cita';
import type { EstadoCita } from '../../../src/modules/catalogo-citas/citas/domain/estado-cita';

// T112 · Cancelación de la cita (RF14; FR-036 a FR-039; R10).

const MINUTO = 60_000;
const INICIO = new Date('2026-10-20T15:00:00Z');
const ANTELACION = 120;
const CLIENTE = { rol: 'CLIENTE' as const, usuarioId: 'u-cliente' };
const PROPIETARIO = { rol: 'PROPIETARIO' as const, usuarioId: 'u-propietario' };
const antesDelInicio = (minutos: number) => new Date(INICIO.getTime() - minutos * MINUTO);

function cita(estado: EstadoCita = 'CONFIRMADA'): Cita {
  return Cita.reconstruir({
    id: 'c1',
    barberoId: 'b1',
    clienteId: 'k1',
    servicio: { servicioId: 's1', nombre: 'Corte', precio: '20.00', duracionMin: 30 },
    rango: RangoHorario.desde(INICIO, 30),
    estado,
    origen: 'EN_LINEA',
    cancelacionTardia: false,
    creadoPor: 'u-cliente',
  });
}

describe('Cita.cancelar', () => {
  it('el cliente cancela con antelación suficiente: cancelada, sin marca de tardía, con quién y cuándo', () => {
    const c = cita();
    const ahora = antesDelInicio(180);
    c.cancelar(CLIENTE, ahora, ANTELACION, 'No llego a tiempo');
    expect(c.estado).toBe('CANCELADA');
    expect(c.cancelacionTardia).toBe(false);
    expect(c.cancelacion).toEqual({ por: 'u-cliente', en: ahora, motivo: 'No llego a tiempo' });
    expect(c.ocupaHorario()).toBe(false);
  });

  it('es tardía si faltan menos minutos que la antelación; justo en el límite no lo es', () => {
    const tardia = cita();
    tardia.cancelar(CLIENTE, antesDelInicio(ANTELACION - 1), ANTELACION);
    expect(tardia.cancelacionTardia).toBe(true);

    const enElLimite = cita();
    enElLimite.cancelar(CLIENTE, antesDelInicio(ANTELACION), ANTELACION);
    expect(enElLimite.cancelacionTardia).toBe(false);

    const sinAntelacion = cita();
    sinAntelacion.cancelar(CLIENTE, antesDelInicio(1), 0);
    expect(sinAntelacion.cancelacionTardia).toBe(false);
  });

  it('el cliente puede cancelar hasta el inicio; desde la hora de inicio recibe TransicionInvalida', () => {
    const ultimoMinuto = cita();
    ultimoMinuto.cancelar(CLIENTE, new Date(INICIO.getTime() - 1), ANTELACION);
    expect(ultimoMinuto.estado).toBe('CANCELADA');
    expect(ultimoMinuto.cancelacionTardia).toBe(true);

    const enCurso = cita();
    expect(() => enCurso.cancelar(CLIENTE, INICIO, ANTELACION)).toThrow(TransicionInvalida);
    expect(enCurso.estado).toBe('CONFIRMADA');
  });

  it('el propietario nunca genera una cancelación tardía, aunque cancele sobre la hora o ya empezada', () => {
    const c = cita();
    c.cancelar(PROPIETARIO, new Date(INICIO.getTime() + 5 * MINUTO), ANTELACION, null);
    expect(c.estado).toBe('CANCELADA');
    expect(c.cancelacionTardia).toBe(false);
    expect(c.cancelacion).toEqual({ por: 'u-propietario', en: expect.any(Date), motivo: null });
  });

  it('una pendiente también se cancela', () => {
    const c = cita('PENDIENTE');
    c.cancelar(CLIENTE, antesDelInicio(300), ANTELACION);
    expect(c.estado).toBe('CANCELADA');
  });

  it.each(['CANCELADA', 'COMPLETADA', 'NO_ASISTIO'] as const)(
    'una cita %s no se cancela (tampoco dos veces)',
    (estado) => {
      expect(() => cita(estado).cancelar(PROPIETARIO, antesDelInicio(300), ANTELACION)).toThrow(
        TransicionInvalida,
      );
      const c = cita();
      c.cancelar(CLIENTE, antesDelInicio(300), ANTELACION);
      expect(() => c.cancelar(CLIENTE, antesDelInicio(200), ANTELACION)).toThrow(TransicionInvalida);
    },
  );

  it('el motivo se recorta y no pasa de 200 caracteres', () => {
    const c = cita();
    c.cancelar(CLIENTE, antesDelInicio(300), ANTELACION, '   ');
    expect(c.cancelacion?.motivo).toBeNull();
    expect(() => cita().cancelar(CLIENTE, antesDelInicio(300), ANTELACION, 'x'.repeat(201))).toThrow(
      /Revisa/,
    );
  });

  it('cancelacionTardiaDesde es el inicio menos la antelación', () => {
    expect(cita().cancelacionTardiaDesde(ANTELACION)).toEqual(antesDelInicio(ANTELACION));
  });
});
