import { Module } from '@nestjs/common';
import { Configuracion } from '../../shared';
import { CatalogoCitasModule } from '../catalogo-citas';
import { SuscripcionesPagosModule } from '../suscripciones-pagos';
import { AIProvider } from './asistente/application/ports/ai-provider';
import { CuotasDelAsistente } from './asistente/application/ports/cuotas';
import { RegistroDePreguntas } from './asistente/application/ports/registro';
import { PreguntarAlAsistente } from './asistente/application/preguntar-al-asistente';
import { KyselyCuotasDelAsistente } from './asistente/infrastructure/kysely-cuotas';
import { KyselyRegistroDePreguntas } from './asistente/infrastructure/kysely-registro';
import { ProveedorIAFalso } from './asistente/infrastructure/proveedor-ia-falso';
import { ProveedorIANinguno } from './asistente/infrastructure/proveedor-ia-ninguno';
import { ProveedorIAOpenRouter } from './asistente/infrastructure/proveedor-ia-openrouter';
import { AsistenteController } from './asistente/presentation/asistente.controller';
import { AutorizacionAsistenteReportes } from './comun/application/autorizacion';
import { ConsultarReportes } from './reportes/application/consultar-reportes';
import { ReportesController } from './reportes/presentation/reportes.controller';

/**
 * El adaptador del proveedor de IA según IA_PROVEEDOR (ADR-027). Es el ÚNICO lugar que conoce los adaptadores (regla
 * ia-solo-por-puerto de PR14). OpenRouter solo llega aquí fuera de producción: Configuracion no arranca con
 * IA_PROVEEDOR=openrouter y NODE_ENV=production.
 */
export function crearProveedorDeIA(configuracion: Configuracion): AIProvider {
  const { proveedor, falsoModo, openrouter } = configuracion.ia;
  if (proveedor === 'falso') return new ProveedorIAFalso(falsoModo);
  if (proveedor === 'openrouter' && openrouter) {
    return new ProveedorIAOpenRouter({
      llave: openrouter.llave,
      modelo: openrouter.modelo,
      urlBase: openrouter.urlBase,
    });
  }
  return new ProveedorIANinguno();
}

/**
 * M04 Asistente IA y reportes (submódulos `reportes`, `asistente` y `comun`), funcionalidad 005. Matriz de
 * dependencias: M04 → M02 y M03 solo por su interfaz pública (CatalogoCitasApi y SuscripcionesApi) y M06; nunca M01
 * ni M05, y nadie llama a M04 (reglas matriz-m04 y nadie-llama-a-m04 de PR14).
 *
 * - Fase 2 (US2): GET /reportes, sin el proveedor de IA (FR-026).
 * - Fase 3 (US1): POST /asistente/mensajes, el asistente del cliente.
 */
@Module({
  imports: [CatalogoCitasModule, SuscripcionesPagosModule],
  controllers: [ReportesController, AsistenteController],
  providers: [
    AutorizacionAsistenteReportes,
    ConsultarReportes,
    PreguntarAlAsistente,
    { provide: CuotasDelAsistente, useClass: KyselyCuotasDelAsistente },
    { provide: RegistroDePreguntas, useClass: KyselyRegistroDePreguntas },
    { provide: AIProvider, useFactory: crearProveedorDeIA, inject: [Configuracion] },
  ],
})
export class AsistenteReportesModule {}
