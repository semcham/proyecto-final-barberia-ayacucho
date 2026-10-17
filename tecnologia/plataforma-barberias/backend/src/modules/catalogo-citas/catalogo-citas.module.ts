import { Module } from '@nestjs/common';
import { AccesoBarberiasModule } from '../acceso-barberias';
import { SuscripcionesPagosModule } from '../suscripciones-pagos';
import { AutorizacionCatalogoCitas } from './catalogo/application/autorizacion';
import { CatalogQuery } from './catalogo/application/ports/catalog-query';
import { KyselyCatalogQuery } from './catalogo/infrastructure/kysely-catalog-query';

/**
 * M02 Catálogo y citas (submódulos catalogo y citas). Matriz de dependencias: M02 → M01 (ADR-020), M03 y
 * M06, siempre por su interfaz pública. Cada historia de la funcionalidad 002 agrega aquí sus piezas.
 */
@Module({
  imports: [AccesoBarberiasModule, SuscripcionesPagosModule],
  providers: [AutorizacionCatalogoCitas, { provide: CatalogQuery, useClass: KyselyCatalogQuery }],
  exports: [CatalogQuery],
})
export class CatalogoCitasModule {}
