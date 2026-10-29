import { IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';

// Cuerpos de /plataforma/auth (contracts/openapi.yaml de 003). Un campo no declarado se rechaza con 400, y
// los errores de validación nunca repiten el valor recibido (solo el campo y la regla).

/** POST /plataforma/auth/ingresar. El formato del correo no se valida: un correo mal escrito es un fallo más. */
export class IngresarPlataformaDto {
  @IsString()
  @MaxLength(254)
  correo!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  contrasena!: string;
}

/** POST /plataforma/auth/segundo-factor: el desafío y el código TOTP o uno de recuperación (uno de los dos). */
export class SegundoFactorDto {
  @IsUUID()
  desafio!: string;

  @IsOptional()
  @Matches(/^[0-9]{6}$/)
  codigo?: string;

  @IsOptional()
  @IsString()
  @Length(10, 20)
  codigoRecuperacion?: string;
}
