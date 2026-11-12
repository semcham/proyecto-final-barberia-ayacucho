// Interfaz pública de M03 Suscripciones y pagos: lo único que pueden importar otros módulos y el host.
export { SuscripcionesPagosModule } from './suscripciones-pagos.module';
export { SuscripcionesApi } from './suscripciones-api';
export type { ResumenSuscripcion } from './suscripciones/application/iniciar-prueba-gratuita';
export { SuscripcionNoPermite } from './suscripciones/domain/errores';
export { ACCIONES_SUSCRIPCION, type AccionSuscripcion } from './suscripciones/domain/accion-suscripcion';
export type { EstadoOperativo } from './suscripciones/application/exigir-operacion';
export type { ResumenDeSuscripcion } from './plataforma/application/ports/resumenes-de-suscripcion';
export {
  PermisosSuscripciones,
  OPERACIONES_SUSCRIPCIONES,
  type OperacionSuscripciones,
} from './suscripciones/domain/permisos';
export { ConciliarPagos } from './pagos/application/conciliar-pagos';
export { ExpirarTransferencias } from './pagos/application/expirar-transferencias';
export { VencerSuscripciones } from './suscripciones/application/vencer-suscripciones';
export { AvisarFinDePrueba } from './suscripciones/application/avisar-fin-de-prueba';
// Funcionalidad 008 (research R01): lo único del adelanto que ven M02 y el host.
export {
  AdelantosApi,
  type AdelantoParaReservar,
  type CandidatoPorVencer,
  type DatosDelAdelantoNuevo,
  type ResultadoDeVencimiento,
  type ResumenDeAdelanto,
} from './adelantos-api';
export type { CancelacionDeLaCita, CausaDeVencimiento, EstadoAdelanto } from './adelantos/domain/adelanto';
export { AdelantoPendiente, SinTiempoParaAdelanto } from './adelantos/domain/errores';
