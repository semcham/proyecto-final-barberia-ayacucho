// Interfaz pública de M04 Asistente IA y reportes: lo único que importa el host (ningún otro módulo puede, regla
// nadie-llama-a-m04 de PR14).
export { AsistenteReportesModule } from './asistente-reportes.module';
export {
  PermisosAsistenteReportes,
  OPERACIONES_ASISTENTE_REPORTES,
  type OperacionAsistenteReportes,
} from './comun/domain/permisos';
