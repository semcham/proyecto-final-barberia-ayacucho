import { IsString, Length } from 'class-validator';

/** 010 · Cuerpo de POST /cuenta/verificacion (contracts/openapi.yaml): el token viaja solo en el cuerpo (R09). */
export class VerificarCorreoDto {
  @IsString()
  @Length(20, 128)
  token!: string;
}
