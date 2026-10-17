// Interfaz pública de M02 Catálogo y citas: lo único que pueden importar el host y otros módulos
// (M04 en la funcionalidad 005).
export { CatalogoCitasModule } from './catalogo-citas.module';
export {
  PermisosCatalogoCitas,
  OPERACIONES_CATALOGO_CITAS,
  type OperacionCatalogoCitas,
  type Alcance,
} from './catalogo/domain/permisos';
