import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { VerificadorBaseDeDatos } from '../shared';
import { Publica } from './solicitud';

/** Estado del servicio para el balanceador y el monitoreo (T047). */
@Controller('salud')
export class SaludController {
  constructor(private readonly verificador: VerificadorBaseDeDatos) {}

  @Get()
  @Publica()
  @SkipThrottle()
  async salud(): Promise<{ estado: 'ok' }> {
    if (!(await this.verificador.responde())) throw new ServiceUnavailableException();
    return { estado: 'ok' };
  }
}
