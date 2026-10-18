import { ReservaInvalida, TransicionInvalida } from '../../catalogo/domain/errores';
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
}

/**
 * T091 · Cita (RF12; FR-008, FR-035a). Que no haya dos citas activas del mismo barbero que se solapen NO
 * lo decide esta entidad: lo garantiza la restricción de exclusión de PostgreSQL (principio IV).
 *
 * T104 · Transiciones de la barbería (RF15; FR-041, FR-042; R10): `aprobar` (PENDIENTE → CONFIRMADA),
 * `completar` y `marcarNoAsistio` (CONFIRMADA → COMPLETADA o NO_ASISTIO, desde la hora de inicio).
 * COMPLETADA, NO_ASISTIO y CANCELADA son finales. La cancelación (RF14) llega con US5.
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
  }): Cita {
    if (entrada.inicio.getTime() <= entrada.ahora.getTime()) throw new ReservaInvalida('HORA_PASADA');
    return new Cita({
      id: entrada.id,
      barberoId: entrada.barberoId,
      clienteId: entrada.clienteId,
      servicio: { ...entrada.servicio },
      rango: RangoHorario.desde(entrada.inicio, entrada.servicio.duracionMin),
      // Toda cita nueva nace confirmada (FR-035a): ningún flujo de 002 crea citas pendientes.
      estado: 'CONFIRMADA',
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

  ocupaHorario(): boolean {
    return ocupaHorario(this.datos.estado);
  }

  /** PENDIENTE → CONFIRMADA. */
  aprobar(): void {
    this.transicion('CONFIRMADA', this.datos.estado === 'PENDIENTE');
  }

  /** CONFIRMADA → COMPLETADA, solo desde la hora de inicio (no se completa una cita futura). */
  completar(ahora: Date): void {
    this.transicion('COMPLETADA', this.datos.estado === 'CONFIRMADA' && this.empezo(ahora));
  }

  /** CONFIRMADA → NO_ASISTIO, solo desde la hora de inicio. */
  marcarNoAsistio(ahora: Date): void {
    this.transicion('NO_ASISTIO', this.datos.estado === 'CONFIRMADA' && this.empezo(ahora));
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
