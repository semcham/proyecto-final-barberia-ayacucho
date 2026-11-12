import { IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

// Cuerpo de PUT /clientes/yo/aviso (contracts/openapi.yaml de 004, CambioCanalAvisoRequest). Cualquier campo no
// declarado, como tenantId o clienteId, se rechaza con 400 (forbidNonWhitelisted). El formato del número lo valida el
// dominio (NumeroWhatsappInvalido, 422 VALIDACION), igual que la aceptación del texto (ConsentimientoRequerido, 422).

export class CambioCanalAvisoDto {
  @IsIn(['CORREO', 'WHATSAPP'])
  canal!: 'CORREO' | 'WHATSAPP';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  numeroWhatsapp?: string | null;

  @IsOptional()
  @IsBoolean()
  aceptaWhatsapp?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  versionTexto?: string;
}
