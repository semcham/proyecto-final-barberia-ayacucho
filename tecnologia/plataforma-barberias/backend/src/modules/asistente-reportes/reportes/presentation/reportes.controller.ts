import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { ActorActual, RequiereOperacion } from '../../../../shared';
import type { ActorDeBarberia } from '../../comun/application/autorizacion';
import type { OperacionAsistenteReportes } from '../../comun/domain/permisos';
import { ConsultarReportes } from '../application/consultar-reportes';
import type { ReportesDelPeriodo } from '../domain/reportes';

/** Operación de la matriz de M04 (primera barrera en el RolesGuard; el caso de uso la vuelve a exigir). */
const OperacionM04 = (operacion: OperacionAsistenteReportes) => RequiereOperacion(operacion);

/**
 * Parámetros de GET /reportes (contracts/openapi.yaml de 005). Aquí solo el tipo: que falten, el formato, el orden y
 * el largo los valida el dominio con 422 y el campo a corregir. Un parámetro de más (p. ej. tenant o slug) responde
 * 400, como en todo el sistema: la barbería sale siempre del token (FR-025).
 */
export class ConsultaReportesDto {
  @IsOptional()
  @IsString()
  desde?: string;

  @IsOptional()
  @IsString()
  hasta?: string;
}

/** T022 de 005 · GET /reportes?desde=&hasta= (US2): los tres reportes del período, solo para el propietario. */
@Controller('reportes')
export class ReportesController {
  constructor(private readonly consultarReportes: ConsultarReportes) {}

  @Get()
  @OperacionM04('VER_REPORTES')
  consultar(
    @ActorActual() actor: ActorDeBarberia,
    @Query() consulta: ConsultaReportesDto,
  ): Promise<ReportesDelPeriodo> {
    return this.consultarReportes.ejecutar(actor, { desde: consulta.desde, hasta: consulta.hasta });
  }
}
