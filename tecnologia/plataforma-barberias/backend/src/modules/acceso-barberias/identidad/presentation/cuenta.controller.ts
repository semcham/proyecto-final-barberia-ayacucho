import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ActorActual, Publica } from '../../../../shared';
import type { Actor } from '../application/autorizacion';
import { PedirRecuperacion } from '../application/pedir-recuperacion';
import { RestablecerContrasena } from '../application/restablecer-contrasena';
import { SolicitarVerificacion } from '../application/solicitar-verificacion';
import { VerificarCorreo } from '../application/verificar-correo';
import { PedirRecuperacionDto, RestablecerContrasenaDto, VerificarCorreoDto } from './cuenta.dto';

/**
 * T058 y T078 de 010 · Enlaces de cuenta por correo (contracts/openapi.yaml de 010). Las respuestas son neutras y con un
 * piso de tiempo (research R07); los límites viven en PostgreSQL (R08). El token y la contraseña nunca se registran.
 */
@Controller('cuenta')
export class CuentaController {
  constructor(
    private readonly verificarCorreo: VerificarCorreo,
    private readonly solicitarVerificacion: SolicitarVerificacion,
    private readonly pedirRecuperacion: PedirRecuperacion,
    private readonly restablecerContrasena: RestablecerContrasena,
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

  /** POST /api/v1/cuenta/recuperacion · Pedir el enlace para recuperar la contraseña, sin sesión (respuesta neutra). */
  @Post('recuperacion')
  @Publica()
  @HttpCode(202)
  recuperar(@Body() dto: PedirRecuperacionDto): Promise<{ mensaje: string }> {
    return this.pedirRecuperacion.ejecutar(dto.correo, dto.barberia);
  }

  /** POST /api/v1/cuenta/recuperacion/contrasena · Elegir la contraseña nueva con el enlace, sin sesión. */
  @Post('recuperacion/contrasena')
  @Publica()
  @HttpCode(204)
  async restablecer(@Body() dto: RestablecerContrasenaDto): Promise<void> {
    await this.restablecerContrasena.ejecutar(dto.token, dto.contrasena);
  }
}
