import type { ProblemaDeFila } from './errores';
import { type DatosServicio, problemasDeServicio } from './servicio';

/**
 * 011 · Carga en lote del catálogo (research R02, R03, R08; data-model §2). Reglas puras: arman los errores y las
 * advertencias de cada fila con las MISMAS reglas que la creación individual (`problemasDeServicio`), más las que solo
 * tienen sentido en un lote (precio que falta, nombres repetidos dentro de la carga o ya existentes).
 */

/** Máximo de filas por carga (FR-001, FR-006). */
export const MAX_FILAS_LOTE = 50;

export interface FilaServicio {
  nombre: string;
  /** null si la celda quedó vacía. */
  duracionMinutos: number | null;
  /** Texto tal como lo envió la interfaz; vacío si falta. */
  precio: string;
  descripcion?: string | null;
}

export interface RevisionDeCarga {
  /** Filas con algún dato (las completamente vacías no cuentan). */
  filas: number;
  errores: ProblemaDeFila[];
  advertencias: ProblemaDeFila[];
}

/** Una fila lista para crear: su número (desde 1, en el orden enviado) y sus datos. */
export interface FilaUtil<T> {
  fila: number;
  datos: T;
}

/** Clave de comparación de nombres: como el índice `service_nombre_unico` (`lower(name)` del nombre recortado). */
export const claveDeNombre = (nombre: string): string => nombre.trim().toLowerCase();

const vacio = (texto: string | null | undefined): boolean => (texto ?? '').trim() === '';

function filaDeServicioVacia(fila: FilaServicio): boolean {
  return vacio(fila.nombre) && fila.duracionMinutos === null && vacio(fila.precio) && vacio(fila.descripcion);
}

/**
 * Revisa una carga de servicios. `nombresExistentes`: claves (`claveDeNombre`) de TODOS los servicios de la barbería,
 * activos o no. Devuelve la revisión y las filas útiles convertidas a `DatosServicio`.
 */
export function revisarServicios(
  filas: readonly FilaServicio[],
  nombresExistentes: ReadonlySet<string>,
): RevisionDeCarga & { utiles: FilaUtil<DatosServicio>[] } {
  const errores: ProblemaDeFila[] = [];
  const utiles: FilaUtil<DatosServicio>[] = [];
  const porNombre = new Map<string, number[]>();

  filas.forEach((fila, indice) => {
    if (filaDeServicioVacia(fila)) return;
    const numero = indice + 1;
    const datos: DatosServicio = {
      nombre: fila.nombre,
      descripcion: fila.descripcion ?? null,
      precio: fila.precio.trim(),
      // Una duración vacía no es un número: la regla de siempre la marca como fuera de rango.
      duracionMin: fila.duracionMinutos ?? Number.NaN,
    };
    utiles.push({ fila: numero, datos });

    // Precio que falta (ajuste del 2026-11-25): se distingue del mal escrito y no se suma "formato".
    const faltaPrecio = datos.precio === '';
    if (faltaPrecio) errores.push({ fila: numero, campo: 'precio', problema: 'falta' });
    for (const p of problemasDeServicio(datos)) {
      if (faltaPrecio && p.campo === 'precio') continue;
      errores.push({ fila: numero, ...p });
    }

    if (!vacio(fila.nombre)) {
      const clave = claveDeNombre(fila.nombre);
      porNombre.set(clave, [...(porNombre.get(clave) ?? []), numero]);
      if (nombresExistentes.has(clave))
        errores.push({ fila: numero, campo: 'nombre', problema: 'ya_existe' });
    }
  });

  for (const numeros of porNombre.values()) {
    if (numeros.length < 2) continue;
    for (const numero of numeros)
      errores.push({ fila: numero, campo: 'nombre', problema: 'repetido_en_carga' });
  }
  if (utiles.length === 0) errores.push({ fila: null, campo: 'filas', problema: 'vacia' });

  return { filas: utiles.length, errores: ordenar(errores), advertencias: [], utiles };
}

/** Por fila y, dentro de la fila, en el orden de las columnas de la tabla. */
const COLUMNAS = ['nombre', 'duracionMinutos', 'precio', 'descripcion', 'servicioIds'];
function ordenar(problemas: ProblemaDeFila[]): ProblemaDeFila[] {
  return [...problemas].sort(
    (a, b) =>
      (a.fila ?? 0) - (b.fila ?? 0) || (COLUMNAS.indexOf(a.campo) >>> 0) - (COLUMNAS.indexOf(b.campo) >>> 0),
  );
}
