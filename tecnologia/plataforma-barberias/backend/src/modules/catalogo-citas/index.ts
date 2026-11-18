// Interfaz pública de M02 Catálogo y citas: lo único que pueden importar el host y otros módulos
// (M04 en la funcionalidad 005).
export { CatalogoCitasModule } from './catalogo-citas.module';
export {
  PermisosCatalogoCitas,
  OPERACIONES_CATALOGO_CITAS,
  type OperacionCatalogoCitas,
  type Alcance,
} from './catalogo/domain/permisos';
// 004 (T093): la tarea purgar-intentos-enlaces, que registra el host (host/tareas.ts).
export { PurgarIntentosEnlace } from './citas/application/purgar-intentos-enlace';
// 008 (T051): la tarea vencer-adelantos, que registra el host cada 60 s.
export { VencerAdelantos } from './citas/application/vencer-adelantos';
// 007 (fase 2c, research R01): fuente de indicadores de la plataforma. Solo la registra host/indicadores.ts (regla de
// PR14 indicadores-solo-por-registro).
export { CitasPorMesIndicador } from './citas/infrastructure/plataforma/citas-por-mes-indicador';
// 005 (T009, research R01): la interfaz de solo lectura que usa M04 (asistente y reportes).
export {
  CatalogoCitasApi,
  type ActividadDeCitas,
  type BarberoVisible,
  type ConsultaDeHorariosLibres,
  type ConteosDeCitas,
  type ContextoDeLaBarberia,
  type HorariosLibresVista,
  type ServicioPublico,
  type ServicioSolicitado,
} from './catalogo-citas-api';
