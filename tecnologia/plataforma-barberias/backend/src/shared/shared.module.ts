import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { AuditLog, KyselyAuditLog } from './audit/audit-log';
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

/** M06 Núcleo compartido: configuración, contexto de tenant, persistencia, auditoría y reloj. */
@Global()
@Module({
  providers: [
    Configuracion,
    TenantContext,
    { provide: Clock, useClass: RelojDelSistema },
    {
      provide: BASE_DE_DATOS,
      inject: [Configuracion],
      useFactory: (configuracion: Configuracion) => crearBaseDeDatos(configuracion.databaseUrlApp),
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
