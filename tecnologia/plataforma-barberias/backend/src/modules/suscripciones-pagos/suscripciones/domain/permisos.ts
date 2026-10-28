/**
 * T048 · Matriz rol × operación de M03 para las rutas de barbería (specs/003-suscripciones-pagos/contracts/
 * rbac.md). Regla de dominio pura: la aplican el guard HTTP del host y cada caso de uso. El administrador de
 * la plataforma no figura: no tiene token de barbería (ADR-031). Barberos y clientes no ven ni pagan la
 * suscripción; solo saben si la barbería acepta reservas (FR-039).
 */

/** Roles con membresía en una barbería (los mismos códigos que M01; aquí sin depender de M01). */
export type RolEnBarberia = 'PROPIETARIO' | 'BARBERO' | 'CLIENTE';

export const OPERACIONES_SUSCRIPCIONES = [
  'VER_PLANES',
  'VER_SUSCRIPCION',
  'VER_ESTADO_OPERATIVO',
  'PAGAR_SUSCRIPCION',
] as const;
export type OperacionSuscripciones = (typeof OPERACIONES_SUSCRIPCIONES)[number];

const MATRIZ: Readonly<Record<OperacionSuscripciones, readonly RolEnBarberia[]>> = {
  VER_PLANES: ['PROPIETARIO'],
  VER_SUSCRIPCION: ['PROPIETARIO'],
  VER_ESTADO_OPERATIVO: ['PROPIETARIO', 'BARBERO', 'CLIENTE'],
  PAGAR_SUSCRIPCION: ['PROPIETARIO'],
};

export const PermisosSuscripciones = {
  permite(rol: RolEnBarberia, operacion: OperacionSuscripciones): boolean {
    return MATRIZ[operacion].includes(rol);
  },
};
