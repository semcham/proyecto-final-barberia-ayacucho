import { ReservaInvalida } from '../../catalogo/domain/errores';
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
 * lo decide esta entidad: lo garantiza la restricción de exclusión de PostgreSQL (principio IV). Las
 * transiciones de estado (RF14, RF15) se agregan con US4 y US5.
 */
export class Cita {
  private constructor(private readonly datos: DatosCita) {}

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
}
