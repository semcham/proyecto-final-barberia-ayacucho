/**
 * T010 de 005 · Matriz rol × operación de M04 (specs/005-asistente-ia-reportes/contracts/rbac.md). Regla de dominio
 * pura: la aplican el guard HTTP del host (una operación por ruta) y cada caso de uso. Una prueba la compara con la
 * tabla del contrato (test/unit/asistente/base-005.spec.ts).
 *
 * - USAR_ASISTENTE es la operación de la RUTA POST /asistente/mensajes, que comparten el cliente y el propietario.
 * - USAR_ASISTENTE_CLIENTE y USAR_ASISTENTE_PROPIETARIO las exige el caso de uso: deciden qué herramientas tiene el
 *   rol (contracts/asistente.md §1). Así el guard no cambia: sigue siendo una operación por ruta.
 * - VER_REPORTES: GET /reportes, solo el propietario.
 *
 * El barbero no tiene ninguna. El administrador de la plataforma no tiene token de barbería (ADR-031).
 *
 * Vive en el submódulo `comun` (005, fase 2) porque la usan los dos submódulos: `reportes` no puede importar nada de
 * `asistente` (regla reportes-sin-ia de PR14).
 */

/** Roles con membresía en una barbería (los mismos códigos que M01; aquí sin depender de M01). */
export type RolEnBarberia = 'PROPIETARIO' | 'BARBERO' | 'CLIENTE';

export const OPERACIONES_ASISTENTE_REPORTES = [
  'USAR_ASISTENTE',
  'USAR_ASISTENTE_CLIENTE',
  'USAR_ASISTENTE_PROPIETARIO',
  'VER_REPORTES',
] as const;
export type OperacionAsistenteReportes = (typeof OPERACIONES_ASISTENTE_REPORTES)[number];

const MATRIZ: Readonly<Record<OperacionAsistenteReportes, readonly RolEnBarberia[]>> = {
  USAR_ASISTENTE: ['PROPIETARIO', 'CLIENTE'],
  USAR_ASISTENTE_CLIENTE: ['CLIENTE'],
  USAR_ASISTENTE_PROPIETARIO: ['PROPIETARIO'],
  VER_REPORTES: ['PROPIETARIO'],
};

export const PermisosAsistenteReportes = {
  permite(rol: RolEnBarberia, operacion: OperacionAsistenteReportes): boolean {
    return MATRIZ[operacion].includes(rol);
  },
};
