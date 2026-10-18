import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import { DatoInvalido } from '../../catalogo/domain/errores';
import { OperacionM02 } from '../../catalogo/presentation/operacion.decorator';
import { CambiarEstadoCita } from '../application/cambiar-estado-cita';
import { CancelarCita } from '../application/cancelar-cita';
import { type CitaVista, ReservarCita } from '../application/reservar-cita';
import { CambiarEstadoDto, CancelarCitaDto, ReservarCitaDto } from './citas.dto';

/**
 * Citas (RF12). T094: POST /citas con Idempotency-Key obligatoria (R09). El tenant sale del token; el
 * cliente, de la sesión (o del cuerpo, solo para la cita presencial del propietario).
 */
@Controller('citas')
export class CitasController {
  constructor(
    private readonly reservarCita: ReservarCita,
    private readonly cambiarEstadoCita: CambiarEstadoCita,
    private readonly cancelarCita: CancelarCita,
  ) {}

  /** T117 · POST /citas/:id/cancelar · El cliente las suyas hasta el inicio; el propietario cualquiera. */
  @Post(':id/cancelar')
  @HttpCode(200)
  @OperacionM02('CANCELAR_CITA')
  cancelar(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelarCitaDto,
  ): Promise<CitaVista> {
    return this.cancelarCita.ejecutar(actor, id, dto?.motivo);
  }

  /** T109 · POST /citas/:id/estado · Transición de la barbería (RF15): aprobar, completar o no asistió. */
  @Post(':id/estado')
  @HttpCode(200)
  @OperacionM02('CAMBIAR_ESTADO_CITA')
  cambiarEstado(
    @ActorActual() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarEstadoDto,
  ): Promise<CitaVista> {
    return this.cambiarEstadoCita.ejecutar(actor, id, dto.estado);
  }

  @Post()
  @OperacionM02('RESERVAR_CITA')
  async reservar(
    @ActorActual() actor: Actor,
    @Body() dto: ReservarCitaDto,
    @Headers('idempotency-key') clave: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<CitaVista> {
    if (!clave) throw new DatoInvalido('Idempotency-Key', 'requerido');
    const { cita, creada } = await this.reservarCita.ejecutar(actor, dto, clave);
    // 201 al crear; 200 cuando un reintento con la misma clave devuelve la cita ya creada.
    respuesta.status(creada ? 201 : 200);
    return cita;
  }
}
