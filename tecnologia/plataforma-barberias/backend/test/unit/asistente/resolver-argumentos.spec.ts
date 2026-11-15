import {
  normalizarNombre,
  resolverPorNombre,
  validarFechaDeHorarios,
} from '../../../src/modules/asistente-reportes/asistente/domain/argumentos';
import { FechaLocal, ZonaHoraria } from '../../../src/shared';

// T027 de 005 · FR-014, FR-017 y contracts/asistente.md §2: los argumentos que devuelve el modelo se resuelven SOLO
// dentro de la barbería del token: el servicio y el barbero se buscan en su catálogo (sin tildes ni mayúsculas,
// primero exacto y después por prefijo), y la fecha se valida contra el día de hoy en la zona de la barbería y el
// horizonte de reserva. Las fechas relativas ("hoy", "mañana") las escribe el modelo con la fecha de hoy que recibe:
// esa fecha se calcula en la zona de la barbería, también cerca de la medianoche de Lima.

const LIMA = new ZonaHoraria('America/Lima');

const SERVICIOS = [
  { id: 's1', nombre: 'Corte clásico' },
  { id: 's2', nombre: 'Corte y barba' },
  { id: 's3', nombre: 'Barba' },
  { id: 's4', nombre: 'Tinte' },
];

describe('normalizarNombre', () => {
  it('compara sin tildes, mayúsculas ni espacios de más', () => {
    expect(normalizarNombre('  Corte   CLÁSICO ')).toBe('corte clasico');
    expect(normalizarNombre('Ñaño')).toBe('nano');
  });
});

describe('resolverPorNombre (servicio y barbero en el catálogo de la barbería)', () => {
  it('coincidencia exacta, sin tildes ni mayúsculas', () => {
    expect(resolverPorNombre('corte clasico', SERVICIOS)).toEqual({ tipo: 'unico', valor: SERVICIOS[0] });
    expect(resolverPorNombre('BARBA', SERVICIOS)).toEqual({ tipo: 'unico', valor: SERVICIOS[2] });
  });

  it('la exacta gana aunque otro empiece igual', () => {
    const conBarba = [...SERVICIOS, { id: 's5', nombre: 'Barba con toalla' }];
    expect(resolverPorNombre('barba', conBarba)).toEqual({ tipo: 'unico', valor: SERVICIOS[2] });
  });

  it('por prefijo, si es uno solo', () => {
    expect(resolverPorNombre('tin', SERVICIOS)).toEqual({ tipo: 'unico', valor: SERVICIOS[3] });
  });

  it('si hay más de uno, devuelve las opciones para pedir que elija', () => {
    expect(resolverPorNombre('corte', SERVICIOS)).toEqual({
      tipo: 'varios',
      opciones: [SERVICIOS[0], SERVICIOS[1]],
    });
  });

  it('sin coincidencias → ninguno (nunca busca fuera de la lista recibida)', () => {
    expect(resolverPorNombre('Servicio exclusivo de otra barbería', SERVICIOS)).toEqual({ tipo: 'ninguno' });
    expect(resolverPorNombre('', SERVICIOS)).toEqual({ tipo: 'ninguno' });
  });
});

describe('La fecha de hoy en la zona de la barbería (lo que recibe el modelo)', () => {
  it('a las 23:30 de Lima (04:30 UTC del día siguiente) hoy sigue siendo el día de Lima', () => {
    expect(LIMA.fechaDe(new Date('2026-11-15T04:30:00Z')).toString()).toBe('2026-11-14');
  });

  it('a las 00:05 de Lima ya es el día siguiente', () => {
    expect(LIMA.fechaDe(new Date('2026-11-15T05:05:00Z')).toString()).toBe('2026-11-15');
  });
});

describe('validarFechaDeHorarios (T027)', () => {
  const hoy = FechaLocal.de('2026-11-14');

  it('hoy y una fecha futura dentro del horizonte son válidas', () => {
    expect(validarFechaDeHorarios('2026-11-14', hoy, 30)).toEqual({ tipo: 'valida', fecha: hoy });
    expect(validarFechaDeHorarios('2026-11-15', hoy, 30)).toEqual({
      tipo: 'valida',
      fecha: FechaLocal.de('2026-11-15'),
    });
    expect(validarFechaDeHorarios('2026-12-14', hoy, 30).tipo).toBe('valida');
  });

  it.each(['2026-13-45', '2026-02-30', '15/11/2026', ''])(
    '%j → formato (SIN_DATOS con la explicación)',
    (valor) => {
      expect(validarFechaDeHorarios(valor, hoy, 30)).toEqual({ tipo: 'formato', valor });
    },
  );

  it('una fecha pasada → pasada', () => {
    expect(validarFechaDeHorarios('2026-11-13', hoy, 30)).toEqual({
      tipo: 'pasada',
      fecha: FechaLocal.de('2026-11-13'),
    });
  });

  it('después del horizonte de reserva → fuera_del_horizonte, con el último día posible', () => {
    expect(validarFechaDeHorarios('2026-12-15', hoy, 30)).toEqual({
      tipo: 'fuera_del_horizonte',
      ultimo: FechaLocal.de('2026-12-14'),
    });
  });
});
