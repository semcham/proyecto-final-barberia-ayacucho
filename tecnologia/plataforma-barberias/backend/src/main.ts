import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './host/app.module';
import { middlewareContextoSolicitud } from './host/contexto-solicitud';
import { crearValidationPipe, RechazarCaracteresDeControl } from './host/validacion';
import { Configuracion, TenantContext } from './shared';

const RUTA_NOTIFICACIONES = '/api/v1/pagos/notificaciones';

/**
 * Configuración HTTP común a la aplicación real y a las pruebas (T046). La aplicación debe crearse con
 * `bodyParser: false` para que aquí se fije el límite de 16 KB.
 */
export function configurarApp(app: NestExpressApplication): void {
  const configuracion = app.get(Configuracion);
  app.setGlobalPrefix('api/v1');
  // Detrás del balanceador (ADR-030): la IP del cliente se toma de X-Forwarded-For SOLO si la conexión llega
  // desde un proxy de confianza (PROXIES_CONFIABLES: la IP de Nginx en Compose; loopback por defecto).
  // Nginx sobrescribe ese encabezado, así que un valor enviado por el cliente no cambia la IP (006 R04).
  app.set('trust proxy', configuracion.proxiesConfiables);
  app.disable('x-powered-by');
  const instancia = configuracion.instanciaId;
  if (instancia) {
    // Nombre lógico de la réplica que atendió (006 R14): demuestra el reparto sin leer registros.
    app.use(
      (_solicitud: unknown, respuesta: { setHeader(n: string, v: string): void }, siguiente: () => void) => {
        respuesta.setHeader('X-Instancia', instancia);
        siguiente();
      },
    );
  }
  // 003 (FR-013): la firma del proveedor se verifica sobre el cuerpo crudo, así que el parser lo conserva para
  // la ruta de notificaciones (y solo para ella). El límite de 16 KB es el mismo para todas las rutas.
  app.useBodyParser('json', {
    limit: '16kb',
    verify: (solicitud: { url?: string; cuerpoCrudo?: Buffer }, _respuesta: unknown, cuerpo: Buffer) => {
      if (solicitud.url?.startsWith(RUTA_NOTIFICACIONES)) solicitud.cuerpoCrudo = Buffer.from(cuerpo);
    },
  } as Parameters<NestExpressApplication['useBodyParser']>[1]);
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
