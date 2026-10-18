import { TransicionInvalida } from '../../../src/modules/catalogo-citas/catalogo/domain/errores';
import { RangoHorario } from '../../../src/modules/catalogo-citas/catalogo/domain/rango-horario';
import { Cita } from '../../../src/modules/catalogo-citas/citas/domain/cita';
import type { EstadoCita } from '../../../src/modules/catalogo-citas/citas/domain/estado-cita';
import { MarcaConflicto } from '../../../src/modules/catalogo-citas/citas/domain/marca-conflicto';

// T098 · Transiciones de la cita (RF15; FR-041, FR-042; R10) y marca de conflicto calculada al leer (FR-016).

const INICIO = new Date('2026-10-20T15:00:00Z');
const ANTES = new Date(INICIO.getTime() - 60_000);
const DESPUES = new Date(INICIO.getTime() + 60_000);

function cita(estado: EstadoCita): Cita {
  return Cita.reconstruir({
    id: 'c1',
    barberoId: 'b1',
    clienteId: 'k1',
    servicio: { servicioId: 's1', nombre: 'Corte', precio: '20.00', duracionMin: 30 },
    rango: RangoHorario.desde(INICIO, 30),
    estado,
    origen: 'EN_LINEA',
    cancelacionTardia: false,
    creadoPor: 'u1',
  });
}

const detalle = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(TransicionInvalida);
    return (error as TransicionInvalida).detalles[0];
  }
  throw new Error('No lanzó TransicionInvalida');
};

describe('Cita · transiciones', () => {
  it('completar y marcar no asistió desde CONFIRMADA, desde la hora de inicio', () => {
    const completada = cita('CONFIRMADA');
    completada.completar(INICIO);
    expect(completada.estado).toBe('COMPLETADA');
    const ausente = cita('CONFIRMADA');
    ausente.marcarNoAsistio(DESPUES);
    expect(ausente.estado).toBe('NO_ASISTIO');
  });

  it('antes de la hora de inicio no se puede completar ni marcar no asistió', () => {
    expect(detalle(() => cita('CONFIRMADA').completar(ANTES))).toEqual({
      desde: 'CONFIRMADA',
      hacia: 'COMPLETADA',
    });
    expect(detalle(() => cita('CONFIRMADA').marcarNoAsistio(ANTES))).toEqual({
      desde: 'CONFIRMADA',
      hacia: 'NO_ASISTIO',
    });
  });

  it('aprobar solo desde PENDIENTE', () => {
    const pendiente = cita('PENDIENTE');
    pendiente.aprobar();
    expect(pendiente.estado).toBe('CONFIRMADA');
    expect(detalle(() => cita('CONFIRMADA').aprobar())).toEqual({ desde: 'CONFIRMADA', hacia: 'CONFIRMADA' });
  });

  it.each(['COMPLETADA', 'NO_ASISTIO', 'CANCELADA'] as const)('el estado final %s no cambia', (estado) => {
    for (const cambiar of [
      (c: Cita) => c.completar(DESPUES),
      (c: Cita) => c.marcarNoAsistio(DESPUES),
      (c: Cita) => c.aprobar(),
    ]) {
      const c = cita(estado);
      expect(() => cambiar(c)).toThrow(TransicionInvalida);
      expect(c.estado).toBe(estado);
    }
  });

  it('una PENDIENTE no se completa ni se marca no asistió sin aprobarla antes', () => {
    expect(() => cita('PENDIENTE').completar(DESPUES)).toThrow(TransicionInvalida);
    expect(() => cita('PENDIENTE').marcarNoAsistio(DESPUES)).toThrow(TransicionInvalida);
  });

  it('cambiarA despacha a la transición del estado pedido', () => {
    const c = cita('CONFIRMADA');
    c.cambiarA('NO_ASISTIO', DESPUES);
    expect(c.estado).toBe('NO_ASISTIO');
    const p = cita('PENDIENTE');
    p.cambiarA('CONFIRMADA', DESPUES);
    expect(p.estado).toBe('CONFIRMADA');
  });
});

describe('MarcaConflicto', () => {
  const tramo = (inicio: number, fin: number) => ({ inicioMin: inicio * 60, finMin: fin * 60 });
  const base = {
    cita: { inicioMin: 10 * 60, finMin: 10 * 60 + 30 },
    bloqueos: [] as { inicioMin: number; finMin: number }[],
    atencion: [tramo(9, 19)],
    disponibilidad: [tramo(9, 19)],
  };

  it('sin conflicto: dentro de la disponibilidad, del horario y sin bloqueos', () => {
    expect(MarcaConflicto.de(base)).toBeNull();
  });

  it('dentro de un bloqueo (aunque solo se solape en parte)', () => {
    expect(MarcaConflicto.de({ ...base, bloqueos: [{ inicioMin: 10 * 60 + 15, finMin: 11 * 60 }] })).toBe(
      'EN_BLOQUEO',
    );
    // Un bloqueo que termina justo cuando empieza la cita no la toca (rangos semiabiertos).
    expect(MarcaConflicto.de({ ...base, bloqueos: [tramo(9, 10)] })).toBeNull();
  });

  it('fuera del horario de atención', () => {
    expect(MarcaConflicto.de({ ...base, atencion: [tramo(11, 19)] })).toBe('FUERA_DEL_HORARIO_DE_ATENCION');
    expect(MarcaConflicto.de({ ...base, atencion: [] })).toBe('FUERA_DEL_HORARIO_DE_ATENCION');
  });

  it('fuera de la disponibilidad del barbero', () => {
    expect(MarcaConflicto.de({ ...base, disponibilidad: [tramo(9, 10), tramo(11, 19)] })).toBe(
      'FUERA_DE_DISPONIBILIDAD',
    );
  });
});
