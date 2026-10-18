import { Module } from '@nestjs/common';
import { AccesoBarberiasModule } from '../acceso-barberias';
import { SuscripcionesPagosModule } from '../suscripciones-pagos';
import { AutorizacionCatalogoCitas } from './catalogo/application/autorizacion';
import { ConsultarHorarios } from './catalogo/application/consultar-horarios';
import { CatalogQuery } from './catalogo/application/ports/catalog-query';
import { FuenteDisponibilidad } from './catalogo/application/ports/fuente-disponibilidad';
import { KyselyCatalogQuery } from './catalogo/infrastructure/kysely-catalog-query';
import { FuenteDisponibilidadKysely } from './catalogo/infrastructure/kysely-fuente-disponibilidad';
import { CatalogoPublicoRepository } from './catalogo/infrastructure/publico/catalogo-publico.repository';
import { HorariosController } from './catalogo/presentation/horarios.controller';
import { PublicoController } from './catalogo/presentation/publico.controller';
import { CitaRepository } from './citas/application/ports/cita-repository';
import { ReservarCita } from './citas/application/reservar-cita';
import { CitaRepositoryPostgres } from './citas/infrastructure/cita-repository-postgres';
import { CitasController } from './citas/presentation/citas.controller';

/**
 * M02 Catálogo y citas (submódulos catalogo y citas). Matriz de dependencias: M02 → M01 (ADR-020), M03 y
 * M06, siempre por su interfaz pública. Cada historia de la funcionalidad 002 agrega aquí sus piezas.
 */
@Module({
  imports: [AccesoBarberiasModule, SuscripcionesPagosModule],
  controllers: [CitasController, PublicoController, HorariosController],
  providers: [
    AutorizacionCatalogoCitas,
    { provide: CatalogQuery, useClass: KyselyCatalogQuery },
    // Horarios libres (US2): la fuente inyectada es la autenticada; la pública la crea el repositorio de la
    // vía pública por cada barbería del enlace (ADR-021).
    { provide: FuenteDisponibilidad, useClass: FuenteDisponibilidadKysely },
    CatalogoPublicoRepository,
    ConsultarHorarios,
    { provide: CitaRepository, useClass: CitaRepositoryPostgres },
    ReservarCita,
  ],
  exports: [CatalogQuery],
})
export class CatalogoCitasModule {}
