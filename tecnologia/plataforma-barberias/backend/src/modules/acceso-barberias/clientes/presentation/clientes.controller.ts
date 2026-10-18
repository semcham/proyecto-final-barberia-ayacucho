import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ActorActual, Publica } from '../../../../shared';
import type { Actor } from '../../identidad/application/autorizacion';
import { fijarCookieRenovacion } from '../../identidad/presentation/cookie-renovacion';
import { Operacion } from '../../identidad/presentation/operacion.decorator';
import { BuscarClientes } from '../application/buscar-clientes';
import type { ClienteEncontrado } from '../application/ports/perfil-cliente-repository';
import { RegistrarCliente } from '../application/registrar-cliente';
import { RegistrarClientePresencial } from '../application/registrar-cliente-presencial';
import { BuscarClientesDto, ClientePresencialDto, RegistroClienteDto } from './clientes.dto';

/** Registros por IP y minuto; mismo límite que el registro de barberías (configurable para las pruebas). */
const limiteRegistros = () => Number(process.env.REGISTRO_LIMITE_POR_MINUTO ?? 10);

/**
 * Clientes (RF05). T089: registro público desde el enlace de una barbería. T108: búsqueda y alta del
 * cliente presencial (solo PROPIETARIO, FR-035).
 */
@Controller('clientes')
export class ClientesController {
  constructor(
    private readonly registrarCliente: RegistrarCliente,
    private readonly buscarClientes: BuscarClientes,
    private readonly registrarPresencial: RegistrarClientePresencial,
  ) {}

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

  /** GET /api/v1/clientes?buscar= · Hasta 20 clientes de la barbería por nombre o teléfono. */
  @Get()
  @Operacion('BUSCAR_CLIENTES')
  buscar(@ActorActual() actor: Actor, @Query() consulta: BuscarClientesDto): Promise<ClienteEncontrado[]> {
    return this.buscarClientes.ejecutar(actor, consulta.buscar);
  }

  /** POST /api/v1/clientes · Cliente presencial sin cuenta, con consentimiento verbal anotado. */
  @Post()
  @HttpCode(201)
  @Operacion('REGISTRAR_CLIENTE_PRESENCIAL')
  registrarClientePresencial(
    @ActorActual() actor: Actor,
    @Body() dto: ClientePresencialDto,
  ): Promise<ClienteEncontrado> {
    return this.registrarPresencial.ejecutar(actor, dto);
  }
}
