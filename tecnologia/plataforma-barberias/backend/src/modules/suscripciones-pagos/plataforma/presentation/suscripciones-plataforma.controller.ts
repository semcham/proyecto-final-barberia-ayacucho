import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length } from 'class-validator';
import { AdminActual, Plataforma } from '../../../../shared';
import type { PagoVista, PlanVista } from '../../pagos/application/vistas';
import type { AdminDePlataforma } from '../application/comprobantes-plataforma';
import {
  ActivacionManual,
  PlanesParaPlataforma,
  ReactivarSuscripcion,
  SuspenderSuscripcion,
} from '../application/suscripciones-plataforma';
import { MotivoDto } from './pagos-plataforma.controller';

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Cuerpo de la activación manual (contracts/openapi.yaml, /plataforma/barberias/{id}/activacion-manual). */
export class ActivacionManualDto {
  @IsUUID()
  planId!: string;

  @Transform(recortar)
  @IsString()
  @Length(5, 300)
  motivo!: string;

  @Transform(recortar)
  @IsString()
  @Length(3, 80)
  referenciaExterna!: string;
}

/**
 * T098 · Suscripciones de las barberías, para el administrador de la plataforma (FR-035, FR-036; ADR-031). Rutas
 * @Plataforma(): un token de barbería responde 401. Cada escritura corre con el tenant de la barbería de la ruta y
 * RLS, y queda en su audit_log con el administrador como actor.
 */
@Controller('plataforma')
@Plataforma()
export class SuscripcionesPlataformaController {
  constructor(
    private readonly suspender: SuspenderSuscripcion,
    private readonly reactivar: ReactivarSuscripcion,
    private readonly activar: ActivacionManual,
    private readonly planes: PlanesParaPlataforma,
  ) {}

  @Get('planes')
  listarPlanes(@AdminActual() admin: AdminDePlataforma): Promise<PlanVista[]> {
    return this.planes.ejecutar(admin);
  }

  @Put('barberias/:barberiaId/suscripcion/suspension')
  @HttpCode(204)
  async suspenderSuscripcion(
    @AdminActual() admin: AdminDePlataforma,
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: MotivoDto,
  ): Promise<void> {
    await this.suspender.ejecutar(admin, barberiaId, dto.motivo);
  }

  @Delete('barberias/:barberiaId/suscripcion/suspension')
  @HttpCode(204)
  async reactivarSuscripcion(
    @AdminActual() admin: AdminDePlataforma,
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
  ): Promise<void> {
    await this.reactivar.ejecutar(admin, barberiaId);
  }

  @Post('barberias/:barberiaId/activacion-manual')
  activacionManual(
    @AdminActual() admin: AdminDePlataforma,
    @Param('barberiaId', ParseUUIDPipe) barberiaId: string,
    @Body() dto: ActivacionManualDto,
  ): Promise<PagoVista> {
    return this.activar.ejecutar(admin, barberiaId, dto);
  }
}
