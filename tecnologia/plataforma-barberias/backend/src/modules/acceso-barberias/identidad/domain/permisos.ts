import type { CodigoRol } from './rol';

/**
 * Operaciones protegidas de M01. Las operaciones públicas no necesitan permiso.
 * Fuentes: specs/001-registro-acceso-barberia/contracts/rbac.md (usuarios y sesión) y
 * specs/002-catalogo-citas-cliente/contracts/rbac.md (barbería, clientes y cambio de barbería).
 */
export const OPERACIONES = [
  'VER_USUARIO_ACTUAL',
  'CERRAR_SESION',
  'LISTAR_USUARIOS',
  'VER_USUARIO',
  'CREAR_USUARIO',
  'ACTUALIZAR_USUARIO',
  'REGENERAR_ACTIVACION',
  // Funcionalidad 002.
  'CAMBIAR_BARBERIA',
  'VER_BARBERIA',
  'ACTUALIZAR_BARBERIA',
  'BUSCAR_CLIENTES',
  'REGISTRAR_CLIENTE_PRESENCIAL',
] as const;
export type Operacion = (typeof OPERACIONES)[number];

// Matriz operación → roles permitidos. Debe coincidir con los rbac.md de 001 y 002 (lo verifican pruebas).
const MATRIZ: Readonly<Record<Operacion, readonly CodigoRol[]>> = {
  VER_USUARIO_ACTUAL: ['PROPIETARIO', 'BARBERO', 'CLIENTE'],
  CERRAR_SESION: ['PROPIETARIO', 'BARBERO', 'CLIENTE'],
  LISTAR_USUARIOS: ['PROPIETARIO'],
  VER_USUARIO: ['PROPIETARIO'],
  CREAR_USUARIO: ['PROPIETARIO'],
  ACTUALIZAR_USUARIO: ['PROPIETARIO'],
  REGENERAR_ACTIVACION: ['PROPIETARIO'],
  // El personal pertenece a una sola barbería: solo el cliente cambia de barbería (ADR-020).
  CAMBIAR_BARBERIA: ['CLIENTE'],
  VER_BARBERIA: ['PROPIETARIO', 'BARBERO'],
  ACTUALIZAR_BARBERIA: ['PROPIETARIO'],
  BUSCAR_CLIENTES: ['PROPIETARIO'],
  REGISTRAR_CLIENTE_PRESENCIAL: ['PROPIETARIO'],
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
