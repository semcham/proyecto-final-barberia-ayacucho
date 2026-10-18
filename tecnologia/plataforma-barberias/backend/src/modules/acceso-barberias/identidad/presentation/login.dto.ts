import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

const FORMATO_TELEFONO = /^\+?[0-9 ]{6,20}$/;

/** Formato del inicio de sesión. No se valida el formato del correo: un correo mal escrito es solo un fallo. */
export class LoginDto {
  @IsString()
  @Length(1, 254)
  correo!: string;

  @IsString()
  @Length(1, 128)
  contrasena!: string;

  // Funcionalidad 002 (ADR-020): ingreso desde el enlace de una barbería y unión a ella.

  /** `slug` de la página desde la que ingresa: elige la barbería de la sesión. */
  @IsOptional()
  @IsString()
  @Length(1, 140)
  barberia?: string;

  @IsOptional()
  @IsBoolean()
  aceptaPoliticaDatos?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  versionPoliticaDatos?: string;

  /** Obligatorio al unirse a una barbería nueva (el perfil de cliente exige teléfono, HU06). */
  @IsOptional()
  @IsString()
  @Matches(FORMATO_TELEFONO)
  telefono?: string;
}

/** POST /auth/barberia: barbería destino y, si aún no es cliente de ella, la aceptación para unirse. */
export class CambiarBarberiaDto {
  @IsString()
  @Length(1, 140)
  barberia!: string;

  @IsOptional()
  @IsBoolean()
  aceptaPoliticaDatos?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  versionPoliticaDatos?: string;

  @IsOptional()
  @IsString()
  @Matches(FORMATO_TELEFONO)
  telefono?: string;
}
