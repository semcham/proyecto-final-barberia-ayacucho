import { llamarPlataforma } from './plataforma';
import type { components } from './schema-007';

// T038 de 007 · Indicadores agregados de la plataforma (specs/007-indicadores-datos-personales/contracts/openapi.yaml,
// GET /plataforma/indicadores). Tipos generados del contrato con `npm run gen:api`. Solo con la sesión de la
// plataforma: usa su propio cliente y su propio token.

export type Indicadores = components['schemas']['Indicadores'];

export const clavesIndicadores = {
  todos: ['plataforma', 'indicadores'] as const,
};

export const apiIndicadores = {
  /** Solo conteos de todas las barberías; sin citasPorMes ni usuarios mientras no existan las vistas de conteo. */
  consultar: () => llamarPlataforma<Indicadores>('/plataforma/indicadores'),
};
