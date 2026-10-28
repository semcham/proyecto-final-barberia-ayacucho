import { ErrorDeAplicacion } from '../../../../shared/nucleo';
import type { AccionSuscripcion } from './accion-suscripcion';
import type { EstadoSuscripcion } from './suscripcion';

/**
 * La base rechazó un período porque se solapa con otro o porque su pago ya pagó uno (restricciones
 * subscription_period_sin_solape y subscription_period_un_periodo_por_pago). El caso de uso deja el pago
 * como DUPLICADO: nunca se extiende dos veces el mismo período (FR-004, SC-011).
 */
export class PeriodoYaCubierto extends ErrorDeAplicacion {
  readonly codigo = 'PERIODO_YA_CUBIERTO';

  constructor() {
    super('El período que paga este pago ya está cubierto');
  }
}

/**
 * El estado de la suscripción no permite la operación (FR-006, FR-007): 403 `SUSCRIPCION_NO_PERMITE` con el
 * detalle `{ estado, accion }`. El mensaje de una reserva nunca es "horario no disponible".
 */
export class SuscripcionNoPermite extends ErrorDeAplicacion {
  readonly codigo = 'SUSCRIPCION_NO_PERMITE';

  constructor(
    readonly estado: EstadoSuscripcion,
    readonly accion: AccionSuscripcion,
  ) {
    super(
      accion === 'RESERVAR'
        ? 'Esta barbería no acepta reservas por ahora'
        : 'Tu suscripción no permite este cambio',
      [{ estado, accion }],
    );
  }
}

/** El recurso no existe en la barbería del token (también si es de otra barbería: 404, PR09). */
export class NoEncontrado extends ErrorDeAplicacion {
  readonly codigo = 'NO_ENCONTRADO';

  constructor() {
    super('No se encontró el recurso solicitado.');
  }
}

/** El rol no permite la operación (matriz de contracts/rbac.md de 003). 403. */
export class AccesoDenegado extends ErrorDeAplicacion {
  readonly codigo = 'ACCESO_DENEGADO';

  constructor() {
    super('No tienes permiso para realizar esta operación.');
  }
}
