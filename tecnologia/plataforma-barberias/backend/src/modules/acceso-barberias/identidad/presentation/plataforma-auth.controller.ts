import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminActual, Clock, Plataforma, Publica } from '../../../../shared';
import { IngresarAdmin } from '../application/plataforma/ingresar-admin';
import { RenovarSesionPlataforma } from '../application/plataforma/renovar-sesion-plataforma';
import { SalirPlataforma } from '../application/plataforma/salir-plataforma';
import {
  type SesionPlataformaEmitida,
  VerificarSegundoFactor,
} from '../application/plataforma/verificar-segundo-factor';
import type { ActorPlataforma } from '../application/validar-solicitud-plataforma';
import { NoAutenticado } from '../domain/errores';
import { IngresarPlataformaDto, SegundoFactorDto } from './plataforma-auth.dto';

/** Cookie de renovación del administrador (R07): otro nombre y otra ruta que la de las barberías. */
export const NOMBRE_COOKIE_PLATAFORMA = 'rtp';
const RUTA_COOKIE = '/api/v1/plataforma/auth';

function opcionesCookie() {
  return { httpOnly: true, secure: true, sameSite: 'strict' as const, path: RUTA_COOKIE };
}

/**
 * T069 · Ingreso del administrador de la plataforma (R07, ADR-031): `/plataforma/auth/*`. El token de
 * renovación viaja solo en la cookie `HttpOnly`, `SameSite=Strict`, con ruta `/api/v1/plataforma/auth`, y
 * dura lo que le queda a la sesión (8 horas como máximo). Nunca se devuelven secretos ni códigos.
 */
@Controller('plataforma/auth')
export class PlataformaAuthController {
  constructor(
    private readonly ingresarAdmin: IngresarAdmin,
    private readonly verificarSegundoFactor: VerificarSegundoFactor,
    private readonly renovarSesion: RenovarSesionPlataforma,
    private readonly salirPlataforma: SalirPlataforma,
    private readonly reloj: Clock,
  ) {}

  @Post('ingresar')
  @Publica()
  @HttpCode(200)
  async ingresar(@Body() dto: IngresarPlataformaDto) {
    const { desafio, expiraEn } = await this.ingresarAdmin.ejecutar(dto.correo, dto.contrasena);
    return { desafio, expiraEn: expiraEn.toISOString() };
  }

  @Post('segundo-factor')
  @Publica()
  @HttpCode(200)
  async segundoFactor(@Body() dto: SegundoFactorDto, @Res({ passthrough: true }) respuesta: Response) {
    const sesion = await this.verificarSegundoFactor.ejecutar(dto.desafio, {
      codigo: dto.codigo,
      codigoRecuperacion: dto.codigoRecuperacion,
    });
    return this.responder(respuesta, sesion);
  }

  @Post('renovar')
  @Publica()
  @HttpCode(200)
  async renovar(@Req() solicitud: Request, @Res({ passthrough: true }) respuesta: Response) {
    const token: unknown = solicitud.cookies?.[NOMBRE_COOKIE_PLATAFORMA];
    try {
      if (typeof token !== 'string' || token.length === 0 || token.length > 128) throw new NoAutenticado();
      return this.responder(respuesta, await this.renovarSesion.ejecutar(token));
    } catch (error) {
      respuesta.clearCookie(NOMBRE_COOKIE_PLATAFORMA, opcionesCookie());
      throw error;
    }
  }

  @Post('salir')
  @Plataforma()
  @HttpCode(204)
  async salir(@AdminActual() admin: ActorPlataforma, @Res({ passthrough: true }) respuesta: Response) {
    await this.salirPlataforma.ejecutar(admin);
    respuesta.clearCookie(NOMBRE_COOKIE_PLATAFORMA, opcionesCookie());
  }

  private responder(respuesta: Response, sesion: SesionPlataformaEmitida) {
    respuesta.cookie(NOMBRE_COOKIE_PLATAFORMA, sesion.tokenRenovacion, {
      ...opcionesCookie(),
      maxAge: Math.max(0, sesion.sesionExpiraEn.getTime() - this.reloj.ahora().getTime()),
    });
    // Ni el token de renovación ni nada del segundo factor en el cuerpo.
    return { tokenAcceso: sesion.tokenAcceso, tipo: 'Bearer', expiraEn: sesion.expiraEn.toISOString() };
  }
}
