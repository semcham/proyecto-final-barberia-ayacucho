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
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, Length, Min, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { AdminActual, Plataforma } from '../../../../shared';
import type { PagoVista } from '../../pagos/application/vistas';
import { comoAdjunto } from '../../pagos/presentation/adjunto';
import {
  type AdminDePlataforma,
  ColaDeComprobantes,
  DetalleDePago,
  type DetalleDePagoVista,
  RevisarComprobante,
  VerComprobante,
} from '../application/comprobantes-plataforma';
import type { ComprobantePorRevisar } from '../application/ports/cola-de-comprobantes';

/** Cuerpo de POST /plataforma/barberias/{id}/pagos/{pagoId}/revision (contracts/openapi.yaml). */
export class RevisionDto {
  @IsIn(['APROBADO', 'RECHAZADO'])
  resultado!: 'APROBADO' | 'RECHAZADO';

  /** Obligatorio para aprobar: el importe que el administrador ve en la cuenta (FR-022a). */
  @ValidateIf((dto: RevisionDto) => dto.resultado === 'APROBADO')
  @IsInt()
  @Min(1)
  importeTransferidoCentimos?: number;

  /** Obligatorio para rechazar, de 5 a 300 caracteres sin contar los espacios de los extremos. */
  @ValidateIf((dto: RevisionDto) => dto.resultado === 'RECHAZADO')
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 300)
  motivo?: string;
}

/**
 * T083 · Comprobantes del administrador de la plataforma (FR-022 a FR-024; ADR-031). Todas las rutas son
 * @Plataforma(): un token de barbería responde 401. La cola se lee con el rol de solo lectura de la
 * plataforma; el detalle, el archivo y la revisión corren con el tenant de la barbería de la ruta y RLS.
 */
@Controller('plataforma')
@Plataforma()
export class ComprobantesPlataformaController {
  constructor(
    private readonly cola: ColaDeComprobantes,
    private readonly detalle: DetalleDePago,
    private readonly ver: VerComprobante,
    private readonly revisar: RevisarComprobante,
  ) {}

  @Get('comprobantes')
  comprobantes(@AdminActual() admin: AdminDePlataforma): Promise<ComprobantePorRevisar[]> {
    return this.cola.ejecutar(admin);
  }

  @Get('barberias/:barberiaId/pagos/:pagoId')
  pago(
    @AdminActual() admin: AdminDePlataforma,
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('pagoId', ParseUUIDPipe) pagoId: string,
  ): Promise<DetalleDePagoVista> {
    return this.detalle.ejecutar(admin, barberiaId, pagoId);
  }

  @Get('barberias/:barberiaId/pagos/:pagoId/comprobante')
  async comprobante(
    @AdminActual() admin: AdminDePlataforma,
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('pagoId', ParseUUIDPipe) pagoId: string,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    return comoAdjunto(respuesta, pagoId, await this.ver.ejecutar(admin, barberiaId, pagoId));
  }

  @Post('barberias/:barberiaId/pagos/:pagoId/revision')
  @HttpCode(200)
  revision(
    @AdminActual() admin: AdminDePlataforma,
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('pagoId', ParseUUIDPipe) pagoId: string,
    @Body() dto: RevisionDto,
  ): Promise<PagoVista> {
    return this.revisar.ejecutar(
      admin,
      barberiaId,
      pagoId,
      dto.resultado === 'APROBADO'
        ? { resultado: 'APROBADO', importeTransferidoCentimos: dto.importeTransferidoCentimos as number }
        : { resultado: 'RECHAZADO', motivo: dto.motivo as string },
    );
  }
}
