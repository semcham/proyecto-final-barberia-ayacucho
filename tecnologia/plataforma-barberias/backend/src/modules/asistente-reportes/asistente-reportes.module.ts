import { Module } from '@nestjs/common';

/**
 * M04 Asistente IA y reportes (submódulos `reportes` y `asistente`), funcionalidad 005. Matriz de dependencias:
 * M04 → M02 y M03 solo por su interfaz pública (CatalogoCitasApi y SuscripcionesApi) y M06; nunca M01 ni M05, y
 * nadie llama a M04 (reglas matriz-m04 y nadie-llama-a-m04 de PR14). Solo este módulo enlaza el puerto AIProvider
 * con su adaptador (ia-solo-por-puerto). La fase 1 deja el módulo vacío: las rutas llegan con cada historia
 * (GET /reportes en US2 y POST /asistente/mensajes en US1).
 */
@Module({})
export class AsistenteReportesModule {}
