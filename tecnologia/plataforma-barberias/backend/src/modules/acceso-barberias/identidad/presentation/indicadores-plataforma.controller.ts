import { Controller, Get } from '@nestjs/common';
import { AdminActual, Plataforma } from '../../../../shared';
import { ConsultarIndicadores, type Indicadores } from '../application/plataforma/consultar-indicadores';
import type { ActorPlataforma } from '../application/validar-solicitud-plataforma';

/**
 * T036 de 007 · Indicadores agregados de la plataforma (RF31; contracts/openapi.yaml y contracts/rbac.md de 007).
 * Ruta @Plataforma(): solo el administrador con su token (sin barbería); cualquier token de barbería responde 401.
 */
@Controller('plataforma/indicadores')
@Plataforma()
export class IndicadoresPlataformaController {
  constructor(private readonly consultar: ConsultarIndicadores) {}

  /** GET /api/v1/plataforma/indicadores */
  @Get()
  indicadores(@AdminActual() admin: ActorPlataforma): Promise<Indicadores> {
    return this.consultar.ejecutar(admin);
  }
}
