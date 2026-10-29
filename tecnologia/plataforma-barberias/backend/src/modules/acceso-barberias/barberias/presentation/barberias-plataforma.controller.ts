import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { AdminActual, Plataforma } from '../../../../shared';
import type { ActorPlataforma } from '../../identidad/application/validar-solicitud-plataforma';
import {
  type BarberiaPlataformaVista,
  ListarBarberiasPlataforma,
  MAXIMA_PAGINA_BARBERIAS,
  ReactivarBarberia,
  SuspenderBarberia,
} from '../application/plataforma/administrar-barberias';

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** GET /plataforma/barberias?buscar&pagina (contracts/openapi.yaml de 003). */
export class ListadoBarberiasDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(80)
  buscar?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAXIMA_PAGINA_BARBERIAS)
  pagina?: number;
}

/** requestBodies.Motivo: de 5 a 300 caracteres, sin espacios a los lados. */
export class MotivoSuspensionDto {
  @Transform(recortar)
  @IsString()
  @Length(5, 300)
  motivo!: string;
}

/**
 * T098 · Barberías para el administrador de la plataforma (RF02; FR-034, FR-038; ADR-031). Rutas @Plataforma():
 * un token de barbería responde 401, y el token de la plataforma no sirve en ninguna ruta de barbería. Suspender
 * y reactivar corren con el tenant de la barbería de la ruta y RLS.
 */
@Controller('plataforma/barberias')
@Plataforma()
export class BarberiasPlataformaController {
  constructor(
    private readonly listar: ListarBarberiasPlataforma,
    private readonly suspender: SuspenderBarberia,
    private readonly reactivar: ReactivarBarberia,
  ) {}

  @Get()
  listado(
    @AdminActual() admin: ActorPlataforma,
    @Query() dto: ListadoBarberiasDto,
  ): Promise<{ barberias: BarberiaPlataformaVista[]; total: number }> {
    return this.listar.ejecutar(admin, dto.buscar ? dto.buscar : null, dto.pagina ?? 1);
  }

  @Put(':barberiaId/suspension')
  @HttpCode(204)
  async suspenderBarberia(
    @AdminActual() admin: ActorPlataforma,
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: MotivoSuspensionDto,
  ): Promise<void> {
    await this.suspender.ejecutar(admin, barberiaId, dto.motivo);
  }

  @Delete(':barberiaId/suspension')
  @HttpCode(204)
  async reactivarBarberia(
    @AdminActual() admin: ActorPlataforma,
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
  ): Promise<void> {
    await this.reactivar.ejecutar(admin, barberiaId);
  }
}
