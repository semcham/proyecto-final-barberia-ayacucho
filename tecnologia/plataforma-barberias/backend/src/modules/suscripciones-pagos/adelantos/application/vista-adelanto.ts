import { ZonaHoraria } from '../../../../shared';
import type { ResumenDeAdelanto } from '../../adelantos-api';
import { Adelanto } from '../domain/adelanto';
import type { AdelantoGuardado, PagoDeAdelanto } from './ports/adelanto-repository';

/**
 * T029 de 008 · El adelanto como lo ven el cliente de la cita y el propietario (contracts/openapi.yaml, Adelanto): las
 * horas en ISO 8601 con el desplazamiento de la barbería y el último registro de pago, con el número completo
 * (FR-011: solo ellos dos llegan a esta vista). Nunca el id ni una dirección del QR o de la captura.
 */
export function aResumen(adelanto: AdelantoGuardado, pago: PagoDeAdelanto | null): ResumenDeAdelanto {
  const zona = new ZonaHoraria(adelanto.zonaHoraria);
  return {
    citaId: adelanto.citaId,
    estado: adelanto.estado,
    montoCentimos: adelanto.montoCentimos,
    precioCentimos: adelanto.precioCentimos,
    saldoCentimos: Adelanto.saldo(adelanto.precioCentimos, adelanto.montoCentimos),
    codigo: adelanto.codigo,
    horaLimite: zona.formatoIso(adelanto.horaLimite),
    limiteRevision: zona.formatoIso(adelanto.limiteRevision),
    pago: pago
      ? {
          numeroOperacion: pago.numeroOperacion,
          tieneCaptura: pago.archivoId !== null,
          registradoEn: zona.formatoIso(pago.registradoEn),
          resultado: pago.resultado,
          motivoRechazo: pago.motivoRechazo,
        }
      : null,
    devueltoEn: adelanto.devueltoEn ? zona.formatoIso(adelanto.devueltoEn) : null,
  };
}
