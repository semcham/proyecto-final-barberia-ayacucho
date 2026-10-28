import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { IsIn, IsUUID } from 'class-validator';
import type { Response } from 'express';
import { ActorActual, RequiereOperacion } from '../../../../shared';
import { IniciarPago, type PagoIniciado } from '../../pagos/application/iniciar-pago';
import type { PagoVista, PlanVista } from '../../pagos/application/vistas';
import type { ActorDeBarberia } from '../application/autorizacion';
import {
  ConsultasDeSuscripcion,
  type EstadoOperativoVista,
  type SuscripcionVista,
} from '../application/consultas';
import type { OperacionSuscripciones } from '../domain/permisos';

/** Operación de la matriz de M03 (primera barrera en el RolesGuard; el caso de uso la vuelve a exigir). */
const OperacionM03 = (operacion: OperacionSuscripciones) => RequiereOperacion(operacion);

/**
 * Cuerpo de POST /suscripcion/pagos. Solo el plan y el medio: ningún dato de tarjeta ni del pagador pasa por
 * la plataforma (principio V); un campo de más responde 400 (ValidationPipe con forbidNonWhitelisted).
 */
export class IniciarPagoDto {
  @IsUUID()
  planId!: string;

  @IsIn(['YAPE', 'TRANSFERENCIA'])
  medio!: 'YAPE' | 'TRANSFERENCIA';
}

/** T049 · Suscripción de la barbería del token (RF19, RF20, RF23; contracts/openapi.yaml de 003). */
@Controller()
export class SuscripcionController {
  constructor(
    private readonly consultas: ConsultasDeSuscripcion,
    private readonly iniciarPago: IniciarPago,
  ) {}

  @Get('planes')
  @OperacionM03('VER_PLANES')
  planes(@ActorActual() actor: ActorDeBarberia): Promise<PlanVista[]> {
    return this.consultas.planes(actor);
  }

  @Get('suscripcion')
  @OperacionM03('VER_SUSCRIPCION')
  suscripcion(@ActorActual() actor: ActorDeBarberia): Promise<SuscripcionVista> {
    return this.consultas.suscripcion(actor);
  }

  @Get('suscripcion/estado-operativo')
  @OperacionM03('VER_ESTADO_OPERATIVO')
  estadoOperativo(@ActorActual() actor: ActorDeBarberia): Promise<EstadoOperativoVista> {
    return this.consultas.estadoOperativo(actor);
  }

  /** 201 si se creó el pago; 200 si se devolvió el pago abierto igual (FR-012). */
  @Post('suscripcion/pagos')
  @HttpCode(201)
  @OperacionM03('PAGAR_SUSCRIPCION')
  async pagar(
    @ActorActual() actor: ActorDeBarberia,
    @Body() dto: IniciarPagoDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<Omit<PagoIniciado, 'creado'>> {
    const { creado, ...iniciado } = await this.iniciarPago.ejecutar(actor, {
      planId: dto.planId,
      medio: dto.medio,
    });
    if (!creado) respuesta.status(200);
    return iniciado;
  }

  @Get('suscripcion/pagos/:pagoId')
  @OperacionM03('VER_SUSCRIPCION')
  pago(
    @ActorActual() actor: ActorDeBarberia,
    @Param('pagoId', ParseUUIDPipe) pagoId: string,
  ): Promise<PagoVista> {
    return this.consultas.pago(actor, pagoId);
  }
}
