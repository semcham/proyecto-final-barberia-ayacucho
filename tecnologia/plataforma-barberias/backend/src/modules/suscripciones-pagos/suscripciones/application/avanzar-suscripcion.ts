import { Injectable } from '@nestjs/common';
import { type AccionAuditada, AuditLog } from '../../../../shared';
import { type PasoDeSuscripcion, siguientePaso } from '../domain/estado-suscripcion';
import type { Suscripcion } from '../domain/suscripcion';
import { SuscripcionRepository } from './ports/suscripcion-repository';

/** Pasos como máximo en una sola llamada: TRIAL → ACTIVE → PAST_DUE → EXPIRED → ACTIVE es el camino más largo. */
const MAXIMO_DE_PASOS = 5;

function accionDe(paso: PasoDeSuscripcion): AccionAuditada {
  if (paso.hacia === 'ACTIVE') return 'SUSCRIPCION_ACTIVADA';
  if (paso.hacia === 'PAST_DUE') return 'SUSCRIPCION_EN_GRACIA';
  return 'SUSCRIPCION_VENCIDA';
}

/**
 * Lleva la suscripción al estado que le corresponde por sus fechas, de a un paso (estado-suscripcion.ts):
 * cada paso es una transición condicional (FR-032) auditada con la fecha que le correspondía (FR-031). La
 * usan la aprobación de un pago (una barbería vencida que paga acepta reservas de inmediato, SC-008) y la
 * tarea de vencimiento (US2). Corre en la transacción del llamador, con la suscripción ya bloqueada.
 */
@Injectable()
export class AvanzarSuscripcion {
  constructor(
    private readonly suscripciones: SuscripcionRepository,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(suscripcion: Suscripcion, ahora: Date): Promise<PasoDeSuscripcion[]> {
    const periodos = await this.suscripciones.periodos(suscripcion.id);
    const cobertura = suscripcion.cobertura(periodos);
    let estado = suscripcion.estado;
    let planId = suscripcion.planId;
    const aplicados: PasoDeSuscripcion[] = [];
    for (let i = 0; i < MAXIMO_DE_PASOS; i += 1) {
      const paso = siguientePaso({ estado, planId, cobertura }, ahora);
      if (!paso) break;
      if (!(await this.suscripciones.aplicarPaso(suscripcion.id, paso))) break;
      await this.auditoria.registrar({
        accion: accionDe(paso),
        actorId: null,
        recurso: `suscripcion:${suscripcion.id}`,
        resultado: 'PERMITIDO',
        en: paso.fecha,
      });
      aplicados.push(paso);
      estado = paso.hacia;
      planId = paso.planId ?? planId;
    }
    return aplicados;
  }
}
