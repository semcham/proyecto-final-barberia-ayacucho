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
import { InvalidadorCatalogoPublico } from './catalogo/application/invalidador-catalogo-publico';
import { ObtenerCatalogoPublico } from './catalogo/application/obtener-catalogo-publico';
import { CatalogQuery } from './catalogo/application/ports/catalog-query';
import { CatalogoPublicoQuery } from './catalogo/application/ports/catalogo-publico-query';
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
import { AccionPorEnlace } from './citas/application/accion-por-enlace';
import { LimiteRechazosEnlace } from './citas/application/limite-rechazos-enlace';
import { IntentosEnlaceRepository } from './citas/application/ports/intentos-enlace-repository';
import { PurgarIntentosEnlace } from './citas/application/purgar-intentos-enlace';
import { ReglasDeHorario } from './citas/application/reglas-de-horario';
import { KyselyIntentosEnlaceRepository } from './citas/infrastructure/kysely-intentos-enlace-repository';
import { EnlacesController } from './citas/presentation/enlaces.controller';
import { ReprogramarCita } from './citas/application/reprogramar-cita';
import { ReservarCita } from './citas/application/reservar-cita';
import { CitaRepositoryPostgres } from './citas/infrastructure/cita-repository-postgres';
import { AgendaController } from './citas/presentation/agenda.controller';
import { CitasController } from './citas/presentation/citas.controller';
import { HistorialController } from './citas/presentation/historial.controller';
import { BandejaAdelantos } from './citas/application/bandeja-adelantos';
import { ConfirmarAdelanto } from './citas/application/confirmar-adelanto';
import { AdelantoController } from './citas/presentation/adelanto.controller';

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
    // Acciones por enlace del recordatorio (004, US3).
    EnlacesController,
    // 008 (US3): confirmar el adelanto y la bandeja de verificación.
    AdelantoController,
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
    // Catálogo público en la caché compartida (006 US2): mismo repositorio detrás del puerto.
    { provide: CatalogoPublicoQuery, useExisting: CatalogoPublicoRepository },
    ObtenerCatalogoPublico,
    InvalidadorCatalogoPublico,
    ConsultarHorarios,
    { provide: CitaRepository, useClass: CitaRepositoryPostgres },
    // 004 (T049): reglas de una hora nueva, compartidas por la reserva y la reprogramación.
    ReglasDeHorario,
    ReservarCita,
    // Reprogramación (004, US1).
    ReprogramarCita,
    // Acciones por enlace (004, US3): verificación, contador de rechazos por IP y su purga.
    { provide: IntentosEnlaceRepository, useClass: KyselyIntentosEnlaceRepository },
    LimiteRechazosEnlace,
    AccionPorEnlace,
    PurgarIntentosEnlace,
    // Agenda y estados (US4).
    CambiarEstadoCita,
    ConsultarAgenda,
    // Cancelación (US5).
    CancelarCita,
    // Historial del cliente (US6).
    ConsultarHistorial,
    // 008 (US3): el propietario confirma el adelanto (la cita pasa a CONFIRMADA) y su bandeja.
    ConfirmarAdelanto,
    BandejaAdelantos,
  ],
  // PurgarIntentosEnlace: la tarea purgar-intentos-enlaces, que registra el host (host/tareas.ts).
  exports: [CatalogQuery, PurgarIntentosEnlace],
})
export class CatalogoCitasModule {}
