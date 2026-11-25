import { problemasDeBarbero } from '../../../src/modules/catalogo-citas/catalogo/domain/barbero';
import { problemasDeServicio } from '../../../src/modules/catalogo-citas/catalogo/domain/servicio';

// 011 (T002; research R02): las reglas de un servicio y de un barbero devuelven TODOS los problemas de unos datos, en el
// orden en que se comprueban al crear uno solo. La carga en lote los muestra todos; la creación individual, el primero.

describe('problemasDeServicio', () => {
  const validos = { nombre: 'Corte clásico', precio: '25', duracionMin: 30 };

  it('datos válidos → sin problemas', () => {
    expect(problemasDeServicio(validos)).toEqual([]);
    expect(problemasDeServicio({ ...validos, descripcion: 'x'.repeat(300) })).toEqual([]);
  });

  it('lista todos los problemas, en el orden de las comprobaciones', () => {
    expect(
      problemasDeServicio({ nombre: ' M ', descripcion: 'x'.repeat(301), precio: 'abc', duracionMin: 500 }),
    ).toEqual([
      { campo: 'nombre', problema: 'longitud' },
      { campo: 'descripcion', problema: 'longitud' },
      { campo: 'precio', problema: 'formato' },
      { campo: 'duracionMinutos', problema: 'rango' },
    ]);
  });

  it.each([
    [{ duracionMin: 4 }, 'rango'],
    [{ duracionMin: 485 }, 'rango'],
    [{ duracionMin: 30.5 }, 'rango'],
    [{ duracionMin: 7 }, 'multiplo_de_5'],
  ])('duración %o → %s', (cambio, problema) => {
    expect(problemasDeServicio({ ...validos, ...cambio })).toEqual([{ campo: 'duracionMinutos', problema }]);
  });

  it.each(['-1', '100000', '25.555', '', '25,50'])('precio %p → formato', (precio) => {
    expect(problemasDeServicio({ ...validos, precio })).toEqual([{ campo: 'precio', problema: 'formato' }]);
  });

  it('el nombre se mide sin los espacios de los extremos (2 a 80 caracteres)', () => {
    expect(problemasDeServicio({ ...validos, nombre: '  ab  ' })).toEqual([]);
    expect(problemasDeServicio({ ...validos, nombre: 'a'.repeat(80) })).toEqual([]);
    expect(problemasDeServicio({ ...validos, nombre: 'a'.repeat(81) })).toEqual([
      { campo: 'nombre', problema: 'longitud' },
    ]);
  });
});

describe('problemasDeBarbero', () => {
  it('nombre de 2 a 80 caracteres sin los espacios de los extremos', () => {
    expect(problemasDeBarbero({ nombre: 'Carlos Ñaupa' })).toEqual([]);
    expect(problemasDeBarbero({ nombre: ' C ' })).toEqual([{ campo: 'nombre', problema: 'longitud' }]);
    expect(problemasDeBarbero({ nombre: 'a'.repeat(81) })).toEqual([
      { campo: 'nombre', problema: 'longitud' },
    ]);
  });
});
