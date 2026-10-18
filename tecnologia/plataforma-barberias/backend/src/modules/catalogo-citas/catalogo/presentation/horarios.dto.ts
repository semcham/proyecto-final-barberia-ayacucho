import { IsOptional, IsUUID, Matches } from 'class-validator';

// Consulta de horarios libres (parámetros ServicioQuery, FechaQuery y BarberoQueryOpcional del contrato de
// 002). Cualquier otro parámetro, como `slug`, `barberia` o `tenantId`, se rechaza con 400
// (forbidNonWhitelisted): en GET /horarios la barbería sale solo del token.

export class ConsultaHorariosDto {
  @IsUUID()
  servicio!: string;

  /** Fecha local de la barbería; la existencia del día la valida FechaLocal (2026-02-30 → 400). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fecha!: string;

  @IsOptional()
  @IsUUID()
  barbero?: string;
}
