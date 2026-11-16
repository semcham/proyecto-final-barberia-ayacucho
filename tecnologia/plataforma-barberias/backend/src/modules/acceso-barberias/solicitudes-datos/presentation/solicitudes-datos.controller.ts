import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ActorActual } from '../../../../shared';
import type { Actor } from '../../identidad/application/autorizacion';
import { Operacion } from '../../identidad/presentation/operacion.decorator';
import { BandejaSolicitudes } from '../application/bandeja-solicitudes';
import { CerrarSolicitud } from '../application/cerrar-solicitud';
import type { VistaSolicitud, VistaSolicitudEnBandeja } from '../application/comun';
import { IniciarAtencion } from '../application/iniciar-atencion';
import { MisSolicitudes } from '../application/mis-solicitudes';
import { RegistrarEnNombre } from '../application/registrar-en-nombre';
import { RegistrarSolicitud } from '../application/registrar-solicitud';
import {
  BandejaDto,
  CierreSolicitudDto,
  NuevaSolicitudDto,
  SolicitudEnNombreDto,
} from './solicitudes-datos.dto';

/**
 * T013 de 007 · Solicitudes sobre datos personales (RF32; contracts/openapi.yaml y contracts/rbac.md de 007). Rutas de
 * barbería: el token de la plataforma responde 401 (ADR-031) y el administrador no tiene ninguna ruta aquí. Cada caso
 * de uso vuelve a exigir su operación (R22).
 */
@Controller('datos-personales/solicitudes')
export class SolicitudesDatosController {
  constructor(
    private readonly registrar: RegistrarSolicitud,
    private readonly registrarEnNombre: RegistrarEnNombre,
    private readonly mias: MisSolicitudes,
    private readonly bandejaDeSolicitudes: BandejaSolicitudes,
    private readonly iniciar: IniciarAtencion,
    private readonly cerrar: CerrarSolicitud,
  ) {}

  /** POST /api/v1/datos-personales/solicitudes · El cliente o el barbero, sobre sus propios datos. */
  @Post()
  @HttpCode(201)
  @Operacion('REGISTRAR_SOLICITUD_DATOS')
  registrarPropia(@ActorActual() actor: Actor, @Body() dto: NuevaSolicitudDto): Promise<VistaSolicitud> {
    return this.registrar.ejecutar(actor, { tipo: dto.tipo, detalle: dto.detalle });
  }

  /** POST /api/v1/datos-personales/solicitudes/en-nombre · El propietario, por un cliente de su barbería. */
  @Post('en-nombre')
  @HttpCode(201)
  @Operacion('REGISTRAR_SOLICITUD_DATOS_EN_NOMBRE')
  registrarPorCliente(
    @ActorActual() actor: Actor,
    @Body() dto: SolicitudEnNombreDto,
  ): Promise<VistaSolicitud> {
    return this.registrarEnNombre.ejecutar(actor, {
      tipo: dto.tipo,
      detalle: dto.detalle,
      clienteId: dto.clienteId,
    });
  }

  /** GET /api/v1/datos-personales/solicitudes/mias · Las del titular de la sesión. */
  @Get('mias')
  @Operacion('VER_MIS_SOLICITUDES_DATOS')
  misSolicitudes(@ActorActual() actor: Actor): Promise<VistaSolicitud[]> {
    return this.mias.ejecutar(actor);
  }

  /** GET /api/v1/datos-personales/solicitudes?estado= · Bandeja del propietario (por defecto, las abiertas). */
  @Get()
  @Operacion('ATENDER_SOLICITUDES_DATOS')
  bandeja(@ActorActual() actor: Actor, @Query() consulta: BandejaDto): Promise<VistaSolicitudEnBandeja[]> {
    return this.bandejaDeSolicitudes.ejecutar(actor, consulta.estado ?? 'ABIERTAS');
  }

  /** POST /api/v1/datos-personales/solicitudes/{id}/atencion · RECIBIDA → EN_ATENCION. */
  @Post(':id/atencion')
  @HttpCode(200)
  @Operacion('ATENDER_SOLICITUDES_DATOS')
  iniciarAtencion(
    @ActorActual() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<VistaSolicitudEnBandeja> {
    return this.iniciar.ejecutar(actor, id);
  }

  /** POST /api/v1/datos-personales/solicitudes/{id}/cierre · Atendida (con respuesta) o rechazada (con motivo). */
  @Post(':id/cierre')
  @HttpCode(200)
  @Operacion('ATENDER_SOLICITUDES_DATOS')
  cerrarSolicitud(
    @ActorActual() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CierreSolicitudDto,
  ): Promise<VistaSolicitudEnBandeja> {
    return this.cerrar.ejecutar(actor, id, {
      resultado: dto.resultado,
      respuesta: dto.respuesta,
      motivo: dto.motivo,
    });
  }
}
