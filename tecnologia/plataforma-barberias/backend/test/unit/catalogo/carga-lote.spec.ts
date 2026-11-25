import {
  claveDeNombre,
  type FilaBarbero,
  type FilaServicio,
  MAX_FILAS_LOTE,
  revisarBarberos,
  revisarServicios,
} from '../../../src/modules/catalogo-citas/catalogo/domain/carga-lote';

// 011 (T011; data-model §2): revisión de una carga de servicios, sin base de datos.

const fila = (cambios: Partial<FilaServicio> = {}): FilaServicio => ({
  nombre: 'Corte clásico',
  duracionMinutos: 30,
  precio: '25',
  ...cambios,
});

const ninguno = new Set<string>();

describe('revisarServicios', () => {
  it('el tope es de 50 filas', () => {
    expect(MAX_FILAS_LOTE).toBe(50);
  });

  it('filas válidas → sin errores y listas para crear, numeradas desde 1', () => {
    const r = revisarServicios([fila(), fila({ nombre: 'Barba', precio: '15.5' })], ninguno);
    expect(r.errores).toEqual([]);
    expect(r.advertencias).toEqual([]);
    expect(r.filas).toBe(2);
    expect(r.utiles.map((u) => [u.fila, u.datos.nombre, u.datos.precio])).toEqual([
      [1, 'Corte clásico', '25'],
      [2, 'Barba', '15.5'],
    ]);
  });

  it('precio vacío → solo "falta" (sin "formato")', () => {
    const r = revisarServicios([fila({ precio: '' }), fila({ nombre: 'Barba', precio: '   ' })], ninguno);
    expect(r.errores).toEqual([
      { fila: 1, campo: 'precio', problema: 'falta' },
      { fila: 2, campo: 'precio', problema: 'falta' },
    ]);
  });

  it('precio mal escrito → "formato"', () => {
    expect(revisarServicios([fila({ precio: 'abc' })], ninguno).errores).toEqual([
      { fila: 1, campo: 'precio', problema: 'formato' },
    ]);
  });

  it('duración vacía → "rango"; no múltiplo de 5 → "multiplo_de_5"', () => {
    expect(
      revisarServicios(
        [fila({ duracionMinutos: null }), fila({ nombre: 'Barba', duracionMinutos: 7 })],
        ninguno,
      ).errores,
    ).toEqual([
      { fila: 1, campo: 'duracionMinutos', problema: 'rango' },
      { fila: 2, campo: 'duracionMinutos', problema: 'multiplo_de_5' },
    ]);
  });

  it('todos los problemas de una fila, en el orden de las columnas', () => {
    expect(
      revisarServicios([fila({ nombre: 'M', duracionMinutos: 7, precio: '' })], ninguno).errores,
    ).toEqual([
      { fila: 1, campo: 'nombre', problema: 'longitud' },
      { fila: 1, campo: 'duracionMinutos', problema: 'multiplo_de_5' },
      { fila: 1, campo: 'precio', problema: 'falta' },
    ]);
  });

  it('nombres repetidos dentro de la carga marcan todas sus filas, sin distinguir mayúsculas ni espacios', () => {
    const r = revisarServicios(
      [fila({ nombre: 'Corte' }), fila({ nombre: 'Barba' }), fila({ nombre: '  CORTE ' })],
      ninguno,
    );
    expect(r.errores).toEqual([
      { fila: 1, campo: 'nombre', problema: 'repetido_en_carga' },
      { fila: 3, campo: 'nombre', problema: 'repetido_en_carga' },
    ]);
  });

  it('un nombre igual a un servicio de la barbería (activo o no) → "ya_existe"', () => {
    const existentes = new Set([claveDeNombre('Corte Clásico'), claveDeNombre('Lavado')]);
    const r = revisarServicios([fila({ nombre: 'corte clásico' }), fila({ nombre: 'Tinte' })], existentes);
    expect(r.errores).toEqual([{ fila: 1, campo: 'nombre', problema: 'ya_existe' }]);
  });

  it('las filas completamente vacías no cuentan, pero la numeración sigue el orden enviado', () => {
    const vacia = { nombre: ' ', duracionMinutos: null, precio: '', descripcion: '' };
    const r = revisarServicios([vacia, fila({ precio: '' }), vacia], ninguno);
    expect(r.filas).toBe(1);
    expect(r.errores).toEqual([{ fila: 2, campo: 'precio', problema: 'falta' }]);
  });

  it('una carga sin ninguna fila con datos → error de la carga "vacia"', () => {
    const r = revisarServicios([{ nombre: '', duracionMinutos: null, precio: '' }], ninguno);
    expect(r.errores).toEqual([{ fila: null, campo: 'filas', problema: 'vacia' }]);
  });
});

// T033 de 011 · Revisión de una carga de barberos (US2; data-model §2).
describe('revisarBarberos', () => {
  const CORTE = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
  const BARBA = '0190a1b2-c3d4-7e5f-8a9b-000000000002';
  const TINTE = '0190a1b2-c3d4-7e5f-8a9b-000000000003';
  const servicios = new Map([
    [CORTE, true],
    [BARBA, true],
    [TINTE, false],
  ]);
  const barbero = (nombre: string, servicioIds: string[] = []): FilaBarbero => ({ nombre, servicioIds });
  const amplio = { maximo: 10, activos: 2 };

  it('filas válidas → sin errores ni advertencias, con el cupo calculado', () => {
    const r = revisarBarberos(
      [barbero('Carlos Ñaupa', [CORTE, BARBA]), barbero('Ana Pillaca')],
      new Set(),
      servicios,
      amplio,
    );
    expect(r.errores).toEqual([]);
    expect(r.advertencias).toEqual([]);
    expect(r.cupo).toEqual({ maximo: 10, activos: 2, disponibles: 8 });
    expect(r.utiles.map((u) => [u.fila, u.datos])).toEqual([
      [1, { nombre: 'Carlos Ñaupa', servicioIds: [CORTE, BARBA] }],
      [2, { nombre: 'Ana Pillaca', servicioIds: [] }],
    ]);
  });

  it('nombre corto → error "longitud" (la misma regla que crear uno)', () => {
    expect(revisarBarberos([barbero('C')], new Set(), servicios, amplio).errores).toEqual([
      { fila: 1, campo: 'nombre', problema: 'longitud' },
    ]);
  });

  it('servicio de otra barbería o inexistente → "no_existe"; desactivado → "inactivo"', () => {
    const r = revisarBarberos(
      [barbero('Carlos', ['0190a1b2-c3d4-7e5f-8a9b-0000000000ff']), barbero('Ana', [CORTE, TINTE])],
      new Set(),
      servicios,
      amplio,
    );
    expect(r.errores).toEqual([
      { fila: 1, campo: 'servicioIds', problema: 'no_existe' },
      { fila: 2, campo: 'servicioIds', problema: 'inactivo' },
    ]);
  });

  it('un nombre repetido en la carga o igual a uno existente es ADVERTENCIA, no error', () => {
    const r = revisarBarberos(
      [barbero('Luis'), barbero('Carlos'), barbero(' LUIS ')],
      new Set([claveDeNombre('Carlos')]),
      servicios,
      amplio,
    );
    expect(r.errores).toEqual([]);
    expect(r.advertencias).toEqual([
      { fila: 1, campo: 'nombre', problema: 'repetido_en_carga' },
      { fila: 2, campo: 'nombre', problema: 'ya_existe' },
      { fila: 3, campo: 'nombre', problema: 'repetido_en_carga' },
    ]);
  });

  it('más filas que cupos libres → error de la carga "supera_cupo"', () => {
    const r = revisarBarberos([barbero('Uno'), barbero('Dos'), barbero('Tres')], new Set(), servicios, {
      maximo: 5,
      activos: 3,
    });
    expect(r.cupo.disponibles).toBe(2);
    expect(r.errores).toEqual([{ fila: null, campo: 'filas', problema: 'supera_cupo' }]);
    expect(
      revisarBarberos([barbero('Uno'), barbero('Dos')], new Set(), servicios, { maximo: 5, activos: 3 })
        .errores,
    ).toEqual([]);
  });

  it('las filas vacías no cuentan; sin ninguna con datos → "vacia"', () => {
    const r = revisarBarberos([barbero(' '), barbero('Ana'), barbero('')], new Set(), servicios, amplio);
    expect(r.filas).toBe(1);
    expect(r.utiles[0].fila).toBe(2);
    expect(revisarBarberos([barbero('')], new Set(), servicios, amplio).errores).toEqual([
      { fila: null, campo: 'filas', problema: 'vacia' },
    ]);
  });
});
