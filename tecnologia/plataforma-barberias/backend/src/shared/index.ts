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
export { Interruptor, type EstadoInterruptor, type OpcionesInterruptor } from './resiliencia/interruptor';
export {
  EjecutorTareas,
  procesarCadaUno,
  type Tarea,
  type ResultadoDeTarea,
  type ResultadoDeCorrida,
} from './tareas/ejecutor-tareas';
export { AlmacenLimitesCompartido } from './limites/almacen-limites-compartido';
// 004 (ADR-025): bus de eventos con salida transaccional. Los módulos publican por el puerto; el despachador
// lo usa solo el host (tarea despachar-eventos). Los enlaces firmados tienen su propia entrada:
// shared/enlaces-firmados.ts.
export {
  BusDeEventos,
  type EventoDeDominio,
  type EventoPublicado,
  type ManejadorDeEvento,
} from './eventos/bus-de-eventos';
export { DespachadorDeEventos } from './eventos/despachador';
export { SharedModule } from './shared.module';
export {
  Publica,
  RequiereOperacion,
  ActorActual,
  Plataforma,
  AdminActual,
  CLAVE_PUBLICA,
  CLAVE_OPERACION,
  CLAVE_PLATAFORMA,
} from './http/decoradores';
