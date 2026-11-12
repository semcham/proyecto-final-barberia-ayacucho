import { ErrorDeAplicacion } from '../../../../shared/nucleo';

// T008 de 008 · Errores esperados del adelanto (specs/008-adelanto-reserva-qr/contracts/openapi.yaml). El host los
// traduce a { codigo, mensaje, detalles } con el estado de ESTADO_POR_CODIGO. Nunca repiten el número de operación
// ni datos del archivo. Un archivo inválido (QR o captura) reutiliza ComprobanteInvalido de 003 (VALIDACION).

/** El plazo para pagar no cabe antes del inicio menos 30 minutos (research R04). 422. */
export class SinTiempoParaAdelanto extends ErrorDeAplicacion {
  readonly codigo = 'SIN_TIEMPO_PARA_ADELANTO';

  constructor() {
    super('Este horario empieza muy pronto para pagar el adelanto. Elige un horario más tarde.');
  }
}

/** El número de operación ya se registró en esta barbería (research R07, FR-010). 409. */
export class NumeroOperacionRepetido extends ErrorDeAplicacion {
  readonly codigo = 'NUMERO_OPERACION_REPETIDO';

  constructor() {
    super('Ese número de operación ya se registró. Revisa el número de tu pago.');
  }
}

/** Ya hay un pago registrado sin revisar para este adelanto (US2-5). 409. */
export class PagoYaRegistrado extends ErrorDeAplicacion {
  readonly codigo = 'PAGO_YA_REGISTRADO';

  constructor() {
    super('Ya registraste tu pago. Espera la revisión de la barbería.');
  }
}

/** El adelanto ya no está pendiente: confirmado, vencido, anulado o resuelto al cancelar. 409. */
export class AdelantoResuelto extends ErrorDeAplicacion {
  readonly codigo = 'ADELANTO_RESUELTO';

  constructor() {
    super('Este adelanto ya fue resuelto.');
  }
}

/** Pasó la hora límite para registrar el pago (FR-007). 422. */
export class AdelantoVencido extends ErrorDeAplicacion {
  readonly codigo = 'ADELANTO_VENCIDO';

  constructor() {
    super('Pasó la hora límite para registrar el pago del adelanto.');
  }
}

/** Confirmar o rechazar sin un pago registrado (FR-012, FR-014). 409. */
export class SinPagoRegistrado extends ErrorDeAplicacion {
  readonly codigo = 'SIN_PAGO_REGISTRADO';

  constructor() {
    super('El cliente todavía no registró el pago de este adelanto.');
  }
}

/** Marcar devuelto un adelanto que no está por devolver (aclaración Q2, FR-022). 409. */
export class AdelantoNoPorDevolver extends ErrorDeAplicacion {
  readonly codigo = 'ADELANTO_NO_POR_DEVOLVER';

  constructor() {
    super('Solo se puede marcar como devuelto un adelanto por devolver.');
  }
}

/** Activar el adelanto sin un QR subido (FR-002). 422. */
export class QrRequerido extends ErrorDeAplicacion {
  readonly codigo = 'QR_REQUERIDO';

  constructor() {
    super('Sube el QR de Yape o Plin de tu barbería antes de activar el adelanto.');
  }
}

/**
 * La cita espera su adelanto: el cliente no la reprograma (research R11) y nadie la aprueba con la ruta de 002
 * (research R15); se confirma solo con la confirmación del adelanto. 409.
 */
export class AdelantoPendiente extends ErrorDeAplicacion {
  readonly codigo = 'ADELANTO_PENDIENTE';

  constructor() {
    super('Esta cita espera el pago de su adelanto: paga y espera la confirmación, o cancela.');
  }
}
