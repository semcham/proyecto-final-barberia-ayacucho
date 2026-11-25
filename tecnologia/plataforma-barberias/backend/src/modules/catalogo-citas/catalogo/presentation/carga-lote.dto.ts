import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNumber,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_FILAS_LOTE } from '../domain/carga-lote';

// T022 de 011 · Cuerpo de la carga en lote (specs/011-carga-masiva-catalogo/contracts/openapi.yaml). Aquí solo se
// comprueba la FORMA (tipos, tope de filas y largos máximos para cortar cuerpos enormes). Las reglas de cada campo son
// las del dominio (`problemasDeServicio`): así la revisión puede marcar "falta el precio" o una duración vacía en su
// fila, en lugar de rechazar el cuerpo entero.

const siNoEsNulo = (_: object, valor: unknown) => valor !== null && valor !== undefined;

export class FilaServicioDto {
  @IsString()
  @MaxLength(200)
  nombre!: string;

  /** null si la celda quedó vacía (la revisión lo marca). */
  @ValidateIf(siNoEsNulo)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  duracionMinutos!: number | null;

  /** Puede venir vacío: la revisión lo marca como "falta". */
  @IsString()
  @MaxLength(20)
  precio!: string;

  @ValidateIf(siNoEsNulo)
  @IsString()
  @MaxLength(1000)
  descripcion?: string | null;
}

export class CargaServiciosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FILAS_LOTE)
  @ValidateNested({ each: true })
  @Type(() => FilaServicioDto)
  filas!: FilaServicioDto[];
}

export class FilaBarberoDto {
  @IsString()
  @MaxLength(200)
  nombre!: string;

  /** Servicios que ofrece (vacío si ninguno). Que existan y estén activos lo revisa el dominio. */
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  servicioIds: string[] = [];
}

export class CargaBarberosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FILAS_LOTE)
  @ValidateNested({ each: true })
  @Type(() => FilaBarberoDto)
  filas!: FilaBarberoDto[];
}
