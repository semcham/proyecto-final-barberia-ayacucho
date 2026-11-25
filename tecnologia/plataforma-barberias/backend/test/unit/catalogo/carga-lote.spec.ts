import {
  claveDeNombre,
  type FilaServicio,
  MAX_FILAS_LOTE,
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
