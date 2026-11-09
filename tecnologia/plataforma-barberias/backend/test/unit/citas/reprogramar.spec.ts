import {
  ReservaInvalida,
  SinAntelacionParaReprogramar,
  TransicionInvalida,
} from '../../../src/modules/catalogo-citas/catalogo/domain/errores';
import { RangoHorario } from '../../../src/modules/catalogo-citas/catalogo/domain/rango-horario';
import { Cita } from '../../../src/modules/catalogo-citas/citas/domain/cita';
import type { EstadoCita } from '../../../src/modules/catalogo-citas/citas/domain/estado-cita';

// T037 · Reprogramar una cita (RF13; FR-001 a FR-007): la misma cita cambia de hora (y quizá de barbero), sube
// su versión y pierde la confirmación del cliente. Cancelar, completar y no asistió también suben la versión
// (invalidan los enlaces de acción de la cita).

const MINUTO = 60_000;
const INICIO = new Date('2026-10-20T15:00:00Z');
const NUEVO = new Date('2026-10-22T16:00:00Z');
const ANTELACION = 120;
const CLIENTE = { rol: 'CLIENTE' as const, usuarioId: 'u-cliente' };
const PROPIETARIO = { rol: 'PROPIETARIO' as const, usuarioId: 'u-propietario' };
const antesDelInicio = (minutos: number) => new Date(INICIO.getTime() - minutos * MINUTO);

function cita(estado: EstadoCita = 'CONFIRMADA', version = 3): Cita {
  return Cita.reconstruir({
    id: 'c1',
    barberoId: 'b1',
    clienteId: 'k1',
    servicio: { servicioId: 's1', nombre: 'Corte', precio: '20.00', duracionMin: 45 },
    rango: RangoHorario.desde(INICIO, 45),
    estado,
    origen: 'EN_LINEA',
    cancelacionTardia: false,
    creadoPor: 'u-cliente',
    version,
    confirmadaPorClienteEn: new Date('2026-10-19T12:00:00Z'),
  });
}

describe('Cita.reprogramar', () => {
  it('mueve la misma cita: nueva hora con la duración copiada, mismo servicio y cliente, confirmada, versión + 1 y sin confirmación del cliente', () => {
    const c = cita();
    const resultado = c.reprogramar(
      { barberoId: 'b1', inicio: NUEVO },
      CLIENTE,
      antesDelInicio(600),
      ANTELACION,
    );
    expect(resultado).toEqual({ cambio: true, anterior: { barberoId: 'b1', inicio: INICIO } });
    expect(c.id).toBe('c1');
    expect(c.clienteId).toBe('k1');
    expect(c.servicio).toEqual({ servicioId: 's1', nombre: 'Corte', precio: '20.00', duracionMin: 45 });
    expect(c.rango.inicio).toEqual(NUEVO);
    expect(c.rango.fin).toEqual(new Date(NUEVO.getTime() + 45 * MINUTO));
    expect(c.estado).toBe('CONFIRMADA');
    expect(c.version).toBe(4);
    expect(c.confirmadaPorClienteEn).toBeNull();
  });

  it('una cita PENDIENTE reprogramada queda CONFIRMADA (FR-007)', () => {
    const c = cita('PENDIENTE');
    c.reprogramar({ barberoId: 'b1', inicio: NUEVO }, PROPIETARIO, antesDelInicio(600), ANTELACION);
    expect(c.estado).toBe('CONFIRMADA');
  });

  it('puede cambiar de barbero a la misma hora', () => {
    const c = cita();
    const resultado = c.reprogramar({ barberoId: 'b2', inicio: INICIO }, PROPIETARIO, antesDelInicio(600), 0);
    expect(resultado.cambio).toBe(true);
    expect(c.barberoId).toBe('b2');
    expect(c.version).toBe(4);
  });

  it('a la misma hora y con el mismo barbero no cambia nada', () => {
    const c = cita();
    const resultado = c.reprogramar(
      { barberoId: 'b1', inicio: new Date(INICIO.getTime()) },
      CLIENTE,
      antesDelInicio(600),
      ANTELACION,
    );
    expect(resultado).toEqual({ cambio: false, anterior: { barberoId: 'b1', inicio: INICIO } });
    expect(c.version).toBe(3);
    expect(c.confirmadaPorClienteEn).toEqual(new Date('2026-10-19T12:00:00Z'));
  });

  it.each<EstadoCita>(['CANCELADA', 'COMPLETADA', 'NO_ASISTIO'])(
    'no se reprograma una cita %s (TRANSICION_INVALIDA) y queda igual',
    (estado) => {
      const c = cita(estado);
      expect(() =>
        c.reprogramar({ barberoId: 'b1', inicio: NUEVO }, PROPIETARIO, antesDelInicio(600), 0),
      ).toThrow(TransicionInvalida);
      expect(c.rango.inicio).toEqual(INICIO);
      expect(c.version).toBe(3);
    },
  );

  it('no se reprograma una cita que ya empezó, ni siquiera el propietario', () => {
    const c = cita();
    expect(() => c.reprogramar({ barberoId: 'b1', inicio: NUEVO }, PROPIETARIO, INICIO, 0)).toThrow(
      TransicionInvalida,
    );
    expect(c.rango.inicio).toEqual(INICIO);
  });

  it('la nueva hora en el pasado se rechaza con HORA_PASADA', () => {
    const c = cita();
    const ahora = antesDelInicio(600);
    let error: unknown;
    try {
      c.reprogramar({ barberoId: 'b1', inicio: new Date(ahora.getTime() - MINUTO) }, PROPIETARIO, ahora, 0);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ReservaInvalida);
    expect((error as ReservaInvalida).detalles).toEqual([{ motivo: 'HORA_PASADA' }]);
    expect(c.version).toBe(3);
  });

  it('el cliente necesita la antelación de cancelación: justo en el límite sí, un minuto después no (FR-006)', () => {
    const enElLimite = cita();
    enElLimite.reprogramar(
      { barberoId: 'b1', inicio: NUEVO },
      CLIENTE,
      antesDelInicio(ANTELACION),
      ANTELACION,
    );
    expect(enElLimite.rango.inicio).toEqual(NUEVO);

    const tarde = cita();
    let error: unknown;
    try {
      tarde.reprogramar(
        { barberoId: 'b1', inicio: NUEVO },
        CLIENTE,
        antesDelInicio(ANTELACION - 1),
        ANTELACION,
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SinAntelacionParaReprogramar);
    expect((error as SinAntelacionParaReprogramar).codigo).toBe('SIN_ANTELACION_PARA_REPROGRAMAR');
    expect((error as SinAntelacionParaReprogramar).detalles).toEqual([{ puedeCancelar: true }]);
    expect(tarde.rango.inicio).toEqual(INICIO);
    expect(tarde.version).toBe(3);
  });

  it('el propietario no tiene regla de antelación', () => {
    const c = cita();
    c.reprogramar({ barberoId: 'b1', inicio: NUEVO }, PROPIETARIO, antesDelInicio(1), ANTELACION);
    expect(c.rango.inicio).toEqual(NUEVO);
  });
});

describe('La versión de la cita sube con cada cambio que invalida sus enlaces', () => {
  it('cancelar sube la versión', () => {
    const c = cita();
    c.cancelar(CLIENTE, antesDelInicio(600), ANTELACION);
    expect(c.version).toBe(4);
  });

  it('completar y no asistió suben la versión', () => {
    const completada = cita();
    completada.completar(INICIO);
    expect(completada.version).toBe(4);

    const noAsistio = cita();
    noAsistio.marcarNoAsistio(INICIO);
    expect(noAsistio.version).toBe(4);
  });

  it('una transición rechazada no sube la versión', () => {
    const c = cita('CANCELADA');
    expect(() => c.completar(INICIO)).toThrow(TransicionInvalida);
    expect(c.version).toBe(3);
  });

  it('una cita nueva empieza en la versión 1 sin confirmación del cliente', () => {
    const nueva = Cita.reservar({
      id: 'c2',
      barberoId: 'b1',
      clienteId: 'k1',
      servicio: { servicioId: 's1', nombre: 'Corte', precio: '20.00', duracionMin: 30 },
      inicio: INICIO,
      origen: 'EN_LINEA',
      creadoPor: 'u-cliente',
      ahora: antesDelInicio(600),
    });
    expect(nueva.version).toBe(1);
    expect(nueva.confirmadaPorClienteEn).toBeNull();
  });
});
