import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

// 010 · Cuerpos de las rutas /cuenta/* (contracts/openapi.yaml de 010). El token viaja solo en el cuerpo (R09). Un
// campo no declarado responde 400 (forbidNonWhitelisted). Las reglas de la contraseña las valida el dominio.

/** POST /cuenta/verificacion. */
export class VerificarCorreoDto {
  @IsString()
  @Length(20, 128)
  token!: string;
}

/** POST /cuenta/recuperacion: el formato del correo NO se valida aquí (un 400 no debe depender de que exista). */
export class PedirRecuperacionDto {
  @IsString()
  @MaxLength(254)
  correo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  barberia?: string;
}

/** POST /cuenta/recuperacion/contrasena. */
export class RestablecerContrasenaDto {
  @IsString()
  @Length(20, 128)
  token!: string;

  @IsString()
  @Length(10, 128)
  contrasena!: string;
}
