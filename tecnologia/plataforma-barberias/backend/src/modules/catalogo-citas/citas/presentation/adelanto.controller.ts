import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import { OperacionM02 } from '../../catalogo/presentation/operacion.decorator';
import {
  type AdelantoEnBandejaVista,
  BandejaAdelantos,
  type EstadoDeBandeja,
} from '../application/bandeja-adelantos';
import { ConfirmarAdelanto } from '../application/confirmar-adelanto';
import type { CitaVista } from '../application/reservar-cita';

/** Consulta de GET /adelantos/por-revisar: la pestaña de la bandeja (por defecto, los pagos por revisar). */
export class BandejaAdelantosDto {
  @IsOptional()
  @IsIn(['POR_REVISAR', 'POR_DEVOLVER'])
  estado?: EstadoDeBandeja;
}

/**
 * T042 de 008 · Las rutas del adelanto que cambian o listan CITAS (M02, research R01): confirmar el adelanto (la cita
 * pasa a CONFIRMADA) y la bandeja de verificación. Solo el propietario (REVISAR_ADELANTO, contracts/rbac.md).
 */
@Controller()
export class AdelantoController {
  constructor(
    private readonly confirmar: ConfirmarAdelanto,
    private readonly bandeja: BandejaAdelantos,
  ) {}

  @Post('citas/:id/adelanto/confirmacion')
  @HttpCode(200)
  @OperacionM02('REVISAR_ADELANTO')
  confirmarAdelanto(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) citaId: string,
  ): Promise<CitaVista> {
    return this.confirmar.ejecutar(actor, citaId);
  }

  @Get('adelantos/por-revisar')
  @OperacionM02('REVISAR_ADELANTO')
  porRevisar(
    @ActorActual() actor: Actor,
    @Query() consulta: BandejaAdelantosDto,
  ): Promise<AdelantoEnBandejaVista[]> {
    return this.bandeja.ejecutar(actor, consulta.estado ?? 'POR_REVISAR');
  }
}
