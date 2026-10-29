import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  type StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { ActorActual, RequiereOperacion } from '../../../../shared';
import { DescargarComprobante, SubirComprobante } from '../../pagos/application/comprobantes';
import { IniciarPago, type PagoIniciado } from '../../pagos/application/iniciar-pago';
import type { PagoVista, PlanVista } from '../../pagos/application/vistas';
import { ComprobanteInvalido } from '../../pagos/domain/errores';
import { comoAdjunto } from '../../pagos/presentation/adjunto';
import {
  type ArchivoEnMemoria,
  ComprobanteInterceptor,
} from '../../pagos/presentation/comprobante.interceptor';
import type { ActorDeBarberia } from '../application/autorizacion';
import {
  ConsultasDeSuscripcion,
  type EstadoOperativoVista,
  type SuscripcionVista,
} from '../application/consultas';
import type { OperacionSuscripciones } from '../domain/permisos';

/** Operación de la matriz de M03 (primera barrera en el RolesGuard; el caso de uso la vuelve a exigir). */
const OperacionM03 = (operacion: OperacionSuscripciones) => RequiereOperacion(operacion);

/**
 * Cuerpo de POST /suscripcion/pagos. Solo el plan y el medio: ningún dato de tarjeta ni del pagador pasa por
 * la plataforma (principio V); un campo de más responde 400 (ValidationPipe con forbidNonWhitelisted).
 */
export class IniciarPagoDto {
  @IsUUID()
  planId!: string;

  @IsIn(['YAPE', 'TRANSFERENCIA'])
  medio!: 'YAPE' | 'TRANSFERENCIA';
}

/**
 * Campos de texto del comprobante (multipart). El formato lo valida el caso de uso (número normalizado y
 * fecha real); aquí solo el tipo y un tope. Los errores nunca repiten lo recibido.
 */
export class SubirComprobanteDto {
  @IsString()
  @MaxLength(60)
  numeroOperacion!: string;

  @IsString()
  @MaxLength(10)
  fechaTransferencia!: string;
}

/** T049 · Suscripción de la barbería del token (RF19, RF20, RF23; contracts/openapi.yaml de 003). */
@Controller()
export class SuscripcionController {
  constructor(
    private readonly consultas: ConsultasDeSuscripcion,
    private readonly iniciarPago: IniciarPago,
    private readonly subirComprobanteCaso: SubirComprobante,
    private readonly descargar: DescargarComprobante,
  ) {}

  @Get('planes')
  @OperacionM03('VER_PLANES')
  planes(@ActorActual() actor: ActorDeBarberia): Promise<PlanVista[]> {
    return this.consultas.planes(actor);
  }

  @Get('suscripcion')
  @OperacionM03('VER_SUSCRIPCION')
  suscripcion(@ActorActual() actor: ActorDeBarberia): Promise<SuscripcionVista> {
    return this.consultas.suscripcion(actor);
  }

  @Get('suscripcion/estado-operativo')
  @OperacionM03('VER_ESTADO_OPERATIVO')
  estadoOperativo(@ActorActual() actor: ActorDeBarberia): Promise<EstadoOperativoVista> {
    return this.consultas.estadoOperativo(actor);
  }

  /** 201 si se creó el pago; 200 si se devolvió el pago abierto igual (FR-012). */
  @Post('suscripcion/pagos')
  @HttpCode(201)
  @OperacionM03('PAGAR_SUSCRIPCION')
  async pagar(
    @ActorActual() actor: ActorDeBarberia,
    @Body() dto: IniciarPagoDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<Omit<PagoIniciado, 'creado'>> {
    const { creado, ...iniciado } = await this.iniciarPago.ejecutar(actor, {
      planId: dto.planId,
      medio: dto.medio,
    });
    if (!creado) respuesta.status(200);
    return iniciado;
  }

  @Get('suscripcion/pagos/:pagoId')
  @OperacionM03('VER_SUSCRIPCION')
  pago(
    @ActorActual() actor: ActorDeBarberia,
    @Param('pagoId', ParseUUIDPipe) pagoId: string,
  ): Promise<PagoVista> {
    return this.consultas.pago(actor, pagoId);
  }

  /** T083 · Subir el comprobante de la transferencia (FR-020): multipart, verificado por bytes. */
  @Post('suscripcion/pagos/:pagoId/comprobante')
  @HttpCode(201)
  @OperacionM03('PAGAR_SUSCRIPCION')
  @UseInterceptors(ComprobanteInterceptor)
  subirComprobante(
    @ActorActual() actor: ActorDeBarberia,
    @Param('pagoId', ParseUUIDPipe) pagoId: string,
    @UploadedFile() archivo: ArchivoEnMemoria | undefined,
    @Body() dto: SubirComprobanteDto,
  ): Promise<PagoVista> {
    if (!archivo) throw new ComprobanteInvalido('archivo', 'requerido');
    return this.subirComprobanteCaso.ejecutar(actor, pagoId, {
      contenido: archivo.buffer,
      numeroOperacion: dto.numeroOperacion,
      fechaTransferencia: dto.fechaTransferencia,
    });
  }

  /** T083 · Descargar el comprobante (FR-041): solo con sesión, como adjunto y sin caché. */
  @Get('suscripcion/pagos/:pagoId/comprobante')
  @OperacionM03('VER_SUSCRIPCION')
  async descargarComprobante(
    @ActorActual() actor: ActorDeBarberia,
    @Param('pagoId', ParseUUIDPipe) pagoId: string,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    return comoAdjunto(respuesta, pagoId, await this.descargar.ejecutar(actor, pagoId));
  }
}
