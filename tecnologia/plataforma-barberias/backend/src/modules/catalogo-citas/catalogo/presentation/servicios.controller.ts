import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import { CargarServicios, RevisarCargaServicios, type RevisionVista } from '../application/carga-lote';
import type { ServicioVista } from '../application/comun';
import { ActualizarServicio, CrearServicio, ListarServicios } from '../application/servicios';
import { CargaServiciosDto } from './carga-lote.dto';
import { ActualizarServicioDto, ServicioDto } from './catalogo.dto';
import { OperacionM02 } from './operacion.decorator';

/** T059 · Servicios de la barbería (RF07). No hay ruta para eliminar: se desactivan (FR-006). */
@Controller('servicios')
export class ServiciosController {
  constructor(
    private readonly listarServicios: ListarServicios,
    private readonly crearServicio: CrearServicio,
    private readonly actualizarServicio: ActualizarServicio,
    private readonly revisarCarga: RevisarCargaServicios,
    private readonly cargarServicios: CargarServicios,
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

  /** 011 (T022) · Revisa una carga de servicios sin guardar nada: errores por fila (vista previa). */
  @Post('lote/revision')
  @HttpCode(200)
  @OperacionM02('GESTIONAR_SERVICIOS')
  revisarLote(@ActorActual() actor: Actor, @Body() dto: CargaServiciosDto): Promise<RevisionVista> {
    return this.revisarCarga.ejecutar(actor, dto.filas);
  }

  /** 011 (T022) · Crea todos los servicios de la carga o ninguno. Idempotency-Key obligatoria. */
  @Post('lote')
  @OperacionM02('GESTIONAR_SERVICIOS')
  async cargarLote(
    @ActorActual() actor: Actor,
    @Body() dto: CargaServiciosDto,
    @Headers('idempotency-key') clave: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<{ tipo: string; creados: number; ids: string[] }> {
    const { creada, ...resumen } = await this.cargarServicios.ejecutar(actor, dto.filas, clave);
    // 201 al crear; 200 cuando un reintento con la misma clave devuelve la carga ya guardada.
    respuesta.status(creada ? 201 : 200);
    return resumen;
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
