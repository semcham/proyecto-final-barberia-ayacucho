import { Module } from '@nestjs/common';
import { Clock, Configuracion } from '../../shared';
import { AplicarResultadoDelProveedor } from './pagos/application/aplicar-resultado';
import { ConciliarPagos } from './pagos/application/conciliar-pagos';
import { IniciarPago } from './pagos/application/iniciar-pago';
import {
  EventoProveedorRepository,
  PagoRepository,
  UbicacionDePagos,
} from './pagos/application/ports/pago-repository';
import { PaymentGateway } from './pagos/application/ports/payment-gateway';
import { RecibirNotificacion } from './pagos/application/recibir-notificacion';
import { crearPasarela } from './pagos/infrastructure/fabrica-pasarela';
import {
  KyselyEventoProveedorRepository,
  KyselyPagoRepository,
} from './pagos/infrastructure/kysely-pago-repository';
import { UbicacionDePagosPlataforma } from './pagos/infrastructure/plataforma/ubicacion-de-pagos';
import { SuscripcionesApi } from './suscripciones-api';
import { AutorizacionSuscripciones } from './suscripciones/application/autorizacion';
import { AvanzarSuscripcion } from './suscripciones/application/avanzar-suscripcion';
import { AvisarFinDePrueba } from './suscripciones/application/avisar-fin-de-prueba';
import { ConsultasDeSuscripcion } from './suscripciones/application/consultas';
import { ExigirOperacion } from './suscripciones/application/exigir-operacion';
import { IniciarPruebaGratuita } from './suscripciones/application/iniciar-prueba-gratuita';
import { ObtenerLimiteBarberos } from './suscripciones/application/obtener-limite-barberos';
import { ObtenerLimiteUsuarios } from './suscripciones/application/obtener-limite-usuarios';
import { PlanVigente } from './suscripciones/application/plan-vigente';
import { SuscripcionRepository } from './suscripciones/application/ports/suscripcion-repository';
import { SuscripcionesPorVencer } from './suscripciones/application/ports/suscripciones-por-vencer';
import { VencerSuscripciones } from './suscripciones/application/vencer-suscripciones';
import { KyselySuscripcionRepository } from './suscripciones/infrastructure/kysely-suscripcion-repository';
import { SuscripcionesPorVencerPlataforma } from './suscripciones/infrastructure/plataforma/suscripciones-por-vencer';
import { NotificacionesController } from './suscripciones/presentation/notificaciones.controller';
import { SuscripcionController } from './suscripciones/presentation/suscripcion.controller';
import {
  DescargarComprobante,
  LectorDeComprobantes,
  SubirComprobante,
} from './pagos/application/comprobantes';
import { ExpirarTransferencias } from './pagos/application/expirar-transferencias';
import { AlmacenComprobantes } from './pagos/application/ports/almacen-comprobantes';
import { AlmacenComprobantesPostgres } from './pagos/infrastructure/almacen-comprobantes-postgres';
import {
  ColaDeComprobantes,
  DetalleDePago,
  RevisarComprobante,
  VerComprobante,
} from './plataforma/application/comprobantes-plataforma';
import { ColaDeComprobantesLectura } from './plataforma/application/ports/cola-de-comprobantes';
import { ColaDeComprobantesPlataforma } from './plataforma/infrastructure/plataforma/cola-de-comprobantes-plataforma';
import { ComprobantesPlataformaController } from './plataforma/presentation/comprobantes-plataforma.controller';
import { HistorialDePagos } from './pagos/application/historial-de-pagos';
import { PagosPorRevisar, ResolverRevision } from './plataforma/application/pagos-por-revisar';
import { PagosPorRevisarLectura } from './plataforma/application/ports/pagos-por-revisar';
import { PagosPorRevisarPlataforma } from './plataforma/infrastructure/plataforma/pagos-por-revisar-plataforma';
import { PagosPlataformaController } from './plataforma/presentation/pagos-plataforma.controller';
import { ResumenesDeSuscripcionLectura } from './plataforma/application/ports/resumenes-de-suscripcion';
import {
  ActivacionManual,
  PlanesParaPlataforma,
  ReactivarSuscripcion,
  SuspenderSuscripcion,
} from './plataforma/application/suscripciones-plataforma';
import { ResumenesDeSuscripcionPlataforma } from './plataforma/infrastructure/plataforma/resumenes-de-suscripcion-plataforma';
import { SuscripcionesPlataformaController } from './plataforma/presentation/suscripciones-plataforma.controller';
import { ConfigurarAdelanto } from './adelantos/application/configurar-adelanto';
import { ArchivosAdelanto } from './adelantos/application/ports/archivos-adelanto';
import { ConfiguracionAdelantoRepository } from './adelantos/application/ports/configuracion-adelanto-repository';
import { ArchivosAdelantoPostgres } from './adelantos/infrastructure/archivos-adelanto-postgres';
import { KyselyConfiguracionAdelanto } from './adelantos/infrastructure/kysely-configuracion-adelanto';
import { AdelantoConfiguracionController } from './adelantos/presentation/adelanto-configuracion.controller';
import { AdelantosApi } from './adelantos-api';
import { AdelantosApiImpl } from './adelantos/application/adelantos-api-impl';
import { ConsultarAdelanto } from './adelantos/application/consultar-adelanto';
import { AdelantoRepository } from './adelantos/application/ports/adelanto-repository';
import { RechazarPagoDeAdelanto } from './adelantos/application/rechazar-pago';
import { RegistrarPagoDeAdelanto } from './adelantos/application/registrar-pago';
import { KyselyAdelantoRepository } from './adelantos/infrastructure/kysely-adelanto-repository';
import { AdelantosPorVencerLectura } from './adelantos/application/ports/adelantos-por-vencer';
import { AdelantosPorVencerPlataforma } from './adelantos/infrastructure/plataforma/adelantos-por-vencer';
import { AdelantoCitaController } from './adelantos/presentation/adelanto-cita.controller';

/**
 * M03 Suscripciones y pagos. Prueba gratuita y límites (001 y 002); en 003, planes, períodos, pagos con la
 * pasarela detrás de PaymentGateway (elegida por PAGOS_PROVEEDOR, ADR-022), notificaciones firmadas,
 * conciliación y restricciones por estado. En 008, el adelanto de reserva con el QR de la barbería (submódulo
 * adelantos/): la plataforma no cobra ese dinero ni usa PaymentGateway para él.
 */
@Module({
  controllers: [
    SuscripcionController,
    NotificacionesController,
    ComprobantesPlataformaController,
    PagosPlataformaController,
    SuscripcionesPlataformaController,
    // 008 (US1): configuración del adelanto de reserva.
    AdelantoConfiguracionController,
    // 008 (US2): el adelanto de la cita y el registro del pago del cliente.
    AdelantoCitaController,
  ],
  providers: [
    { provide: SuscripcionRepository, useClass: KyselySuscripcionRepository },
    { provide: PagoRepository, useClass: KyselyPagoRepository },
    { provide: EventoProveedorRepository, useClass: KyselyEventoProveedorRepository },
    { provide: UbicacionDePagos, useClass: UbicacionDePagosPlataforma },
    { provide: SuscripcionesPorVencer, useClass: SuscripcionesPorVencerPlataforma },
    { provide: PaymentGateway, inject: [Configuracion, Clock], useFactory: crearPasarela },
    AutorizacionSuscripciones,
    PlanVigente,
    AvanzarSuscripcion,
    IniciarPruebaGratuita,
    ExigirOperacion,
    ObtenerLimiteUsuarios,
    ObtenerLimiteBarberos,
    ConsultasDeSuscripcion,
    AplicarResultadoDelProveedor,
    IniciarPago,
    RecibirNotificacion,
    ConciliarPagos,
    VencerSuscripciones,
    // 004 (US5, FR-037): aviso de prueba por terminar al propietario.
    AvisarFinDePrueba,
    SuscripcionesApi,
    // US3: transferencia con comprobante (R05, ADR-023).
    { provide: AlmacenComprobantes, useClass: AlmacenComprobantesPostgres },
    { provide: ColaDeComprobantesLectura, useClass: ColaDeComprobantesPlataforma },
    LectorDeComprobantes,
    SubirComprobante,
    DescargarComprobante,
    ExpirarTransferencias,
    ColaDeComprobantes,
    DetalleDePago,
    VerComprobante,
    RevisarComprobante,
    // US4: historial y pagos por revisar (FR-025, FR-025a).
    { provide: PagosPorRevisarLectura, useClass: PagosPorRevisarPlataforma },
    HistorialDePagos,
    PagosPorRevisar,
    ResolverRevision,
    // US5: administración de suscripciones y activación manual (FR-035, FR-036).
    { provide: ResumenesDeSuscripcionLectura, useClass: ResumenesDeSuscripcionPlataforma },
    SuspenderSuscripcion,
    ReactivarSuscripcion,
    ActivacionManual,
    PlanesParaPlataforma,
    // 008 (US1): adelanto de reserva con QR, configuración y archivos privados (research R01, R05).
    { provide: ConfiguracionAdelantoRepository, useClass: KyselyConfiguracionAdelanto },
    { provide: ArchivosAdelanto, useClass: ArchivosAdelantoPostgres },
    ConfigurarAdelanto,
    // 008 (US2): AdelantosApi para M02 (research R01), el registro del pago y la consulta del adelanto.
    { provide: AdelantoRepository, useClass: KyselyAdelantoRepository },
    // 008 fase 5 (T050): candidatos de vencer-adelantos con la lectura de la plataforma (cinco columnas).
    { provide: AdelantosPorVencerLectura, useClass: AdelantosPorVencerPlataforma },
    { provide: AdelantosApi, useClass: AdelantosApiImpl },
    RegistrarPagoDeAdelanto,
    ConsultarAdelanto,
    // 008 (US3): el propietario rechaza el pago (confirmar lo orquesta M02 por AdelantosApi).
    RechazarPagoDeAdelanto,
  ],
  exports: [
    SuscripcionesApi,
    ConciliarPagos,
    VencerSuscripciones,
    ExpirarTransferencias,
    AvisarFinDePrueba,
    AdelantosApi,
  ],
})
export class SuscripcionesPagosModule {}
