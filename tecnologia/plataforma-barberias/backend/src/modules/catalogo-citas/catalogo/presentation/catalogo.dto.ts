import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Cuerpos de la configuración de la barbería (US1; contrato de 002). Los campos desconocidos, como
// `tenantId`, se rechazan con 400 (forbidNonWhitelisted). Las reglas de negocio las valida el dominio
// (Servicio, Barbero, Bloqueo, HorarioSemanal).

const HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const PRECIO = /^[0-9]{1,5}(\.[0-9]{1,2})?$/;
const siNoEsNulo = (_: object, valor: unknown) => valor !== null && valor !== undefined;

export class TramoHorarioDto {
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana!: number;

  @Matches(HORA)
  inicio!: string;

  @Matches(HORA)
  fin!: string;
}

export class HorarioSemanalDto {
  @IsArray()
  @ArrayMaxSize(28)
  @ValidateNested({ each: true })
  @Type(() => TramoHorarioDto)
  tramos!: TramoHorarioDto[];

  @IsOptional()
  @IsBoolean()
  confirmarConflictos?: boolean;
}

export class ServicioDto {
  @IsString()
  @Length(2, 80)
  nombre!: string;

  @ValidateIf(siNoEsNulo)
  @IsString()
  @MaxLength(300)
  descripcion?: string | null;

  @Matches(PRECIO)
  precio!: string;

  @IsInt()
  @Min(5)
  @Max(480)
  duracionMinutos!: number;
}

export class ActualizarServicioDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  nombre?: string;

  @ValidateIf(siNoEsNulo)
  @IsString()
  @MaxLength(300)
  descripcion?: string | null;

  @IsOptional()
  @Matches(PRECIO)
  precio?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  duracionMinutos?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsBoolean()
  confirmarConflictos?: boolean;
}

export class BarberoDto {
  @IsString()
  @Length(2, 80)
  nombre!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  servicioIds!: string[];

  @ValidateIf(siNoEsNulo)
  @IsUUID()
  usuarioId?: string | null;
}

export class ActualizarBarberoDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  nombre?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  servicioIds?: string[];

  @ValidateIf(siNoEsNulo)
  @IsUUID()
  usuarioId?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsBoolean()
  confirmarConflictos?: boolean;
}

export class BloqueoDto {
  /** ISO 8601 con desplazamiento, p. ej. 2026-10-20T10:00:00-05:00. */
  @IsISO8601({ strict: true })
  inicio!: string;

  @IsISO8601({ strict: true })
  fin!: string;

  @ValidateIf(siNoEsNulo)
  @IsString()
  @MaxLength(200)
  motivo?: string | null;

  @IsOptional()
  @IsBoolean()
  confirmarConflictos?: boolean;
}
