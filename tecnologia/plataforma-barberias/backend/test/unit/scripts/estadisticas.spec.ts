import { percentil, porcentaje5xx, repartoPorInstancia, resumenTiempos } from '../../../scripts/estadisticas';

// T048 (006) · Estadísticas de las mediciones (medir-horarios y demo-caida): percentiles por rango más
// cercano, porcentaje de 5xx y reparto por X-Instancia.

describe('Estadísticas de las mediciones', () => {
  describe('percentil (rango más cercano)', () => {
    const cien = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100

    it('con 100 valores conocidos, p50 = 50, p95 = 95 y p100 = 100, sin importar el orden', () => {
      const desordenados = [...cien].reverse();
      expect(percentil(desordenados, 50)).toBe(50);
      expect(percentil(desordenados, 95)).toBe(95);
      expect(percentil(desordenados, 100)).toBe(100);
      expect(desordenados[0]).toBe(100); // no ordena la lista recibida
    });

    it('casos borde: lista vacía, un elemento y dos elementos', () => {
      expect(percentil([], 95)).toBeNull();
      expect(percentil([42], 50)).toBe(42);
      expect(percentil([42], 95)).toBe(42);
      expect(percentil([10, 20], 50)).toBe(10);
      expect(percentil([20, 10], 95)).toBe(20);
      expect(percentil([10, 20], 0)).toBe(10);
    });
  });

  it('resumenTiempos: p50, p95 y máximo redondeados a ms', () => {
    expect(resumenTiempos([1.4, 2.6, 3.5, 100.2])).toEqual({ p50_ms: 3, p95_ms: 100, max_ms: 100 });
    expect(resumenTiempos([])).toEqual({ p50_ms: null, p95_ms: null, max_ms: null });
    expect(resumenTiempos([7.7])).toEqual({ p50_ms: 8, p95_ms: 8, max_ms: 8 });
  });

  it('porcentaje5xx: solo cuentan 500–599, con dos decimales; sin solicitudes, 0', () => {
    expect(porcentaje5xx([200, 200, 503, 404, 429, 500])).toBe(33.33);
    expect(porcentaje5xx([200, 201])).toBe(0);
    expect(porcentaje5xx([])).toBe(0);
    expect(porcentaje5xx([502])).toBe(100);
  });

  it('repartoPorInstancia: cuenta por X-Instancia, y sin encabezado como "ninguna"', () => {
    expect(repartoPorInstancia(['backend-1', 'backend-2', 'backend-1', null, undefined])).toEqual({
      'backend-1': 2,
      'backend-2': 1,
      ninguna: 2,
    });
    expect(repartoPorInstancia([])).toEqual({});
  });
});
