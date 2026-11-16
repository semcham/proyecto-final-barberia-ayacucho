import type { CodigoRol } from './rol';

/**
 * Operaciones protegidas de M01. Las operaciones públicas no necesitan permiso.
 * Fuentes: specs/001-registro-acceso-barberia/contracts/rbac.md (usuarios y sesión) y
 * specs/002-catalogo-citas-cliente/contracts/rbac.md (barbería, clientes y cambio de barbería) y, desde 004,
 * specs/004-notificaciones-reprogramacion/contracts/rbac.md (canal de aviso).
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
  // Funcionalidad 004 (specs/004-notificaciones-reprogramacion/contracts/rbac.md): canal de aviso y consentimiento
  // de WhatsApp del propio cliente.
  'GESTIONAR_CANAL_AVISO',
  // Funcionalidad 007 (specs/007-indicadores-datos-personales/contracts/rbac.md): solicitudes sobre datos personales.
  'REGISTRAR_SOLICITUD_DATOS',
  'VER_MIS_SOLICITUDES_DATOS',
  'ATENDER_SOLICITUDES_DATOS',
  'REGISTRAR_SOLICITUD_DATOS_EN_NOMBRE',
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
  GESTIONAR_CANAL_AVISO: ['CLIENTE'],
  // 007: el cliente y el barbero registran sobre sus propios datos y ven las suyas; el propietario atiende y registra
  // en nombre de un cliente. El propietario sobre su propia cuenta queda fuera de 007 (FR-005).
  REGISTRAR_SOLICITUD_DATOS: ['BARBERO', 'CLIENTE'],
  VER_MIS_SOLICITUDES_DATOS: ['BARBERO', 'CLIENTE'],
  ATENDER_SOLICITUDES_DATOS: ['PROPIETARIO'],
  REGISTRAR_SOLICITUD_DATOS_EN_NOMBRE: ['PROPIETARIO'],
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
