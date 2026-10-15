// Interfaz pública de M01 Acceso y barberías: lo único que pueden importar el host y otros módulos.
export { AccesoBarberiasModule } from './acceso-barberias.module';
export { ValidarSolicitud } from './identidad/application/validar-solicitud';
export type { Actor } from './identidad/application/autorizacion';
export { Permisos, OPERACIONES, type Operacion } from './identidad/domain/permisos';
export { NoAutenticado, AccesoDenegado, ValorInvalido } from './identidad/domain/errores';
