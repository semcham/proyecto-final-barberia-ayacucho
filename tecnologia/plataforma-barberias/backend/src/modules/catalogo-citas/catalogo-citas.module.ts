import { Module } from '@nestjs/common';
import { AccesoBarberiasModule } from '../acceso-barberias';
import { SuscripcionesPagosModule } from '../suscripciones-pagos';
import { AutorizacionCatalogoCitas } from './catalogo/application/autorizacion';
import {
  ActualizarBarbero,
  CrearBarbero,
  ListarBarberos,
  ReglasBarbero,
} from './catalogo/application/barberos';
import {
  ContextoBloqueos,
  CrearBloqueo,
  EliminarBloqueo,
  ListarBloqueos,
} from './catalogo/application/bloqueos';
import {
  ObtenerDisponibilidad,
  ObtenerHorarioAtencion,
  ReemplazarDisponibilidad,
  ReemplazarHorarioAtencion,
} from './catalogo/application/horarios';
import {
  BarberoRepository,
  BloqueoRepository,
  CitasActivasQuery,
  HorarioRepository,
  ServicioRepository,
} from './catalogo/application/ports/catalogo-repositorios';
import { ActualizarServicio, CrearServicio, ListarServicios } from './catalogo/application/servicios';
import {
  KyselyBarberoRepository,
  KyselyBloqueoRepository,
  KyselyCitasActivasQuery,
  KyselyHorarioRepository,
  KyselyServicioRepository,
} from './catalogo/infrastructure/kysely-catalogo-repositorios';
import { BarberosController } from './catalogo/presentation/barberos.controller';
import { DisponibilidadController } from './catalogo/presentation/disponibilidad.controller';
import { HorarioAtencionController } from './catalogo/presentation/horario-atencion.controller';
import { ServiciosController } from './catalogo/presentation/servicios.controller';
import { ConsultarHorarios } from './catalogo/application/consultar-horarios';
import { CatalogQuery } from './catalogo/application/ports/catalog-query';
import { FuenteDisponibilidad } from './catalogo/application/ports/fuente-disponibilidad';
import { KyselyCatalogQuery } from './catalogo/infrastructure/kysely-catalog-query';
import { FuenteDisponibilidadKysely } from './catalogo/infrastructure/kysely-fuente-disponibilidad';
import { CatalogoPublicoRepository } from './catalogo/infrastructure/publico/catalogo-publico.repository';
import { HorariosController } from './catalogo/presentation/horarios.controller';
import { PublicoController } from './catalogo/presentation/publico.controller';
import { CambiarEstadoCita } from './citas/application/cambiar-estado-cita';
import { CancelarCita } from './citas/application/cancelar-cita';
import { ConsultarHistorial } from './citas/application/consultar-historial';
import { ConsultarAgenda } from './citas/application/consultar-agenda';
import { CitaRepository } from './citas/application/ports/cita-repository';
import { ReservarCita } from './citas/application/reservar-cita';
import { CitaRepositoryPostgres } from './citas/infrastructure/cita-repository-postgres';
import { AgendaController } from './citas/presentation/agenda.controller';
import { CitasController } from './citas/presentation/citas.controller';
import { HistorialController } from './citas/presentation/historial.controller';

/**
 * M02 Catálogo y citas (submódulos catalogo y citas). Matriz de dependencias: M02 → M01 (ADR-020), M03 y
 * M06, siempre por su interfaz pública. Cada historia de la funcionalidad 002 agrega aquí sus piezas.
 */
@Module({
  imports: [AccesoBarberiasModule, SuscripcionesPagosModule],
  controllers: [
    CitasController,
    PublicoController,
    HorariosController,
    ServiciosController,
    BarberosController,
    DisponibilidadController,
    HorarioAtencionController,
    AgendaController,
    HistorialController,
  ],
  providers: [
    AutorizacionCatalogoCitas,
    // Configuración del catálogo (US1): puertos → adaptadores y casos de uso.
    { provide: ServicioRepository, useClass: KyselyServicioRepository },
    { provide: BarberoRepository, useClass: KyselyBarberoRepository },
    { provide: HorarioRepository, useClass: KyselyHorarioRepository },
    { provide: BloqueoRepository, useClass: KyselyBloqueoRepository },
    { provide: CitasActivasQuery, useClass: KyselyCitasActivasQuery },
    ListarServicios,
    CrearServicio,
    ActualizarServicio,
    ReglasBarbero,
    ListarBarberos,
    CrearBarbero,
    ActualizarBarbero,
    ObtenerHorarioAtencion,
    ReemplazarHorarioAtencion,
    ObtenerDisponibilidad,
    ReemplazarDisponibilidad,
    ContextoBloqueos,
    ListarBloqueos,
    CrearBloqueo,
    EliminarBloqueo,
    { provide: CatalogQuery, useClass: KyselyCatalogQuery },
    // Horarios libres (US2): la fuente inyectada es la autenticada; la pública la crea el repositorio de la
    // vía pública por cada barbería del enlace (ADR-021).
    { provide: FuenteDisponibilidad, useClass: FuenteDisponibilidadKysely },
    CatalogoPublicoRepository,
    ConsultarHorarios,
    { provide: CitaRepository, useClass: CitaRepositoryPostgres },
    ReservarCita,
    // Agenda y estados (US4).
    CambiarEstadoCita,
    ConsultarAgenda,
    // Cancelación (US5).
    CancelarCita,
    // Historial del cliente (US6).
    ConsultarHistorial,
  ],
  exports: [CatalogQuery],
})
export class CatalogoCitasModule {}
