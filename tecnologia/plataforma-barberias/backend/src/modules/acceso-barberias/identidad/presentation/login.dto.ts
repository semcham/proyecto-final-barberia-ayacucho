import { IsString, Length } from 'class-validator';

/** Formato del inicio de sesión. No se valida el formato del correo: un correo mal escrito es solo un fallo. */
export class LoginDto {
  @IsString()
  @Length(1, 254)
  correo!: string;

  @IsString()
  @Length(1, 128)
  contrasena!: string;
}
