import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { VerificadorBaseDeDatos, VerificadorMigraciones } from '../shared';
import { Publica } from './solicitud';

/** Estado del servicio para el balanceador, Docker y el monitoreo (T047 de 001; 006 R02). */
@Controller('salud')
@Publica()
// El límite global se llama "general" (app.module.ts): @SkipThrottle() sin argumentos solo omite "default".
@SkipThrottle({ general: true })
export class SaludController {
  constructor(
    private readonly verificador: VerificadorBaseDeDatos,
    private readonly migraciones: VerificadorMigraciones,
  ) {}

  /** GET /api/v1/salud · Vivacidad: la instancia responde y PostgreSQL acepta consultas. */
  @Get()
  async salud(): Promise<{ estado: 'ok' }> {
    if (!(await this.verificador.responde())) throw new ServiceUnavailableException();
    return { estado: 'ok' };
  }

  /**
   * GET /api/v1/salud/listo · Disponibilidad: PostgreSQL responde y todas las migraciones del código están
   * aplicadas. Redis no cuenta: sin Redis la réplica sigue lista (FR-019).
   */
  @Get('listo')
  async listo(): Promise<{ estado: 'listo' }> {
    if (!(await this.migraciones.lista())) throw new ServiceUnavailableException();
    return { estado: 'listo' };
  }
}
