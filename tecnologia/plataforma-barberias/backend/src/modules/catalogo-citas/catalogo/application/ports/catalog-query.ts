import type { FechaLocal, Tramo } from '../../../../../shared';

export interface ServicioVigente {
  servicioId: string;
  nombre: string;
  /** Soles, como texto decimal (numeric de PostgreSQL). */
  precio: string;
  duracionMin: number;
}

export interface BarberoDelServicio {
  barberoId: string;
  nombre: string;
}

export interface Intervalo {
  inicio: Date;
  fin: Date;
}

/**
 * T031 · Lecturas del catálogo de la barbería del contexto (transacción con el tenant del token). Las usan
 * la reserva (FR-030), el cálculo de horarios con sesión y las marcas de la agenda. Está en la fase base
 * para que la reserva (US3) no dependa de las historias del catálogo (US1, US2).
 */
export abstract class CatalogQuery {
  /** Servicio ACTIVO de la barbería, o null (inexistente, de otra barbería o inactivo). */
  abstract servicioActivo(servicioId: string): Promise<ServicioVigente | null>;
  /** Verdadero si el barbero está activo y tiene asignado el servicio. */
  abstract barberoOfrece(barberoId: string, servicioId: string): Promise<boolean>;
  /** Disponibilidad del barbero ∩ horario de atención de la barbería, para el día de la semana de la fecha. */
  abstract tramosDelDia(barberoId: string, fecha: FechaLocal): Promise<Tramo[]>;
  /** Bloqueos del barbero que se solapan con [desde, hasta). */
  abstract bloqueosEnRango(barberoId: string, desde: Date, hasta: Date): Promise<Intervalo[]>;
  /** Barberos activos que ofrecen el servicio, por nombre. */
  abstract barberosQueOfrecen(servicioId: string): Promise<BarberoDelServicio[]>;
}
