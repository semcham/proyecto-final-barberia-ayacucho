import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import { OperacionM02 } from '../../catalogo/presentation/operacion.decorator';
import { ConsultarHistorial, type PaginaCitasVista } from '../application/consultar-historial';

/** Consulta del historial: `pagina` (desde 1) y `tamano` (1 a 50). Cualquier otro parámetro → 400. */
export class ConsultaHistorialDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  tamano = 20;
}

/** T122 · GET /clientes/yo/citas (RF17): el historial del cliente en la barbería de su sesión. */
@Controller('clientes/yo/citas')
export class HistorialController {
  constructor(private readonly consultarHistorial: ConsultarHistorial) {}

  @Get()
  @OperacionM02('VER_HISTORIAL')
  consultar(@ActorActual() actor: Actor, @Query() consulta: ConsultaHistorialDto): Promise<PaginaCitasVista> {
    return this.consultarHistorial.ejecutar(actor, consulta.pagina, consulta.tamano);
  }
}
