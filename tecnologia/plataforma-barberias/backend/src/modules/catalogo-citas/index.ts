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
