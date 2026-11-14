import type { EstadoAdelanto } from '../../domain/adelanto';

/** Un adelanto guardado (booking_deposit), con las copias que M03 guarda de la cita (research R02). */
export interface AdelantoGuardado {
  id: string;
  citaId: string;
  clienteId: string;
  usuarioClienteId: string;
  codigo: string;
  montoCentimos: number;
  precioCentimos: number;
  servicio: string;
  inicio: Date;
  zonaHoraria: string;
  qrArchivoId: string;
  horaLimite: Date;
  limiteRevision: Date;
  estado: EstadoAdelanto;
  resueltoEn: Date | null;
  devueltoEn: Date | null;
}

/** Lo que se guarda al crear un adelanto POR_PAGAR (el id y el código los pone el repositorio). */
export type AdelantoNuevo = Omit<AdelantoGuardado, 'id' | 'codigo' | 'estado' | 'resueltoEn' | 'devueltoEn'>;

/** Un registro de pago del cliente (booking_deposit_payment). */
export interface PagoDeAdelanto {
  id: string;
  adelantoId: string;
  numeroOperacion: string;
  archivoId: string | null;
  registradoEn: Date;
  registradoPor: string;
  resultado: 'CONFIRMADO' | 'RECHAZADO' | null;
  revisadoEn: Date | null;
  motivoRechazo: string | null;
}

export type PagoNuevo = Pick<
  PagoDeAdelanto,
  'id' | 'adelantoId' | 'numeroOperacion' | 'archivoId' | 'registradoEn' | 'registradoPor'
>;

/**
 * T029 de 008 · Adelantos y registros de pago de la barbería de la transacción en curso (RLS y filtro explícito por
 * tenant). Las transiciones de estado son condicionales (`WHERE status = $desde`, research R06).
 */
export abstract class AdelantoRepository {
  /**
   * Guarda el adelanto POR_PAGAR con un código de reserva nuevo, único en la barbería. Un código repetido no aborta
   * la transacción de la reserva: se inserta con ON CONFLICT DO NOTHING y se prueba otro (research R07).
   */
  abstract crear(nuevo: AdelantoNuevo): Promise<AdelantoGuardado>;

  /** El adelanto de la cita, o null. Con `bloquear`, FOR UPDATE hasta el fin de la transacción. */
  abstract deCita(citaId: string, opciones?: { bloquear?: boolean }): Promise<AdelantoGuardado | null>;

  /** Fase 5 · La cita de un adelanto de la barbería, o null (otro tenant o inexistente: RLS). */
  abstract citaDe(adelantoId: string): Promise<string | null>;

  /** Los adelantos de varias citas (las que no tienen, no aparecen). */
  abstract deCitas(citaIds: readonly string[]): Promise<AdelantoGuardado[]>;

  /** El último registro de pago de cada adelanto (vigente o el último rechazado), por id del adelanto. */
  abstract ultimosPagos(adelantoIds: readonly string[]): Promise<Map<string, PagoDeAdelanto>>;

  /**
   * Guarda el registro de pago. Un número ya usado en la barbería se traduce a NumeroOperacionRepetido y un segundo
   * registro vigente del mismo adelanto a PagoYaRegistrado (las garantías son de la base, también a la vez).
   */
  abstract registrarPago(nuevo: PagoNuevo): Promise<void>;

  /**
   * Anota la revisión del propietario en el registro de pago vigente (solo si aún no se revisó); false si ya estaba
   * revisado. El motivo, solo en un rechazo (CHECK de la base).
   */
  abstract revisarPago(
    pagoId: string,
    revision: { resultado: 'CONFIRMADO' | 'RECHAZADO'; por: string; en: Date; motivo: string | null },
  ): Promise<boolean>;

  /** Adelantos en un estado (la bandeja), de la hora límite más próxima a la más lejana, hasta `limite`. */
  abstract porEstado(estado: EstadoAdelanto, limite: number): Promise<AdelantoGuardado[]>;

  /**
   * Fase 6 · POR_DEVOLVER → DEVUELTO con la fecha y quién lo marcó (CHECK booking_deposit_devuelto); false si ya no
   * estaba por devolver.
   */
  abstract marcarDevuelto(adelantoId: string, devolucion: { por: string; en: Date }): Promise<boolean>;

  /** Fase 6 · La copia de la hora y el servicio de la cita, al reprogramarla (research R02, R11). */
  abstract actualizarCopiaDeLaCita(
    citaId: string,
    cita: { inicio: Date; servicio: string; zonaHoraria: string },
  ): Promise<void>;

  /** Transición condicional del estado; false si el adelanto ya no estaba en `desde`. */
  abstract cambiarEstado(
    adelantoId: string,
    cambio: { desde: EstadoAdelanto; hacia: EstadoAdelanto; en: Date },
  ): Promise<boolean>;
}
