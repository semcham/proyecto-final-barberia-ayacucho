import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import { DatoInvalido } from '../../catalogo/domain/errores';
import { OperacionM02 } from '../../catalogo/presentation/operacion.decorator';
import { type CitaVista, ReservarCita } from '../application/reservar-cita';
import { ReservarCitaDto } from './citas.dto';

/**
 * Citas (RF12). T094: POST /citas con Idempotency-Key obligatoria (R09). El tenant sale del token; el
 * cliente, de la sesión (o del cuerpo, solo para la cita presencial del propietario).
 */
@Controller('citas')
export class CitasController {
  constructor(private readonly reservarCita: ReservarCita) {}

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
