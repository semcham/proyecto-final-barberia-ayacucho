import type { AdelantoCalculado } from './adelantos/domain/politica-adelanto';
import type { CancelacionDeLaCita, CausaDeVencimiento, EstadoAdelanto } from './adelantos/domain/adelanto';

// T009 de 008 · Interfaz pública del adelanto de reserva (research R01). M03 es dueño de los datos y las reglas del
// adelanto; M02 orquesta todo lo que cambia la cita (reservar pendiente, confirmar, vencer, cancelar, no asistió y
// reprogramar) y en cada caso llama aquí, en la MISMA transacción, con la cita ya bloqueada (research R06). La regla
// PR14 adelantos-solo-por-api impide que M02 importe otra cosa del submódulo. La implementación está en
// adelantos/application/adelantos-api-impl.ts; cada fase de 008 completa sus operaciones.

/** El adelanto que corresponde a una reserva, calculado con la configuración vigente al reservar. */
export interface AdelantoParaReservar extends AdelantoCalculado {
  /** El QR vigente al reservar: la cita lo conserva aunque la barbería lo cambie después (FR-004). */
  qrArchivoId: string;
}

/** Lo que M02 pasa al crear el adelanto de una cita PENDIENTE. M03 guarda copias (research R02). */
export interface DatosDelAdelantoNuevo {
  citaId: string;
  clienteId: string;
  /** Cuenta del cliente que reservó: solo ella registra el pago (research R02). */
  usuarioClienteId: string;
  servicio: string;
  precioCentimos: number;
  inicio: Date;
  zonaHoraria: string;
  adelanto: AdelantoParaReservar;
}

/**
 * El registro de pago vigente, o el último rechazado (contracts/openapi.yaml, Adelanto.pago). El número va completo:
 * solo lo ven el cliente de la cita y el propietario de su barbería (FR-011).
 */
export interface PagoDeAdelantoVista {
  numeroOperacion: string;
  tieneCaptura: boolean;
  /** ISO 8601 con el desplazamiento de la barbería. */
  registradoEn: string;
  resultado: 'CONFIRMADO' | 'RECHAZADO' | null;
  motivoRechazo: string | null;
}

/**
 * El adelanto de una cita, como lo ven el cliente y el propietario (contracts/openapi.yaml, Adelanto). Las horas, en
 * ISO 8601 con el desplazamiento de la barbería, como el resto de la API.
 */
export interface ResumenDeAdelanto {
  citaId: string;
  estado: EstadoAdelanto;
  montoCentimos: number;
  precioCentimos: number;
  saldoCentimos: number;
  codigo: string;
  horaLimite: string;
  limiteRevision: string;
  pago: PagoDeAdelantoVista | null;
  devueltoEn: string | null;
}

/**
 * Un adelanto que la tarea vencer-adelantos debe revisar (research R09). Solo lo que el rol de la plataforma puede leer
 * (id y tenant de booking_deposit, data-model §7): la cita la resuelve `citaDelAdelanto` ya con el tenant y RLS.
 */
export interface CandidatoPorVencer {
  tenantId: string;
  adelantoId: string;
}

export interface ResultadoDeVencimiento {
  estado: Extract<EstadoAdelanto, 'VENCIDO' | 'POR_DEVOLVER'>;
  causa: CausaDeVencimiento;
  adelanto: ResumenDeAdelanto;
}

export abstract class AdelantosApi {
  /**
   * Al reservar (FR-005 a FR-007): el adelanto que corresponde, o null si la barbería no lo tiene activo o el
   * servicio cuesta cero. Lanza SinTiempoParaAdelanto si el plazo no cabe antes del inicio menos 30 minutos.
   */
  abstract paraReservar(cita: {
    precioCentimos: number;
    inicio: Date;
    ahora: Date;
  }): Promise<AdelantoParaReservar | null>;

  /** Guarda el adelanto POR_PAGAR con su código y publica AdelantoSolicitado (contracts/eventos.md). */
  abstract crear(datos: DatosDelAdelantoNuevo): Promise<ResumenDeAdelanto>;

  /**
   * POR_REVISAR → CONFIRMADO, con la cita ya bloqueada por M02 (research R06). Sobre uno ya confirmado, sin
   * efecto (efecto: false). Lanza SinPagoRegistrado o AdelantoResuelto.
   */
  abstract confirmar(
    citaId: string,
    actorId: string,
    ahora: Date,
  ): Promise<{ efecto: boolean; adelanto: ResumenDeAdelanto }>;

  /**
   * Lo que decide la tarea de vencimiento sobre la cita bloqueada (FR-017, FR-018): bloquea el adelanto y aplica
   * VENCIDO o POR_DEVOLVER (transición condicional), o devuelve null si aún no corresponde (o ya se resolvió).
   */
  abstract decidirVencimiento(citaId: string, ahora: Date): Promise<ResultadoDeVencimiento | null>;

  /**
   * Candidatos de todas las barberías con la hora límite o el límite máximo adicional cumplidos, en lotes ordenados
   * por id (`despuesDe`: el último id del lote anterior). Es la única operación fuera de la transacción del llamador:
   * lee con el rol de solo lectura de la plataforma las cinco columnas técnicas de booking_deposit (ADR-031, R09).
   */
  abstract porVencer(
    ahora: Date,
    lote: number,
    despuesDe: string | null,
  ): Promise<readonly CandidatoPorVencer[]>;

  /** Fase 5 (US4) · La cita de un adelanto de la barbería de la transacción (con RLS), o null. Sin bloquear. */
  abstract citaDelAdelanto(adelantoId: string): Promise<string | null>;

  /** Al cancelar la cita: ANULADO, POR_DEVOLVER o RETENIDO (research R10). null si la cita no tiene adelanto. */
  abstract alCancelar(
    citaId: string,
    cancelacion: CancelacionDeLaCita,
    ahora: Date,
  ): Promise<EstadoAdelanto | null>;

  /** Al marcar que no asistió: RETENIDO (FR-021). null si la cita no tiene adelanto. */
  abstract alNoAsistir(citaId: string, ahora: Date): Promise<EstadoAdelanto | null>;

  /** Al reprogramar (solo el propietario, research R11): actualiza la copia de la hora y del servicio. */
  abstract alReprogramar(
    citaId: string,
    cita: { inicio: Date; servicio: string; zonaHoraria: string },
  ): Promise<void>;

  /** El adelanto de una cita, o null si no tiene. */
  abstract deCita(citaId: string): Promise<ResumenDeAdelanto | null>;

  /** Los adelantos de varias citas (agenda e historial), por id de cita. */
  abstract deCitas(citaIds: readonly string[]): Promise<ReadonlyMap<string, ResumenDeAdelanto>>;

  /**
   * Fase 4 (US3) · Los adelantos de la bandeja del propietario en un estado (por revisar o por devolver), de la hora
   * límite más próxima a la más lejana, hasta `limite`. M02 les suma la cita y el nombre del cliente.
   */
  abstract enBandeja(
    estado: Extract<EstadoAdelanto, 'POR_REVISAR' | 'POR_DEVOLVER'>,
    limite: number,
  ): Promise<readonly ResumenDeAdelanto[]>;
}
