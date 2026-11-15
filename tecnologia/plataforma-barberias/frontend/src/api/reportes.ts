import { llamarApi } from './client';
import type { components } from './schema-005';

// T023 de 005 · Reportes del propietario (specs/005-asistente-ia-reportes/contracts/openapi.yaml, GET /reportes).
// Tipos generados del contrato con `npm run gen:api`.

export type ReportesDelPeriodo = components['schemas']['ReportesDelPeriodo'];
export type ConteosDeCitas = components['schemas']['ConteosDeCitas'];

/** Dos fechas locales de la barbería, YYYY-MM-DD, ambas incluidas. */
export interface PeriodoDeReportes {
  desde: string;
  hasta: string;
}

export const clavesReportes = {
  todos: ['reportes'] as const,
  delPeriodo: ({ desde, hasta }: PeriodoDeReportes) => ['reportes', desde, hasta] as const,
};

export const apiReportes = {
  /** Los tres reportes del período (solo el propietario). Un período inválido responde 422 con el campo. */
  delPeriodo: ({ desde, hasta }: PeriodoDeReportes) =>
    llamarApi<ReportesDelPeriodo>(`/reportes?${new URLSearchParams({ desde, hasta }).toString()}`),
};
