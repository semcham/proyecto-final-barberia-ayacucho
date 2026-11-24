import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ActorActual, Publica } from '../../../../shared';
import type { Actor } from '../application/autorizacion';
import { SolicitarVerificacion } from '../application/solicitar-verificacion';
import { VerificarCorreo } from '../application/verificar-correo';
import { VerificarCorreoDto } from './cuenta.dto';

/**
 * T058 de 010 · Enlaces de cuenta por correo (contracts/openapi.yaml de 010). Las respuestas son neutras y con un piso de
 * tiempo (research R07); los límites viven en PostgreSQL (R08). El token nunca se registra.
 */
@Controller('cuenta')
export class CuentaController {
  constructor(
    private readonly verificarCorreo: VerificarCorreo,
    private readonly solicitarVerificacion: SolicitarVerificacion,
  ) {}

  /** POST /api/v1/cuenta/verificacion · Verificar el correo con el enlace, sin sesión. */
  @Post('verificacion')
  @Publica()
  @HttpCode(200)
  verificar(@Body() dto: VerificarCorreoDto): Promise<{ barberia: string }> {
    return this.verificarCorreo.ejecutar(dto.token);
  }

  /**
   * POST /api/v1/cuenta/verificacion/reenvio · Reenviar el correo de verificación (con sesión). Sin operación de la
   * matriz a propósito: cualquier sesión recibe la misma respuesta neutra, y solo la del cliente sin verificar envía algo.
   */
  @Post('verificacion/reenvio')
  @HttpCode(202)
  reenviar(@ActorActual() actor: Actor): Promise<{ mensaje: string }> {
    return this.solicitarVerificacion.reenviar(actor);
  }
}
