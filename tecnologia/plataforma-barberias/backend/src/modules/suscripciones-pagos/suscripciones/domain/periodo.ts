// Períodos pagados de la suscripción (FR-003, FR-004, FR-005, FR-012a; research R04; data-model.md §3).
// Dominio puro: sin reloj ni base de datos; el instante actual llega como parámetro.

/** Gracia tras terminar un período pagado sin el siguiente (FR-030). La prueba gratuita no tiene gracia. */
export const DIAS_DE_GRACIA = 7;

const DIA_MS = 24 * 60 * 60 * 1000;
/**
 * Los meses se cuentan en la fecha de Lima. Perú no tiene horario de verano desde 1994, así que el desfase
 * es fijo (UTC−5) y no hace falta una base de zonas horarias en el dominio.
 */
const DESFASE_LIMA_MS = -5 * 60 * 60 * 1000;

export interface Periodo {
  id: string;
  pagoId: string;
  planId: string;
  /** Rango semiabierto [inicio, fin). */
  inicio: Date;
  fin: Date;
}

/** Lo que cubrió y cubre la suscripción: la prueba gratuita y los períodos pagados. */
export interface Cobertura {
  finPrueba: Date | null;
  periodos: readonly Periodo[];
}

export type DecisionDeAprobacion =
  | { tipo: 'PERIODO'; inicio: Date; fin: Date }
  | { tipo: 'DUPLICADO'; motivo: 'PERIODO_TOMADO' | 'EXCEDE_ADELANTO' };

/** Un mes calendario de Lima, ajustado al último día del mes (31 de enero → 28 o 29 de febrero). */
export function sumarUnMes(inicio: Date): Date {
  const local = new Date(inicio.getTime() + DESFASE_LIMA_MS);
  const anio = local.getUTCFullYear();
  const mes = local.getUTCMonth() + 1;
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(local.getUTCDate(), ultimoDia);
  const fin = Date.UTC(
    anio,
    mes,
    dia,
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  );
  return new Date(fin - DESFASE_LIMA_MS);
}

export function finDeGracia(finDelPeriodo: Date): Date {
  return new Date(finDelPeriodo.getTime() + DIAS_DE_GRACIA * DIA_MS);
}

const porInicio = (a: Periodo, b: Periodo) => a.inicio.getTime() - b.inicio.getTime();

/** El período que cubre el instante (inicio ≤ instante < fin), si hay uno. */
export function periodoVigente(cobertura: Cobertura, ahora: Date): Periodo | null {
  const t = ahora.getTime();
  return cobertura.periodos.find((p) => p.inicio.getTime() <= t && t < p.fin.getTime()) ?? null;
}

/** El período empezado más reciente (vigente o ya terminado), si hay uno. */
export function ultimoPeriodoEmpezado(cobertura: Cobertura, ahora: Date): Periodo | null {
  const empezados = cobertura.periodos.filter((p) => p.inicio.getTime() <= ahora.getTime()).sort(porInicio);
  return empezados.at(-1) ?? null;
}

/** El primer período empezado (el que termina la prueba), si hay uno. */
export function primerPeriodoEmpezado(cobertura: Cobertura, ahora: Date): Periodo | null {
  return cobertura.periodos.filter((p) => p.inicio.getTime() <= ahora.getTime()).sort(porInicio)[0] ?? null;
}

/** Hasta cuándo está cubierta la suscripción: fin del último período o, si no hay, fin de la prueba. */
export function coberturaHasta(cobertura: Cobertura): Date | null {
  const fines = cobertura.periodos.map((p) => p.fin.getTime());
  if (cobertura.finPrueba) fines.push(cobertura.finPrueba.getTime());
  return fines.length > 0 ? new Date(Math.max(...fines)) : null;
}

/**
 * Dónde empieza el próximo período pagado (FR-004):
 * - con la prueba o un período todavía vigentes, al terminar la cobertura (no se pierden días);
 * - en gracia, al final del período vencido (P2: A);
 * - vencida, al aprobarse (ahora).
 */
export function inicioDelProximoPeriodo(cobertura: Cobertura, ahora: Date): Date {
  const hasta = coberturaHasta(cobertura);
  if (hasta && hasta.getTime() > ahora.getTime()) return hasta;
  const ultimo = ultimoPeriodoEmpezado(cobertura, ahora);
  if (ultimo && ahora.getTime() < finDeGracia(ultimo.fin).getTime()) return ultimo.fin;
  return ahora;
}

/** Ya hay un período pagado que empieza después del instante: el máximo de un período por adelantado. */
export function tienePeriodoPorAdelantado(cobertura: Cobertura, ahora: Date): boolean {
  return cobertura.periodos.some((p) => p.inicio.getTime() > ahora.getTime());
}

/**
 * Regla de aprobación (data-model.md §3; FR-004, FR-012a; H1). `cubreDesde` es el período objetivo que el
 * pago registró al iniciarse (`covers_after`):
 * 1. si ya existe un período que empieza en esa fecha o después, el período objetivo está tomado: DUPLICADO
 *    (dos aprobaciones del "próximo período" no crean dos períodos seguidos);
 * 2. si no, el período empieza donde indica FR-004, y se comprueba otra vez el tope de un período por
 *    adelantado: si se excediera, DUPLICADO.
 * Las restricciones EXCLUDE y UNIQUE (payment_id) de la base son la última barrera.
 */
export function decidirAprobacion(cobertura: Cobertura, cubreDesde: Date, ahora: Date): DecisionDeAprobacion {
  if (cobertura.periodos.some((p) => p.inicio.getTime() >= cubreDesde.getTime())) {
    return { tipo: 'DUPLICADO', motivo: 'PERIODO_TOMADO' };
  }
  const inicio = inicioDelProximoPeriodo(cobertura, ahora);
  if (inicio.getTime() > ahora.getTime() && tienePeriodoPorAdelantado(cobertura, ahora)) {
    return { tipo: 'DUPLICADO', motivo: 'EXCEDE_ADELANTO' };
  }
  return { tipo: 'PERIODO', inicio, fin: sumarUnMes(inicio) };
}

/**
 * Plan que rige en el instante (FR-005): el del período que lo cubre; sin período vigente, el del último
 * período empezado; sin períodos, el de la prueba.
 */
export function planVigente(cobertura: Cobertura, ahora: Date, planDePrueba: string): string {
  return (
    (periodoVigente(cobertura, ahora) ?? ultimoPeriodoEmpezado(cobertura, ahora))?.planId ?? planDePrueba
  );
}
