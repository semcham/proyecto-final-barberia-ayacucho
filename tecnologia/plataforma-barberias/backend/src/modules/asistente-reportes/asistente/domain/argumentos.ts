import { FechaInvalida, FechaLocal } from '../../../../shared/nucleo';

// T040 de 005 · Resolución de los argumentos del modelo DENTRO de la barbería del token (contracts/asistente.md §2,
// FR-004, FR-014, FR-017): el servicio y el barbero solo se buscan en la lista que el backend leyó de la barbería
// (nunca en otra), sin tildes ni mayúsculas, primero exacto y después por prefijo; la fecha se valida contra el día de
// hoy de la barbería y el horizonte de reserva. Reglas puras.

/** Minúsculas, sin tildes y con un solo espacio entre palabras. */
export function normalizarNombre(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export type Resolucion<T> =
  { tipo: 'unico'; valor: T } | { tipo: 'ninguno' } | { tipo: 'varios'; opciones: T[] };

export function resolverPorNombre<T extends { nombre: string }>(
  buscado: string,
  candidatos: readonly T[],
): Resolucion<T> {
  const clave = normalizarNombre(buscado);
  if (clave === '') return { tipo: 'ninguno' };
  const exactos = candidatos.filter((c) => normalizarNombre(c.nombre) === clave);
  if (exactos.length === 1) return { tipo: 'unico', valor: exactos[0] };
  if (exactos.length > 1) return { tipo: 'varios', opciones: exactos };
  const porPrefijo = candidatos.filter((c) => normalizarNombre(c.nombre).startsWith(clave));
  if (porPrefijo.length === 1) return { tipo: 'unico', valor: porPrefijo[0] };
  if (porPrefijo.length > 1) return { tipo: 'varios', opciones: porPrefijo };
  return { tipo: 'ninguno' };
}

export type FechaDeHorarios =
  | { tipo: 'valida'; fecha: FechaLocal }
  | { tipo: 'formato'; valor: string }
  | { tipo: 'pasada'; fecha: FechaLocal }
  | { tipo: 'fuera_del_horizonte'; ultimo: FechaLocal };

/** La fecha de una consulta de horarios: existe, no es pasada y está dentro del horizonte de reserva. */
export function validarFechaDeHorarios(
  valor: string,
  hoy: FechaLocal,
  horizonteDias: number,
): FechaDeHorarios {
  let fecha: FechaLocal;
  try {
    fecha = FechaLocal.de(valor);
  } catch (error) {
    if (error instanceof FechaInvalida) return { tipo: 'formato', valor };
    throw error;
  }
  const dias = fecha.diasDesde(hoy);
  if (dias < 0) return { tipo: 'pasada', fecha };
  if (dias > horizonteDias) return { tipo: 'fuera_del_horizonte', ultimo: hoy.sumarDias(horizonteDias) };
  return { tipo: 'valida', fecha };
}
