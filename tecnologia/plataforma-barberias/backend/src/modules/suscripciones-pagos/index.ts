// Interfaz pública de M03 Suscripciones y pagos: lo único que pueden importar otros módulos y el host.
export { SuscripcionesPagosModule } from './suscripciones-pagos.module';
export { SuscripcionesApi } from './suscripciones-api';
export type { ResumenSuscripcion } from './suscripciones/application/iniciar-prueba-gratuita';
export { SuscripcionNoPermite } from './suscripciones/domain/errores';
export { ACCIONES_SUSCRIPCION, type AccionSuscripcion } from './suscripciones/domain/accion-suscripcion';
export type { EstadoOperativo } from './suscripciones/application/exigir-operacion';
export {
  PermisosSuscripciones,
  OPERACIONES_SUSCRIPCIONES,
  type OperacionSuscripciones,
} from './suscripciones/domain/permisos';
export { ConciliarPagos } from './pagos/application/conciliar-pagos';
