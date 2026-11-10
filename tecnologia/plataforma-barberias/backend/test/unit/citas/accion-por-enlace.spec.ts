import { RangoHorario } from '../../../src/modules/catalogo-citas/catalogo/domain/rango-horario';
import { Cita } from '../../../src/modules/catalogo-citas/citas/domain/cita';
import type { EstadoCita } from '../../../src/modules/catalogo-citas/citas/domain/estado-cita';

// T076 · Reglas de una acción por enlace sobre la cita (contracts/enlaces-de-accion.md §3–§4; FR-024, FR-025).
// La acción de la ruta debe ser la del enlace; la cita debe tener la misma versión, estar activa y no haber
// empezado. Confirmar NO cambia la versión (después se puede cancelar con el otro enlace); cancelar sí.

const MINUTO = 60_000;
const INICIO = new Date('2026-11-12T15:00:00Z');
const ANTES = new Date(INICIO.getTime() - 90 * MINUTO);

function cita(estado: EstadoCita = 'CONFIRMADA', version = 4): Cita {
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
    version,
    confirmadaPorClienteEn: null,
  });
}

const enlace = (accion: 'CONFIRMAR' | 'REPROGRAMAR' | 'CANCELAR', version = 4) => ({ accion, version });

describe('Cita.aceptaEnlace (T076)', () => {
  it('acepta el enlace de la misma acción y versión sobre una cita activa que no empezó', () => {
    for (const accion of ['CONFIRMAR', 'REPROGRAMAR', 'CANCELAR'] as const) {
      expect(cita().aceptaEnlace(enlace(accion), accion, ANTES)).toBe(true);
    }
    expect(cita('PENDIENTE').aceptaEnlace(enlace('CANCELAR'), 'CANCELAR', ANTES)).toBe(true);
  });

  it('rechaza el enlace de otra acción (un enlace de confirmar no cancela)', () => {
    expect(cita().aceptaEnlace(enlace('CONFIRMAR'), 'CANCELAR', ANTES)).toBe(false);
    expect(cita().aceptaEnlace(enlace('CANCELAR'), 'REPROGRAMAR', ANTES)).toBe(false);
  });

  it('rechaza un enlace de otra versión (la cita cambió desde que se emitió)', () => {
    expect(cita('CONFIRMADA', 5).aceptaEnlace(enlace('CANCELAR', 4), 'CANCELAR', ANTES)).toBe(false);
    expect(cita('CONFIRMADA', 3).aceptaEnlace(enlace('CANCELAR', 4), 'CANCELAR', ANTES)).toBe(false);
  });

  it.each<EstadoCita>(['CANCELADA', 'COMPLETADA', 'NO_ASISTIO'])(
    'rechaza el enlace de una cita %s',
    (estado) => {
      expect(cita(estado).aceptaEnlace(enlace('CONFIRMAR'), 'CONFIRMAR', ANTES)).toBe(false);
    },
  );

  it('rechaza el enlace desde la hora de inicio', () => {
    expect(cita().aceptaEnlace(enlace('CONFIRMAR'), 'CONFIRMAR', INICIO)).toBe(false);
    expect(cita().aceptaEnlace(enlace('CONFIRMAR'), 'CONFIRMAR', new Date(INICIO.getTime() - 1))).toBe(true);
  });
});

describe('Versión al confirmar y al cancelar (T076)', () => {
  it('confirmar marca la asistencia sin cambiar la versión: el enlace de cancelar sigue valiendo', () => {
    const c = cita();
    c.confirmarAsistencia(ANTES);
    expect(c.confirmadaPorClienteEn).toEqual(ANTES);
    expect(c.version).toBe(4);
    expect(c.estado).toBe('CONFIRMADA');
    expect(c.aceptaEnlace(enlace('CANCELAR'), 'CANCELAR', ANTES)).toBe(true);
  });

  it('cancelar sube la versión: los demás enlaces de la cita dejan de valer', () => {
    const c = cita();
    c.cancelar({ rol: 'CLIENTE', usuarioId: null }, ANTES, 120);
    expect(c.version).toBe(5);
    expect(c.aceptaEnlace(enlace('CONFIRMAR'), 'CONFIRMAR', ANTES)).toBe(false);
  });

  it('confirmar una cita que no está activa o que ya empezó es una transición inválida', () => {
    expect(() => cita('CANCELADA').confirmarAsistencia(ANTES)).toThrow();
    expect(() => cita().confirmarAsistencia(INICIO)).toThrow();
  });
});
