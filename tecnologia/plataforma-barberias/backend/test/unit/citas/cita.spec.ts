import { ReservaInvalida } from '../../../src/modules/catalogo-citas/catalogo/domain/errores';
import { Cita } from '../../../src/modules/catalogo-citas/citas/domain/cita';

// T076 · Creación de la cita (RF12, FR-008, FR-035a).

const AHORA = new Date('2026-10-20T14:00:00Z'); // 09:00 en Lima
const SERVICIO = { servicioId: 'serv-1', nombre: 'Corte clásico', precio: '25.50', duracionMin: 45 };

const reservar = (inicio: Date) =>
  Cita.reservar({
    id: 'cita-1',
    barberoId: 'barbero-1',
    clienteId: 'cliente-1',
    servicio: SERVICIO,
    inicio,
    origen: 'EN_LINEA',
    creadoPor: 'usuario-1',
    ahora: AHORA,
  });

describe('Cita.reservar', () => {
  it('nace CONFIRMADA (FR-035a), sin cancelación tardía', () => {
    const cita = reservar(new Date('2026-10-20T15:00:00Z'));
    expect(cita.estado).toBe('CONFIRMADA');
    expect(cita.cancelacionTardia).toBe(false);
    expect(cita.ocupaHorario()).toBe(true);
  });

  // T028 de 008 (research R03): con adelanto, la cita nace PENDIENTE (ocupa el horario) y `aprobar` la confirma.
  it('con la opción pendiente nace PENDIENTE, ocupa el horario y aprobar la deja CONFIRMADA', () => {
    const cita = Cita.reservar({
      id: 'cita-2',
      barberoId: 'barbero-1',
      clienteId: 'cliente-1',
      servicio: SERVICIO,
      inicio: new Date('2026-10-20T15:00:00Z'),
      origen: 'EN_LINEA',
      creadoPor: 'usuario-1',
      ahora: AHORA,
      pendiente: true,
    });
    expect(cita.estado).toBe('PENDIENTE');
    expect(cita.ocupaHorario()).toBe(true);
    cita.aprobar();
    expect(cita.estado).toBe('CONFIRMADA');
  });

  it('fin = inicio + duración del servicio', () => {
    const cita = reservar(new Date('2026-10-20T15:00:00Z'));
    expect(cita.rango.inicio.toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(cita.rango.fin.toISOString()).toBe('2026-10-20T15:45:00.000Z');
  });

  it('copia nombre, precio y duración del servicio (FR-008)', () => {
    const cita = reservar(new Date('2026-10-20T15:00:00Z'));
    expect(cita.servicio).toEqual(SERVICIO);
    expect(cita.servicio).not.toBe(SERVICIO);
  });

  it.each([
    ['en el pasado', '2026-10-20T13:00:00Z'],
    ['justo ahora', '2026-10-20T14:00:00Z'],
  ])('rechaza un inicio %s (HORA_PASADA)', (_caso, inicio) => {
    let error: unknown;
    try {
      reservar(new Date(inicio));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ReservaInvalida);
    expect((error as ReservaInvalida).detalles).toEqual([{ motivo: 'HORA_PASADA' }]);
  });
});
