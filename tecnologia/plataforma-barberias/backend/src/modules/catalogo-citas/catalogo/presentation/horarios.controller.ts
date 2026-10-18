import { Controller, Get, Query } from '@nestjs/common';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import { ConsultarHorarios, type HorariosLibresVista } from '../application/consultar-horarios';
import { ConsultaHorariosDto } from './horarios.dto';
import { OperacionM02 } from './operacion.decorator';

/**
 * T073 · GET /horarios con sesión (CLIENTE y PROPIETARIO): el mismo cálculo que la vía pública, con la
 * barbería del token (principio III).
 */
@Controller('horarios')
export class HorariosController {
  constructor(private readonly consultarHorarios: ConsultarHorarios) {}

  @Get()
  @OperacionM02('CONSULTAR_HORARIOS')
  consultar(
    @ActorActual() actor: Actor,
    @Query() consulta: ConsultaHorariosDto,
  ): Promise<HorariosLibresVista> {
    return this.consultarHorarios.conSesion(actor, {
      servicioId: consulta.servicio,
      fecha: consulta.fecha,
      barberoId: consulta.barbero,
    });
  }
}
