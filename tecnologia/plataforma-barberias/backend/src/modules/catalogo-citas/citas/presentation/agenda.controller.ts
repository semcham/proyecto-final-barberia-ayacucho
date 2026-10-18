import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import type { Actor } from '../../../acceso-barberias';
import { ActorActual } from '../../../../shared';
import { OperacionM02 } from '../../catalogo/presentation/operacion.decorator';
import { type AgendaVista, ConsultarAgenda } from '../application/consultar-agenda';

/** Consulta de la agenda (FechaQuery y BarberoQueryOpcional del contrato de 002). */
export class ConsultaAgendaDto {
  /** Fecha local de la barbería; la existencia del día la valida FechaLocal (2026-02-30 → 400). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fecha!: string;

  @IsOptional()
  @IsUUID()
  barbero?: string;
}

/** T109 · GET /agenda (RF16): el PROPIETARIO ve toda la barbería; el BARBERO, la de su barbero vinculado. */
@Controller('agenda')
export class AgendaController {
  constructor(private readonly consultarAgenda: ConsultarAgenda) {}

  @Get()
  @OperacionM02('VER_AGENDA')
  consultar(@ActorActual() actor: Actor, @Query() consulta: ConsultaAgendaDto): Promise<AgendaVista> {
    return this.consultarAgenda.ejecutar(actor, { fecha: consulta.fecha, barberoId: consulta.barbero });
  }
}
