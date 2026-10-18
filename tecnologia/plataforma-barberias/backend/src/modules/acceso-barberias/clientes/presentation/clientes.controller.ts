import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Publica } from '../../../../shared';
import { fijarCookieRenovacion } from '../../identidad/presentation/cookie-renovacion';
import { RegistrarCliente } from '../application/registrar-cliente';
import { RegistroClienteDto } from './clientes.dto';

/** Registros por IP y minuto; mismo límite que el registro de barberías (configurable para las pruebas). */
const limiteRegistros = () => Number(process.env.REGISTRO_LIMITE_POR_MINUTO ?? 10);

/** Clientes (RF05). T089: registro público desde el enlace de una barbería. */
@Controller('clientes')
export class ClientesController {
  constructor(private readonly registrarCliente: RegistrarCliente) {}

  /** POST /api/v1/clientes/registro · Registro con consentimiento; deja la sesión abierta en esa barbería. */
  @Post('registro')
  @Publica()
  @HttpCode(201)
  @Throttle({ general: { limit: limiteRegistros, ttl: 60_000 } })
  async registrar(@Body() dto: RegistroClienteDto, @Res({ passthrough: true }) respuesta: Response) {
    const { sesion, usuario } = await this.registrarCliente.ejecutar(dto);
    fijarCookieRenovacion(respuesta, sesion.tokenRenovacion);
    return { tokenAcceso: sesion.tokenAcceso, tipo: 'Bearer', expiraEn: sesion.expiraEn, usuario };
  }
}
