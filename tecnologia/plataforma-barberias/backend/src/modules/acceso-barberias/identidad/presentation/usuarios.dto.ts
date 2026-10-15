import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

// Formato de /usuarios y /auth/activar (contracts/openapi.yaml). Cualquier campo no declarado, como
// tenantId, se rechaza con 400 (forbidNonWhitelisted). Las reglas de negocio las valida el dominio.

export class CrearUsuarioDto {
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsString()
  @Length(3, 254)
  correo!: string;

  /** El propietario solo crea barberos (FR-015, FR-017). */
  @IsIn(['BARBERO'])
  rol!: 'BARBERO';
}

export class ActualizarUsuarioDto {
  @IsIn(['ACTIVA', 'DESACTIVADA'])
  estado!: 'ACTIVA' | 'DESACTIVADA';
}

export class ListarUsuariosQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  tamano = 20;

  @IsOptional()
  @IsIn(['PROPIETARIO', 'BARBERO'])
  rol?: 'PROPIETARIO' | 'BARBERO';

  @IsOptional()
  @IsIn(['PENDIENTE', 'ACTIVA', 'DESACTIVADA'])
  estado?: 'PENDIENTE' | 'ACTIVA' | 'DESACTIVADA';
}

export class ActivacionDto {
  @IsString()
  @Length(20, 128)
  token!: string;

  @IsString()
  @Length(10, 128)
  contrasena!: string;
}
