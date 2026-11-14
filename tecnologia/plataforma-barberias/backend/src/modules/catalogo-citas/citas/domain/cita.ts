import {
  DatoInvalido,
  ReservaInvalida,
  SinAntelacionParaReprogramar,
  TransicionInvalida,
} from '../../catalogo/domain/errores';
import { RangoHorario } from '../../catalogo/domain/rango-horario';
import { type EstadoCita, ocupaHorario } from './estado-cita';

export type OrigenCita = 'EN_LINEA' | 'PRESENCIAL';

/** Copia del servicio al reservar (FR-008): los cambios posteriores del servicio no alteran la cita. */
export interface ServicioDeLaCita {
  servicioId: string;
  nombre: string;
  /** Soles, como texto decimal. */
  precio: string;
  duracionMin: number;
}

export interface DatosCita {
  id: string;
  barberoId: string;
  clienteId: string;
  servicio: ServicioDeLaCita;
  rango: RangoHorario;
  estado: EstadoCita;
  origen: OrigenCita;
  cancelacionTardia: boolean;
  creadoPor: string;
  /** Quién canceló, cuándo y por qué (FR-039); null mientras no esté cancelada. */
  cancelacion?: Cancelacion | null;
  /**
   * 004: sube al reprogramar, cancelar, completar o marcar no asistió; invalida los enlaces de acción emitidos
   * con la versión anterior. 1 si no se indica (cita recién reservada).
   */
  version?: number;
  /** 004: cuándo el cliente confirmó su asistencia por el enlace; null = "sin confirmar" (FR-028). */
  confirmadaPorClienteEn?: Date | null;
}

/** Quién reprograma: el cliente (sus citas, con antelación) o el propietario (cualquiera, sin antelación). */
export interface QuienReprograma {
  rol: 'CLIENTE' | 'PROPIETARIO';
  /** Null si reprogramó el cliente por un enlace de acción (004). */
  usuarioId: string | null;
}

/** Barbero e inicio de la cita antes de reprogramarla. */
export interface PosicionDeCita {
  barberoId: string;
  inicio: Date;
}

export interface ResultadoReprogramacion {
  /** false si la cita ya estaba en esa hora y con ese barbero: no cambia nada ni se avisa. */
  cambio: boolean;
  anterior: PosicionDeCita;
}

export interface Cancelacion {
  /** Null si canceló el cliente por un enlace de acción, sin sesión (004). */
  por: string | null;
  en: Date;
  motivo: string | null;
}

/**
 * Quién cancela: el cliente (sus citas, hasta el inicio) o el propietario (cualquiera, nunca tardía). Por un enlace
 * de acción (004) es el cliente sin usuario (`usuarioId` null).
 */
export interface QuienCancela {
  rol: 'CLIENTE' | 'PROPIETARIO';
  usuarioId: string | null;
}

/** Lo que trae un enlace de acción verificado sobre la cita (contracts/enlaces-de-accion.md §3). */
export interface EnlaceSobreCita {
  accion: 'CONFIRMAR' | 'REPROGRAMAR' | 'CANCELAR';
  version: number;
}

const MINUTO_MS = 60 * 1000;
const MOTIVO_MAXIMO = 200;

/**
 * T091 · Cita (RF12; FR-008, FR-035a). Que no haya dos citas activas del mismo barbero que se solapen NO
 * lo decide esta entidad: lo garantiza la restricción de exclusión de PostgreSQL (principio IV).
 *
 * T104 · Transiciones de la barbería (RF15; FR-041, FR-042; R10): `aprobar` (PENDIENTE → CONFIRMADA),
 * `completar` y `marcarNoAsistio` (CONFIRMADA → COMPLETADA o NO_ASISTIO, desde la hora de inicio).
 * COMPLETADA, NO_ASISTIO y CANCELADA son finales.
 *
 * T116 · Cancelación (RF14; FR-036 a FR-039): `cancelar` desde PENDIENTE o CONFIRMADA. El cliente, hasta
 * la hora de inicio; es tardía si `inicio − ahora < antelación` de la barbería. El propietario cancela
 * cualquier cita activa y nunca genera una cancelación tardía.
 *
 * 004 (T046) · Reprogramación (RF13; FR-001 a FR-007): `reprogramar` mueve la MISMA cita a otra hora (y quizá
 * a otro barbero), con la duración copiada al reservar. Queda CONFIRMADA, con la versión + 1 y sin la
 * confirmación del cliente. Que la hora nueva no choque con otra cita lo garantiza PostgreSQL (principio IV).
 */
export class Cita {
  private constructor(private datos: DatosCita) {}

  static reservar(entrada: {
    id: string;
    barberoId: string;
    clienteId: string;
    servicio: ServicioDeLaCita;
    inicio: Date;
    origen: OrigenCita;
    creadoPor: string;
    ahora: Date;
    /**
     * 008 (research R03): la reserva del cliente con el adelanto activo nace PENDIENTE (ocupa el horario igual) y se
     * confirma con `aprobar` al confirmar el adelanto.
     */
    pendiente?: boolean;
  }): Cita {
    if (entrada.inicio.getTime() <= entrada.ahora.getTime()) throw new ReservaInvalida('HORA_PASADA');
    return new Cita({
      id: entrada.id,
      barberoId: entrada.barberoId,
      clienteId: entrada.clienteId,
      servicio: { ...entrada.servicio },
      rango: RangoHorario.desde(entrada.inicio, entrada.servicio.duracionMin),
      // Sin adelanto, toda cita nueva nace confirmada (FR-035a de 002); con adelanto, pendiente (008).
      estado: entrada.pendiente ? 'PENDIENTE' : 'CONFIRMADA',
      origen: entrada.origen,
      cancelacionTardia: false,
      creadoPor: entrada.creadoPor,
    });
  }

  static reconstruir(datos: DatosCita): Cita {
    return new Cita({ ...datos, servicio: { ...datos.servicio } });
  }

  get id(): string {
    return this.datos.id;
  }
  get barberoId(): string {
    return this.datos.barberoId;
  }
  get clienteId(): string {
    return this.datos.clienteId;
  }
  get servicio(): ServicioDeLaCita {
    return { ...this.datos.servicio };
  }
  get rango(): RangoHorario {
    return this.datos.rango;
  }
  get estado(): EstadoCita {
    return this.datos.estado;
  }
  get origen(): OrigenCita {
    return this.datos.origen;
  }
  get cancelacionTardia(): boolean {
    return this.datos.cancelacionTardia;
  }
  get creadoPor(): string {
    return this.datos.creadoPor;
  }

  get cancelacion(): Cancelacion | null {
    return this.datos.cancelacion ?? null;
  }

  get version(): number {
    return this.datos.version ?? 1;
  }

  get confirmadaPorClienteEn(): Date | null {
    return this.datos.confirmadaPorClienteEn ?? null;
  }

  /**
   * Mueve la cita a `destino` (FR-001 a FR-007). Solo una cita PENDIENTE o CONFIRMADA que aún no empezó. El
   * cliente necesita la antelación de cancelación de la barbería (con exactamente esa antelación, sí puede);
   * el propietario no. A la misma hora y con el mismo barbero no cambia nada.
   */
  reprogramar(
    destino: PosicionDeCita,
    quien: QuienReprograma,
    ahora: Date,
    antelacionMinutos: number,
  ): ResultadoReprogramacion {
    const anterior: PosicionDeCita = { barberoId: this.datos.barberoId, inicio: this.datos.rango.inicio };
    if (!this.ocupaHorario() || this.empezo(ahora)) {
      throw new TransicionInvalida(this.datos.estado, 'REPROGRAMADA');
    }
    if (destino.barberoId === anterior.barberoId && destino.inicio.getTime() === anterior.inicio.getTime()) {
      return { cambio: false, anterior };
    }
    if (
      quien.rol === 'CLIENTE' &&
      ahora.getTime() > this.cancelacionTardiaDesde(antelacionMinutos).getTime()
    ) {
      throw new SinAntelacionParaReprogramar();
    }
    if (destino.inicio.getTime() <= ahora.getTime()) throw new ReservaInvalida('HORA_PASADA');
    this.datos = {
      ...this.datos,
      barberoId: destino.barberoId,
      rango: RangoHorario.desde(destino.inicio, this.datos.servicio.duracionMin),
      // Una cita reprogramada queda confirmada y sin la marca de asistencia del cliente (FR-007).
      estado: 'CONFIRMADA',
      confirmadaPorClienteEn: null,
      version: this.version + 1,
    };
    return { cambio: true, anterior };
  }

  ocupaHorario(): boolean {
    return ocupaHorario(this.datos.estado);
  }

  /** Instante desde el cual una cancelación del cliente sería tardía: inicio − antelación. */
  cancelacionTardiaDesde(antelacionMinutos: number): Date {
    return new Date(this.datos.rango.inicio.getTime() - antelacionMinutos * MINUTO_MS);
  }

  cancelar(quien: QuienCancela, ahora: Date, antelacionMinutos: number, motivo?: string | null): void {
    const esCliente = quien.rol === 'CLIENTE';
    const limpio = motivo?.trim() ?? '';
    if ([...limpio].length > MOTIVO_MAXIMO) throw new DatoInvalido('motivo', 'longitud');
    this.transicion('CANCELADA', this.ocupaHorario() && !(esCliente && this.empezo(ahora)));
    this.datos = {
      ...this.datos,
      version: this.version + 1,
      cancelacionTardia:
        esCliente && ahora.getTime() > this.cancelacionTardiaDesde(antelacionMinutos).getTime(),
      cancelacion: { por: quien.usuarioId, en: ahora, motivo: limpio || null },
    };
  }

  /**
   * 004 (T076; contracts/enlaces-de-accion.md §3): el enlace vale para esta cita si es de la acción de la ruta, de
   * la versión actual (cualquier cambio de la cita lo invalida), y la cita sigue activa y no empezó.
   */
  aceptaEnlace(enlace: EnlaceSobreCita, accionDeLaRuta: EnlaceSobreCita['accion'], ahora: Date): boolean {
    return (
      enlace.accion === accionDeLaRuta &&
      enlace.version === this.version &&
      this.ocupaHorario() &&
      !this.empezo(ahora)
    );
  }

  /**
   * 004 (T088, FR-028): el cliente confirma su asistencia por el enlace. NO cambia la versión: el enlace de cancelar
   * del mismo recordatorio sigue valiendo.
   */
  confirmarAsistencia(ahora: Date): void {
    if (!this.ocupaHorario() || this.empezo(ahora)) {
      throw new TransicionInvalida(this.datos.estado, 'CONFIRMADA_POR_EL_CLIENTE');
    }
    this.datos = { ...this.datos, confirmadaPorClienteEn: ahora };
  }

  /**
   * 008 (T051; FR-016, FR-018): la tarea vencer-adelantos cancela la cita PENDIENTE cuyo adelanto venció (sin pago a
   * la hora límite, o con el pago sin revisar al límite máximo adicional). Nunca es tardía y no tiene autor: la
   * cancela la plataforma. Sube la versión, como toda cancelación.
   */
  vencerAdelanto(ahora: Date): void {
    this.transicion('CANCELADA', this.datos.estado === 'PENDIENTE');
    this.datos = {
      ...this.datos,
      version: this.version + 1,
      cancelacionTardia: false,
      cancelacion: { por: null, en: ahora, motivo: null },
    };
  }

  /** PENDIENTE → CONFIRMADA. */
  aprobar(): void {
    this.transicion('CONFIRMADA', this.datos.estado === 'PENDIENTE');
  }

  /** CONFIRMADA → COMPLETADA, solo desde la hora de inicio (no se completa una cita futura). */
  completar(ahora: Date): void {
    this.transicion('COMPLETADA', this.datos.estado === 'CONFIRMADA' && this.empezo(ahora));
    this.datos = { ...this.datos, version: this.version + 1 };
  }

  /** CONFIRMADA → NO_ASISTIO, solo desde la hora de inicio. */
  marcarNoAsistio(ahora: Date): void {
    this.transicion('NO_ASISTIO', this.datos.estado === 'CONFIRMADA' && this.empezo(ahora));
    this.datos = { ...this.datos, version: this.version + 1 };
  }

  /** Aplica la transición de la barbería hacia `destino` (POST /citas/{id}/estado). */
  cambiarA(destino: 'CONFIRMADA' | 'COMPLETADA' | 'NO_ASISTIO', ahora: Date): void {
    if (destino === 'CONFIRMADA') this.aprobar();
    else if (destino === 'COMPLETADA') this.completar(ahora);
    else this.marcarNoAsistio(ahora);
  }

  private empezo(ahora: Date): boolean {
    return ahora.getTime() >= this.datos.rango.inicio.getTime();
  }

  private transicion(destino: EstadoCita, permitida: boolean): void {
    if (!permitida) throw new TransicionInvalida(this.datos.estado, destino);
    this.datos = { ...this.datos, estado: destino };
  }
}
