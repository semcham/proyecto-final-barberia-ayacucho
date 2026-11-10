import { Injectable } from '@nestjs/common';
import { HISTORIAL_MS, PoliticaIntentos } from '../../../acceso-barberias';
import { Clock } from '../../../../shared';
import { DemasiadosIntentos } from '../../catalogo/domain/errores';
import { IntentosEnlaceRepository } from './ports/intentos-enlace-repository';

/**
 * T077/T092 de 004 · Límite de rechazos de los enlaces de acción por IP (FR-031; research R07). La regla es la
 * MISMA PoliticaIntentos del ingreso de M01 (importada de su interfaz pública), con la IP como clave: 5 rechazos en
 * 60 s bloquean 60 s; cada racha siguiente duplica la espera, hasta 900 s; el historial es de 24 h. Un intento
 * rechazado por el bloqueo no se anota (no alarga el bloqueo).
 */
@Injectable()
export class LimiteRechazosEnlace {
  constructor(
    private readonly intentos: IntentosEnlaceRepository,
    private readonly reloj: Clock,
  ) {}

  /** Antes de mirar el enlace: si la IP está bloqueada, DemasiadosIntentos con los segundos que faltan. */
  async exigirSinBloqueo(ip: string): Promise<void> {
    const ahora = this.reloj.ahora();
    const fallos = await this.intentos.fallosDesde(ip, new Date(ahora.getTime() - HISTORIAL_MS));
    const evaluacion = PoliticaIntentos.evaluar(fallos, ahora);
    if (evaluacion.bloqueado) throw new DemasiadosIntentos(evaluacion.reintentarEnSegundos);
  }

  /** Anota un enlace rechazado (ENLACE_NO_VALIDO) desde esa IP. */
  registrarRechazo(ip: string): Promise<void> {
    return this.intentos.registrar(ip, this.reloj.ahora());
  }
}
