import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, ThrottlerStorageService } from '@nestjs/throttler';
import { AccesoBarberiasModule } from '../modules/acceso-barberias';
import { CatalogoCitasModule } from '../modules/catalogo-citas';
import { AlmacenLimitesCompartido, CacheCompartida, SharedModule } from '../shared';
import { AuthGuard } from './auth.guard';
import { ErrorFilter } from './error.filter';
import { RolesGuard } from './roles.guard';
import { SaludController } from './salud.controller';
import { TenantHeaderInterceptor } from './tenant-header.interceptor';

/**
 * Raíz de composición: único lugar que ensambla los módulos y aplica guards, filtros e interceptores.
 * Orden de los guards globales: límite general de solicitudes → autenticación → autorización por rol.
 */
@Module({
  imports: [
    SharedModule,
    AccesoBarberiasModule,
    CatalogoCitasModule,
    // Freno general por IP, compartido entre réplicas en la caché (006 US3, ADR-029), con respaldo en
    // memoria por instancia si Redis no responde. El límite estricto del inicio de sesión vive en
    // PostgreSQL (US2 de 001, principio VIII).
    ThrottlerModule.forRootAsync({
      inject: [CacheCompartida],
      useFactory: (cache: CacheCompartida) => ({
        throttlers: [{ name: 'general', ttl: 60_000, limit: 300 }],
        storage: new AlmacenLimitesCompartido(cache, new ThrottlerStorageService()),
      }),
    }),
  ],
  controllers: [SaludController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantHeaderInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
