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
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { ActorActual, RequiereOperacion } from '../../../../shared';
import type { ResumenDeAdelanto } from '../../adelantos-api';
import { type ArchivoEnMemoria, InterceptorDeArchivo } from '../../pagos/presentation/archivo.interceptor';
import type { ActorDeBarberia } from '../../suscripciones/application/autorizacion';
import type { OperacionSuscripciones } from '../../suscripciones/domain/permisos';
import { ConsultarAdelanto } from '../application/consultar-adelanto';
import { RechazarPagoDeAdelanto } from '../application/rechazar-pago';
import { RegistrarPagoDeAdelanto } from '../application/registrar-pago';
import { TAMANO_MAXIMO_ARCHIVO_ADELANTO } from '../domain/archivo-adelanto';
import { archivoPrivado } from './adelanto-configuracion.controller';

/** Operación de la matriz de M03 (primera barrera en el RolesGuard; el caso de uso la vuelve a exigir). */
const OperacionM03 = (operacion: OperacionSuscripciones) => RequiereOperacion(operacion);

/**
 * Campo de texto del registro del pago (multipart). El formato lo valida el caso de uso (4 a 20 alfanuméricos tras
 * quitar espacios); aquí solo el tipo y un tope (contracts/openapi.yaml de 008: maxLength 24).
 */
export class RegistrarPagoDeAdelantoDto {
  @IsString()
  @MaxLength(24)
  numeroOperacion!: string;
}

/**
 * Cuerpo de POST /citas/{id}/adelanto/rechazo. Aquí solo el tipo y un tope amplio: que falte o que no tenga de 5 a 300
 * caracteres lo decide el dominio, con 422 (contracts/openapi.yaml de 008).
 */
export class RechazarPagoDeAdelantoDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  motivo?: string;
}

/** La captura: multer en memoria, un archivo de hasta 5 MB y un solo campo de texto. Más grande → 413 (contrato). */
const CapturaInterceptor = InterceptorDeArchivo({
  tamanoMaximo: TAMANO_MAXIMO_ARCHIVO_ADELANTO.CAPTURA,
  camposDeTexto: 1,
});

/**
 * T031 de 008 · El adelanto de una cita (US2): verlo, su QR, su captura y el registro del pago del cliente. M03 es
 * dueño de estas rutas aunque cuelguen de /citas/{id}: no cambian la cita (research R01). La barbería sale del token.
 */
@Controller('citas/:id/adelanto')
export class AdelantoCitaController {
  constructor(
    private readonly consultar: ConsultarAdelanto,
    private readonly registrar: RegistrarPagoDeAdelanto,
    private readonly rechazar: RechazarPagoDeAdelanto,
  ) {}

  /** T041 · El propietario rechaza el pago registrado, con un motivo (FR-014). */
  @Post('rechazo')
  @HttpCode(200)
  @OperacionM03('REVISAR_ADELANTO')
  rechazarPago(
    @ActorActual() actor: ActorDeBarberia,
    @Param('id', ParseUUIDPipe) citaId: string,
    @Body() dto: RechazarPagoDeAdelantoDto,
  ): Promise<ResumenDeAdelanto> {
    return this.rechazar.ejecutar(actor, citaId, dto.motivo);
  }

  @Get()
  @OperacionM03('VER_ADELANTO')
  ver(
    @ActorActual() actor: ActorDeBarberia,
    @Param('id', ParseUUIDPipe) citaId: string,
  ): Promise<ResumenDeAdelanto> {
    return this.consultar.ver(actor, citaId);
  }

  @Get('qr')
  @OperacionM03('VER_ADELANTO')
  async qr(
    @ActorActual() actor: ActorDeBarberia,
    @Param('id', ParseUUIDPipe) citaId: string,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    return archivoPrivado(respuesta, 'qr-adelanto', await this.consultar.qr(actor, citaId));
  }

  @Get('captura')
  @OperacionM03('VER_ADELANTO')
  async captura(
    @ActorActual() actor: ActorDeBarberia,
    @Param('id', ParseUUIDPipe) citaId: string,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    return archivoPrivado(respuesta, `captura-${citaId}`, await this.consultar.captura(actor, citaId));
  }

  @Post('pago')
  @HttpCode(201)
  @OperacionM03('PAGAR_ADELANTO')
  @UseInterceptors(CapturaInterceptor)
  registrarPago(
    @ActorActual() actor: ActorDeBarberia,
    @Param('id', ParseUUIDPipe) citaId: string,
    @UploadedFile() archivo: ArchivoEnMemoria | undefined,
    @Body() dto: RegistrarPagoDeAdelantoDto,
  ): Promise<ResumenDeAdelanto> {
    return this.registrar.ejecutar(actor, citaId, {
      numeroOperacion: dto.numeroOperacion,
      captura: archivo?.buffer ?? null,
    });
  }
}
