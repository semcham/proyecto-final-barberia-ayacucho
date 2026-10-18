import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import { ActualizarBarbero, CrearBarbero, ListarBarberos } from '../application/barberos';
import type { BarberoVista } from '../application/comun';
import { ActualizarBarberoDto, BarberoDto } from './catalogo.dto';
import { OperacionM02 } from './operacion.decorator';

/** T059 · Barberos de la barbería (RF08). No hay ruta para eliminar: se desactivan (FR-011). */
@Controller('barberos')
export class BarberosController {
  constructor(
    private readonly listarBarberos: ListarBarberos,
    private readonly crearBarbero: CrearBarbero,
    private readonly actualizarBarbero: ActualizarBarbero,
  ) {}

  @Get()
  @OperacionM02('VER_CATALOGO')
  listar(@ActorActual() actor: Actor): Promise<BarberoVista[]> {
    return this.listarBarberos.ejecutar(actor);
  }

  @Post()
  @HttpCode(201)
  @OperacionM02('GESTIONAR_BARBEROS')
  crear(@ActorActual() actor: Actor, @Body() dto: BarberoDto): Promise<BarberoVista> {
    return this.crearBarbero.ejecutar(actor, dto);
  }

  @Patch(':id')
  @OperacionM02('GESTIONAR_BARBEROS')
  actualizar(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarBarberoDto,
  ): Promise<BarberoVista> {
    return this.actualizarBarbero.ejecutar(actor, id, dto);
  }
}
