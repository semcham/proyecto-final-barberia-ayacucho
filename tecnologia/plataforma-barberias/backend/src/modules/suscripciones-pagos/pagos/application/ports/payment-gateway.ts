import { ErrorDeAplicacion } from '../../../../../shared';

// Puerto PaymentGateway (principio V, ADR-022; contracts/pasarela-simulada.md §1). Sin tipos del proveedor:
// los adaptadores (simulador por HTTP o proveedor real) traducen a estos tipos. Ningún dato de tarjeta ni
// del pagador cruza este puerto.

export interface SolicitudSesionDePago {
  pagoId: string;
  importeCentimos: number;
  moneda: string;
  descripcion: string;
  metodo: 'YAPE';
  urlRetorno: string;
}

export interface SesionDePago {
  referenciaProveedor: string;
  /** Página alojada del proveedor: el propietario nunca escribe datos de pago en la plataforma. */
  urlPago: string;
  expiraEn: Date;
}

export type EstadoEnProveedor = 'APROBADO' | 'RECHAZADO' | 'PENDIENTE' | 'EXPIRADO';

export interface PagoEnProveedor {
  estado: EstadoEnProveedor;
  importeCentimos: number;
  moneda: string;
}

/** Estado informado en una notificación: además, la devolución o el contracargo (FR-017a). */
export type EstadoNotificado = EstadoEnProveedor | 'DEVUELTO';

/** Notificación con la firma ya verificada. Sin datos del pagador (FR-013b). */
export interface NotificacionVerificada {
  eventoId: string;
  tipo: string;
  referencia: string;
  estado: EstadoNotificado;
  importeCentimos: number;
  moneda: string;
  emitidoEn: Date;
}

export interface LimitesDelMedio {
  minimoCentimos: number;
  maximoCentimos: number;
}

/** El proveedor no responde: tiempo límite, conexión rechazada, error 5xx o circuito abierto. */
export class ProveedorNoDisponible extends ErrorDeAplicacion {
  readonly codigo = 'PROVEEDOR_NO_DISPONIBLE';

  constructor() {
    super('La pasarela de pagos no responde');
  }
}

/** La notificación no trae firma, la firma no coincide o su marca de tiempo está fuera de ±5 min. */
export class FirmaInvalida extends ErrorDeAplicacion {
  readonly codigo = 'FIRMA_INVALIDA';

  constructor() {
    super('Notificación no válida');
  }
}

/** El proveedor no conoce la referencia consultada. */
export class PagoDesconocido extends ErrorDeAplicacion {
  readonly codigo = 'PAGO_DESCONOCIDO';

  constructor() {
    super('La pasarela no conoce ese pago');
  }
}

export abstract class PaymentGateway {
  /** Crea la sesión de pago alojada. Lanza `ProveedorNoDisponible`. */
  abstract crearSesionDePago(solicitud: SolicitudSesionDePago): Promise<SesionDePago>;

  /** Estado real del pago en el proveedor (conciliación). Lanza `ProveedorNoDisponible` o `PagoDesconocido`. */
  abstract consultarPago(referenciaProveedor: string): Promise<PagoEnProveedor>;

  /**
   * Cancela una sesión pendiente. Devuelve si el proveedor lo permitió. Un `ProveedorNoDisponible` se puede
   * ignorar: la anulación local ya ocurrió y la conciliación cierra lo que quede.
   */
  abstract cancelarSesion(referenciaProveedor: string): Promise<boolean>;

  /** Verifica la firma sobre el cuerpo crudo (tiempo constante, ±5 min). Lanza `FirmaInvalida`. */
  abstract verificarNotificacion(
    cuerpoCrudo: Buffer,
    encabezados: Record<string, string | string[] | undefined>,
  ): NotificacionVerificada;

  /** Importes mínimo y máximo que el proveedor acepta con Yape. */
  abstract limitesYape(): LimitesDelMedio;
}
