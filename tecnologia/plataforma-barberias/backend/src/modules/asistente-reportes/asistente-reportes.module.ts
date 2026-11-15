import { Module } from '@nestjs/common';
import { CatalogoCitasModule } from '../catalogo-citas';
import { AutorizacionAsistenteReportes } from './comun/application/autorizacion';
import { ConsultarReportes } from './reportes/application/consultar-reportes';
import { ReportesController } from './reportes/presentation/reportes.controller';

/**
 * M04 Asistente IA y reportes (submódulos `reportes`, `asistente` y `comun`), funcionalidad 005. Matriz de
 * dependencias: M04 → M02 y M03 solo por su interfaz pública (CatalogoCitasApi y SuscripcionesApi) y M06; nunca M01
 * ni M05, y nadie llama a M04 (reglas matriz-m04 y nadie-llama-a-m04 de PR14). Solo este módulo enlaza el puerto
 * AIProvider con su adaptador (ia-solo-por-puerto).
 *
 * - Fase 2 (US2): GET /reportes, sin el proveedor de IA (FR-026).
 * - Fase 3 (US1): POST /asistente/mensajes.
 */
@Module({
  imports: [CatalogoCitasModule],
  controllers: [ReportesController],
  providers: [AutorizacionAsistenteReportes, ConsultarReportes],
})
export class AsistenteReportesModule {}
