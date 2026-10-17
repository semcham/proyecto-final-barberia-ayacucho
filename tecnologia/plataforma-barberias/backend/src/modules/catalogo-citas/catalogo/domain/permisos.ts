/**
 * T027 · Matriz rol × operación de M02 (specs/002-catalogo-citas-cliente/contracts/rbac.md). Regla de
 * dominio pura: la aplican el guard HTTP del host y cada caso de uso (R22 de 001). Una prueba la compara
 * con la tabla del contrato.
 */

/** Roles con membresía en una barbería (los mismos códigos que M01; aquí sin depender de M01). */
export type RolActor = 'PROPIETARIO' | 'BARBERO' | 'CLIENTE';

/** TODOS: sobre cualquier recurso de la barbería. PROPIOS: solo sus citas o su barbero vinculado. */
export type Alcance = 'TODOS' | 'PROPIOS';

export const OPERACIONES_CATALOGO_CITAS = [
  'VER_HORARIO_ATENCION',
  'GESTIONAR_HORARIO_ATENCION',
  'VER_CATALOGO',
  'GESTIONAR_SERVICIOS',
  'GESTIONAR_BARBEROS',
  'GESTIONAR_DISPONIBILIDAD',
  'GESTIONAR_BLOQUEOS',
  'CONSULTAR_HORARIOS',
  'RESERVAR_CITA',
  'CANCELAR_CITA',
  'CAMBIAR_ESTADO_CITA',
  'VER_AGENDA',
  'VER_HISTORIAL',
] as const;
export type OperacionCatalogoCitas = (typeof OPERACIONES_CATALOGO_CITAS)[number];

const MATRIZ: Readonly<Record<OperacionCatalogoCitas, Readonly<Partial<Record<RolActor, Alcance>>>>> = {
  VER_HORARIO_ATENCION: { PROPIETARIO: 'TODOS', BARBERO: 'TODOS' },
  GESTIONAR_HORARIO_ATENCION: { PROPIETARIO: 'TODOS' },
  VER_CATALOGO: { PROPIETARIO: 'TODOS', BARBERO: 'TODOS' },
  GESTIONAR_SERVICIOS: { PROPIETARIO: 'TODOS' },
  GESTIONAR_BARBEROS: { PROPIETARIO: 'TODOS' },
  GESTIONAR_DISPONIBILIDAD: { PROPIETARIO: 'TODOS', BARBERO: 'PROPIOS' },
  GESTIONAR_BLOQUEOS: { PROPIETARIO: 'TODOS', BARBERO: 'PROPIOS' },
  CONSULTAR_HORARIOS: { PROPIETARIO: 'TODOS', CLIENTE: 'TODOS' },
  RESERVAR_CITA: { PROPIETARIO: 'TODOS', CLIENTE: 'PROPIOS' },
  CANCELAR_CITA: { PROPIETARIO: 'TODOS', CLIENTE: 'PROPIOS' },
  CAMBIAR_ESTADO_CITA: { PROPIETARIO: 'TODOS', BARBERO: 'PROPIOS' },
  VER_AGENDA: { PROPIETARIO: 'TODOS', BARBERO: 'PROPIOS' },
  VER_HISTORIAL: { CLIENTE: 'PROPIOS' },
};

export const PermisosCatalogoCitas = {
  permite(rol: RolActor, operacion: OperacionCatalogoCitas): boolean {
    return MATRIZ[operacion][rol] !== undefined;
  },
  /** Alcance del rol en la operación, o null si no la tiene permitida. */
  alcance(rol: RolActor, operacion: OperacionCatalogoCitas): Alcance | null {
    return MATRIZ[operacion][rol] ?? null;
  },
  rolesPermitidos(operacion: OperacionCatalogoCitas): readonly RolActor[] {
    return Object.keys(MATRIZ[operacion]) as RolActor[];
  },
};
