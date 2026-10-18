import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './host/app.module';
import { middlewareContextoSolicitud } from './host/contexto-solicitud';
import { crearValidationPipe, RechazarCaracteresDeControl } from './host/validacion';
import { Configuracion, TenantContext } from './shared';

/**
 * Configuración HTTP común a la aplicación real y a las pruebas (T046). La aplicación debe crearse con
 * `bodyParser: false` para que aquí se fije el límite de 16 KB.
 */
export function configurarApp(app: NestExpressApplication): void {
  const configuracion = app.get(Configuracion);
  app.setGlobalPrefix('api/v1');
  // Detrás del balanceador (ADR-006): la IP real del cliente viene en X-Forwarded-For.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '16kb' });
  app.use(cookieParser());
  // Después del parser del cuerpo (ver middlewareContextoSolicitud).
  app.use(middlewareContextoSolicitud(app.get(TenantContext)));
  app.enableCors({ origin: configuracion.corsOrigen, credentials: true });
  app.useGlobalPipes(new RechazarCaracteresDeControl(), crearValidationPipe());
  app.enableShutdownHooks();
}

async function iniciar(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configurarApp(app);
  await app.listen(app.get(Configuracion).puerto);
}

if (require.main === module) {
  void iniciar();
}
