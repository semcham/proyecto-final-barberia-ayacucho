// Interfaz pública de M01 Acceso y barberías: lo único que pueden importar el host y otros módulos.
export { AccesoBarberiasModule } from './acceso-barberias.module';
export { ValidarSolicitud } from './identidad/application/validar-solicitud';
export {
  ValidarSolicitudPlataforma,
  type ActorPlataforma,
} from './identidad/application/validar-solicitud-plataforma';
export type { Actor } from './identidad/application/autorizacion';
export { Permisos, OPERACIONES, type Operacion } from './identidad/domain/permisos';
export { NoAutenticado, AccesoDenegado, ValorInvalido } from './identidad/domain/errores';
export { CODIGOS_ROL, type CodigoRol } from './identidad/domain/rol';
export { BarberiaNoDisponible } from './barberias/domain/errores';
// Interfaces públicas para M02 (ADR-020, research R05 de 002).
export {
  PersonalApi,
  ClientesApi,
  BarberiasApi,
  type PerfilClienteResumen,
  type ConfiguracionAgenda,
  type DatosPublicosBarberia,
} from './api-publica';
