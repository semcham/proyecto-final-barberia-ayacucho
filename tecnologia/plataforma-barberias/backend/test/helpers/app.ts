import type { AddressInfo } from 'node:net';
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/host/app.module';
import { configurarApp } from '../../src/main';

export interface AppDePrueba {
  app: NestExpressApplication;
  /** Agente supertest que conserva las cookies entre solicitudes. */
  agente: ReturnType<typeof request.agent>;
  /** Puerto en 127.0.0.1 si se creó con `escuchar: true` (pruebas con dos instancias o con Nginx). */
  puerto?: number;
  /** `http://127.0.0.1:{puerto}` si se creó con `escuchar: true`. */
  url?: string;
  cerrar(): Promise<void>;
}

/**
 * Levanta la aplicación completa (mismos pipes, filtros, guards y middleware que src/main.ts) contra la
 * base de Testcontainers o temporal (T048). `controladoresExtra` permite montar rutas solo de prueba.
 *
 * 006 (T017):
 * - `entorno`: variables que se fijan antes de construir el módulo (las lee `Configuracion` al crearse,
 *   p. ej. `INSTANCIA_ID`, `REDIS_URL`, `CACHE_*`) y se restauran en cuanto la aplicación está iniciada,
 *   para que dos instancias creadas una tras otra no se pisen. Un `undefined` borra la variable.
 * - `escuchar`: la aplicación escucha en un puerto libre de 127.0.0.1 y devuelve `puerto` y `url`.
 */
export async function crearApp(
  opciones: {
    controladoresExtra?: Type[];
    /** Permite sustituir proveedores, p. ej. para simular un fallo a mitad de un caso de uso. */
    ajustar?: (constructor: TestingModuleBuilder) => TestingModuleBuilder;
    entorno?: Record<string, string | undefined>;
    escuchar?: boolean;
  } = {},
): Promise<AppDePrueba> {
  const anteriores = new Map<string, string | undefined>();
  for (const [variable, valor] of Object.entries(opciones.entorno ?? {})) {
    anteriores.set(variable, process.env[variable]);
    if (valor === undefined) delete process.env[variable];
    else process.env[variable] = valor;
  }
  try {
    const constructor = Test.createTestingModule({
      imports: [AppModule],
      controllers: opciones.controladoresExtra ?? [],
    });
    const modulo = await (opciones.ajustar ? opciones.ajustar(constructor) : constructor).compile();
    const app = modulo.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: ['error'],
    });
    configurarApp(app);
    let puerto: number | undefined;
    if (opciones.escuchar) {
      await app.listen(0, '127.0.0.1');
      puerto = (app.getHttpServer().address() as AddressInfo).port;
    } else {
      await app.init();
    }
    return {
      app,
      agente: request.agent(app.getHttpServer()),
      puerto,
      url: puerto === undefined ? undefined : `http://127.0.0.1:${puerto}`,
      cerrar: () => app.close(),
    };
  } finally {
    for (const [variable, valor] of anteriores) {
      if (valor === undefined) delete process.env[variable];
      else process.env[variable] = valor;
    }
  }
}
