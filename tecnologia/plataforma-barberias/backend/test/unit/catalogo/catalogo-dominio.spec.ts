import { Barbero } from '../../../src/modules/catalogo-citas/catalogo/domain/barbero';
import { Bloqueo } from '../../../src/modules/catalogo-citas/catalogo/domain/bloqueo';
import { LimiteBarberosAlcanzado } from '../../../src/modules/catalogo-citas/catalogo/domain/errores';
import { LimiteBarberos } from '../../../src/modules/catalogo-citas/catalogo/domain/limite-barberos';
import { Servicio } from '../../../src/modules/catalogo-citas/catalogo/domain/servicio';

// T040 · Dominio del catálogo (RF07–RF09; research R12, R13): reglas puras, sin base de datos.

const SERVICIO_ID = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
const OTRO_SERVICIO = '0190a1b2-c3d4-7e5f-8a9b-000000000002';

const problemaDe = (fn: () => unknown): { campo: string; problema: string } | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { detalles: { campo: string; problema: string }[] }).detalles[0];
  }
  return undefined;
};

describe('Servicio', () => {
  const crear = (cambios: Partial<Parameters<typeof Servicio.crear>[1]> = {}) =>
    Servicio.crear(SERVICIO_ID, { nombre: 'Corte clásico', precio: '25', duracionMin: 30, ...cambios });

  it('se crea activo, con el nombre recortado y el precio normalizado a dos decimales', () => {
    const servicio = crear({ nombre: '  Corte clásico  ', precio: '25.5', descripcion: '  ' });
    expect(servicio).toMatchObject({
      id: SERVICIO_ID,
      nombre: 'Corte clásico',
      precio: '25.50',
      duracionMin: 30,
      descripcion: null,
      activo: true,
    });
    expect(crear({ precio: '0' }).precio).toBe('0.00');
    expect(crear({ precio: '99999.99' }).precio).toBe('99999.99');
  });

  it.each([
    [{ nombre: 'C' }, 'nombre', 'longitud'],
    [{ nombre: 'x'.repeat(81) }, 'nombre', 'longitud'],
    [{ precio: '-1' }, 'precio', 'formato'],
    [{ precio: '100000' }, 'precio', 'formato'],
    [{ precio: '10.999' }, 'precio', 'formato'],
    [{ precio: 'abc' }, 'precio', 'formato'],
    [{ duracionMin: 0 }, 'duracionMinutos', 'rango'],
    [{ duracionMin: 485 }, 'duracionMinutos', 'rango'],
    [{ duracionMin: 32 }, 'duracionMinutos', 'multiplo_de_5'],
    [{ descripcion: 'x'.repeat(301) }, 'descripcion', 'longitud'],
  ])('rechaza %o (%s: %s)', (cambios, campo, problema) => {
    expect(problemaDe(() => crear(cambios))).toEqual({ campo, problema });
  });

  it('editar valida igual que crear y desactivar o activar cambia solo el estado', () => {
    const servicio = crear();
    servicio.editar({ precio: '30', duracionMin: 45 });
    expect(servicio).toMatchObject({ precio: '30.00', duracionMin: 45, nombre: 'Corte clásico' });
    expect(problemaDe(() => servicio.editar({ duracionMin: 7 }))).toEqual({
      campo: 'duracionMinutos',
      problema: 'multiplo_de_5',
    });
    servicio.desactivar();
    expect(servicio.activo).toBe(false);
    servicio.activar();
    expect(servicio.activo).toBe(true);
  });
});

describe('Barbero', () => {
  it('asigna y quita servicios sin duplicarlos y responde si ofrece uno', () => {
    const barbero = Barbero.crear('b1', { nombre: ' Carlos ', usuarioId: null, servicioIds: [SERVICIO_ID] });
    expect(barbero.nombre).toBe('Carlos');
    expect(barbero.ofrece(SERVICIO_ID)).toBe(true);
    barbero.asignar(SERVICIO_ID);
    barbero.asignar(OTRO_SERVICIO);
    expect(barbero.servicioIds).toEqual([SERVICIO_ID, OTRO_SERVICIO]);
    barbero.quitar(SERVICIO_ID);
    expect(barbero.ofrece(SERVICIO_ID)).toBe(false);
    expect(barbero.servicioIds).toEqual([OTRO_SERVICIO]);
  });

  it('desactivar y reactivar; vincular y desvincular un usuario', () => {
    const barbero = Barbero.crear('b1', { nombre: 'Carlos', usuarioId: 'u1', servicioIds: [] });
    expect(barbero.activo).toBe(true);
    barbero.desactivar();
    expect(barbero.activo).toBe(false);
    barbero.reactivar();
    expect(barbero.activo).toBe(true);
    barbero.vincular(null);
    expect(barbero.usuarioId).toBeNull();
  });

  it('el nombre visible tiene de 2 a 80 caracteres', () => {
    expect(problemaDe(() => Barbero.crear('b1', { nombre: 'C', usuarioId: null, servicioIds: [] }))).toEqual({
      campo: 'nombre',
      problema: 'longitud',
    });
    const barbero = Barbero.crear('b1', { nombre: 'Carlos', usuarioId: null, servicioIds: [] });
    expect(problemaDe(() => barbero.renombrar('x'.repeat(81)))).toEqual({
      campo: 'nombre',
      problema: 'longitud',
    });
  });
});

describe('Bloqueo', () => {
  const inicio = new Date('2026-10-20T15:00:00Z');
  const crear = (fin: Date, motivo: string | null = null) =>
    Bloqueo.crear({ id: 'x', barberoId: 'b1', inicio, fin, motivo, creadoPor: 'u1' });

  it('se crea con inicio < fin y el motivo opcional recortado', () => {
    const bloqueo = crear(new Date('2026-10-20T16:00:00Z'), '  Cita médica ');
    expect(bloqueo).toMatchObject({ barberoId: 'b1', inicio, motivo: 'Cita médica' });
    expect(crear(new Date('2026-10-20T16:00:00Z'), '   ').motivo).toBeNull();
  });

  it('rechaza inicio ≥ fin, más de 30 días y un motivo de más de 200 caracteres', () => {
    expect(problemaDe(() => crear(inicio))).toEqual({ campo: 'fin', problema: 'inicio_no_menor_que_fin' });
    expect(problemaDe(() => crear(new Date(inicio.getTime() - 60_000)))).toEqual({
      campo: 'fin',
      problema: 'inicio_no_menor_que_fin',
    });
    const treintaDias = new Date(inicio.getTime() + 30 * 24 * 3600 * 1000);
    expect(crear(treintaDias).fin).toEqual(treintaDias);
    expect(problemaDe(() => crear(new Date(treintaDias.getTime() + 60_000)))).toEqual({
      campo: 'fin',
      problema: 'mas_de_30_dias',
    });
    expect(problemaDe(() => crear(new Date('2026-10-20T16:00:00Z'), 'x'.repeat(201)))).toEqual({
      campo: 'motivo',
      problema: 'longitud',
    });
  });
});

describe('LimiteBarberos', () => {
  it('permite agregar mientras los activos estén por debajo del máximo del plan', () => {
    expect(LimiteBarberos.puedeAgregar(4, 5)).toBe(true);
    expect(LimiteBarberos.puedeAgregar(5, 5)).toBe(false);
    expect(() => LimiteBarberos.exigir(4, 5)).not.toThrow();
    expect(() => LimiteBarberos.exigir(5, 5)).toThrow(LimiteBarberosAlcanzado);
  });
});
