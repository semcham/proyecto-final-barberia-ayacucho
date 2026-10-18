import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ActorActual, Publica } from '../../../../shared';
import { ActivarCuenta } from '../application/activar-cuenta';
import { ActivacionDto } from './usuarios.dto';
import type { Actor } from '../application/autorizacion';
import { CambiarBarberia } from '../application/cambiar-barberia';
import { CerrarSesion } from '../application/cerrar-sesion';
import { IniciarSesion } from '../application/iniciar-sesion';
import { ObtenerUsuarioActual } from '../application/obtener-usuario-actual';
import { RenovarSesion } from '../application/renovar-sesion';
import type { SesionIniciada } from '../application/sesion-iniciada';
import { NoAutenticado } from '../domain/errores';
import { borrarCookieRenovacion, fijarCookieRenovacion, NOMBRE_COOKIE_RENOVACION } from './cookie-renovacion';
import { CambiarBarberiaDto, LoginDto } from './login.dto';
import { Operacion } from './operacion.decorator';

/** Intentos de activación por IP y minuto (los enlaces son de 256 bits; esto frena el abuso). */
const limiteActivaciones = () => Number(process.env.ACTIVACION_LIMITE_POR_MINUTO ?? 10);

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
    private readonly activarCuenta: ActivarCuenta,
    private readonly cambiarBarberia: CambiarBarberia,
  ) {}

  /** POST /api/v1/auth/login · Iniciar sesión (RF04). */
  @Post('login')
  @Publica()
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) respuesta: Response) {
    const resultado = await this.iniciarSesion.ejecutar(dto.correo, dto.contrasena, {
      barberia: dto.barberia,
      union: {
        aceptaPoliticaDatos: dto.aceptaPoliticaDatos,
        versionPoliticaDatos: dto.versionPoliticaDatos,
        telefono: dto.telefono,
      },
    });
    fijarCookieRenovacion(respuesta, resultado.sesion.tokenRenovacion);
    return aRespuesta(resultado);
  }

  /** POST /api/v1/auth/barberia · El cliente cambia su sesión a otra barbería (ADR-020). */
  @Post('barberia')
  @HttpCode(200)
  @Operacion('CAMBIAR_BARBERIA')
  async cambiarDeBarberia(
    @ActorActual() actor: Actor,
    @Body() dto: CambiarBarberiaDto,
    @Res({ passthrough: true }) respuesta: Response,
  ) {
    const resultado = await this.cambiarBarberia.ejecutar(actor, dto.barberia, {
      aceptaPoliticaDatos: dto.aceptaPoliticaDatos,
      versionPoliticaDatos: dto.versionPoliticaDatos,
      telefono: dto.telefono,
    });
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

  /** POST /api/v1/auth/activar · El usuario fija su contraseña con el enlace de un solo uso (FR-022). */
  @Post('activar')
  @Publica()
  @HttpCode(204)
  @Throttle({ general: { limit: limiteActivaciones, ttl: 60_000 } })
  async activar(@Body() dto: ActivacionDto): Promise<void> {
    await this.activarCuenta.ejecutar(dto.token, dto.contrasena);
  }

  /** GET /api/v1/auth/yo · Usuario autenticado y su barbería. */
  @Get('yo')
  @Operacion('VER_USUARIO_ACTUAL')
  yo(@ActorActual() actor: Actor) {
    return this.obtenerUsuarioActual.ejecutar(actor);
  }
}
