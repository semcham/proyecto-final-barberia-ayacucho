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
  cerrar(): Promise<void>;
}

/**
 * Levanta la aplicación completa (mismos pipes, filtros, guards y middleware que src/main.ts) contra la
 * base de Testcontainers o temporal (T048). `controladoresExtra` permite montar rutas solo de prueba.
 */
export async function crearApp(
  opciones: {
    controladoresExtra?: Type[];
    /** Permite sustituir proveedores, p. ej. para simular un fallo a mitad de un caso de uso. */
    ajustar?: (constructor: TestingModuleBuilder) => TestingModuleBuilder;
  } = {},
): Promise<AppDePrueba> {
  const constructor = Test.createTestingModule({
    imports: [AppModule],
    controllers: opciones.controladoresExtra ?? [],
  });
  const modulo = await (opciones.ajustar ? opciones.ajustar(constructor) : constructor).compile();
  const app = modulo.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configurarApp(app);
  await app.init();
  return {
    app,
    agente: request.agent(app.getHttpServer()),
    cerrar: () => app.close(),
  };
}
