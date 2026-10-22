// Interfaz pública de M06 Núcleo compartido.
export { ErrorDeAplicacion, SinContextoDeTenant } from './errores';
export { TenantId } from './tenant/tenant-id';
export { TenantContext, type DatosSolicitud } from './tenant/tenant-context';
export { Clock, RelojDelSistema } from './clock/clock';
export { ZonaHoraria, type MomentoLocal } from './tiempo/zona-horaria';
export { FechaLocal, FechaInvalida } from './tiempo/fecha-local';
export { HorarioSemanal, HorarioInvalido, type Tramo } from './tiempo/horario-semanal';
export { Configuracion } from './config/configuracion';
export { UnitOfWork } from './persistence/unit-of-work';
export { KyselyUnitOfWork } from './persistence/kysely-unit-of-work';
export {
  VerificadorBaseDeDatos,
  VerificadorMigraciones,
  BASE_DE_DATOS,
  type BaseDeDatos,
} from './persistence/database';
export type { Database } from './persistence/db-types';
export { AuditLog, type EntradaAuditoria, type AccionAuditada } from './audit/audit-log';
export { CacheCompartida, type Conteo } from './cache/cache-compartida';
export { ClavesCache, ClaveCache, ClaveGeneracion, ClaveContador } from './cache/claves-cache';
export { SharedModule } from './shared.module';
export { Publica, RequiereOperacion, ActorActual, CLAVE_PUBLICA, CLAVE_OPERACION } from './http/decoradores';
