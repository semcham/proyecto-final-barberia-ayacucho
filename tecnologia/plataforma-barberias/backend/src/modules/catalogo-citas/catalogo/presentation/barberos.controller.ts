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
import { ActualizarBarbero, CrearBarbero, ListarBarberos } from '../application/barberos';
import { CargarBarberos, RevisarCargaBarberos, type RevisionBarberosVista } from '../application/carga-lote';
import type { BarberoVista } from '../application/comun';
import { CargaBarberosDto } from './carga-lote.dto';
import { ActualizarBarberoDto, BarberoDto } from './catalogo.dto';
import { OperacionM02 } from './operacion.decorator';

/** T059 · Barberos de la barbería (RF08). No hay ruta para eliminar: se desactivan (FR-011). */
@Controller('barberos')
export class BarberosController {
  constructor(
    private readonly listarBarberos: ListarBarberos,
    private readonly crearBarbero: CrearBarbero,
    private readonly actualizarBarbero: ActualizarBarbero,
    private readonly revisarCarga: RevisarCargaBarberos,
    private readonly cargarBarberos: CargarBarberos,
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

  /** 011 (T039) · Revisa una carga de barberos sin guardar nada: errores, advertencias y cupo del plan. */
  @Post('lote/revision')
  @HttpCode(200)
  @OperacionM02('GESTIONAR_BARBEROS')
  revisarLote(@ActorActual() actor: Actor, @Body() dto: CargaBarberosDto): Promise<RevisionBarberosVista> {
    return this.revisarCarga.ejecutar(actor, dto.filas);
  }

  /** 011 (T039) · Crea todos los barberos de la carga (activos, sin usuario) o ninguno. Idempotency-Key obligatoria. */
  @Post('lote')
  @OperacionM02('GESTIONAR_BARBEROS')
  async cargarLote(
    @ActorActual() actor: Actor,
    @Body() dto: CargaBarberosDto,
    @Headers('idempotency-key') clave: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<{ tipo: string; creados: number; ids: string[] }> {
    const { creada, ...resumen } = await this.cargarBarberos.ejecutar(actor, dto.filas, clave);
    respuesta.status(creada ? 201 : 200);
    return resumen;
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
