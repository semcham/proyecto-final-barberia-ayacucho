import {
  Body,
  Controller,
  Get,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { ActorActual, RequiereOperacion } from '../../../../shared';
import { extensionDe } from '../../pagos/domain/tipo-de-archivo';
import { type ArchivoEnMemoria, InterceptorDeArchivo } from '../../pagos/presentation/archivo.interceptor';
import type { ActorDeBarberia } from '../../suscripciones/application/autorizacion';
import type { OperacionSuscripciones } from '../../suscripciones/domain/permisos';
import type { ArchivoAdelanto } from '../application/ports/archivos-adelanto';
import { ConfigurarAdelanto, type ConfiguracionAdelantoVista } from '../application/configurar-adelanto';
import { ArchivoDeAdelantoInvalido, TAMANO_MAXIMO_ARCHIVO_ADELANTO } from '../domain/archivo-adelanto';

/** Operación de la matriz de M03 (primera barrera en el RolesGuard; el caso de uso la vuelve a exigir). */
const OperacionM03 = (operacion: OperacionSuscripciones) => RequiereOperacion(operacion);

/**
 * Cuerpo de PUT /barberia/adelanto (contracts/openapi.yaml de 008, CambiarConfiguracionAdelanto). Aquí solo los
 * tipos: un campo de más (p. ej. tenantId) o de otro tipo responde 400; los rangos y lo que falta para activar los
 * valida el dominio con 422.
 */
export class CambiarConfiguracionAdelantoDto {
  @IsBoolean()
  activo!: boolean;

  @IsOptional()
  @IsIn(['FIJO', 'PORCENTAJE'])
  tipo?: 'FIJO' | 'PORCENTAJE';

  @IsOptional()
  @IsInt()
  montoCentimos?: number;

  @IsOptional()
  @IsInt()
  porcentaje?: number;

  @IsOptional()
  @IsInt()
  plazoMinutos?: number;
}

/** El QR: multer en memoria, un archivo de hasta 1 MB y ningún campo de texto. Más grande → 413 (contrato). */
const QrInterceptor = InterceptorDeArchivo({
  tamanoMaximo: TAMANO_MAXIMO_ARCHIVO_ADELANTO.QR,
  camposDeTexto: 0,
});

/**
 * Un archivo privado del adelanto: con el tipo verificado por los bytes, como adjunto con un nombre neutro, sin
 * caché (`no-store`) y sin que el navegador adivine otro tipo (`nosniff`). Igual que los comprobantes de 003.
 */
export function archivoPrivado(
  respuesta: Response,
  nombre: string,
  archivo: ArchivoAdelanto,
): StreamableFile {
  respuesta.setHeader('X-Content-Type-Options', 'nosniff');
  respuesta.setHeader('Cache-Control', 'no-store');
  return new StreamableFile(archivo.contenido, {
    type: archivo.tipo,
    length: archivo.contenido.length,
    disposition: `attachment; filename="${nombre}.${extensionDe(archivo.tipo)}"`,
  });
}

/** T017 de 008 · Configuración del adelanto de la barbería del token (US1). Solo el propietario. */
@Controller('barberia/adelanto')
export class AdelantoConfiguracionController {
  constructor(private readonly configurar: ConfigurarAdelanto) {}

  @Get()
  @OperacionM03('CONFIGURAR_ADELANTO')
  obtener(@ActorActual() actor: ActorDeBarberia): Promise<ConfiguracionAdelantoVista> {
    return this.configurar.obtener(actor);
  }

  @Put()
  @OperacionM03('CONFIGURAR_ADELANTO')
  cambiar(
    @ActorActual() actor: ActorDeBarberia,
    @Body() dto: CambiarConfiguracionAdelantoDto,
  ): Promise<ConfiguracionAdelantoVista> {
    return this.configurar.cambiar(actor, {
      activo: dto.activo,
      tipo: dto.tipo,
      montoCentimos: dto.montoCentimos,
      porcentaje: dto.porcentaje,
      plazoMinutos: dto.plazoMinutos,
    });
  }

  @Put('qr')
  @OperacionM03('CONFIGURAR_ADELANTO')
  @UseInterceptors(QrInterceptor)
  subirQr(
    @ActorActual() actor: ActorDeBarberia,
    @UploadedFile() archivo: ArchivoEnMemoria | undefined,
  ): Promise<ConfiguracionAdelantoVista> {
    if (!archivo) throw new ArchivoDeAdelantoInvalido('requerido');
    return this.configurar.subirQr(actor, archivo.buffer);
  }

  @Get('qr')
  @OperacionM03('CONFIGURAR_ADELANTO')
  async verQr(
    @ActorActual() actor: ActorDeBarberia,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    return archivoPrivado(respuesta, 'qr-adelanto', await this.configurar.verQr(actor));
  }
}
