import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { AuditLog, KyselyAuditLog } from './audit/audit-log';
import { CacheCompartida } from './cache/cache-compartida';
import { CacheInactiva } from './cache/cache-inactiva';
import { RedisCacheCompartida } from './cache/redis-cache-compartida';
import { Clock, RelojDelSistema } from './clock/clock';
import { Configuracion } from './config/configuracion';
import {
  BASE_DE_DATOS,
  type BaseDeDatos,
  crearBaseDeDatos,
  VerificadorBaseDeDatos,
  VerificadorMigraciones,
} from './persistence/database';
import { KyselyUnitOfWork } from './persistence/kysely-unit-of-work';
import { LecturaPlataforma } from './persistence/lectura-plataforma';
import { CandadoPostgres, RegistroDeCorridasPostgres } from './persistence/tareas-postgres';
import { UnitOfWork } from './persistence/unit-of-work';
import { EjecutorTareas } from './tareas/ejecutor-tareas';
import { TenantContext } from './tenant/tenant-context';

/**
 * M06 Núcleo compartido: configuración, contexto de tenant, persistencia, auditoría, reloj y caché
 * compartida (ADR-029: Redis si hay REDIS_URL; si no, CacheInactiva).
 *
 * LecturaPlataforma (ADR-031) es un único pool del rol de solo lectura de la plataforma para toda la
 * aplicación. Se inyecta por su clase, que solo pueden importar las carpetas infrastructure/plataforma/ de M03
 * y M01 (regla lectura-plataforma-confinada de PR14).
 */
@Global()
@Module({
  providers: [
    Configuracion,
    TenantContext,
    { provide: Clock, useClass: RelojDelSistema },
    {
      provide: CacheCompartida,
      inject: [Configuracion, Clock],
      useFactory: (configuracion: Configuracion, reloj: Clock): CacheCompartida =>
        configuracion.redisUrl ? new RedisCacheCompartida(configuracion, reloj) : new CacheInactiva(),
    },
    {
      provide: BASE_DE_DATOS,
      inject: [Configuracion],
      useFactory: (configuracion: Configuracion) =>
        crearBaseDeDatos(configuracion.databaseUrlApp, configuracion.pools.appMax),
    },
    {
      provide: VerificadorBaseDeDatos,
      inject: [BASE_DE_DATOS],
      useFactory: (db: BaseDeDatos) => new VerificadorBaseDeDatos(db),
    },
    {
      provide: VerificadorMigraciones,
      inject: [BASE_DE_DATOS],
      useFactory: (db: BaseDeDatos) => new VerificadorMigraciones(db),
    },
    {
      provide: LecturaPlataforma,
      inject: [Configuracion],
      useFactory: (configuracion: Configuracion) =>
        LecturaPlataforma.conectar(configuracion.plataforma.databaseUrl, configuracion.pools.plataformaMax),
    },
    {
      // Ejecutor de tareas programadas (ADR-024). Las tareas las registra el host (host/tareas.ts).
      provide: EjecutorTareas,
      inject: [Configuracion, BASE_DE_DATOS, Clock],
      useFactory: (configuracion: Configuracion, db: BaseDeDatos, reloj: Clock) =>
        new EjecutorTareas({
          ...configuracion.tareas,
          replica: configuracion.instanciaId ?? `local-${process.pid}`,
          candado: new CandadoPostgres(db),
          registro: new RegistroDeCorridasPostgres(db),
          reloj,
        }),
    },
    KyselyUnitOfWork,
    { provide: UnitOfWork, useExisting: KyselyUnitOfWork },
    { provide: AuditLog, useClass: KyselyAuditLog },
  ],
  exports: [
    Configuracion,
    TenantContext,
    Clock,
    CacheCompartida,
    BASE_DE_DATOS,
    VerificadorBaseDeDatos,
    VerificadorMigraciones,
    LecturaPlataforma,
    EjecutorTareas,
    KyselyUnitOfWork,
    UnitOfWork,
    AuditLog,
  ],
})
export class SharedModule implements OnApplicationShutdown {
  constructor(
    @Inject(BASE_DE_DATOS) private readonly db: BaseDeDatos,
    private readonly lecturaPlataforma: LecturaPlataforma,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.db.destroy(), this.lecturaPlataforma.cerrar()]);
  }
}
