// Interfaz pública de M06 Núcleo compartido.
export { ErrorDeAplicacion, SinContextoDeTenant } from './errores';
export { TenantId } from './tenant/tenant-id';
export { TenantContext, type DatosSolicitud } from './tenant/tenant-context';
export { Clock, RelojDelSistema } from './clock/clock';
export { Configuracion } from './config/configuracion';
export { UnitOfWork } from './persistence/unit-of-work';
export { KyselyUnitOfWork } from './persistence/kysely-unit-of-work';
export { VerificadorBaseDeDatos, BASE_DE_DATOS, type BaseDeDatos } from './persistence/database';
export type { Database } from './persistence/db-types';
export { AuditLog, type EntradaAuditoria, type AccionAuditada } from './audit/audit-log';
export { SharedModule } from './shared.module';
export { Publica, RequiereOperacion, ActorActual, CLAVE_PUBLICA, CLAVE_OPERACION } from './http/decoradores';
