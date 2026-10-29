import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { AdminActual, Plataforma } from '../../../../shared';
import type { AdminDePlataforma } from '../application/comprobantes-plataforma';
import { PagosPorRevisar, ResolverRevision } from '../application/pagos-por-revisar';
import type { PagoPorRevisar } from '../application/ports/pagos-por-revisar';

/** Cuerpo de la resolución (contracts/openapi.yaml, requestBodies.Motivo): la nota, de 5 a 300 caracteres. */
export class MotivoDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 300)
  motivo!: string;
}

/**
 * T090 · Pagos por revisar del administrador de la plataforma (FR-025a; ADR-031). Rutas @Plataforma(): un
 * token de barbería responde 401. La lista se lee con el rol de solo lectura de la plataforma; la resolución
 * corre con el tenant de la barbería de la ruta y RLS.
 */
@Controller('plataforma')
@Plataforma()
export class PagosPlataformaController {
  constructor(
    private readonly porRevisar: PagosPorRevisar,
    private readonly resolver: ResolverRevision,
  ) {}

  @Get('pagos/por-revisar')
  pagosPorRevisar(@AdminActual() admin: AdminDePlataforma): Promise<PagoPorRevisar[]> {
    return this.porRevisar.ejecutar(admin);
  }

  @Post('barberias/:barberiaId/pagos/:pagoId/revision/resolucion')
  @HttpCode(204)
  async resolucion(
    @AdminActual() admin: AdminDePlataforma,
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Param('pagoId', ParseUUIDPipe) pagoId: string,
    @Body() dto: MotivoDto,
  ): Promise<void> {
    await this.resolver.ejecutar(admin, barberiaId, pagoId, dto.motivo);
  }
}
