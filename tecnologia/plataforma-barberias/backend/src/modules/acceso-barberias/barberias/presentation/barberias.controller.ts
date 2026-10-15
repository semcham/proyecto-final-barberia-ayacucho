import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Publica } from '../../../../shared';
import { fijarCookieRenovacion } from '../../identidad/presentation/cookie-renovacion';
import { RegistrarBarberia } from '../application/registrar-barberia';
import { RegistroBarberiaDto } from './registro-barberia.dto';

/** Registros por IP y minuto; configurable para las pruebas (en producción, 10). */
const limiteRegistros = () => Number(process.env.REGISTRO_LIMITE_POR_MINUTO ?? 10);

@Controller('barberias')
export class BarberiasController {
  constructor(private readonly registrarBarberia: RegistrarBarberia) {}

  /** POST /api/v1/barberias · Registrar barbería con prueba gratuita (RF01, RF18). */
  @Post()
  @Publica()
  @HttpCode(201)
  @Throttle({ general: { limit: limiteRegistros, ttl: 60_000 } })
  async registrar(@Body() dto: RegistroBarberiaDto, @Res({ passthrough: true }) respuesta: Response) {
    const resultado = await this.registrarBarberia.ejecutar(dto);
    fijarCookieRenovacion(respuesta, resultado.sesion.tokenRenovacion);
    const barberia = resultado.barberia;
    return {
      barberia,
      suscripcion: {
        estado: resultado.suscripcion.estado,
        plan: resultado.suscripcion.plan,
        iniciaEn: resultado.suscripcion.iniciaEn.toISOString(),
        venceEn: resultado.suscripcion.venceEn.toISOString(),
      },
      sesion: {
        tokenAcceso: resultado.sesion.tokenAcceso,
        tipo: 'Bearer',
        expiraEn: resultado.sesion.expiraEn,
        usuario: { ...resultado.propietario, rol: 'PROPIETARIO', barberia },
      },
    };
  }
}
