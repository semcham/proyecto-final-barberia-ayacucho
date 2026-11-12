import {
  AdelantoNoPorDevolver,
  AdelantoResuelto,
  AdelantoVencido,
  PagoYaRegistrado,
  SinPagoRegistrado,
} from './errores';

// T008 de 008 · Estados del adelanto y sus transiciones (data-model §5). Reglas puras: cada operación recibe el
// estado actual y devuelve el siguiente, o rechaza con su error sin efecto. La persistencia aplica la transición
// de forma condicional (WHERE status = $desde) con la cita bloqueada primero (research R06).
//
//                   registrar pago                    confirmar
//    POR_PAGAR ─────────────────────▶ POR_REVISAR ─────────────────▶ CONFIRMADO
//      │  ▲                              │   │                          │
//      │  └──────── rechazar ────────────┘   │ límite máximo            ├─ cancela con tiempo o el
//      │                                     │ adicional                │  propietario ──▶ POR_DEVOLVER ──▶ DEVUELTO
//      │ hora límite                         ▼                          │
//      ├──────────────────▶ VENCIDO     POR_DEVOLVER                    └─ cancela tarde o no asistió ──▶ RETENIDO
//      └─ cancela la cita ──▶ ANULADO        ▲
//                                            └─ cancela la cita con el pago por revisar

export const ESTADOS_ADELANTO = [
  'POR_PAGAR',
  'POR_REVISAR',
  'CONFIRMADO',
  'VENCIDO',
  'ANULADO',
  'POR_DEVOLVER',
  'DEVUELTO',
  'RETENIDO',
] as const;
export type EstadoAdelanto = (typeof ESTADOS_ADELANTO)[number];

/** Plazos guardados con el adelanto al reservar (PoliticaAdelanto). */
export interface PlazosDelAdelanto {
  horaLimite: Date;
  limiteRevision: Date;
}

/** Por qué vence: sin pago a la hora límite, o pago sin revisar al límite máximo adicional. */
export type CausaDeVencimiento = 'SIN_PAGO' | 'SIN_REVISION';

/** Cómo se canceló la cita: por el cliente o por la barbería, y si fue tarde (regla de antelación de 002). */
export interface CancelacionDeLaCita {
  porCliente: boolean;
  tardia: boolean;
}

const PENDIENTES: readonly EstadoAdelanto[] = ['POR_PAGAR', 'POR_REVISAR'];

export const Adelanto = {
  /** POR_PAGAR y POR_REVISAR: la cita sigue PENDIENTE y el horario retenido. */
  estaPendiente(estado: EstadoAdelanto): boolean {
    return PENDIENTES.includes(estado);
  },

  /** El cliente registra su pago: POR_PAGAR → POR_REVISAR, solo antes de la hora límite (FR-009, FR-010). */
  registrarPago(estado: EstadoAdelanto, ahora: Date, plazos: PlazosDelAdelanto): EstadoAdelanto {
    if (estado === 'POR_REVISAR') throw new PagoYaRegistrado();
    if (estado !== 'POR_PAGAR') throw new AdelantoResuelto();
    if (ahora.getTime() >= plazos.horaLimite.getTime()) throw new AdelantoVencido();
    return 'POR_REVISAR';
  },

  /** El propietario rechaza el pago: POR_REVISAR → POR_PAGAR, con la hora límite original (FR-014). */
  rechazar(estado: EstadoAdelanto): EstadoAdelanto {
    if (estado === 'POR_PAGAR') throw new SinPagoRegistrado();
    if (estado !== 'POR_REVISAR') throw new AdelantoResuelto();
    return 'POR_PAGAR';
  },

  /**
   * El propietario confirma: POR_REVISAR → CONFIRMADO (la cita pasa a CONFIRMADA). Repetir sobre uno ya
   * confirmado no tiene efecto (FR-015).
   */
  confirmar(estado: EstadoAdelanto): { estado: EstadoAdelanto; efecto: boolean } {
    if (estado === 'CONFIRMADO') return { estado, efecto: false };
    if (estado === 'POR_PAGAR') throw new SinPagoRegistrado();
    if (estado !== 'POR_REVISAR') throw new AdelantoResuelto();
    return { estado: 'CONFIRMADO', efecto: true };
  },

  /**
   * Lo que decide la tarea de vencimiento (FR-017, FR-018): sin pago a la hora límite → VENCIDO; con el pago sin
   * revisar al límite máximo adicional → POR_DEVOLVER. En cualquier otro caso, nada (null). En los dos casos la
   * cita se cancela sin marca de tardía.
   */
  decidirVencimiento(
    estado: EstadoAdelanto,
    ahora: Date,
    plazos: PlazosDelAdelanto,
  ): { estado: EstadoAdelanto; causa: CausaDeVencimiento } | null {
    if (estado === 'POR_PAGAR' && ahora.getTime() >= plazos.horaLimite.getTime()) {
      return { estado: 'VENCIDO', causa: 'SIN_PAGO' };
    }
    if (estado === 'POR_REVISAR' && ahora.getTime() >= plazos.limiteRevision.getTime()) {
      return { estado: 'POR_DEVOLVER', causa: 'SIN_REVISION' };
    }
    return null;
  },

  /**
   * Se cancela la cita (research R10; FR-019, FR-021): sin pago → ANULADO; con el pago por revisar →
   * POR_DEVOLVER; confirmado → RETENIDO si cancela tarde el cliente, si no POR_DEVOLVER.
   */
  alCancelar(estado: EstadoAdelanto, cancelacion: CancelacionDeLaCita): EstadoAdelanto {
    switch (estado) {
      case 'POR_PAGAR':
        return 'ANULADO';
      case 'POR_REVISAR':
        return 'POR_DEVOLVER';
      case 'CONFIRMADO':
        return cancelacion.porCliente && cancelacion.tardia ? 'RETENIDO' : 'POR_DEVOLVER';
      default:
        throw new AdelantoResuelto();
    }
  },

  /** El cliente no asistió a la cita confirmada: CONFIRMADO → RETENIDO (FR-021). */
  alNoAsistir(estado: EstadoAdelanto): EstadoAdelanto {
    if (estado !== 'CONFIRMADO') throw new AdelantoResuelto();
    return 'RETENIDO';
  },

  /** El propietario marca que lo devolvió: solo desde POR_DEVOLVER (aclaración Q2, FR-022). */
  marcarDevuelto(estado: EstadoAdelanto): EstadoAdelanto {
    if (estado !== 'POR_DEVOLVER') throw new AdelantoNoPorDevolver();
    return 'DEVUELTO';
  },

  /** Lo que el cliente paga el día de la cita (FR-020). */
  saldo(precioCentimos: number, montoCentimos: number): number {
    return precioCentimos - montoCentimos;
  },
};
