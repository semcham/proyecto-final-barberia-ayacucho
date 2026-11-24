import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, ThrottlerStorageService } from '@nestjs/throttler';
import { AccesoBarberiasModule } from '../modules/acceso-barberias';
import { AsistenteReportesModule } from '../modules/asistente-reportes';
import { CatalogoCitasModule } from '../modules/catalogo-citas';
import { NotificacionesModule } from '../modules/notificaciones';
import { SuscripcionesPagosModule } from '../modules/suscripciones-pagos';
import { AlmacenLimitesCompartido, CacheCompartida, SharedModule } from '../shared';
import { AuthGuard } from './auth.guard';
import { ErrorFilter } from './error.filter';
import { SuscripcionesDeEventos } from './eventos';
import { IndicadoresDeLaPlataforma } from './indicadores';
import { RolesGuard } from './roles.guard';
import { CorreoVerificadoGuard } from './correo-verificado.guard';
import { SaludController } from './salud.controller';
import { TareasProgramadas } from './tareas';
import { TenantHeaderInterceptor } from './tenant-header.interceptor';

/**
 * Raíz de composición: único lugar que ensambla los módulos y aplica guards, filtros e interceptores.
 * Orden de los guards globales: límite general de solicitudes → autenticación → autorización por rol → correo
 * verificado del cliente (010).
 */
@Module({
  imports: [
    SharedModule,
    AccesoBarberiasModule,
    CatalogoCitasModule,
    SuscripcionesPagosModule,
    NotificacionesModule,
    // 005: M04 Asistente IA y reportes (vacío en la fase 1; sus rutas llegan con US2 y US1).
    AsistenteReportesModule,
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
    // 010 (research R05): después de la autorización por rol, el correo verificado del cliente en tres rutas.
    { provide: APP_GUARD, useClass: CorreoVerificadoGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantHeaderInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
    TareasProgramadas,
    SuscripcionesDeEventos,
    // 007 (fase 2b): registra las fuentes de los indicadores de la plataforma en el registro de M06.
    IndicadoresDeLaPlataforma,
  ],
})
export class AppModule {}
