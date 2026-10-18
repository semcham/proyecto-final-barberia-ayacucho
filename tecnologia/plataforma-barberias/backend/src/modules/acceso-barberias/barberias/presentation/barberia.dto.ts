import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// Cuerpo de PATCH /barberia (ActualizarBarberiaRequest del contrato de 002). Todos los campos son
// opcionales, pero debe llegar al menos uno (lo exige el caso de uso). Los campos desconocidos, como
// `estado` o `tenantId`, se rechazan con 400 (forbidNonWhitelisted). El dominio valida el enlace.

const siNoEsNulo = (_: object, valor: unknown) => valor !== null && valor !== undefined;

export class ActualizarBarberiaDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  slug?: string;

  @ValidateIf(siNoEsNulo)
  @IsString()
  @MaxLength(200)
  direccion?: string | null;

  @ValidateIf(siNoEsNulo)
  @IsString()
  @Matches(/^\+?[0-9 ]{6,20}$/)
  telefono?: string | null;

  @ValidateIf(siNoEsNulo)
  @IsString()
  @MaxLength(500)
  descripcion?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4320)
  antelacionCancelacionMinutos?: number;
}
