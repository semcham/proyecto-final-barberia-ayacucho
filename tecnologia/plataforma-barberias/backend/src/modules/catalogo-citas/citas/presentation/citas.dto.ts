import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';

// Cuerpo de POST /citas (contracts/openapi.yaml de 002, ReservarCitaRequest). Cualquier campo no
// declarado, como tenantId o barberia, se rechaza con 400 (forbidNonWhitelisted). Las reglas de la
// reserva las valida el caso de uso; la de no duplicar, PostgreSQL.

export class ReservarCitaDto {
  @IsUUID()
  servicioId!: string;

  @IsUUID()
  barberoId!: string;

  /** ISO 8601 con desplazamiento, p. ej. 2026-10-20T10:00:00-05:00. */
  @IsISO8601({ strict: true })
  inicio!: string;

  /** Solo el PROPIETARIO (cita presencial). Un CLIENTE que lo envía recibe 400. */
  @IsOptional()
  @IsUUID()
  clienteId?: string;
}

/** Cuerpo de POST /citas/{id}/estado (CambiarEstadoRequest). CANCELADA va por /cancelar (US5). */
export class CambiarEstadoDto {
  @IsIn(['CONFIRMADA', 'COMPLETADA', 'NO_ASISTIO'])
  estado!: 'CONFIRMADA' | 'COMPLETADA' | 'NO_ASISTIO';
}
