import { ErrorDeAplicacion } from '../../../../shared/nucleo';

// Errores esperados de los pagos (contracts/openapi.yaml). El host los traduce a { codigo, mensaje, detalles }.

/** Ya hay un período pagado por adelantado: como máximo uno (FR-004). 409. */
export class PagoAdelantadoNoPermitido extends ErrorDeAplicacion {
  readonly codigo = 'PAGO_ADELANTADO_NO_PERMITIDO';

  constructor() {
    super('Ya pagaste el período siguiente; podrás pagar otro cuando empiece');
  }
}

/** El importe del plan está fuera de los límites del medio (Yape). 422. */
export class MedioNoDisponible extends ErrorDeAplicacion {
  readonly codigo = 'MEDIO_NO_DISPONIBLE_PARA_EL_PLAN';

  constructor(metodo: string) {
    super('Este medio de pago no está disponible para el plan elegido', [{ metodo }]);
  }
}

/** La pasarela no responde (FR-044, SC-005): 503 con la alternativa de transferencia. */
export class PagoEnLineaNoDisponible extends ErrorDeAplicacion {
  readonly codigo = 'PAGO_EN_LINEA_NO_DISPONIBLE';

  constructor() {
    super('El pago en línea no está disponible ahora. Puedes pagar por transferencia bancaria.', [
      { alternativa: 'TRANSFERENCIA' },
    ]);
  }
}

/** El comprobante ya se revisó: la revisión es única (FR-022c). 409. */
export class PagoYaRevisado extends ErrorDeAplicacion {
  readonly codigo = 'PAGO_YA_REVISADO';

  constructor() {
    super('Este pago ya fue revisado');
  }
}

/** El número de operación ya se aprobó en otro pago (FR-022b). 409. */
export class NumeroOperacionYaAprobado extends ErrorDeAplicacion {
  readonly codigo = 'NUMERO_OPERACION_YA_APROBADO';

  constructor() {
    super('Ese número de operación ya se aprobó en otro pago');
  }
}

/** El importe declarado o informado no es el del pago (FR-005b, FR-022a). 422. */
export class ImporteDistinto extends ErrorDeAplicacion {
  readonly codigo = 'IMPORTE_DISTINTO';

  constructor() {
    super('El importe no coincide con el del pago');
  }
}

/** Hay un comprobante en revisión: no se anula ni se crea otro pago (FR-012, FR-021; H4). 409. */
export class ComprobanteYaEnRevision extends ErrorDeAplicacion {
  readonly codigo = 'COMPROBANTE_YA_EN_REVISION';

  constructor() {
    super('Tienes un comprobante en revisión; espera su resultado antes de iniciar otro pago');
  }
}

// --- US3: transferencia con comprobante (R05, ADR-023) ---

/** Archivo, número de operación o fecha del comprobante inválidos. 400. Nunca repite lo recibido. */
export class ComprobanteInvalido extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';

  constructor(campo: 'archivo' | 'numeroOperacion' | 'fechaTransferencia', problema: string) {
    super('Revisa los datos del comprobante.', [{ campo, problema }]);
  }
}

/** El pago no espera un comprobante (no es una transferencia, o ya se cerró). 409. */
export class PagoNoEsperaComprobante extends ErrorDeAplicacion {
  readonly codigo = 'PAGO_NO_ESPERA_COMPROBANTE';

  constructor() {
    super('Este pago no espera un comprobante. Inicia una transferencia nueva.');
  }
}

/** Se alcanzó el máximo de comprobantes del día de la barbería (FR-020a). 429, con la espera hasta mañana. */
export class DemasiadosComprobantes extends ErrorDeAplicacion {
  readonly codigo = 'DEMASIADOS_INTENTOS';

  constructor(readonly reintentarEnSegundos: number) {
    super('Ya enviaste 5 comprobantes hoy. Podrás enviar otro mañana.', [{ reintentarEnSegundos }]);
  }
}

/** Orden incompatible con el estado del pago: error de programación, nunca efecto parcial. */
export class TransicionDePagoInvalida extends ErrorDeAplicacion {
  readonly codigo = 'TRANSICION_DE_PAGO_INVALIDA';

  constructor(estado: string, orden: string) {
    super(`Un pago ${estado} no admite ${orden}`, [{ estado, orden }]);
  }
}

/** El plan no existe, no está activo o no se puede contratar (el de prueba). 422. */
export class PlanNoContratable extends ErrorDeAplicacion {
  readonly codigo = 'PLAN_NO_CONTRATABLE';

  constructor() {
    super('Ese plan no se puede contratar');
  }
}
