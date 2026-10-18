import { Equals, IsBoolean, IsString, Length, Matches } from 'class-validator';

// Cuerpo de POST /clientes/registro (contracts/openapi.yaml de 002, RegistroClienteRequest). Cualquier
// campo no declarado, como tenantId, se rechaza con 400 (forbidNonWhitelisted). Las reglas de negocio las
// valida el dominio (Correo, Contrasena, Telefono, Consentimiento).

export class RegistroClienteDto {
  /** `slug` del enlace de la barbería donde se registra. */
  @IsString()
  @Length(1, 140)
  barberia!: string;

  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsString()
  @Length(3, 254)
  correo!: string;

  @IsString()
  @Matches(/^\+?[0-9 ]{6,20}$/)
  telefono!: string;

  @IsString()
  @Length(10, 128)
  contrasena!: string;

  /** Sin aceptación expresa de la política de datos no hay registro (FR-023). */
  @IsBoolean()
  @Equals(true)
  aceptaPoliticaDatos!: boolean;

  @IsString()
  @Length(1, 32)
  versionPoliticaDatos!: string;
}
