import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import type { ServicioVista } from '../application/comun';
import { ActualizarServicio, CrearServicio, ListarServicios } from '../application/servicios';
import { ActualizarServicioDto, ServicioDto } from './catalogo.dto';
import { OperacionM02 } from './operacion.decorator';

/** T059 · Servicios de la barbería (RF07). No hay ruta para eliminar: se desactivan (FR-006). */
@Controller('servicios')
export class ServiciosController {
  constructor(
    private readonly listarServicios: ListarServicios,
    private readonly crearServicio: CrearServicio,
    private readonly actualizarServicio: ActualizarServicio,
  ) {}

  @Get()
  @OperacionM02('VER_CATALOGO')
  listar(@ActorActual() actor: Actor): Promise<ServicioVista[]> {
    return this.listarServicios.ejecutar(actor);
  }

  @Post()
  @HttpCode(201)
  @OperacionM02('GESTIONAR_SERVICIOS')
  crear(@ActorActual() actor: Actor, @Body() dto: ServicioDto): Promise<ServicioVista> {
    return this.crearServicio.ejecutar(actor, {
      nombre: dto.nombre,
      descripcion: dto.descripcion,
      precio: dto.precio,
      duracionMin: dto.duracionMinutos,
    });
  }

  @Patch(':id')
  @OperacionM02('GESTIONAR_SERVICIOS')
  actualizar(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizarServicioDto,
  ): Promise<ServicioVista> {
    return this.actualizarServicio.ejecutar(actor, id, {
      nombre: dto.nombre,
      descripcion: dto.descripcion,
      precio: dto.precio,
      duracionMin: dto.duracionMinutos,
      activo: dto.activo,
      confirmarConflictos: dto.confirmarConflictos,
    });
  }
}
