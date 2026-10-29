import type { EstadoPago, MarcaRevision, Pago } from '../../domain/pago';

/** Datos de un pago nuevo; el resto (estado abierto, fechas) lo fija el repositorio. */
export type PagoNuevo = Pick<
  Pago,
  | 'id'
  | 'suscripcionId'
  | 'planId'
  | 'importeCentimos'
  | 'moneda'
  | 'metodo'
  | 'estado'
  | 'cubreDesde'
  | 'creadoPor'
> & { referenciaTransferencia?: string };

/** Cambios de una transición, aplicados solo si el pago sigue en `desde` (transición condicional). */
export interface CambioDePago {
  desde: EstadoPago;
  hacia: EstadoPago;
  marca: MarcaRevision | null;
}

/** Ya hay un pago abierto para la suscripción: el índice único payment_un_pago_abierto lo garantiza. */
export class YaHayPagoAbierto extends Error {
  constructor() {
    super('La suscripción ya tiene un pago abierto');
    this.name = 'YaHayPagoAbierto';
  }
}

/**
 * Pagos del tenant del contexto (filtro explícito por tenant además de RLS). Participa en la transacción
 * en curso de UnitOfWork.
 */
export abstract class PagoRepository {
  abstract porId(id: string, opciones?: { bloquear?: boolean }): Promise<Pago | null>;
  /** El pago abierto (pendiente, esperando comprobante o en revisión) de la suscripción, si hay uno. */
  abstract abiertoDe(suscripcionId: string, opciones?: { bloquear?: boolean }): Promise<Pago | null>;
  /** Lanza YaHayPagoAbierto si la base lo rechaza por el índice de pago abierto. */
  abstract insertar(pago: PagoNuevo): Promise<void>;
  abstract fijarSesion(
    id: string,
    sesion: { referencia: string; url: string; expiraEn: Date },
  ): Promise<void>;
  /**
   * Devuelve si se aplicó (el pago seguía en `cambio.desde`). Lanza NumeroOperacionYaAprobado si al aprobar
   * el número de operación ya está aprobado en otro pago, de cualquier barbería (FR-022b).
   */
  abstract cambiar(id: string, cambio: CambioDePago): Promise<boolean>;
  /** Número de operación normalizado y fecha declarados con el comprobante (US3). */
  abstract fijarDatosDeTransferencia(
    id: string,
    datos: { numeroOperacion: string; fecha: string },
  ): Promise<void>;
  abstract fijarMotivoRechazo(id: string, motivo: string): Promise<void>;
  /**
   * Número de operación COMPLETO: solo para el detalle que ve el administrador con el tenant de la barbería
   * fijado (H2). Las vistas y la vía de la plataforma solo tienen los últimos 4 caracteres.
   */
  abstract numeroOperacion(id: string): Promise<string | null>;
  /** Período que pagó el pago, si tiene uno. */
  abstract periodoDe(id: string): Promise<{ inicio: Date; fin: Date } | null>;
}

/** Evento del proveedor, sin datos del pagador (FR-013b). */
export interface EventoDelProveedor {
  eventoId: string;
  referencia: string;
  estado: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE' | 'EXPIRADO' | 'DEVUELTO';
  importeCentimos: number;
  moneda: string;
  tenantId: string | null;
  pagoId: string | null;
  efecto: 'APLICADO' | 'SIN_EFECTO' | 'REVISION' | 'SIN_PAGO';
}

/**
 * Eventos del proveedor (provider_event, tabla de la plataforma). El rol de la aplicación solo inserta, sin
 * leer ni actualizar (C1, constitución 1.3.1): `registrar` devuelve si el evento era nuevo.
 */
export abstract class EventoProveedorRepository {
  abstract registrar(evento: EventoDelProveedor): Promise<boolean>;
}

/** Dónde está un pago: su barbería (tenant) y su id. */
export interface UbicacionDePago {
  tenantId: string;
  pagoId: string;
}

/** Un pago en línea pendiente, para la conciliación. */
export interface PagoPendiente extends UbicacionDePago {
  referenciaProveedor: string | null;
  creadoEn: Date;
}

/**
 * Lecturas entre barberías por la vía de la plataforma (ADR-031): solo por una clave exacta (la referencia
 * del proveedor) o la lista de pendientes para la conciliación; nunca con datos del cliente.
 */
export abstract class UbicacionDePagos {
  abstract porReferencia(referenciaProveedor: string): Promise<UbicacionDePago | null>;
  abstract pendientesCreadosAntesDe(instante: Date, limite: number): Promise<PagoPendiente[]>;
  /** Transferencias que siguen esperando comprobante desde antes de `instante` (para expirarlas). */
  abstract esperandoComprobanteAntesDe(instante: Date, limite: number): Promise<UbicacionDePago[]>;
}
