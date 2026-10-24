/**
 * T048 (006) · Estadísticas compartidas por `medir-horarios.ts` y `demo-caida.ts`. Sin dependencias.
 */

/** Percentil por rango más cercano, sin modificar la lista; `null` si está vacía. */
export function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, indice)];
}

const redondear = (valor: number | null) => (valor === null ? null : Math.round(valor));

/** p50, p95 y máximo, redondeados a milisegundos. */
export function resumenTiempos(tiemposMs: readonly number[]): {
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
} {
  return {
    p50_ms: redondear(percentil(tiemposMs, 50)),
    p95_ms: redondear(percentil(tiemposMs, 95)),
    max_ms: redondear(percentil(tiemposMs, 100)),
  };
}

/** Porcentaje de respuestas 5xx sobre el total, con dos decimales (0 sin solicitudes). */
export function porcentaje5xx(estados: readonly number[]): number {
  if (estados.length === 0) return 0;
  const errores = estados.filter((estado) => estado >= 500 && estado < 600).length;
  return Number(((100 * errores) / estados.length).toFixed(2));
}

/** Respuestas por réplica según `X-Instancia`; sin encabezado, "ninguna". */
export function repartoPorInstancia(
  instancias: readonly (string | null | undefined)[],
): Record<string, number> {
  const reparto: Record<string, number> = {};
  for (const instancia of instancias) {
    const nombre = instancia ?? 'ninguna';
    reparto[nombre] = (reparto[nombre] ?? 0) + 1;
  }
  return reparto;
}
