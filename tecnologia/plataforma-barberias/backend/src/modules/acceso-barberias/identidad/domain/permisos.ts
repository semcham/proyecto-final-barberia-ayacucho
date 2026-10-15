import type { CodigoRol } from './rol';

/** Operaciones protegidas de M01 (contracts/rbac.md). Las operaciones públicas no necesitan permiso. */
export const OPERACIONES = [
  'VER_USUARIO_ACTUAL',
  'CERRAR_SESION',
  'LISTAR_USUARIOS',
  'VER_USUARIO',
  'CREAR_USUARIO',
  'ACTUALIZAR_USUARIO',
  'REGENERAR_ACTIVACION',
] as const;
export type Operacion = (typeof OPERACIONES)[number];

// Matriz operación → roles permitidos. Debe coincidir con contracts/rbac.md (lo verifica una prueba).
const MATRIZ: Readonly<Record<Operacion, readonly CodigoRol[]>> = {
  VER_USUARIO_ACTUAL: ['PROPIETARIO', 'BARBERO'],
  CERRAR_SESION: ['PROPIETARIO', 'BARBERO'],
  LISTAR_USUARIOS: ['PROPIETARIO'],
  VER_USUARIO: ['PROPIETARIO'],
  CREAR_USUARIO: ['PROPIETARIO'],
  ACTUALIZAR_USUARIO: ['PROPIETARIO'],
  REGENERAR_ACTIVACION: ['PROPIETARIO'],
};

/** Regla de dominio pura de autorización por rol (R22). La aplican el caso de uso y el guard HTTP. */
export const Permisos = {
  permite(rol: CodigoRol, operacion: Operacion): boolean {
    return MATRIZ[operacion].includes(rol);
  },
  rolesPermitidos(operacion: Operacion): readonly CodigoRol[] {
    return MATRIZ[operacion];
  },
};
