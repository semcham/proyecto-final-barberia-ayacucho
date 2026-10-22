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
} from './persistence/database';
import { KyselyUnitOfWork } from './persistence/kysely-unit-of-work';
import { UnitOfWork } from './persistence/unit-of-work';
import { TenantContext } from './tenant/tenant-context';

/**
 * M06 Núcleo compartido: configuración, contexto de tenant, persistencia, auditoría, reloj y caché
 * compartida (ADR-029: Redis si hay REDIS_URL; si no, CacheInactiva).
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
    KyselyUnitOfWork,
    UnitOfWork,
    AuditLog,
  ],
})
export class SharedModule implements OnApplicationShutdown {
  constructor(@Inject(BASE_DE_DATOS) private readonly db: BaseDeDatos) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
