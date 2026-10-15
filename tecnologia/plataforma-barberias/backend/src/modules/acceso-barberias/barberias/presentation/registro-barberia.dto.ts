import { Type } from 'class-transformer';
import { IsDefined, IsObject, IsString, Length, ValidateNested } from 'class-validator';

// Validación de formato (presentación). Las reglas de negocio las valida el dominio (Correo, Contrasena...).
// Cualquier campo no declarado, como tenantId, se rechaza con 400 (forbidNonWhitelisted, R11).

export class PropietarioDto {
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsString()
  @Length(3, 254)
  correo!: string;

  @IsString()
  @Length(10, 128)
  contrasena!: string;
}

export class AceptacionesDto {
  @IsString()
  @Length(1, 32)
  terminosVersion!: string;

  @IsString()
  @Length(1, 32)
  politicaDatosVersion!: string;
}

export class RegistroBarberiaDto {
  @IsString()
  @Length(2, 120)
  nombreBarberia!: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PropietarioDto)
  propietario!: PropietarioDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AceptacionesDto)
  aceptaciones!: AceptacionesDto;
}
