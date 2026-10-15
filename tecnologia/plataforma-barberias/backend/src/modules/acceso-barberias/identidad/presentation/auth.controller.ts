import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ActorActual, Publica } from '../../../../shared';
import type { Actor } from '../application/autorizacion';
import { CerrarSesion } from '../application/cerrar-sesion';
import { IniciarSesion } from '../application/iniciar-sesion';
import { ObtenerUsuarioActual } from '../application/obtener-usuario-actual';
import { RenovarSesion } from '../application/renovar-sesion';
import type { SesionIniciada } from '../application/sesion-iniciada';
import { NoAutenticado } from '../domain/errores';
import { borrarCookieRenovacion, fijarCookieRenovacion, NOMBRE_COOKIE_RENOVACION } from './cookie-renovacion';
import { LoginDto } from './login.dto';
import { Operacion } from './operacion.decorator';

/** Cuerpo SesionResponse del contrato. El token de renovación viaja solo en la cookie HttpOnly. */
function aRespuesta({ sesion, usuario }: SesionIniciada) {
  return { tokenAcceso: sesion.tokenAcceso, tipo: 'Bearer', expiraEn: sesion.expiraEn, usuario };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly iniciarSesion: IniciarSesion,
    private readonly renovarSesion: RenovarSesion,
    private readonly cerrarSesion: CerrarSesion,
    private readonly obtenerUsuarioActual: ObtenerUsuarioActual,
  ) {}

  /** POST /api/v1/auth/login · Iniciar sesión (RF04). */
  @Post('login')
  @Publica()
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) respuesta: Response) {
    const resultado = await this.iniciarSesion.ejecutar(dto.correo, dto.contrasena);
    fijarCookieRenovacion(respuesta, resultado.sesion.tokenRenovacion);
    return aRespuesta(resultado);
  }

  /** POST /api/v1/auth/refresh · Renovar el token de acceso con la cookie (y rotarla). */
  @Post('refresh')
  @Publica()
  @HttpCode(200)
  async refresh(@Req() solicitud: Request, @Res({ passthrough: true }) respuesta: Response) {
    const token: unknown = solicitud.cookies?.[NOMBRE_COOKIE_RENOVACION];
    try {
      if (typeof token !== 'string' || token.length === 0 || token.length > 128) throw new NoAutenticado();
      const resultado = await this.renovarSesion.ejecutar(token);
      fijarCookieRenovacion(respuesta, resultado.sesion.tokenRenovacion);
      return aRespuesta(resultado);
    } catch (error) {
      borrarCookieRenovacion(respuesta);
      throw error;
    }
  }

  /** POST /api/v1/auth/logout · Cerrar sesión (FR-011). */
  @Post('logout')
  @HttpCode(204)
  @Operacion('CERRAR_SESION')
  async logout(@ActorActual() actor: Actor, @Res({ passthrough: true }) respuesta: Response): Promise<void> {
    await this.cerrarSesion.ejecutar(actor);
    borrarCookieRenovacion(respuesta);
  }

  /** GET /api/v1/auth/yo · Usuario autenticado y su barbería. */
  @Get('yo')
  @Operacion('VER_USUARIO_ACTUAL')
  yo(@ActorActual() actor: Actor) {
    return this.obtenerUsuarioActual.ejecutar(actor);
  }
}
