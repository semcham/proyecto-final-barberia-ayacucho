import { Body, Controller, Get, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Publica } from '../../../../shared';
import {
  AccionPorEnlace,
  type DatosDelEnlace,
  type ResultadoDeAccion,
} from '../application/accion-por-enlace';
import { ReprogramarCitaDto } from './citas.dto';

// Límite general de estas rutas por IP (contracts/enlaces-de-accion.md §3, paso 1): 30 por minuto. Se lee en cada
// solicitud, como los demás límites con variable de entorno.
const limiteEnlaces = () => Number(process.env.ENLACES_LIMITE_POR_MINUTO ?? 30);
/** La IP del cliente (Express la toma de X-Forwarded-For solo desde un proxy de confianza, PROXIES_CONFIABLES). */
const IP_DESCONOCIDA = 'desconocida';

/**
 * T095 de 004 · Acciones por enlace, sin sesión (RF34; contracts/openapi.yaml, contracts/rbac.md). Públicas: no
 * usan el token de sesión aunque llegue; la barbería sale SOLO del enlace firmado (cuarta excepción del principio
 * III). El token llega solo en el encabezado X-Enlace-Accion: nunca en la ruta ni en la consulta, para que no quede
 * en los registros de acceso.
 */
@Controller('enlaces/accion')
@Publica()
@Throttle({ general: { limit: limiteEnlaces, ttl: 60_000 } })
export class EnlacesController {
  constructor(private readonly accion: AccionPorEnlace) {}

  @Get()
  consultar(
    @Headers('x-enlace-accion') token: string | undefined,
    @Ip() ip: string | undefined,
  ): Promise<DatosDelEnlace> {
    return this.accion.consultar(token, ip ?? IP_DESCONOCIDA);
  }

  @Post('confirmar')
  @HttpCode(200)
  confirmar(
    @Headers('x-enlace-accion') token: string | undefined,
    @Ip() ip: string | undefined,
  ): Promise<ResultadoDeAccion> {
    return this.accion.confirmar(token, ip ?? IP_DESCONOCIDA);
  }

  @Post('cancelar')
  @HttpCode(200)
  cancelar(
    @Headers('x-enlace-accion') token: string | undefined,
    @Ip() ip: string | undefined,
  ): Promise<ResultadoDeAccion> {
    return this.accion.cancelarCita(token, ip ?? IP_DESCONOCIDA);
  }

  @Post('reprogramar')
  @HttpCode(200)
  reprogramar(
    @Headers('x-enlace-accion') token: string | undefined,
    @Ip() ip: string | undefined,
    @Body() dto: ReprogramarCitaDto,
  ): Promise<ResultadoDeAccion> {
    return this.accion.reprogramarCita(token, ip ?? IP_DESCONOCIDA, dto);
  }
}
