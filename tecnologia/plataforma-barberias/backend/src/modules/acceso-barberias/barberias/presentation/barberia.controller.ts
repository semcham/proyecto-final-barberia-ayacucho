import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ActorActual } from '../../../../shared';
import type { Actor } from '../../identidad/application/autorizacion';
import { Operacion } from '../../identidad/presentation/operacion.decorator';
import { ActualizarBarberia } from '../application/actualizar-barberia';
import { ObtenerBarberia } from '../application/obtener-barberia';
import type { ConfiguracionBarberia } from '../application/ports/tenant-repository';
import { ActualizarBarberiaDto } from './barberia.dto';

/**
 * T051 · Configuración de la barbería del token (RF03). El horario de atención está en M02
 * (`/barberia/horario`, research R05). El tenant sale siempre del token.
 */
@Controller('barberia')
export class BarberiaController {
  constructor(
    private readonly obtenerBarberia: ObtenerBarberia,
    private readonly actualizarBarberia: ActualizarBarberia,
  ) {}

  @Get()
  @Operacion('VER_BARBERIA')
  obtener(@ActorActual() actor: Actor): Promise<ConfiguracionBarberia> {
    return this.obtenerBarberia.ejecutar(actor);
  }

  @Patch()
  @Operacion('ACTUALIZAR_BARBERIA')
  actualizar(
    @ActorActual() actor: Actor,
    @Body() dto: ActualizarBarberiaDto,
  ): Promise<ConfiguracionBarberia> {
    return this.actualizarBarberia.ejecutar(actor, dto);
  }
}
