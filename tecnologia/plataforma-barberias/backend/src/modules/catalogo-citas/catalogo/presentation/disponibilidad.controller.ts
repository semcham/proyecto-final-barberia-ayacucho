import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import { CrearBloqueo, EliminarBloqueo, ListarBloqueos } from '../application/bloqueos';
import type { BloqueoVista, HorarioVista } from '../application/comun';
import { ObtenerDisponibilidad, ReemplazarDisponibilidad } from '../application/horarios';
import { BloqueoDto, HorarioSemanalDto } from './catalogo.dto';
import { OperacionM02 } from './operacion.decorator';

/**
 * T059 · Disponibilidad semanal y bloqueos de un barbero (RF09). El PROPIETARIO opera cualquiera; el
 * BARBERO, solo los del barbero vinculado a su usuario (el caso de uso lo comprueba: 403).
 */
@Controller('barberos/:id')
export class DisponibilidadController {
  constructor(
    private readonly obtenerDisponibilidad: ObtenerDisponibilidad,
    private readonly reemplazarDisponibilidad: ReemplazarDisponibilidad,
    private readonly listarBloqueos: ListarBloqueos,
    private readonly crearBloqueo: CrearBloqueo,
    private readonly eliminarBloqueo: EliminarBloqueo,
  ) {}

  @Get('disponibilidad')
  @OperacionM02('GESTIONAR_DISPONIBILIDAD')
  disponibilidad(@ActorActual() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<HorarioVista> {
    return this.obtenerDisponibilidad.ejecutar(actor, id);
  }

  @Put('disponibilidad')
  @OperacionM02('GESTIONAR_DISPONIBILIDAD')
  reemplazar(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HorarioSemanalDto,
  ): Promise<HorarioVista> {
    return this.reemplazarDisponibilidad.ejecutar(actor, id, dto);
  }

  @Get('bloqueos')
  @OperacionM02('GESTIONAR_BLOQUEOS')
  bloqueos(@ActorActual() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<BloqueoVista[]> {
    return this.listarBloqueos.ejecutar(actor, id);
  }

  @Post('bloqueos')
  @HttpCode(201)
  @OperacionM02('GESTIONAR_BLOQUEOS')
  bloquear(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BloqueoDto,
  ): Promise<BloqueoVista> {
    return this.crearBloqueo.ejecutar(actor, id, {
      inicio: new Date(dto.inicio),
      fin: new Date(dto.fin),
      motivo: dto.motivo,
      confirmarConflictos: dto.confirmarConflictos,
    });
  }

  @Delete('bloqueos/:bloqueoId')
  @HttpCode(204)
  @OperacionM02('GESTIONAR_BLOQUEOS')
  async desbloquear(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bloqueoId', ParseUUIDPipe) bloqueoId: string,
  ): Promise<void> {
    await this.eliminarBloqueo.ejecutar(actor, id, bloqueoId);
  }
}
