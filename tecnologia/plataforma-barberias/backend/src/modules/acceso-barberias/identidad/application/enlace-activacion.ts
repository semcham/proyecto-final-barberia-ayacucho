import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { Clock, Configuracion } from '../../../../shared';
import { Activacion } from '../domain/activacion';
import { ActivacionRepository } from './ports/activacion-repository';
import { generarTokenOpaco, hashDeToken } from './tokens-opacos';

export interface EnlaceActivacion {
  enlace: string;
  venceEn: Date;
}

/**
 * Genera el enlace de activación de un solo uso (R14). Mientras no exista M05, el enlace se devuelve al
 * propietario para que lo entregue; cuando exista, se enviará por correo sin cambiar este servicio.
 * Debe ejecutarse dentro de la transacción del caso de uso.
 */
@Injectable()
export class GenerarEnlaceActivacion {
  constructor(
    private readonly activaciones: ActivacionRepository,
    private readonly configuracion: Configuracion,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(tenantId: string, usuarioId: string, creadoPor: string): Promise<EnlaceActivacion> {
    const token = generarTokenOpaco();
    const activacion = Activacion.crear(uuidv7(), tenantId, usuarioId, this.reloj.ahora());
    await this.activaciones.crear(activacion, hashDeToken(token), creadoPor);
    const enlace = new URL('/activar', this.configuracion.frontendBaseUrl);
    enlace.searchParams.set('token', token);
    return { enlace: enlace.toString(), venceEn: activacion.venceEn };
  }
}
