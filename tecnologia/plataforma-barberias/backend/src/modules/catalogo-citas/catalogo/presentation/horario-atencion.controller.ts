import { Body, Controller, Get, Put } from '@nestjs/common';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import type { HorarioVista } from '../application/comun';
import { ObtenerHorarioAtencion, ReemplazarHorarioAtencion } from '../application/horarios';
import { HorarioSemanalDto } from './catalogo.dto';
import { OperacionM02 } from './operacion.decorator';

/** T059 · Horario de atención de la barbería (RF03). Vive en M02 aunque su ruta cuelga de /barberia (R05). */
@Controller('barberia/horario')
export class HorarioAtencionController {
  constructor(
    private readonly obtenerHorario: ObtenerHorarioAtencion,
    private readonly reemplazarHorario: ReemplazarHorarioAtencion,
  ) {}

  @Get()
  @OperacionM02('VER_HORARIO_ATENCION')
  obtener(@ActorActual() actor: Actor): Promise<HorarioVista> {
    return this.obtenerHorario.ejecutar(actor);
  }

  @Put()
  @OperacionM02('GESTIONAR_HORARIO_ATENCION')
  reemplazar(@ActorActual() actor: Actor, @Body() dto: HorarioSemanalDto): Promise<HorarioVista> {
    return this.reemplazarHorario.ejecutar(actor, dto);
  }
}
