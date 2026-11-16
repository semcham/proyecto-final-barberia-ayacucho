import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator';
import { ESTADOS_SOLICITUD, TIPOS_SOLICITUD, type TipoSolicitud } from '../domain/solicitud-datos';

// T013 de 007 · Cuerpos de specs/007-indicadores-datos-personales/contracts/openapi.yaml. Lo que valida el DTO
// responde 400 VALIDACION (campos desconocidos, como `tenant` o `barberia`, por forbidNonWhitelisted; tipo o resultado
// desconocido; largos excedidos). Las reglas del dominio (rectificación sin detalle, atender sin respuesta, rechazar
// sin motivo) responden 422 desde el dominio. La barbería sale siempre del token, nunca del cuerpo (principio III).

const presente = (_: object, valor: unknown) => valor !== null && valor !== undefined;

/** NuevaSolicitud. */
export class NuevaSolicitudDto {
  @IsIn(TIPOS_SOLICITUD)
  tipo!: TipoSolicitud;

  @IsOptional()
  @ValidateIf(presente)
  @IsString()
  @MaxLength(500)
  detalle?: string | null;
}

/** NuevaSolicitud con el cliente de la barbería por el que la registra el propietario. */
export class SolicitudEnNombreDto extends NuevaSolicitudDto {
  @IsUUID()
  clienteId!: string;
}

/** Cuerpo de POST /datos-personales/solicitudes/{id}/cierre. */
export class CierreSolicitudDto {
  @IsIn(['ATENDIDA', 'RECHAZADA'])
  resultado!: 'ATENDIDA' | 'RECHAZADA';

  @IsOptional()
  @ValidateIf(presente)
  @IsString()
  @Length(1, 1000)
  respuesta?: string | null;

  @IsOptional()
  @ValidateIf(presente)
  @IsString()
  @Length(5, 300)
  motivo?: string | null;
}

/** Consulta de la bandeja: las abiertas (por defecto) o un estado. */
export class BandejaDto {
  @IsOptional()
  @IsIn(['ABIERTAS', ...ESTADOS_SOLICITUD])
  estado?: 'ABIERTAS' | (typeof ESTADOS_SOLICITUD)[number];
}
