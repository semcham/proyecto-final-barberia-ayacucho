import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccesoBarberiasModule } from '../modules/acceso-barberias';
import { SharedModule } from '../shared';
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
    // Freno general por instancia (R10). El límite estricto del inicio de sesión vive en PostgreSQL (US2).
    ThrottlerModule.forRoot({ throttlers: [{ name: 'general', ttl: 60_000, limit: 300 }] }),
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
