import { describe, expect, it } from 'vitest';
import {
  celdasDeHoja,
  duracionDeCelda,
  nombresDePegado,
  precioDeCelda,
  serviciosDePegado,
} from '../src/pages/panel/carga/pegado-de-hoja';

// T024 de 011 · Pegado desde una hoja de cálculo (contracts/pantallas.md): solo ordena lo pegado; no valida.

describe('celdasDeHoja', () => {
  it('separa filas por salto de línea (\\r\\n o \\n) y columnas por tabulación', () => {
    expect(celdasDeHoja('Corte\t30\t25\r\nBarba\t20\t15\n')).toEqual([
      ['Corte', '30', '25'],
      ['Barba', '20', '15'],
    ]);
  });

  it('respeta las celdas entre comillas de Excel, con tabulación, salto o comillas dentro', () => {
    expect(celdasDeHoja('"Corte\ty barba"\t50\t30\n"Con ""estilo""\nespecial"\t30\t20')).toEqual([
      ['Corte y barba', '50', '30'],
      ['Con "estilo" especial', '30', '20'],
    ]);
  });

  it('ignora las líneas vacías y quita los espacios de los extremos', () => {
    expect(celdasDeHoja('\n  Corte \t 30 \t 25 \n\t\t\n\n')).toEqual([['Corte', '30', '25']]);
  });
});

describe('precio y duración', () => {
  it.each([
    ['S/ 25,50', '25.50'],
    ['S/30', '30'],
    ['s/. 12', '12'],
    ['25.5', '25.5'],
    ['25,5', '25.5'],
    ['veinte', 'veinte'],
    ['', ''],
  ])('precio %p → %p', (celda, esperado) => {
    expect(precioDeCelda(celda)).toBe(esperado);
  });

  it.each([
    ['30 min', '30'],
    ['45', '45'],
    ['7,5', '7.5'],
    ['media hora', 'media hora'],
  ])('duración %p → %p', (celda, esperado) => {
    expect(duracionDeCelda(celda)).toBe(esperado);
  });
});

describe('serviciosDePegado', () => {
  it('descarta el encabezado y normaliza precio y duración', () => {
    const r = serviciosDePegado('Nombre\tDuración\tPrecio\nCorte\t30 min\tS/ 25,50\nBarba\t20\t15', 50);
    expect(r).toEqual({
      filas: [
        { nombre: 'Corte', duracion: '30', precio: '25.50', descripcion: '' },
        { nombre: 'Barba', duracion: '20', precio: '15', descripcion: '' },
      ],
      fuera: 0,
    });
  });

  it('las columnas que faltan quedan vacías y las que sobran se ignoran', () => {
    expect(serviciosDePegado('Corte\nBarba\t20\t15\tCon navaja\textra', 50).filas).toEqual([
      { nombre: 'Corte', duracion: '', precio: '', descripcion: '' },
      { nombre: 'Barba', duracion: '20', precio: '15', descripcion: 'Con navaja' },
    ]);
  });

  it('respeta el tope: agrega las que caben y dice cuántas quedaron fuera', () => {
    const texto = Array.from({ length: 8 }, (_, i) => `Servicio ${i + 1}\t30\t20`).join('\n');
    const r = serviciosDePegado(texto, 5);
    expect(r.filas).toHaveLength(5);
    expect(r.fuera).toBe(3);
    expect(serviciosDePegado(texto, 0)).toEqual({ filas: [], fuera: 8 });
  });

  it('una primera fila con datos no se toma por encabezado', () => {
    expect(serviciosDePegado('Nombre\t30\t20', 50).filas).toHaveLength(1);
  });
});

describe('nombresDePegado', () => {
  it('toma solo la primera columna de cada línea', () => {
    expect(nombresDePegado('Barbero\nCarlos Ñaupa\t966\nAna Pillaca', 50)).toEqual({
      filas: ['Carlos Ñaupa', 'Ana Pillaca'],
      fuera: 0,
    });
  });
});
