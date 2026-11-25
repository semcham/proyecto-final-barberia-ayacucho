import { Barbero, problemasDeBarbero } from '../../../src/modules/catalogo-citas/catalogo/domain/barbero';
import { problemasDeServicio, Servicio } from '../../../src/modules/catalogo-citas/catalogo/domain/servicio';

// 011 (T003; SC-005): para el mismo dato, la creación individual y la carga en lote dicen lo mismo. Servicio.crear y
// Barbero.crear fallan con el PRIMER problema de la lista que usa la carga, o no fallan si la lista está vacía.

const ID = '0190a1b2-c3d4-7e5f-8a9b-000000000001';

const errorDe = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { detalles: { campo: string; problema: string }[] }).detalles[0];
  }
};

const NOMBRES = ['a', 'ab', '  ab  ', 'a'.repeat(80), 'a'.repeat(81), '   ', 'Corte clásico'];
const DURACIONES = [0, 4, 5, 7, 30, 30.5, 480, 485];
const PRECIOS = ['25', '25.5', '25.50', '25.555', '-1', '100000', 'abc', '0'];
const DESCRIPCIONES = [undefined, null, '', 'x'.repeat(300), 'x'.repeat(301)];

describe('Servicio: la carga y la creación individual coinciden', () => {
  const casos = NOMBRES.flatMap((nombre) =>
    DURACIONES.flatMap((duracionMin) =>
      PRECIOS.flatMap((precio) =>
        DESCRIPCIONES.map((descripcion) => ({ nombre, duracionMin, precio, descripcion })),
      ),
    ),
  );

  it(`${casos.length} combinaciones`, () => {
    for (const datos of casos) {
      const enLote = problemasDeServicio(datos);
      expect({ datos, error: errorDe(() => Servicio.crear(ID, datos)) }).toEqual({
        datos,
        error: enLote[0] ?? null,
      });
    }
  });

  it('editar también falla con el primer problema', () => {
    const servicio = Servicio.crear(ID, { nombre: 'Corte', precio: '20', duracionMin: 30 });
    expect(errorDe(() => servicio.editar({ duracionMin: 7 }))).toEqual({
      campo: 'duracionMinutos',
      problema: 'multiplo_de_5',
    });
    expect(errorDe(() => servicio.editar({ precio: '1,5' }))).toEqual({
      campo: 'precio',
      problema: 'formato',
    });
  });
});

describe('Barbero: la carga y la creación individual coinciden', () => {
  it.each(NOMBRES)('nombre %p', (nombre) => {
    const enLote = problemasDeBarbero({ nombre });
    expect(errorDe(() => Barbero.crear(ID, { nombre, usuarioId: null, servicioIds: [] }))).toEqual(
      enLote[0] ?? null,
    );
  });
});
